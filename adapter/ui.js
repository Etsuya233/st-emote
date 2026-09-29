/**
 * The settings panel: managing 表情包 and 表情.
 *
 * The rules this panel applies — which labels and pack names are legal, how the
 * list is sorted and titled, what an empty pack looks like, what a search
 * matches, which files may be deleted, whether an archive may be imported — all
 * live in `core/`. What is here is the DOM, the file dialogs and the calls into
 * SillyTavern's endpoints.
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

import {
    findPackByName,
    findStickerByLabel,
    validateDescription,
    validateLabel,
    validatePackName,
    validateStickerTag,
} from '../core/constraints.js';
import { addImportedPack, removePack, removeStickers, replaceStickerImage } from '../core/catalogue.js';
import { renamePackInScope, scopeHasPack, setPackInScope } from '../core/effective-set.js';
import {
    PACK_STATES,
    isStickerImageMissing,
    packCoverImage,
    packState,
    renameBreaksTokens,
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
import { filePickerButton, iconButton, iconize } from './buttons.js';
import { collapseBlock } from './collapsible.js';
import { mountDebugSection } from './debug-panel.js';
import { askForText, confirmWithUser, copyText, toast } from './dialogs.js';
import { useClientLocale } from './locale.js';
import { logError } from './log.js';
import { setEnabled } from './render-path.js';
import { allowStickerTag, rerenderChat } from './rendering.js';
import { clearContextRegexJson } from './regex.js';
import { buildStickerPlacementSelect, mountSizingSection } from './sizing-panel.js';
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
 * Sticker ids the user has ticked for a batch delete, across re-renders. Module
 * state on purpose: the pack list is rebuilt from scratch on every change, and a
 * selection that reset itself on the first re-render would be unusable.
 *
 * @type {Set<string>}
 */
const selectedStickerIds = new Set();

/**
 * The sentence for a refused field, with the field named and the reason given.
 *
 * The reason keys are the same ones `core/constraints.js` produces, so a new rule
 * cannot be added there and left without a sentence here.
 *
 * @param {any} context
 * @param {'packName'|'label'|'description'|'htmlTag'} field
 * @param {string} reason
 * @returns {string}
 */
function constraintMessage(context, field, reason) {
    return `${t(`constraint.${field}`)} ${t(`constraint.reason.${reason}`)}.`;
}

/**
 * Validate a new pack name and its app-wide uniqueness.
 *
 * @param {any} context
 * @param {import('./settings.js').Settings} settings
 * @param {unknown} value
 * @param {object} [except]
 * @returns {{ok: true, value: string} | {ok: false, message: string}}
 */
function checkPackName(context, settings, value, except) {
    const result = validatePackName(value);
    if (!result.ok) {
        return { ok: false, message: constraintMessage(context, 'packName', result.reason) };
    }
    if (findPackByName(settings.packs, result.value, { except })) {
        return { ok: false, message: t('pack.nameTaken', { name: result.value }) };
    }
    return { ok: true, value: result.value };
}

/**
 * Validate a label and its uniqueness inside one pack.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {unknown} value
 * @param {object} [except]
 * @returns {{ok: true, value: string} | {ok: false, message: string}}
 */
