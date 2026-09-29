/**
 * The settings panel: managing 表情包 and 表情.
 *
 * The rules this panel applies — which labels and pack names are legal, how the
 * list is sorted and titled, what an empty pack looks like, what a search
 * matches, which files may be deleted, whether an archive may be imported — all
 * live in `core/`. What is here is the DOM, the file dialogs and the calls into
 * SillyTavern's endpoints.
 *
 * **The pack list is a grid, and that is the whole shape of it.** A 表情 is a
 * square with its 标签 under it and nothing else — no tick, no fields, no
 * buttons. Everything a user does to one sticker happens in the editor
 * (`adapter/sticker-editor.js`), which is a layer over this panel rather than a
 * row in it, and every 批量 operation happens in the batch mode one pack's header
 * switches on. Both of those used to be on screen all the time, which is why a
 * pack of ten stickers was sixty controls and twenty rows.
 *
 * **Every sentence on screen comes from `core/i18n.js`.** There is no English
 * literal left in this file to translate later: the reason a half-finished
 * panel is embarrassing is that it is invisible until a user opens it, and the
 * only way to keep that from happening is for there to be no second place a
 * sentence could be written. Which language those sentences come from is
 * `adapter/locale.js`'s one fact, read once at mount.
 *
 * The fixed skeleton is assembled with `innerHTML`, because it is markup with no
 * user data in it. Everything the user typed or named goes in through
 * `textContent`, and the two places a sentence sits beside a code sample build
 * the sample as its own element — which is also why there is no escaping lookup
 * here: a value that never reaches `innerHTML` cannot need escaping.
 */

import { findPackByName, validateStickerTag } from '../core/constraints.js';
import { addImportedPack, removePack, removeStickers, replaceStickerImage } from '../core/catalogue.js';
import { findConflicts } from '../core/conflict.js';
import { renamePackInScope, scopeHasPack, setPackInScope } from '../core/effective-set.js';
import {
    PACK_STATES,
    isStickerImageMissing,
    packCoverImage,
    packState,
    searchLibrary,
    sortPacks,
} from '../core/library.js';
import {
    SUGGESTED_MAX_HEIGHT_PX,
    acceptedImageTypes,
    exceedsSuggestedHeight,
    isExternalImageUrl,
    validateExternalImageUrl,
} from '../core/image-rules.js';
import { t } from '../core/i18n.js';
import { normalizeLabel } from '../core/normalize.js';
import { importFailureMessage, planImport } from '../core/manifest.js';
import { buildPackArchive, downloadBlob, readPackArchive } from './archive.js';
import { filePickerButton, iconButton, iconize, markIcon } from './buttons.js';
import { collapseBlock } from './collapsible.js';
import { mountDebugSection } from './debug-panel.js';
import { askForText, confirmWithUser, copyText, toast } from './dialogs.js';
import { checkPackName, constraintMessage } from './field-checks.js';
import { useClientLocale } from './locale.js';
import { logError } from './log.js';
import { effectiveSetForMessage } from './render-common.js';
import { setEnabled } from './render-path.js';
import { allowStickerTag, rerenderChat } from './rendering.js';
import { clearContextRegexJson } from './regex.js';
import { mountSizingSection } from './sizing-panel.js';
import {
    collectCharacterPackNames,
    getChatScope,
    getCurrentCharacter,
    getCurrentCharacterScope,
    missingPackNames,
    setChatScope,
    setCurrentCharacterScope,
} from './scope.js';
import {
    createPack,
    createSticker,
    ensureSettings,
    isPackEnabled,
    newId,
    renamePack,
    setPackEnabled,
} from './settings.js';
import { closeStickerEditor, openStickerEditor } from './sticker-editor.js';
import {
    deleteStickerImage,
    imageFileChecker,
    listOwnImageFiles,
    uploadImage,
    uploadStickerImage,
} from './upload.js';

/** The file dialog's filter, derived from the rules rather than written out. */
const ACCEPTED_MIME = acceptedImageTypes();

/**
 * The file names of our own images that are on this server, and the predicate
 * built from them. Refreshed whenever the panel mounts and after anything that
 * changes the set (an upload, a delete, an import) — a pack whose images did not
 * travel with the settings is only detectable by asking the server.
 *
 * @type {Set<string>|null}
 */
let storedImageFiles = null;

/**
 * The panel's own state that has to outlive a repaint: which stickers the user
 * has ticked, which pack is open, and which pack is in 批量 mode.
 *
 * **Module state on purpose, all three.** `renderPackList` rebuilds the pack
 * list from scratch on every change, so anything held on an element is gone by
 * the next keystroke's repaint. A selection that reset itself on the first
 * re-render would be unusable, and an accordion or a batch mode that snapped
 * shut on every tick would be worse than not existing.
 *
 * **They do not outlive a *mount*** — `mountSettingsPanel` clears all three,
 * because a mount is a page load as far as the client is concerned. A test that
 * mounted the panel and found a cell already ticked from an earlier test would
 * be reading a state no user has ever been in.
 *
 * `openPackName` and `batchPackName` are names rather than elements for a second
 * reason: a rename changes a pack's name, and a state holding the old one would
 * leave the panel stuck.
 *
 * @type {Set<string>}
 */
const selectedStickerIds = new Set();

/** @type {string|null} */
let openPackName = null;

/** @type {string|null} */
let batchPackName = null;

/**
 * @param {any} context
 */
function saveAndRefresh(context) {
    context.saveSettingsDebounced();
    rerenderChat(context);
}


/**
 * @param {any} context
 * @returns {Promise<void>} Resolves once the stored-file listing is in hand.
 */
async function refreshStoredImages(context) {
    storedImageFiles = await listOwnImageFiles(context);
}

/**
 * Whether a sticker's image file is on this server right now.
 *
 * @param {{image?: string}} sticker
 * @returns {boolean}
 */
function stickerImageMissing(sticker) {
    return isStickerImageMissing(sticker, imageFileChecker(storedImageFiles));
}

/**
 * The panel's fixed skeleton: the intro and the status line, then the four
 * blocks the panel is sorted into — 表情包 (the content), 渲染, 外观 and
 * 接入与工具 — the pack creator, the macro and regex hints, the import row, and
 * the place the pack list goes.
 *
 * **The order is the point, and it is content first.** The library is what a
 * user opens this panel to change; everything else is configuration. So the
 * packs, their search box and their create row come before any setting, and the
 * pack list scrolls inside its own box rather than pushing the settings off the
 * bottom of the panel.
 *
 * Only markup and ids here — every visible word is filled in afterwards through
 * `textContent`, because a sentence carrying a user's pack name must not be able
 * to arrive as an element.
 *
 * @returns {string}
 */
