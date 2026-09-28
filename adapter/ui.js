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
import { normalizeLabel } from '../core/normalize.js';
import { importFailureMessage, planImport } from '../core/manifest.js';
import { buildPackArchive, downloadBlob, readPackArchive } from './archive.js';
import { mountDebugSection } from './debug-panel.js';
import { askForText, confirmWithUser, copyText, toast } from './dialogs.js';
import { currentLocale, tr } from './locale.js';
import { logError } from './log.js';
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
    return `${tr(context, `constraint.${field}`)} ${tr(context, `constraint.reason.${reason}`)}.`;
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
        return { ok: false, message: tr(context, 'pack.nameTaken', { name: result.value }) };
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
        return { ok: false, message: tr(context, 'sticker.labelTaken', { name: result.value }) };
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
 * The panel's fixed skeleton: the intro, the two global switches, the 投放方式
 * and 尺寸 containers the sizing section fills, the pack creator, the macro and
 * regex hints, the import row, and the place the pack list goes.
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
        '<div class="st-emote-options">',
        '<label class="st-emote-option">',
        '<input type="checkbox" id="st_emote_render_user"> <span id="st_emote_render_user_label"></span>',
        '</label>',
        '<label class="st-emote-option">',
        '<span id="st_emote_tag_name_label"></span>',
        '<input type="text" class="text_pole" id="st_emote_tag_name">',
        '</label>',
        '</div>',
        '<div class="st-emote-hint" id="st_emote_size_hint"></div>',
        '<div class="st-emote-placement">',
        '<label class="st-emote-field">',
        '<span id="st_emote_placement_label"></span>',
        '<select class="text_pole" id="st_emote_placement"></select>',
        '</label>',
        '</div>',
        '<div id="st_emote_sizes" class="st-emote-sizes"></div>',
        '<div class="st-emote-create">',
        '<input type="text" class="text_pole" id="st_emote_new_pack">',
        '<div class="menu_button" id="st_emote_create_pack"></div>',
        '</div>',
        '<div id="st_emote_missing" class="st-emote-missing"></div>',
        '<div class="st-emote-hint" id="st_emote_macro_hint"></div>',
        '<pre class="st-emote-code" id="st_emote_macro_example"></pre>',
        '<div class="st-emote-hint" id="st_emote_regex_hint"></div>',
        '<pre class="st-emote-code" id="st_emote_regex"></pre>',
        '<div class="menu_button" id="st_emote_copy_regex"></div>',
        '<div class="st-emote-hint" id="st_emote_transfer_hint"></div>',
        '<div class="st-emote-import">',
        '<input type="text" class="text_pole" id="st_emote_search">',
        '<div class="menu_button" id="st_emote_import_pack"></div>',
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
    target.textContent = tr(context, 'panel.intro');
    const caption = document.createElement('div');
    caption.textContent = `${tr(context, 'panel.introTokenCaption')} `;
    const example = document.createElement('code');
    example.textContent = tr(context, 'panel.tokenExample');
    target.append(caption, example);
}

/**
 * Mount the settings drawer into the Extensions panel.
 *
 * @param {any} context
 */