function checkLabel(context, pack, value, except) {
    const result = validateLabel(value);
    if (!result.ok) {
        return { ok: false, message: constraintMessage(context, 'label', result.reason) };
    }
    if (findStickerByLabel(pack.stickers, result.value, { except })) {
        return { ok: false, message: t('sticker.labelTaken', { name: result.value }) };
    }
    return { ok: true, value: result.value };
}

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
 * The panel's fixed skeleton: the intro, the 总开关 and the two 标记 form
 * switches, the 投放方式 and 尺寸 containers the sizing section fills, the pack
 * creator, the macro and regex hints, the import row, and the place the pack
 * list goes.
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
        '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>',
        '</div>',
        '<div class="inline-drawer-content">',
        '<div class="st-emote-hint" id="st_emote_intro"></div>',
        '<div class="st-emote-hint" id="st_emote_icon_hint"></div>',
        // Three groups rather than one column of equal-density controls: 处理
        // (what gets rendered at all), 标记 (what the token is written with) and
        // 外观 (where a rendered one lands and how big it is). The grouping is
        // carried by a rhythm and a hairline between groups — no headings, because
        // the sentences would need two catalogs to say something the spacing
        // already says.
        //
        // `st-emote-group` and not `st-emote-block`: the latter is the class on a
        // 块后 image, and two meanings for one word is the kind of thing that
        // reads wrong six months later.
        '<div class="st-emote-group">',
        '<label class="st-emote-option">',
        '<input type="checkbox" id="st_emote_enabled"> <span id="st_emote_enabled_label"></span>',
        '</label>',
        '<div class="st-emote-hint" id="st_emote_enabled_hint"></div>',
        '<label class="st-emote-option">',
        '<input type="checkbox" id="st_emote_render_user"> <span id="st_emote_render_user_label"></span>',
        '</label>',
        '<div class="st-emote-form-label" id="st_emote_form_label"></div>',
        '<label class="st-emote-option">',
        '<input type="checkbox" id="st_emote_bracket_form"> <span id="st_emote_bracket_form_label"></span>',
        '</label>',
        '<label class="st-emote-option">',
        '<input type="checkbox" id="st_emote_tag_form"> <span id="st_emote_tag_form_label"></span>',
        '</label>',
        '<div class="st-emote-hint" id="st_emote_form_hint"></div>',
        '</div>',
        '<div class="st-emote-group">',
        '<label class="st-emote-option">',
        '<span id="st_emote_tag_name_label"></span>',
        '<input type="text" class="text_pole" id="st_emote_tag_name">',
        '</label>',
        '</div>',
        '<div class="st-emote-group">',
        '<div class="st-emote-hint" id="st_emote_size_hint"></div>',
        '<div class="st-emote-placement">',
        '<label class="st-emote-field">',
        '<span id="st_emote_placement_label"></span>',
        '<select class="text_pole" id="st_emote_placement"></select>',
        '</label>',
        '</div>',
        // The two 尺寸集 fill this one container, each as a collapsed section of
        // its own (see `mountSizingSection`). 投放方式 stays outside them: one
        // select does not deserve a drawer, and the 外观 group as a whole is the
        // one section of the panel that never closes.
        '<div id="st_emote_sizes" class="st-emote-sizes"></div>',
        '</div>',
        '<div class="st-emote-create">',
        '<input type="text" class="text_pole" id="st_emote_new_pack">',
        '<div class="menu_button st-emote-button" id="st_emote_create_pack"></div>',
        '</div>',
        '<div id="st_emote_missing" class="st-emote-missing"></div>',
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
        // The search box stays outside every drawer on purpose: it filters the
        // pack list right below it, so a user reaching for it is looking for a
        // sticker rather than for an explanation, and hiding it behind a header
        // would make the most-used control on the panel the hardest to find.
        '<div class="st-emote-search">',
        '<input type="text" class="text_pole" id="st_emote_search">',
        '</div>',
        '<div id="st_emote_packs" class="st-emote-packs"></div>',
        '</div>',
    ].join('');
}

/**
 * The intro paragraph, which is the one place a sentence and a code sample sit
 * side by side. Built as its own element tree rather than one string so the
 * sample keeps its `<code>` styling while the prose stays plain text.
 *
 * @param {any} context
 * @param {HTMLElement} target
 */