function panelSkeleton() {
    return [
        '<div class="inline-drawer-toggle inline-drawer-header">',
        '<b>st-emote</b>',
        // Nothing else in the header. A read-out here (how many packs are on, or
        // simply "off") was there so the state would be legible while the panel
        // is collapsed — which it mostly was, except that the status line inside
        // the panel already says the same thing, and a row of numbers sitting
        // next to the name in a list of extension drawers is noise rather than
        // information. The state is one click away, and the 总开关's own row says
        // it more directly.
        '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>',
        '</div>',
        '<div class="inline-drawer-content">',
        '<div class="st-emote-hint" id="st_emote_intro"></div>',

        // The status line and the one warning that belongs beside it. Both are
        // repainted by `paintStatus`; neither is a control.
        '<div class="st-emote-status" id="st_emote_status">',
        '<span class="st-emote-status-dot"></span>',
        '<span class="st-emote-status-text" id="st_emote_status_text"></span>',
        '<span class="st-emote-status-counts" id="st_emote_status_counts"></span>',
        '</div>',
        '<div class="st-emote-status st-emote-status-warn" id="st_emote_conflicts" hidden></div>',

        // ── the library: the panel's content, and the reason it is open ──────
        '<div class="st-emote-block" id="st_emote_block_library">',
        '<div class="st-emote-block-head">',
        '<div class="st-emote-block-title" id="st_emote_library_title"></div>',
        '<div class="st-emote-block-note" id="st_emote_library_note"></div>',
        '</div>',
        // Shown only while the library is empty, and then it is the first thing
        // under the title — a user with no packs has nothing else to read, and
        // the four steps are the whole feature.
        '<div class="st-emote-start" id="st_emote_start" hidden>',
        '<div class="st-emote-start-title" id="st_emote_start_title"></div>',
        '<ol class="st-emote-start-steps" id="st_emote_start_steps"></ol>',
        '<div class="st-emote-hint" id="st_emote_start_hint"></div>',
        '</div>',
        // The search box and the create row are the library's own toolbar: the
        // search filters the list right below it and the create row puts
        // something *into* that same list, so they sit together above it.
        // Neither is behind a header, for the same reason — both are reachable
        // without deciding to open anything first.
        '<div class="st-emote-search">',
        '<input type="text" class="text_pole" id="st_emote_search">',
        '</div>',
        '<div class="st-emote-create">',
        // A `<label for>` rather than a wrapping one: the row holds the create
        // button, and a control inside a label is a browser's problem to
        // resolve. The sentence is the field's own name, which is also its
        // placeholder — a field this short does not need two ways of saying it.
        '<label class="st-emote-create-label" id="st_emote_new_pack_label" for="st_emote_new_pack"></label>',
        '<input type="text" class="text_pole" id="st_emote_new_pack">',
        '<div class="menu_button st-emote-button" id="st_emote_create_pack"></div>',
        '</div>',
        '<div id="st_emote_missing" class="st-emote-missing"></div>',
        '<div id="st_emote_packs" class="st-emote-packs"></div>',
        '</div>',

        // ── 渲染: what gets rendered at all, and how a 标记 is written ───────
        '<div class="st-emote-block" id="st_emote_block_rendering">',
        '<div class="st-emote-block-title" id="st_emote_render_title"></div>',
        // The 总开关 gets a row of its own rather than sharing the checkbox
        // every other setting uses: it is the one control that decides whether
        // the extension does anything, and the consequence of turning it off is
        // a paragraph — which is why that paragraph is on screen only while it
        // is off, and always on the row as its tooltip.
        '<label class="st-emote-master" id="st_emote_master">',
        '<input type="checkbox" id="st_emote_enabled"> <span id="st_emote_enabled_label"></span>',
        '</label>',
        '<div class="st-emote-hint" id="st_emote_enabled_hint"></div>',
        '<label class="st-emote-option">',
        '<input type="checkbox" id="st_emote_render_user"> <span id="st_emote_render_user_label"></span>',
        '</label>',
        '<div class="st-emote-subtitle" id="st_emote_form_label"></div>',
        '<label class="st-emote-option">',
        '<input type="checkbox" id="st_emote_bracket_form"> <span id="st_emote_bracket_form_label"></span>',
        '</label>',
        '<label class="st-emote-option">',
        '<input type="checkbox" id="st_emote_tag_form"> <span id="st_emote_tag_form_label"></span>',
        '</label>',
        // Indented under the two switches above, because it configures the
        // second of them rather than standing on its own.
        '<label class="st-emote-option st-emote-suboption">',
        '<span id="st_emote_tag_name_label"></span>',
        '<input type="text" class="text_pole" id="st_emote_tag_name">',
        '</label>',
        '<div class="st-emote-hint" id="st_emote_form_hint"></div>',
        '</div>',

        // ── 外观: where a rendered one lands and how big it is ───────────────
        '<div class="st-emote-block" id="st_emote_block_appearance">',
        '<div class="st-emote-block-title" id="st_emote_look_title"></div>',
        // The em/px/% sentence lives here rather than beside the 总开关, because
        // it is about these two 尺寸集 and about nothing else. It is also the
        // block title's tooltip, so the long form is one hover away.
        '<div class="st-emote-hint" id="st_emote_size_hint"></div>',
        '<label class="st-emote-field">',
        '<span id="st_emote_placement_label"></span>',
        '<select class="text_pole" id="st_emote_placement"></select>',
        '</label>',
        // The two 尺寸集 fill this one container, each as a collapsed section of
        // its own (see `mountSizingSection`). 投放方式 stays outside them: one
        // select does not deserve a drawer, and the 外观 block as a whole is the
        // one section of the panel that never closes.
        '<div id="st_emote_sizes" class="st-emote-sizes"></div>',
        '</div>',

        // ── 接入与工具: everything read once, then never again ───────────────
        '<div class="st-emote-block" id="st_emote_block_tools">',
        '<div class="st-emote-block-title" id="st_emote_tools_title"></div>',
        // The three explanation blocks, each wrapped in a collapsed section once
        // the panel mounts: a paragraph plus a sample is a page of panel nobody
        // reads, and it is the same text once they open it. The wrappers carry
        // ids so the sections can be built around the markup below rather than
        // this file spelling the drawer out three times.
        '<div id="st_emote_macro_block">',
        '<div class="st-emote-hint" id="st_emote_macro_hint"></div>',
        '<pre class="st-emote-code" id="st_emote_macro_example"></pre>',
        '</div>',
        '<div id="st_emote_regex_block">',
        '<div class="st-emote-hint" id="st_emote_regex_hint"></div>',
        '<pre class="st-emote-code" id="st_emote_regex"></pre>',
        '<div class="menu_button st-emote-button" id="st_emote_copy_regex"></div>',
        '</div>',
        '<div id="st_emote_transfer_block">',
        '<div class="st-emote-hint" id="st_emote_transfer_hint"></div>',
        '<div class="st-emote-import">',
        '<div class="menu_button st-emote-button" id="st_emote_import_pack"></div>',
        '</div>',
        '</div>',
        '</div>',
        '</div>',
    ].join('');
}

/**
 * The intro paragraph, which is the one place a sentence and a code sample sit
 * side by side. Built as its own element tree rather than one string so the
 * sample keeps its `<code>` styling while the prose stays plain text.
 *
 * **The caption sits on its own line** so the sample below it is one unbroken
 * run of characters. A marker the user has to read is a marker they cannot
 * mistype, and a caption in front of it costs the panel one line.
 *
 * @param {any} context
 * @param {HTMLElement} target
 */
function fillIntro(context, target) {
    target.textContent = t('panel.intro');
    const caption = document.createElement('div');
    caption.className = 'st-emote-intro-token';
    caption.textContent = `${t('panel.introTokenCaption')} `;
    const example = document.createElement('code');
    example.textContent = t('panel.tokenExample');
    target.append(caption, example);
}

/**
 * The first-run card: the four steps, in order, for a user with no packs at all.
 *
 * Built here rather than in the skeleton because the steps are a list and the
 * skeleton holds markup only. The last step is the one everybody misses — with
 * no `{{st-emote}}` in a preset the model is never told which labels exist, so
 * it never writes a token and the whole feature looks broken.
 *
 * @param {HTMLElement} target - The `<ol>` the steps go into.
 */
function fillStartSteps(target) {
    target.textContent = '';
    for (const key of [
        'panel.startStep1',
        'panel.startStep2',
        'panel.startStep3',
        'panel.startStep4',
    ]) {
        const step = document.createElement('li');
        step.textContent = t(key);
        target.append(step);
    }
}

/**
 * Repaint the two read-outs that answer "what is in play right now": the status
 * line under the intro, and the shorter one in the drawer's own header.
 *
 * **The numbers come from the same 生效集 the macro listing and the debug
 * preview read** (`effectiveSetForMessage(context, -1)` — the message id a
 * streaming preview carries, which falls back to the selected character). One
 * source, so the status line cannot disagree with the listing the model is
 * actually given.
 *
 * Two counts are two sentences rather than one sentence with two values in it:
 * `t` picks a singular wording from a single `count`, so "1 packs" would be
 * whatever the second number happened to be.
 *
 * Called from the three places the 生效集 can change without a rebuild of the
 * settings half of the panel — the pack list repaint, the 总开关, and each of
 * the three 作用域 toggles.
 *
 * @param {any} context
 */