export function mountSettingsPanel(context) {
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
    root.querySelector('#st_emote_size_hint').textContent = tr(context, 'panel.sizeHint');
    root.querySelector('#st_emote_placement_label').textContent = tr(context, 'placement.label');
    root.querySelector('#st_emote_render_user_label').textContent = tr(context, 'panel.renderUser');
    root.querySelector('#st_emote_tag_name_label').textContent = `${tr(context, 'panel.tagName')}:`;
    root.querySelector('#st_emote_new_pack').placeholder = tr(context, 'panel.newPackName');
    root.querySelector('#st_emote_create_pack').textContent = tr(context, 'panel.createPack');
    root.querySelector('#st_emote_macro_hint').textContent = tr(context, 'panel.macroHint');
    root.querySelector('#st_emote_macro_example').textContent = tr(context, 'panel.macroExample');
    root.querySelector('#st_emote_regex_hint').textContent = tr(context, 'panel.regexHint');
    root.querySelector('#st_emote_copy_regex').textContent = tr(context, 'panel.copyRegex');
    root.querySelector('#st_emote_transfer_hint').textContent = tr(context, 'panel.transferHint');
    searchInput.placeholder = tr(context, 'panel.searchPlaceholder');
    root.querySelector('#st_emote_import_pack').textContent = tr(context, 'panel.importPack');
    // The debug area sits above the library: it is a tool for tuning the settings
    // further up, and the pack list below it is the longest thing on the page.
    root.querySelector('#st_emote_packs').before(mountDebugSection(context, root));

    const tagInput = root.querySelector('#st_emote_tag_name');
    tagInput.value = settings.stickerTag;
    regexBlock.textContent = clearContextRegexJson(settings.stickerTag);
    tagInput.addEventListener('change', () => {
        const result = validateStickerTag(tagInput.value);
        if (!result.ok) {
            toast('warning', constraintMessage(context, 'htmlTag', result.reason));
            tagInput.value = ensureSettings(context).stickerTag;
            return;
        }
        const current = ensureSettings(context);
        current.stickerTag = result.value;
        allowStickerTag(result.value);
        regexBlock.textContent = clearContextRegexJson(result.value);
        saveAndRefresh(context);
    });

    const copyButton = root.querySelector('#st_emote_copy_regex');
    copyButton.addEventListener('click', async () => {
        try {
            await copyText(regexBlock.textContent);
            toast('success', tr(context, 'panel.regexCopied'));
        } catch (error) {
            logError('failed to copy regex JSON', error);
            toast('error', tr(context, 'panel.regexCopyFailed'));
        }
    });

    const renderUserCheckbox = root.querySelector('#st_emote_render_user');
    renderUserCheckbox.checked = settings.renderUserMessages;
    renderUserCheckbox.addEventListener('change', () => {
        ensureSettings(context).renderUserMessages = renderUserCheckbox.checked;
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
 * A small labelled button, the shape almost every action in a pack row uses.
 *
 * @param {string} label
 * @param {string} [className]
 * @returns {HTMLDivElement}
 */
function actionButton(label, className = '') {
    const button = document.createElement('div');
    button.className = `menu_button ${className}`.trim();
    button.textContent = label;
    return button;
}

/**
 * A button that opens a file dialog and hands the chosen files to `onFiles`.
 *
 * @param {string} label
 * @param {{accept?: string, multiple?: boolean, className?: string}} options
 * @param {(files: File[]) => void|Promise<void>} onFiles
 * @returns {Element}
 */
function filePickerButton(label, options, onFiles) {
    const button = actionButton(label, options.className);
    const input = document.createElement('input');
    input.type = 'file';
    if (options.accept) {
        input.accept = options.accept;
    }
    input.multiple = options.multiple === true;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
        const files = Array.from(input.files ?? []);
        // Cleared before the work starts, so picking the same file twice in a
        // row still fires a change event.
        input.value = '';
        if (files.length > 0) {
            await onFiles(files);
        }
    });
    button.addEventListener('click', () => input.click());

    const wrapper = document.createElement('span');
    wrapper.className = 'st-emote-action';
    wrapper.append(button, input);
    return wrapper;
}

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
            ? tr(context, 'panel.noPacks')
            : tr(context, 'panel.noStickerMatches', { query });
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
    header.textContent = tr(context, 'panel.missingPackHeader', { count: missing.length });
    container.append(header);

    const list = document.createElement('div');
    list.className = 'st-emote-missing-list';
    list.textContent = missing.join(', ');
    container.append(list);

    const button = actionButton(tr(context, 'panel.createMissingPacks'));
    button.addEventListener('click', () => {
        const current = ensureSettings(context);
        for (const name of missing) {
            if (!findPackByName(current.packs, name)) {
                createPack(current, name);
            }
        }
        context.saveSettingsDebounced();
        rerenderChat(context);
        toast('success', tr(context, 'panel.missingPacksCreated', { count: missing.length }));
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
    count.textContent = tr(context, 'pack.stickerCount', { count: pack.stickers.length });
    header.append(count);

    const stateKey = PACK_STATE_LABEL_KEYS[state];
    if (stateKey) {
        // The class stays `st-emote-badge-<state>`: the stylesheet reads it to
        // colour the two states differently, so it is a hook rather than a label.
        header.append(badge(
            tr(context, stateKey),
            `st-emote-badge-${state}`,
            tr(context, `${stateKey}Title`),
        ));
    }

    header.append(filePickerButton(
        tr(context, 'pack.uploadImages'),
        { accept: ACCEPTED_MIME, multiple: true, className: 'st-emote-upload' },
        (files) => handleUploads(context, pack, files, refresh),
    ));
    const addUrl = actionButton(tr(context, 'pack.addImageUrl'), 'st-emote-add-url');
    header.append(addUrl);
    addUrl.addEventListener('click', async () => {
        await handleExternalUrl(context, pack, refresh);
    });

    if (!searching) {
        const exportButton = actionButton(tr(context, 'pack.exportZip'), 'st-emote-export');
        header.append(exportButton);
        exportButton.addEventListener('click', async () => {
            await handleExport(context, pack);
        });
        const deleteButton = actionButton(tr(context, 'pack.deletePack'), 'st-emote-delete-pack');
        header.append(deleteButton);
        deleteButton.addEventListener('click', async () => {
            await handleDeletePack(context, pack, refresh);
        });
    }

    header.append(buildScopeToggles(context, pack));
    wrapper.append(header);

    wrapper.append(buildSelectionBar(context, pack, visible, refresh, searching));

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
        cover.title = tr(context, 'pack.coverRepoint');
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
        toast('warning', tr(context, 'pack.renamed', { name: check.value }));
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
    all.title = tr(context, 'pack.selectAllTitle');
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
    label.textContent = searching ? tr(context, 'pack.selectMatches') : tr(context, 'pack.selectAll');
    const wrapper = document.createElement('label');
    wrapper.className = 'st-emote-enable';
    wrapper.append(all, label);
    bar.append(wrapper);

    const chosen = selectedInPack(pack);
    const count = document.createElement('span');
    count.className = 'st-emote-pack-count';
    count.textContent = chosen === 0
        ? ''
        : tr(context, 'pack.selectedCount', { count: chosen });
    bar.append(count);

    if (chosen > 0) {
        const remove = actionButton(
            tr(context, 'pack.deleteSelected', { count: chosen }),
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
            textContent: tr(context, 'pack.searchDeleteHint'),
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
        tr(context, 'scope.global'),
        isPackEnabled(ensureSettings(context), pack.name),
        (checked) => {
            setPackEnabled(ensureSettings(context), pack.name, checked);
            saveAndRefresh(context);
        },
    ));

    const currentCharacter = getCurrentCharacter(context);
    const hasCharacter = Boolean(currentCharacter);
    group.append(buildScopeToggle(
        tr(context, 'scope.character'),
        hasCharacter && scopeHasPack(getCurrentCharacterScope(context), pack.name),
        (checked) => {
            const next = setPackInScope(getCurrentCharacterScope(context), pack.name, checked);
            setCurrentCharacterScope(context, next).finally(() => rerenderChat(context));
        },
        !hasCharacter,
    ));

    group.append(buildScopeToggle(
        tr(context, 'scope.chat'),
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

    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.className = 'st-emote-sticker-tick';
    tick.title = tr(context, 'sticker.selectForDelete');
    tick.checked = selectedStickerIds.has(sticker.id);
    tick.addEventListener('change', () => {
        if (tick.checked) {
            selectedStickerIds.add(sticker.id);
        } else {
            selectedStickerIds.delete(sticker.id);
        }
        refresh();
    });
    row.append(tick);

    row.append(buildStickerThumb(sticker));

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'text_pole st-emote-label';
    labelInput.placeholder = tr(context, 'sticker.labelPlaceholder');
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
            toast('warning', tr(context, 'sticker.renamed', { name: check.value }));
        }
        refresh();
    });
    row.append(labelInput);

    if (!normalizeLabel(sticker.label)) {
        row.append(badge(tr(context, 'sticker.unlabeled')));
    }
    if (isExternalImageUrl(sticker.image)) {
        row.append(badge(
            tr(context, 'sticker.external'),
            'st-emote-badge-external',
            tr(context, 'sticker.externalTitle'),
        ));
    }

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
    row.append(descriptionInput);
    row.append(buildStickerPlacementSelect(context, sticker, () => saveAndRefresh(context)));

    const replace = filePickerButton(
        tr(context, 'sticker.replace'),
        { accept: ACCEPTED_MIME, className: 'st-emote-replace' },
        async (files) => {
            await replaceStickerImageWithFile(context, pack, sticker, refresh, files[0]);
        },
    );
    row.append(replace);

    if (!searching) {
        const remove = actionButton(tr(context, 'sticker.delete'), 'st-emote-sticker-delete');
        remove.addEventListener('click', async () => {
            await handleStickerDelete(context, pack, sticker, refresh);
        });
        row.append(remove);
    }

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
            sticker.image = await uploadStickerImage(context, file, sticker.id, currentLocale(context));
        } catch (error) {
            logError(`upload failed for ${file.name}`, error);
            toast('error', tr(context, 'upload.failed', { name: file.name, reason: error.message }));
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
        toast('success', tr(context, 'upload.done', { count: uploaded, name: pack.name }));
    }
    if (tooTall.length > 0) {
        toast('warning', tr(context, 'upload.tooTall', {
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
    const answer = await askForText(context, tr(context, 'url.prompt'));
    if (answer === null) {
        return;
    }
    const check = validateExternalImageUrl(answer);
    if (!check.ok) {
        toast('warning', tr(context, check.reason === 'empty' ? 'url.empty' : 'url.malformed'));
        return;
    }
    const sticker = createSticker();
    sticker.image = check.value;
    pack.stickers.push(sticker);
    context.saveSettingsDebounced();
    toast('success', tr(context, 'url.added', { name: pack.name }));
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
        stored = await uploadStickerImage(context, chosen, sticker.id, currentLocale(context));
    } catch (error) {
        logError(`could not replace the image of ${sticker.id}`, error);
        toast('error', tr(context, 'image.replaceFailed', { reason: error.message }));
        return;
    }

    // The old file goes only after the new one is safely stored, so a failed
    // upload can never leave the sticker with no image at all.
    const previous = replaceStickerImage(sticker, stored);
    if (previous) {
        await deleteImageQuietly(context, previous);
    }
    context.saveSettingsDebounced();
    toast('success', tr(context, previous ? 'image.replaced' : 'image.set'));
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
        ? tr(context, 'delete.sticker', { name: `"${sticker.label}"` })
        : tr(context, 'delete.stickerUnnamed');
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
        tr(context, 'delete.selected', { count: chosen.length }),
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
        tr(context, 'delete.pack', { name: pack.name, count }),
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
    toast('success', tr(context, 'delete.packDone', { name: pack.name }));
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
        const { blob, fileName, count } = await buildPackArchive(pack, currentLocale(context));
        downloadBlob(blob, fileName);
        toast('success', tr(context, 'export.done', { name: pack.name, count }));
    } catch (error) {
        logError(`could not export "${pack.name}"`, error);
        toast('error', tr(context, 'export.failed', { name: pack.name, reason: error.message }));
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
        toast('error', tr(context, 'import.readFailed', { name: file.name, reason: error.message }));
        return;
    }
    if (!archive.ok) {
        toast('warning', importFailureMessage(archive.reason, currentLocale(context)));
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
        toast('warning', importFailureMessage(plan.reason, currentLocale(context)));
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
            toast('warning', tr(context, 'upload.failed', { name: upload.path, reason: error.message }));
        }
    }

    // Added last, and into no scope: an imported pack is inert until the user
    // enables it, so importing can never change what a chat renders.
    addImportedPack(current, plan.pack);
    context.saveSettingsDebounced();
    await refreshStoredImages(context);
    toast('success', tr(context, 'import.done', {
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