function fillIntro(context, target) {
    target.textContent = t('panel.intro');
    const caption = document.createElement('div');
    caption.textContent = `${t('panel.introTokenCaption')} `;
    const example = document.createElement('code');
    example.textContent = t('panel.tokenExample');
    target.append(caption, example);
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
    root.querySelector('#st_emote_icon_hint').textContent = t('panel.iconHint');
    root.querySelector('#st_emote_size_hint').textContent = t('panel.sizeHint');
    root.querySelector('#st_emote_placement_label').textContent = t('placement.label');
    root.querySelector('#st_emote_render_user_label').textContent = t('panel.renderUser');
    root.querySelector('#st_emote_enabled_label').textContent = t('panel.enabled');
    root.querySelector('#st_emote_enabled_hint').textContent = t('panel.enabledHint');
    root.querySelector('#st_emote_form_label').textContent = t('form.label');
    root.querySelector('#st_emote_bracket_form_label').textContent = t('form.bracket');
    root.querySelector('#st_emote_tag_form_label').textContent = t('form.tag');
    root.querySelector('#st_emote_tag_name_label').textContent = `${t('panel.tagName')}:`;
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
    // **The order of the whole panel is by how often a thing is reached for**,
    // and these four calls are where that order is set. 尺寸集 (built in
    // `mountSizingSection`, which fills `#st_emote_sizes` further up) is the most
    // reached for, because changing how a sticker looks is a more common fix than
    // diagnosing why one did not draw. The debug area comes next: it is a tool a
    // user returns to whenever something looks wrong. The three below are
    // setup-time material — read once when the panel is first opened, then never
    // again — so they go last, in that order: the macro is what a new user needs
    // first, the regex is a refinement on it, and moving a pack between devices is
    // the rarest of the three.
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
            toast('warning', constraintMessage(context, 'htmlTag', result.reason));
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
        saveAndRefresh(context);
    });

    mountSizingSection(context, root, () => saveAndRefresh(context));

    const nameInput = root.querySelector('#st_emote_new_pack');
    const createButton = root.querySelector('#st_emote_create_pack');
    createButton.addEventListener('click', () => {
        const current = ensureSettings(context);
        const check = checkPackName(context, current, nameInput.value);
        if (!check.ok) {
            toast('warning', check.message);
            return;
        }
        createPack(current, check.value);
        context.saveSettingsDebounced();
        nameInput.value = '';
        refresh();
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
    refresh();
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
 * @param {any} context
 * @param {Element} packContainer
 * @param {Element} missingContainer
 * @param {() => void} refresh
 */
function renderPackList(context, packContainer, missingContainer, refresh) {
    const settings = ensureSettings(context);
    renderMissingPacks(context, settings, missingContainer, refresh);

    packContainer.textContent = '';
    const searchInput = document.getElementById('st_emote_search');
    const query = searchInput?.value ?? '';
    const entries = searchLibrary(sortPacks(settings.packs), query);

    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'st-emote-empty';
        empty.textContent = settings.packs.length === 0
            ? t('panel.noPacks')
            : t('panel.noStickerMatches', { query });
        packContainer.append(empty);
        return;
    }

    for (const { pack, stickers } of entries) {
        packContainer.append(buildPackElement(context, pack, stickers, refresh, query !== ''));
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
 * One pack in the list.
 *
 * `pack` and `visible` are deliberately two arguments: `pack` is the record the
 * settings hold and every button edits, `visible` is only what a search chose to
 * show. Handing the same filtered object to both would mean a rename during a
 * search edits a record nothing else can see.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {import('./settings.js').StickerRecord[]} visible - Stickers to draw.
 * @param {() => void} refresh
 * @param {boolean} [searching] - True while a search is narrowing the list, which
 *   hides the buttons that would act on stickers the user cannot see.
 * @returns {Element}
 */
function buildPackElement(context, pack, visible, refresh, searching = false) {
    const wrapper = document.createElement('div');
    wrapper.className = 'st-emote-pack';
    const state = packState(pack, imageFileChecker(storedImageFiles));
    if (state === PACK_STATES.imagesMissing) {
        wrapper.classList.add('st-emote-pack-missing');
    }

    const header = document.createElement('div');
    header.className = 'st-emote-pack-header';

    header.append(buildPackCover(context, pack, state, refresh));
    header.append(buildPackNameInput(context, pack, refresh));

    const count = document.createElement('span');
    count.className = 'st-emote-pack-count';
    count.textContent = t('pack.stickerCount', { count: pack.stickers.length });
    header.append(count);

    const stateKey = PACK_STATE_LABEL_KEYS[state];
    if (stateKey) {
        // The class stays `st-emote-badge-<state>`: the stylesheet reads it to
        // colour the two states differently, so it is a hook rather than a label.
        header.append(badge(
            t(stateKey),
            `st-emote-badge-${state}`,
            t(`${stateKey}Title`),
        ));
    }

    // The pack's own actions, in one wrapping group. The group wrapping is the
    // point: a button that cannot fit moves to the next line as a whole, while
    // its label stays on one line inside it. Deleting the pack is set apart from
    // the three reversible ones, because it is the only one of the four the panel
    // cannot take back.
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

    header.append(actions);
    wrapper.append(header);

    // The 作用域 toggles and "Select all" share one row: they are both about
    // which stickers are in play, and either can claim the width the sticker rows
    // below actually need.
    const controls = document.createElement('div');
    controls.className = 'st-emote-pack-controls';
    controls.append(
        buildScopeToggles(context, pack),
        buildSelectionBar(context, pack, visible, refresh, searching),
    );
    wrapper.append(controls);

    const list = document.createElement('div');
    list.className = 'st-emote-stickers';
    for (const sticker of visible) {
        list.append(buildStickerElement(context, pack, sticker, refresh, searching));
    }
    wrapper.append(list);

    return wrapper;
}

/**
 * The cover thumbnail: the first sticker that has a picture, which is the pure
 * core's rule rather than something re-derived here.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {string} state
 * @param {() => void} refresh
 * @returns {Element}
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
        const check = checkPackName(context, current, name.value, pack);
        if (!check.ok) {
            toast('warning', check.message);
            name.value = pack.name;
            return;
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
            setCurrentCharacterScope(context, next).finally(() => rerenderChat(context));
        },
        !hasCharacter,
    ));

    group.append(buildScopeToggle(
        t('scope.chat'),
        scopeHasPack(getChatScope(context), pack.name),
        (checked) => {
            const next = setPackInScope(getChatScope(context), pack.name, checked);
            setChatScope(context, next);
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
 * One 表情, as two rows.
 *
 * **First row**: the tick, the thumbnail, the 标签 and the row's badges. The 标签
 * is the 标识 — it is what a token names, so it has to be readable at a glance —
 * and the tick and the thumbnail are fixed-width, so none of them can be squeezed
 * by what follows. This row carries nothing else, which is what leaves the 标签
 * the whole width in a narrow panel.
 *
 * **Second row**: the 描述 across the width, then the 投放方式 override and the two
 * image actions. The 描述 is content rather than identity and is usually a full
 * sentence, so it is the field that needs width most; sharing one line with a
 * thumbnail, a tick and a select is what truncated it to "测试表情,详".
 *
 * **The 投放方式 override is on the second row on purpose, not by accident.** It
 * is a per-sticker override almost nobody touches, so wedging it between the 标签
 * and the 描述 — which is where the one-line layout put it — costs the two fields
 * a user does type into, and puts a rarely-used select in the middle of the tab
 * order. Down here it sits with the actions it modifies, and the row's tab order
 * is **exactly what it was before the split**: 标签, 描述, 投放方式, Replace, Delete.
 * A reflow that silently reorders what Tab reaches is the kind of thing nobody
 * notices until it annoys them daily.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {import('./settings.js').StickerRecord} sticker
 * @param {() => void} refresh
 * @param {boolean} searching
 * @returns {Element}
 */
function buildStickerElement(context, pack, sticker, refresh, searching) {
    const row = document.createElement('div');
    row.className = 'st-emote-sticker';

    const top = document.createElement('div');
    top.className = 'st-emote-sticker-main';
    row.append(top);

    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.className = 'st-emote-sticker-tick';
    tick.title = t('sticker.selectForDelete');
    tick.checked = selectedStickerIds.has(sticker.id);
    tick.addEventListener('change', () => {
        if (tick.checked) {
            selectedStickerIds.add(sticker.id);
        } else {
            selectedStickerIds.delete(sticker.id);
        }
        refresh();
    });
    top.append(tick);

    top.append(buildStickerThumb(sticker));

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'text_pole st-emote-label';
    labelInput.placeholder = t('sticker.labelPlaceholder');
    labelInput.value = sticker.label;
    labelInput.addEventListener('change', () => {
        const previousLabel = sticker.label;
        const check = checkLabel(context, pack, labelInput.value, sticker);
        if (!check.ok) {
            toast('warning', check.message);
            labelInput.value = sticker.label;
            return;
        }
        sticker.label = check.value;
        saveAndRefresh(context);
        // The same warning a pack rename gets, and gated on the same predicate:
        // a change that normalises away costs no tokens, a real one invalidates
        // every token already written in a chat.
        if (renameBreaksTokens(previousLabel, check.value)) {
            toast('warning', t('sticker.renamed', { name: check.value }));
        }
        refresh();
    });
    top.append(labelInput);

    if (!normalizeLabel(sticker.label)) {
        top.append(badge(t('sticker.unlabeled')));
    }
    if (isExternalImageUrl(sticker.image)) {
        top.append(badge(
            t('sticker.external'),
            'st-emote-badge-external',
            t('sticker.externalTitle'),
        ));
    }

    const detail = document.createElement('div');
    detail.className = 'st-emote-sticker-detail';
    row.append(detail);

    const descriptionInput = document.createElement('input');
    descriptionInput.type = 'text';
    descriptionInput.className = 'text_pole st-emote-description';
    // The spec's "an empty description shows as an em dash", and an em dash
    // reads the same in every language this catalog ships.
    descriptionInput.placeholder = '—';
    descriptionInput.value = sticker.description ?? '';
    descriptionInput.addEventListener('change', () => {
        const result = validateDescription(descriptionInput.value);
        if (!result.ok) {
            toast('warning', constraintMessage(context, 'description', result.reason));
            descriptionInput.value = sticker.description ?? '';
            return;
        }
        sticker.description = result.value;
        context.saveSettingsDebounced();
    });
    detail.append(descriptionInput);
    detail.append(buildStickerPlacementSelect(context, sticker, () => saveAndRefresh(context)));

    const actions = document.createElement('div');
    actions.className = 'st-emote-actions';
    actions.append(filePickerButton(
        'replaceImage',
        t('sticker.replace'),
        { accept: ACCEPTED_MIME, className: 'st-emote-replace' },
        async (files) => {
            await replaceStickerImageWithFile(context, pack, sticker, refresh, files[0]);
        },
    ));

    if (!searching) {
        const remove = iconButton('deleteSticker', t('sticker.delete'), 'st-emote-sticker-delete');
        remove.addEventListener('click', async () => {
            await handleStickerDelete(context, pack, sticker, refresh);
        });
        actions.append(remove);
    }
    detail.append(actions);

    return row;
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
 * The row's thumbnail. A local image that is not on this server is drawn as a
 * dashed outline with its own badge, so "external link" and "image did not
 * travel" are told apart at a glance — the two failure modes look identical in
 * the chat and are not the same problem.
 *
 * @param {import('./settings.js').StickerRecord} sticker
 * @returns {Element}
 */
function buildStickerThumb(sticker) {
    const thumb = document.createElement('img');
    thumb.className = 'st-emote-thumb';
    thumb.alt = '';
    if (sticker.image === '') {
        thumb.classList.add('st-emote-thumb-missing');
        return thumb;
    }
    thumb.src = sticker.image;
    thumb.addEventListener('error', () => {
        thumb.classList.add('st-emote-thumb-missing');
        thumb.removeAttribute('src');
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