function paintStatus(context) {
    const settings = ensureSettings(context);
    const strip = document.getElementById('st_emote_status');
    const text = document.getElementById('st_emote_status_text');
    const counts = document.getElementById('st_emote_status_counts');
    if (!strip || !text || !counts) {
        return;
    }

    const effective = effectiveSetForMessage(context, -1);
    const packs = effective.packs.length;
    const stickers = effective.packs.reduce((total, pack) => total + pack.stickers.length, 0);
    const readOut = `${t('panel.packCount', { count: packs })} · ${t('pack.stickerCount', { count: stickers })}`;

    // A count of what *would* be available is noise while nothing is being
    // rendered, so the whole line changes rather than gaining a footnote.
    strip.classList.toggle('st-emote-status-off', !settings.enabled);
    text.textContent = settings.enabled ? t('panel.statusLabel') : t('panel.statusOff');
    counts.textContent = settings.enabled ? readOut : '';

    // 冲突 is the other question this line exists to answer, and it is the most
    // common reason for "I enabled it, I uploaded it, and nothing rendered".
    const conflicts = findConflicts(effective);
    const warning = document.getElementById('st_emote_conflicts');
    if (warning) {
        warning.hidden = conflicts.length === 0;
        warning.textContent = conflicts.length === 0
            ? ''
            : t('conflict.header', { count: conflicts.length });
    }
}

/**
 * Repaint the 总开关's row: its own class when it is off, and the paragraph
 * about what turning it off does.
 *
 * **The paragraph is on screen only while the switch is off.** It is four lines
 * describing a consequence that has not happened yet, and four lines of it sit
 * between the user and the control they opened the panel for. The sentence is
 * always on the row as its tooltip, so the moment it becomes true is the moment
 * it is also readable without a hover.
 *
 * @param {any} context
 */
function paintMasterSwitch(context) {
    const settings = ensureSettings(context);
    const row = document.getElementById('st_emote_master');
    const hint = document.getElementById('st_emote_enabled_hint');
    if (!row || !hint) {
        return;
    }
    row.classList.toggle('st-emote-master-off', !settings.enabled);
    row.title = t('panel.enabledHint');
    hint.textContent = settings.enabled ? '' : t('panel.enabledHint');
}

/**
 * Mount the settings drawer into the Extensions panel.
 *
 * @param {any} context
 */
export function mountSettingsPanel(context) {
    useClientLocale(context);
    const container = document.getElementById('extensions_settings');
    if (!container || document.getElementById('st_emote_drawer')) {
        return;
    }

    // A panel that has just been mounted has nothing open, is not in 批量 mode,
    // and has nothing ticked. All three survive every *repaint* — which is
    // exactly what makes them usable — and all three are cleared here, in the one
    // place that decides what "just mounted" means. A mount is a page load as far
    // as the client is concerned (it reloads on a language change), so a tick
    // surviving one would be a tick from the last session.
    openPackName = null;
    batchPackName = null;
    selectedStickerIds.clear();

    const root = document.createElement('div');
    root.id = 'st_emote_drawer';
    root.className = 'inline-drawer';
    root.innerHTML = panelSkeleton();
    container.append(root);

    const settings = ensureSettings(context);
    const packContainer = root.querySelector('#st_emote_packs');
    const missingContainer = root.querySelector('#st_emote_missing');
    const regexBlock = root.querySelector('#st_emote_regex');
    const searchInput = root.querySelector('#st_emote_search');
    const refresh = () => renderPackList(context, packContainer, missingContainer, refresh);

    fillIntro(context, root.querySelector('#st_emote_intro'));
    fillStartSteps(root.querySelector('#st_emote_start_steps'));
    root.querySelector('#st_emote_start_title').textContent = t('panel.noPacks');
    // The icons-are-icons sentence is the one piece of the old intro that is
    // about the *interface* rather than about the feature, so it belongs with
    // the first-run card — a user who already has packs does not need it, and a
    // user with none has nothing else to read.
    root.querySelector('#st_emote_start_hint').textContent = t('panel.iconHint');

    // The four block titles. Small, wide-tracked and upper-case: quieter than a
    // heading the client draws for a collapsible section, and never confusable
    // with one.
    root.querySelector('#st_emote_library_title').textContent = t('block.library');
    root.querySelector('#st_emote_render_title').textContent = t('block.rendering');
    root.querySelector('#st_emote_look_title').textContent = t('block.appearance');
    root.querySelector('#st_emote_tools_title').textContent = t('block.tools');
    // The library's own count, and the long form of the 尺寸 sentence as the
    // 外观 title's hover: a tooltip is where a paragraph belongs when the
    // paragraph is about everything inside the block.
    root.querySelector('#st_emote_look_title').title = t('panel.sizeHint');

    root.querySelector('#st_emote_size_hint').textContent = t('panel.sizeHint');
    root.querySelector('#st_emote_placement_label').textContent = t('placement.label');
    root.querySelector('#st_emote_render_user_label').textContent = t('panel.renderUser');
    root.querySelector('#st_emote_enabled_label').textContent = t('panel.enabled');
    root.querySelector('#st_emote_form_label').textContent = t('form.label');
    root.querySelector('#st_emote_bracket_form_label').textContent = t('form.bracket');
    root.querySelector('#st_emote_tag_form_label').textContent = t('form.tag');
    root.querySelector('#st_emote_tag_name_label').textContent = `${t('panel.tagName')}:`;
    // The create row's name, as a visible label rather than as a placeholder: a
    // placeholder disappears the moment the field has content, and the field
    // this one is in has content the moment it is being used.
    root.querySelector('#st_emote_new_pack_label').textContent = t('panel.newPackName');
    root.querySelector('#st_emote_new_pack').placeholder = t('panel.newPackName');
    // The three actions that live in the fixed skeleton get their glyph the
    // same way, rather than by being built here: they keep the ids their
    // listeners and the control-surface test find them by, and the sentences
    // come from the same catalog keys the buttons used to paint as text.
    iconize(root.querySelector('#st_emote_create_pack'), 'createPack', t('panel.createPack'));
    iconize(root.querySelector('#st_emote_copy_regex'), 'copyRegex', t('panel.copyRegex'));
    iconize(root.querySelector('#st_emote_import_pack'), 'importPack', t('panel.importPack'));
    root.querySelector('#st_emote_macro_hint').textContent = t('panel.macroHint');
    root.querySelector('#st_emote_macro_example').textContent = t('panel.macroExample');
    root.querySelector('#st_emote_regex_hint').textContent = t('panel.regexHint');
    root.querySelector('#st_emote_transfer_hint').textContent = t('panel.transferHint');
    searchInput.placeholder = t('panel.searchPlaceholder');
    // The three explanation blocks become collapsed sections here rather than in
    // the skeleton: the drawer markup is the client's, and building it in one
    // place is what keeps the four sections (these three plus the debug area)
    // from drifting into four slightly different widgets.
    //
    // **They are in the order a user needs them in, inside one block.** The two
    // 尺寸集 are built by `mountSizingSection` further up and are the most
    // reached for, because changing how a sticker looks is a more common fix
    // than diagnosing why one did not draw. The debug area comes next: it is a
    // tool a user returns to whenever something looks wrong. The three below
    // are setup-time material — read once when the panel is first opened, then
    // never again — so they go last, in that order: the macro is what a new user
    // needs first, the regex is a refinement on it, and moving a pack between
    // devices is the rarest of the three. A block title over all four says they
    // are one kind of thing, which the order alone does not.
    //
    // The debug area is inserted *before* the collapses, because `collapseBlock`
    // replaces the block it wraps — afterwards the id it was found by is gone.
    root.querySelector('#st_emote_macro_block').before(mountDebugSection(context, root));
    collapseBlock(root.querySelector('#st_emote_macro_block'), t('panel.macroTitle'));
    collapseBlock(root.querySelector('#st_emote_regex_block'), t('panel.regexTitle'));
    collapseBlock(root.querySelector('#st_emote_transfer_block'), t('panel.transferTitle'));

    const tagInput = root.querySelector('#st_emote_tag_name');
    const bracketBox = root.querySelector('#st_emote_bracket_form');
    const tagBox = root.querySelector('#st_emote_tag_form');
    const formHint = root.querySelector('#st_emote_form_hint');
    tagInput.value = settings.stickerTag;

    /**
     * Repaint everything the two 标记 form switches decide: the tag-name input
     * (useless while the form is off), the "both off" warning, and the
     * prompt-only regex JSON.
     *
     * @param {any} current
     */
    const refreshTokenForms = (current) => {
        tagInput.disabled = !current.tagForm;
        formHint.textContent = current.bracketForm || current.tagForm ? '' : t('form.bothOff');
        regexBlock.textContent = clearContextRegexJson(current.stickerTag, {
            bracketForm: current.bracketForm,
            tagForm: current.tagForm,
        });
    };
    refreshTokenForms(settings);
    // The sanitizer permission follows the form switch, and the chat is
    // repainted so a token already on screen becomes plain text again.
    allowStickerTag(settings.tagForm ? settings.stickerTag : null);

    tagInput.addEventListener('change', () => {
        const result = validateStickerTag(tagInput.value);
        if (!result.ok) {
            toast('warning', constraintMessage('htmlTag', result.reason));
            tagInput.value = ensureSettings(context).stickerTag;
            return;
        }
        const current = ensureSettings(context);
        current.stickerTag = result.value;
        allowStickerTag(current.tagForm ? result.value : null);
        refreshTokenForms(current);
        saveAndRefresh(context);
    });

    for (const [box, field] of [[bracketBox, 'bracketForm'], [tagBox, 'tagForm']]) {
        box.checked = settings[field];
        box.addEventListener('change', () => {
            const current = ensureSettings(context);
            current[field] = box.checked;
            allowStickerTag(current.tagForm ? current.stickerTag : null);
            refreshTokenForms(current);
            saveAndRefresh(context);
        });
    }

    const copyButton = root.querySelector('#st_emote_copy_regex');
    copyButton.addEventListener('click', async () => {
        try {
            await copyText(regexBlock.textContent);
            toast('success', t('panel.regexCopied'));
        } catch (error) {
            logError('failed to copy regex JSON', error);
            toast('error', t('panel.regexCopyFailed'));
        }
    });

    const renderUserCheckbox = root.querySelector('#st_emote_render_user');
    renderUserCheckbox.checked = settings.renderUserMessages;
    renderUserCheckbox.addEventListener('change', () => {
        ensureSettings(context).renderUserMessages = renderUserCheckbox.checked;
        saveAndRefresh(context);
    });

    const enabledCheckbox = root.querySelector('#st_emote_enabled');
    enabledCheckbox.checked = settings.enabled;
    enabledCheckbox.addEventListener('change', () => {
        setEnabled(context, enabledCheckbox.checked);
        paintMasterSwitch(context);
        paintStatus(context);
        saveAndRefresh(context);
    });

    mountSizingSection(context, root, () => saveAndRefresh(context));

    const nameInput = root.querySelector('#st_emote_new_pack');
    const createButton = root.querySelector('#st_emote_create_pack');
    createButton.addEventListener('click', () => {
        const current = ensureSettings(context);
        const check = checkPackName(current, nameInput.value);
        if (!check.ok) {
            toast('warning', check.message);
            return;
        }
        createPack(current, check.value);
        context.saveSettingsDebounced();
        nameInput.value = '';
        // A brand new pack is empty, and an empty grid is a thing to look at
        // rather than a thing to read about — so it opens.
        openPackName = check.value;
        refresh();
        revealPack(check.value);
    });

    searchInput.addEventListener('input', () => refresh());

    mountImportButton(context, root, refresh);

    const events = context.eventTypes;
    if (context.eventSource && events?.CHAT_CHANGED) {
        context.eventSource.on(events.CHAT_CHANGED, refresh);
    }

    // The stored-file listing decides which packs read as "images missing", and
    // it is only knowable by asking the server, so the first paint waits for it.
    refreshStoredImages(context).then(refresh);
    paintMasterSwitch(context);
    refresh();
}

/**
 * Put a freshly created pack in front of the user.
 *
 * The list is sorted by name, so a new pack lands wherever its name sorts
 * rather than at the end where it was just added — which is how "I pressed the
 * button and nothing happened" happens. **Opening it is half the fix**: the grid
 * of a pack is below its header now, so scrolling to a closed row would land the
 * user in front of a line that has nothing on it.
 *
 * Matched on the rendered field rather than on the record, because that is the
 * only handle the DOM has: the list is rebuilt from scratch on every change and
 * nothing on the page remembers which element was which.
 *
 * `scrollIntoView` is guarded because jsdom has no layout to scroll. A missing
 * one is a browser that cannot, and a call that throws would take the click
 * handler down with it.
 *
 * @param {string} name - The pack's name, as the catalogue now spells it.
 */
function revealPack(name) {
    const row = packRow(name);
    if (!row) {
        return;
    }
    scrollIntoView(row);
    row.querySelector('.st-emote-pack-name')?.focus();
}

/**
 * Put one freshly uploaded sticker in front of the user.
 *
 * The same failure as `revealPack`, one level down: a pack that was closed gets
 * opened (its grid is below the header), and the cell is looked up by id rather
 * than by 标签, because an uploaded sticker has no label yet — which is the
 * normal state of the first ten uploads a user makes.
 *
 * @param {string} packName - The pack it landed in.
 * @param {string} stickerId
 */
function revealSticker(packName, stickerId) {
    openPackName = packName;
    const cell = cellById(packName, stickerId);
    if (!cell) {
        return;
    }
    scrollIntoView(cell);
}

/**
 * @param {string} name
 * @returns {Element|null}
 */
function packRow(name) {
    return [...document.querySelectorAll('#st_emote_packs .st-emote-pack')]
        .find((pack) => pack.querySelector('.st-emote-pack-name')?.value === name) ?? null;
}

/**
 * @param {string} packName
 * @param {string} stickerId
 * @returns {Element|null}
 */
function cellById(packName, stickerId) {
    // Read off `dataset` rather than built into a selector: an id from a
    // hand-edited settings file can hold anything, and a selector built from one
    // is a query that throws instead of a query that finds nothing.
    return [...(packRow(packName)?.querySelectorAll('.st-emote-cell') ?? [])]
        .find((cell) => cell.dataset.stickerId === stickerId) ?? null;
}

/**
 * @param {Element} element
 */
function scrollIntoView(element) {
    if (typeof element.scrollIntoView === 'function') {
        element.scrollIntoView({ block: 'nearest' });
    }
}

/**
 * The "Import pack (.zip)" control, plus the hidden file picker it opens.
 *
 * @param {any} context
 * @param {Element} root
 * @param {() => void} refresh
 */
function mountImportButton(context, root, refresh) {
    const button = root.querySelector('#st_emote_import_pack');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.zip,application/zip';
    fileInput.multiple = false;
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (file) {
            await handleImport(context, file, refresh);
        }
    });
    button.addEventListener('click', () => fileInput.click());
    button.after(fileInput);
}

/** How each `PACK_STATES` value reads in the list. The keys are the catalog's. */
const PACK_STATE_LABEL_KEYS = {
    [PACK_STATES.empty]: 'pack.stateEmpty',
    [PACK_STATES.imagesMissing]: 'pack.stateImagesMissing',
};

/**
 * Repaint the library: the pack list, the first-run card, the library's own
 * count, and the status line above it.
 *
 * **The pack list is the one part of the panel that is rebuilt from scratch on
 * every change**, so this is also where the read-outs that depend on the
 * catalogue get repainted. The settings half is not rebuilt, which is what lets
 * a section the user opened stay open while they edit inside it.
 *
 * @param {any} context
 * @param {Element} packContainer
 * @param {Element} missingContainer
 * @param {() => void} refresh
 */
function renderPackList(context, packContainer, missingContainer, refresh) {
    const settings = ensureSettings(context);
    renderMissingPacks(context, settings, missingContainer, refresh);

    const empty = settings.packs.length === 0;
    // The card and the list are the same fact told two ways: with packs there is
    // a list, without them there are four steps. The toolbar above stays either
    // way, because naming a pack is how the list starts.
    const start = document.getElementById('st_emote_start');
    if (start) {
        start.hidden = !empty;
    }
    const note = document.getElementById('st_emote_library_note');
    if (note) {
        note.textContent = t('panel.packCount', { count: settings.packs.length });
    }
    paintStatus(context);

    packContainer.textContent = '';
    const searchInput = document.getElementById('st_emote_search');
    const query = searchInput?.value ?? '';
    const entries = searchLibrary(sortPacks(settings.packs), query);

    if (empty) {
        // The first-run card says it, in four steps rather than in one line.
        return;
    }
    if (entries.length === 0) {
        const nothing = document.createElement('div');
        nothing.className = 'st-emote-empty';
        nothing.textContent = t('panel.noStickerMatches', { query });
        packContainer.append(nothing);
        return;
    }

    for (const [position, { pack, stickers }] of entries.entries()) {
        packContainer.append(buildPackElement(
            context,
            pack,
            stickers,
            refresh,
            query !== '',
            position,
        ));
    }
}

/**
 * Show the packs the current character card enables that are missing locally,
 * with a button to create the placeholder packs so the references resolve.
 *
 * @param {any} context
 * @param {import('./settings.js').Settings} settings
 * @param {Element} container
 * @param {() => void} refresh
 */
function renderMissingPacks(context, settings, container, refresh) {
    container.textContent = '';
    const missing = missingPackNames(settings, collectCharacterPackNames(context));
    if (missing.length === 0) {
        return;
    }

    const header = document.createElement('div');
    header.className = 'st-emote-missing-header';
    header.textContent = t('panel.missingPackHeader', { count: missing.length });
    container.append(header);

    const list = document.createElement('div');
    list.className = 'st-emote-missing-list';
    list.textContent = missing.join(', ');
    container.append(list);

    // No per-action hook class here, unlike every other action button: this one
    // used to have none either, and the control-surface snapshot is the guard
    // for "the panel offers what it offered before" — a class added to one
    // button would rewrite that line for no gain, since the whole block already
    // has an id a test can reach it by.
    const button = iconButton('createMissingPacks', t('panel.createMissingPacks'));
    button.addEventListener('click', () => {
        const current = ensureSettings(context);
        for (const name of missing) {
            if (!findPackByName(current.packs, name)) {
                createPack(current, name);
            }
        }
        context.saveSettingsDebounced();
        rerenderChat(context);
        toast('success', t('panel.missingPacksCreated', { count: missing.length }));
        refresh();
    });
    container.append(button);
}

/**
 * One pack in the list: a header that opens and closes, and a grid of its
 * stickers underneath.
 *
 * `pack` and `visible` are deliberately two arguments: `pack` is the record the
 * settings hold and every button edits, `visible` is only what a search chose to
 * show. Handing the same filtered object to both would mean a rename during a
 * search edits a record nothing else can see.
 *
 * **The header is one row that opens and closes the pack, and nothing else on
 * screen is always there.** Whatever the state, the whole of a collapsed pack is
 * one line: cover, 包名, count, any state badge, and a chevron. The actions, the
 * 作用域 toggles and the grid live inside the body, so a library of forty packs
 * costs forty lines rather than forty times six rows.
 *
 * **It is not the client's `inline-drawer`, on purpose.** That widget's toggle is
 * a header of one sentence, and the client delegates a click on it from
 * `document` — a header holding a text input and a row of buttons would slide
 * open on every click on the input too. `collapsibleSection` stays where it
 * belongs: the settings' explanation sections, which are exactly that shape.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {import('./settings.js').StickerRecord[]} visible - Stickers to draw.
 * @param {() => void} refresh
 * @param {boolean} [searching] - True while a search is narrowing the list, which
 *   hides the buttons that would act on stickers the user cannot see.
 * @param {number} [position] - Where this pack sorts, for the body's element id.
 * @returns {Element}
 */
function buildPackElement(context, pack, visible, refresh, searching = false, position = 0) {
    const wrapper = document.createElement('div');
    wrapper.className = 'st-emote-pack';
    const state = packState(pack, imageFileChecker(storedImageFiles));
    if (state === PACK_STATES.imagesMissing) {
        wrapper.classList.add('st-emote-pack-missing');
    }

    const open = openPackName === pack.name;
    // 批量 mode belongs to a pack, not to the panel: the batch delete it drives
    // reads one pack's stickers, and a "12 selected" that spans four packs is a
    // number nobody can act on confidently.
    const batching = batchPackName === pack.name;

    const toggle = document.createElement('div');
    toggle.className = 'st-emote-pack-toggle';
    toggle.setAttribute('role', 'button');
    // The keyboard path to the grid: without a tab stop the accordion is mouse
    // -only, and `aria-expanded` would be describing a control nothing else can
    // reach.
    toggle.setAttribute('tabindex', '0');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-controls', `st_emote_pack_body_${position}`);
    toggle.title = open ? t('pack.collapse') : t('pack.expand');

    toggle.append(buildPackCover(context, pack, state, refresh));
    toggle.append(buildPackNameInput(context, pack, refresh));

    const count = document.createElement('span');
    count.className = 'st-emote-pack-count';
    count.textContent = t('pack.stickerCount', { count: pack.stickers.length });
    toggle.append(count);

    const stateKey = PACK_STATE_LABEL_KEYS[state];
    if (stateKey) {
        // The class stays `st-emote-badge-<state>`: the stylesheet reads it to
        // colour the two states differently, so it is a hook rather than a label.
        toggle.append(badge(
            t(stateKey),
            `st-emote-badge-${state}`,
            t(`${stateKey}Title`),
        ));
    }

    // The chevron is the client's own glyph and the direction is on the toggle's
    // `aria-expanded`; the mark itself says nothing a screen reader should read.
    const chevron = markIcon(open ? 'collapse' : 'expand');
    chevron.classList.add('st-emote-pack-chevron');
    toggle.append(chevron);

    // The header's own children that are controls — the 包名 input and the cover
    // in its "re-point the images" state — say so here, because a click that lands
    // on one of them is a click on *that*, not on the accordion. The pack's action
    // buttons are in the body rather than the header, which is why they are not
    // in this list.
    toggle.addEventListener('click', (event) => {
        if (event.target.closest('input, img')) {
            return;
        }
        setOpenPack(pack.name);
        refresh();
    });
    toggle.addEventListener('keydown', (event) => {
        // Enter and Space are what a `role=button` answers to, and the target
        // check is what keeps Enter in the 包名 field from opening the pack.
        if (event.target !== toggle || (event.key !== 'Enter' && event.key !== ' ')) {
            return;
        }
        event.preventDefault();
        setOpenPack(pack.name);
        refresh();
    });
    wrapper.append(toggle);

    const body = document.createElement('div');
    body.className = 'st-emote-pack-body';
    body.id = `st_emote_pack_body_${position}`;
    body.hidden = !open;

    if (open) {
        body.append(buildPackActions(context, pack, refresh, searching, batching));
        // The 作用域 toggles share a row with the batch bar: they are both about
        // which stickers are in play, and in a 300px column either can claim the
        // width the grid below actually needs.
        const controls = document.createElement('div');
        controls.className = 'st-emote-pack-controls';
        controls.append(buildScopeToggles(context, pack));
        if (batching) {
            controls.append(buildSelectionBar(context, pack, visible, refresh, searching));
        }
        body.append(controls);

        const grid = document.createElement('div');
        grid.className = 'st-emote-stickers';
        for (const sticker of visible) {
            grid.append(buildStickerCell(context, pack, sticker, refresh, searching, batching));
        }
        body.append(grid);
    }

    wrapper.append(body);
    return wrapper;
}

/**
 * The pack's own actions, in one wrapping group. The group wrapping is the
 * point: a button that cannot fit moves to the next line as a whole, while its
 * label stays on one line inside it.
 *
 * Deleting the pack is set apart from the rest by a doubled gap rather than by a
 * colour — it is the only one of them the panel cannot take back, and the two
 * live side by side on the same row in a column the user controls the colour of.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {() => void} refresh
 * @param {boolean} searching
 * @param {boolean} batching
 * @returns {Element}
 */
function buildPackActions(context, pack, refresh, searching, batching) {
    const actions = document.createElement('div');
    actions.className = 'st-emote-actions';
    actions.append(filePickerButton(
        'uploadImages',
        t('pack.uploadImages'),
        { accept: ACCEPTED_MIME, multiple: true, className: 'st-emote-upload' },
        (files) => handleUploads(context, pack, files, refresh),
    ));
    const addUrl = iconButton('addImageUrl', t('pack.addImageUrl'), 'st-emote-add-url');
    actions.append(addUrl);
    addUrl.addEventListener('click', async () => {
        await handleExternalUrl(context, pack, refresh);
    });

    // 批量 is a mode, so it is a toggle: one glyph, `aria-pressed` for the state,
    // and a sentence per direction so the tooltip says which way the click goes.
    const batch = iconButton(
        'batchMode',
        batching ? t('pack.batchModeDone') : t('pack.batchMode'),
        'st-emote-batch',
    );
    batch.setAttribute('aria-pressed', String(batching));
    batch.addEventListener('click', () => {
        setBatchPack(pack.name);
        refresh();
    });
    actions.append(batch);

    if (!searching) {
        const exportButton = iconButton('exportZip', t('pack.exportZip'), 'st-emote-export');
        actions.append(exportButton);
        exportButton.addEventListener('click', async () => {
            await handleExport(context, pack);
        });
        const deleteButton = iconButton('deletePack', t('pack.deletePack'), 'st-emote-delete-pack');
        actions.append(deleteButton);
        deleteButton.addEventListener('click', async () => {
            await handleDeletePack(context, pack, refresh);
        });
    }

    return actions;
}

/**
 * Open one pack and close the rest — or close it, if it is the open one.
 *
 * **One at a time, not one or none.** Two packs open at once is the state this
 * panel spent its whole life in, and it is the reason the list was a wall: the
 * eye has to be able to say "the pack I am working on is *this* row".
 *
 * @param {string} name
 */
function setOpenPack(name) {
    openPackName = openPackName === name ? null : name;
}

/**
 * Enter or leave 批量 mode for one pack.
 *
 * **Entering it opens the pack.** Batch mode without a grid is a checkbox and a
 * delete button acting on stickers that are not on screen, which is the one
 * outcome worse than having no batch mode at all.
 *
 * @param {string} name
 */
function setBatchPack(name) {
    if (batchPackName === name) {
        batchPackName = null;
        return;
    }
    batchPackName = name;
    openPackName = name;
}

/**
 * The cover thumbnail: the first sticker that has a picture, which is the pure
 * core's rule rather than something re-derived here.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {string} state
 * @param {() => void} refresh
 * @returns {HTMLImageElement}
 */
function buildPackCover(context, pack, state, refresh) {
    const cover = document.createElement('img');
    cover.className = 'st-emote-cover';
    cover.alt = '';
    const image = packCoverImage(pack);
    if (image !== '') {
        cover.src = image;
    } else {
        cover.classList.add('st-emote-cover-empty');
    }

    if (state === PACK_STATES.imagesMissing) {
        // The "re-point the images" entry point. It is a button rather than a
        // hint because a greyed-out pack with no way back in is the one state
        // this whole feature exists to recover from.
        cover.classList.add('st-emote-cover-action');
        cover.title = t('pack.coverRepoint');
        cover.addEventListener('click', async () => {
            const target = pack.stickers.find((sticker) => stickerImageMissing(sticker));
            if (!target) {
                return;
            }
            await replaceStickerImageWithFile(context, pack, target, refresh);
        });
    }
    return cover;
}

/**
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {() => void} refresh
 * @returns {HTMLInputElement}
 */
function buildPackNameInput(context, pack, refresh) {
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'text_pole st-emote-pack-name';
    name.value = pack.name;
    name.addEventListener('change', () => {
        const current = ensureSettings(context);
        const previousName = pack.name;
        const check = checkPackName(current, name.value, pack);
        if (!check.ok) {
            toast('warning', check.message);
            name.value = pack.name;
            return;
        }
        // The accordion and the batch mode are keyed on this name, so a rename
        // that left them behind would close a pack the user is still inside.
        if (openPackName === previousName) {
            openPackName = check.value;
        }
        if (batchPackName === previousName) {
            batchPackName = check.value;
        }
        renamePack(current, pack, check.value);
        const nextCharacterScope = renamePackInScope(
            getCurrentCharacterScope(context),
            previousName,
            check.value,
        );
        setCurrentCharacterScope(context, nextCharacterScope);
        const nextChatScope = renamePackInScope(getChatScope(context), previousName, check.value);
        setChatScope(context, nextChatScope);
        saveAndRefresh(context);
        toast('warning', t('pack.renamed', { name: check.value }));
        refresh();
    });
    return name;
}

/**
 * The tick-everything box and the batch delete that acts on the ticks.
 *
 * **It exists only in 批量 mode.** The row used to be on screen for every pack at
 * all times, which is how a once-a-month operation came to own a line of every
 * pack's header.
 *
 * The ticks themselves live in `visible`, so "select all" during a search means
 * "everything the search is showing" — the two boxes always agree about what is
 * on screen.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {import('./settings.js').StickerRecord[]} visible
 * @param {() => void} refresh
 * @param {boolean} searching
 * @returns {Element}
 */
function buildSelectionBar(context, pack, visible, refresh, searching) {
    const bar = document.createElement('div');
    bar.className = 'st-emote-selection';

    const all = document.createElement('input');
    all.type = 'checkbox';
    all.title = t('pack.selectAllTitle');
    all.checked = visible.length > 0 && visible.every((sticker) => selectedStickerIds.has(sticker.id));
    all.addEventListener('change', () => {
        for (const sticker of visible) {
            if (all.checked) {
                selectedStickerIds.add(sticker.id);
            } else {
                selectedStickerIds.delete(sticker.id);
            }
        }
        refresh();
    });

    const label = document.createElement('span');
    label.textContent = searching ? t('pack.selectMatches') : t('pack.selectAll');
    const wrapper = document.createElement('label');
    wrapper.className = 'st-emote-enable';
    wrapper.append(all, label);
    bar.append(wrapper);

    const chosen = selectedInPack(pack);
    const count = document.createElement('span');
    count.className = 'st-emote-pack-count';
    count.textContent = chosen === 0
        ? ''
        : t('pack.selectedCount', { count: chosen });
    bar.append(count);

    if (chosen > 0) {
        const remove = iconButton(
            'deleteSelected',
            t('pack.deleteSelected', { count: chosen }),
            'st-emote-delete-selected',
        );
        remove.addEventListener('click', async () => {
            await handleBatchDelete(context, pack, refresh);
        });
        bar.append(remove);
    }
    if (searching) {
        // The ticks are still on, but the list is filtered: acting on them from
        // here would delete stickers the user cannot see.
        bar.append(Object.assign(document.createElement('span'), {
            className: 'st-emote-hint',
            textContent: t('pack.searchDeleteHint'),
        }));
    }

    return bar;
}

/**
 * @param {import('./settings.js').PackRecord} pack
 * @returns {number}
 */
function selectedInPack(pack) {
    return pack.stickers.filter((sticker) => selectedStickerIds.has(sticker.id)).length;
}

/**
 * The Global / Character / Chat checkboxes for one pack. Scopes are a pure
 * union, so every box is independent: checking one never unchecks another.
 *
 * A pack is not disabled by having no images on this server — the spec keeps a
 * pack with missing images enableable precisely so the user can turn it on and
 * put the pictures back.
 *
 * **Each of the three repaints the status line.** None of them rebuilds the
 * pack list — the checkbox keeps its own state, and a rebuild would throw away
 * the ticks a user is halfway through — yet each of them changes the 生效集,
 * which is what the status line is reporting. A read-out that only followed a
 * list repaint would go stale on exactly the action that matters.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @returns {Element}
 */
function buildScopeToggles(context, pack) {
    const group = document.createElement('div');
    group.className = 'st-emote-scopes';

    group.append(buildScopeToggle(
        t('scope.global'),
        isPackEnabled(ensureSettings(context), pack.name),
        (checked) => {
            setPackEnabled(ensureSettings(context), pack.name, checked);
            paintStatus(context);
            saveAndRefresh(context);
        },
    ));

    const currentCharacter = getCurrentCharacter(context);
    const hasCharacter = Boolean(currentCharacter);
    group.append(buildScopeToggle(
        t('scope.character'),
        hasCharacter && scopeHasPack(getCurrentCharacterScope(context), pack.name),
        (checked) => {
            const next = setPackInScope(getCurrentCharacterScope(context), pack.name, checked);
            setCurrentCharacterScope(context, next).finally(() => {
                paintStatus(context);
                rerenderChat(context);
            });
        },
        !hasCharacter,
    ));

    group.append(buildScopeToggle(
        t('scope.chat'),
        scopeHasPack(getChatScope(context), pack.name),
        (checked) => {
            const next = setPackInScope(getChatScope(context), pack.name, checked);
            setChatScope(context, next);
            paintStatus(context);
            rerenderChat(context);
        },
    ));

    return group;
}

/**
 * @param {string} label
 * @param {boolean} checked
 * @param {(checked: boolean) => void} onChange
 * @param {boolean} [disabled]
 * @returns {Element}
 */
function buildScopeToggle(label, checked, onChange, disabled = false) {
    const wrapper = document.createElement('label');
    wrapper.className = 'st-emote-enable';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = checked;
    box.disabled = disabled;
    box.addEventListener('change', () => onChange(box.checked));
    wrapper.append(box, document.createTextNode(` ${label}`));
    return wrapper;
}

/**
 * One 表情, as one square.
 *
 * **This is the whole default surface of a sticker, and the reduction is the
 * point.** It used to be two rows and six controls — a tick, the picture, the
 * 标签, the 描述, the 投放方式 override, replace and delete — all of them on
 * screen for every sticker in every pack. The 标签 stays, because it is the 标识
 * and it is what a token names; the rest moved into the editor, which is one
 * layer over the panel rather than a row in it.
 *
 * **The badges became corner marks.** A 56px cell has no room for a word, so
 * 外链 wears a link glyph and a sticker with no image wears the same dashed
 * outline the panel has always used for one. `sticker.external` and
 * `sticker.unlabeled` still exist as words — the editor is the one screen with
 * room to say them.
 *
 * **In 批量 mode the cell stops being a button and becomes a checkbox.** The
 * same square, a different question asked of it, and no nested control: a tick
 * inside a clickable cell is a cell where half the clicks do something the
 * label did not promise.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {import('./settings.js').StickerRecord} sticker
 * @param {() => void} refresh
 * @param {boolean} searching
 * @param {boolean} batching
 * @returns {Element}
 */
function buildStickerCell(context, pack, sticker, refresh, searching, batching) {
    const cell = document.createElement('div');
    cell.className = 'st-emote-cell';
    // The two facts a test (and `revealSticker`) needs to name a cell: its id is
    // stable across a repaint and across a rename, and the 标签 is what the cell
    // says out loud.
    cell.dataset.stickerId = sticker.id;
    cell.dataset.label = sticker.label;

    const picked = selectedStickerIds.has(sticker.id);
    if (picked) {
        cell.classList.add('st-emote-cell-picked');
    }

    cell.setAttribute('role', batching ? 'checkbox' : 'button');
    cell.setAttribute('tabindex', '0');
    if (batching) {
        cell.setAttribute('aria-checked', String(picked));
        cell.setAttribute('aria-label', t('sticker.selectForDelete'));
    } else {
        cell.setAttribute('aria-label', cellCaption(sticker));
    }
    cell.title = cellTitle(sticker);

    if (batching) {
        const tick = markIcon('picked');
        tick.classList.add('st-emote-cell-pick');
        cell.append(tick);
    }
    cell.append(buildStickerThumb(sticker));

    if (isExternalImageUrl(sticker.image)) {
        const mark = markIcon('external');
        mark.classList.add('st-emote-cell-external');
        mark.title = t('sticker.externalTitle');
        cell.append(mark);
    }

    const caption = document.createElement('span');
    caption.className = 'st-emote-cell-label';
    caption.textContent = sticker.label;
    cell.append(caption);

    const activate = () => {
        if (batching) {
            if (selectedStickerIds.has(sticker.id)) {
                selectedStickerIds.delete(sticker.id);
            } else {
                selectedStickerIds.add(sticker.id);
            }
            refresh();
            return;
        }
        openStickerEditor(context, pack, sticker, {
            refresh,
            searching,
            replace: (file) => replaceStickerImageWithFile(context, pack, sticker, refresh, file),
            remove: async () => {
                closeStickerEditor();
                await handleStickerDelete(context, pack, sticker, refresh);
            },
        });
    };
    cell.addEventListener('click', activate);
    cell.addEventListener('keydown', (event) => {
        // Enter and Space are what a `role=button` and a `role=checkbox` answer
        // to; Space scrolls the panel by default, which is why it is prevented.
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        event.preventDefault();
        activate();
    });

    return cell;
}

/**
 * What a cell says out loud: the 标签 and what a click on it does.
 *
 * @param {import('./settings.js').StickerRecord} sticker
 * @returns {string}
 */
function cellCaption(sticker) {
    return normalizeLabel(sticker.label)
        ? t('sticker.cellCaption', { name: sticker.label })
        : t('sticker.cellCaptionUnlabeled');
}

/**
 * What a cell says on hover: the 标签 and the 描述, which is the one place the
 * 描述 is visible without opening the editor.
 *
 * @param {import('./settings.js').StickerRecord} sticker
 * @returns {string}
 */
function cellTitle(sticker) {
    const named = normalizeLabel(sticker.label);
    const described = (sticker.description ?? '').trim() !== '';
    if (named && described) {
        return t('sticker.cellTitle', { name: sticker.label, description: sticker.description });
    }
    if (named) {
        return t('sticker.cellTitleNoDescription', { name: sticker.label });
    }
    if (described) {
        return t('sticker.cellTitleUnlabeled', { description: sticker.description });
    }
    return t('sticker.unlabeled');
}

/**
 * @param {string} text
 * @param {string} [className]
 * @param {string} [title]
 * @returns {Element}
 */
function badge(text, className = '', title = '') {
    const element = document.createElement('span');
    element.className = `st-emote-badge ${className}`.trim();
    element.textContent = text;
    if (title !== '') {
        element.title = title;
    }
    return element;
}

/**
 * The cell's picture. A sticker with no image is drawn as a dashed box with a
 * question mark in it, so "never had an image" and "external link" are told
 * apart at a glance — the two failure modes look identical in the chat and are
 * not the same problem.
 *
 * @param {import('./settings.js').StickerRecord} sticker
 * @returns {Element}
 */
function buildStickerThumb(sticker) {
    if (sticker.image === '') {
        const empty = document.createElement('div');
        empty.className = 'st-emote-thumb st-emote-thumb-missing';
        empty.textContent = '?';
        return empty;
    }
    const thumb = document.createElement('img');
    thumb.className = 'st-emote-thumb';
    thumb.alt = '';
    thumb.src = sticker.image;
    thumb.addEventListener('error', () => {
        const dashed = document.createElement('div');
        dashed.className = 'st-emote-thumb st-emote-thumb-missing';
        dashed.textContent = '?';
        thumb.replaceWith(dashed);
    });
    return thumb;
}

/**
 * Add the picked images to a pack, one sticker each.
 *
 * The size and format rules are the core's and are applied before anything is
 * sent, so a refused file costs a message rather than a round trip. Animated
 * images are uploaded as the bytes they are: nothing here re-encodes, resizes or
 * touches frames, so a gif stays a gif.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {File[]} files
 * @param {() => void} refresh
 */
async function handleUploads(context, pack, files, refresh) {
    let uploaded = 0;
    const tooTall = [];
    let lastAdded = null;

    for (const file of files) {
        const sticker = createSticker();
        try {
            sticker.image = await uploadStickerImage(context, file, sticker.id);
        } catch (error) {
            logError(`upload failed for ${file.name}`, error);
            toast('error', t('upload.failed', { name: file.name, reason: error.message }));
            continue;
        }
        pack.stickers.push(sticker);
        uploaded += 1;
        lastAdded = sticker.id;
        const height = await measureImageHeight(sticker.image);
        if (exceedsSuggestedHeight(height)) {
            tooTall.push(file.name);
        }
    }

    if (uploaded > 0) {
        context.saveSettingsDebounced();
        toast('success', t('upload.done', { count: uploaded, name: pack.name }));
    }
    if (tooTall.length > 0) {
        toast('warning', t('upload.tooTall', {
            limit: SUGGESTED_MAX_HEIGHT_PX,
            names: tooTall.join(', '),
        }));
    }
    await refreshStoredImages(context);
    rerenderChat(context);
    refresh();
    // The pictures landed at the bottom of a grid, below the fold of a pack that
    // was closed. Putting the last one in front of the user is what makes "I
    // uploaded, and now what" a question with an answer.
    if (lastAdded !== null) {
        revealSticker(pack.name, lastAdded);
    }
}

/**
 * Add a 外链: a sticker whose image is an address, not a file here.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {() => void} refresh
 */
async function handleExternalUrl(context, pack, refresh) {
    const answer = await askForText(context, t('url.prompt'));
    if (answer === null) {
        return;
    }
    const check = validateExternalImageUrl(answer);
    if (!check.ok) {
        toast('warning', t(check.reason === 'empty' ? 'url.empty' : 'url.malformed'));
        return;
    }
    const sticker = createSticker();
    sticker.image = check.value;
    pack.stickers.push(sticker);
    context.saveSettingsDebounced();
    toast('success', t('url.added', { name: pack.name }));
    rerenderChat(context);
    refresh();
    revealSticker(pack.name, sticker.id);
}

/**
 * Point one sticker at a new image, keeping its label and description, and
 * delete the file the old image came from.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {import('./settings.js').StickerRecord} sticker
 * @param {() => void} refresh
 * @param {File} [file] - Already picked by the caller, if it has one.
 */
async function replaceStickerImageWithFile(context, pack, sticker, refresh, file) {
    let chosen = file;
    if (!chosen) {
        const picked = await pickFile(ACCEPTED_MIME);
        if (!picked) {
            return;
        }
        chosen = picked;
    }

    let stored;
    try {
        stored = await uploadStickerImage(context, chosen, sticker.id);
    } catch (error) {
        logError(`could not replace the image of ${sticker.id}`, error);
        toast('error', t('image.replaceFailed', { reason: error.message }));
        return;
    }

    // The old file goes only after the new one is safely stored, so a failed
    // upload can never leave the sticker with no image at all.
    const previous = replaceStickerImage(sticker, stored);
    if (previous) {
        await deleteImageQuietly(context, previous);
    }
    context.saveSettingsDebounced();
    toast('success', t(previous ? 'image.replaced' : 'image.set'));
    await refreshStoredImages(context);
    rerenderChat(context);
    refresh();
}

/**
 * @param {string} accept
 * @returns {Promise<File|null>}
 */
function pickFile(accept) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const file = input.files?.[0] ?? null;
            input.remove();
            resolve(file);
        }, { once: true });
        document.body.append(input);
        input.click();
    });
}

/**
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {import('./settings.js').StickerRecord} sticker
 * @param {() => void} refresh
 */
async function handleStickerDelete(context, pack, sticker, refresh) {
    // An unlabeled sticker has no name to put in the sentence, so it gets the
    // one that says "this sticker" instead of a confirmation naming nothing.
    const message = normalizeLabel(sticker.label)
        ? t('delete.sticker', { name: `"${sticker.label}"` })
        : t('delete.stickerUnnamed');
    const confirmed = await confirmWithUser(context, message);
    if (!confirmed) {
        return;
    }
    await deleteStickers(context, pack, [sticker]);
    rerenderChat(context);
    refresh();
}

/**
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {() => void} refresh
 */
async function handleBatchDelete(context, pack, refresh) {
    const chosen = pack.stickers.filter((sticker) => selectedStickerIds.has(sticker.id));
    if (chosen.length === 0) {
        return;
    }
    const confirmed = await confirmWithUser(
        context,
        t('delete.selected', { count: chosen.length }),
    );
    if (!confirmed) {
        return;
    }
    await deleteStickers(context, pack, chosen);
    rerenderChat(context);
    refresh();
}

/**
 * Remove stickers and their image files, then re-check which files are left.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {object[]} stickers
 */
async function deleteStickers(context, pack, stickers) {
    const { files } = removeStickers(pack, stickers);
    for (const sticker of stickers) {
        selectedStickerIds.delete(sticker.id);
    }
    context.saveSettingsDebounced();
    for (const file of files) {
        await deleteImageQuietly(context, file);
    }
    await refreshStoredImages(context);
}

/**
 * Delete a whole pack: its stickers, its image files, and its name in every
 * scope that referenced it.
 *
 * This is the one deletion the spec asks to be confirmed, because it is the one
 * that cannot be undone from the panel: the label of every sticker goes with it,
 * and so does every file.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {() => void} refresh
 */
async function handleDeletePack(context, pack, refresh) {
    const count = pack.stickers.length;
    const confirmed = await confirmWithUser(
        context,
        t('delete.pack', { name: pack.name, count }),
    );
    if (!confirmed) {
        return;
    }
    const result = removePack(ensureSettings(context), pack, {
        character: getCurrentCharacterScope(context),
        chat: getChatScope(context),
    });
    setCurrentCharacterScope(context, result.character);
    setChatScope(context, result.chat);
    for (const sticker of pack.stickers) {
        selectedStickerIds.delete(sticker.id);
    }
    // The accordion and the batch mode are keyed on this pack's name. Left
    // pointing at a pack that no longer exists, the list would render with every
    // header closed and no way to tell that from "nothing is open".
    if (openPackName === pack.name) {
        openPackName = null;
    }
    if (batchPackName === pack.name) {
        batchPackName = null;
    }
    context.saveSettingsDebounced();
    for (const file of result.files) {
        await deleteImageQuietly(context, file);
    }
    await refreshStoredImages(context);
    toast('success', t('delete.packDone', { name: pack.name }));
    rerenderChat(context);
    refresh();
}

/**
 * Write one pack out as a zip.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 */
async function handleExport(context, pack) {
    try {
        const { blob, fileName, count } = await buildPackArchive(pack);
        downloadBlob(blob, fileName);
        toast('success', t('export.done', { name: pack.name, count }));
    } catch (error) {
        logError(`could not export "${pack.name}"`, error);
        toast('error', t('export.failed', { name: pack.name, reason: error.message }));
    }
}

/**
 * Read a pack zip, upload the images it carries, and add the pack.
 *
 * The order matters: the archive is validated, then the name is checked against
 * the catalogue, and only then is anything stored. A refused import leaves no
 * files behind and no half-added pack.
 *
 * @param {any} context
 * @param {File} file
 * @param {() => void} refresh
 */
async function handleImport(context, file, refresh) {
    let archive;
    try {
        archive = await readPackArchive(file);
    } catch (error) {
        logError(`could not read ${file.name}`, error);
        toast('error', t('import.readFailed', { name: file.name, reason: error.message }));
        return;
    }
    if (!archive.ok) {
        toast('warning', importFailureMessage(archive.reason));
        return;
    }

    const current = ensureSettings(context);
    // The extracted bytes' real lengths, so `planImport` can hold an imported
    // image to the same 5MB ceiling a picked file faces. A manifest's own claim
    // about its size would be a number the other side wrote.
    const imageSizes = new Map(
        [...archive.images].map(([path, bytes]) => [path, bytes.byteLength]),
    );
    const plan = planImport(archive.manifest, current.packs, newId, imageSizes);
    if (!plan.ok) {
        toast('warning', importFailureMessage(plan.reason));
        return;
    }

    let stored = 0;
    for (const upload of plan.uploads) {
        const bytes = archive.images.get(upload.path);
        if (!bytes) {
            continue;
        }
        try {
            upload.sticker.image = await uploadImage(
                context,
                bytesToBase64(bytes),
                upload.format,
                upload.sticker.id,
            );
            stored += 1;
        } catch (error) {
            logError(`could not store ${upload.path} from ${file.name}`, error);
            toast('warning', t('upload.failed', { name: upload.path, reason: error.message }));
        }
    }

    // Added last, and into no scope: an imported pack is inert until the user
    // enables it, so importing can never change what a chat renders.
    addImportedPack(current, plan.pack);
    context.saveSettingsDebounced();
    await refreshStoredImages(context);
    toast('success', t('import.done', {
        name: plan.pack.name,
        count: plan.pack.stickers.length,
        stored,
    }));
    rerenderChat(context);
    refresh();
}

/**
 * Delete one stored file, logging rather than throwing when the server refuses.
 * A file that is already gone is the normal state on a device where the image
 * never arrived, and a delete that fails must not stop the rest of a batch.
 *
 * @param {any} context
 * @param {string} path
 */
async function deleteImageQuietly(context, path) {
    try {
        await deleteStickerImage(context, path);
    } catch (error) {
        logError(`could not delete ${path}`, error);
    }
}

/**
 * The pixel height of a stored image, or null when the browser cannot measure
 * it. Used only to decide whether to mention the suggested height.
 *
 * @param {string} path
 * @returns {Promise<number|null>}
 */
function measureImageHeight(path) {
    return new Promise((resolve) => {
        const probe = new Image();
        probe.addEventListener('load', () => resolve(probe.naturalHeight || null), { once: true });
        probe.addEventListener('error', () => resolve(null), { once: true });
        probe.src = path;
    });
}

/**
 * @param {Uint8Array} bytes
 * @returns {string} Base64 payload, chunked so a large image does not blow the
 *   argument limit of `String.fromCharCode`.
 */
function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
    }
    return btoa(binary);
}
