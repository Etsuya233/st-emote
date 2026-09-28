/**
 * The settings panel: managing 表情包 and 表情.
 *
 * The rules this panel applies — which labels and pack names are legal, how the
 * list is sorted and titled, what an empty pack looks like, what a search
 * matches, which files may be deleted, whether an archive may be imported — all
 * live in `core/`. What is here is the DOM, the file dialogs and the calls into
 * SillyTavern's endpoints.
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
    exceedsSuggestedHeight,
    isExternalImageUrl,
    validateExternalImageUrl,
} from '../core/image-rules.js';
import { normalizeLabel } from '../core/normalize.js';
import { planImport } from '../core/manifest.js';
import { PLACEMENTS } from '../core/placement.js';
import {
    FIT_MODES,
    SIZE_FIELDS,
    SIZE_SETS,
    defaultSizeValue,
    validateFitMode,
    validateSizeValue,
} from '../core/size.js';
import { buildPackArchive, downloadBlob, readPackArchive } from './archive.js';
import { allowStickerTag, rerenderChat } from './rendering.js';
import { LOG_PREFIX } from './render-common.js';
import { clearContextRegexJson } from './regex.js';
import {
    collectCharacterPackNames,
    getChatScope,
    getCurrentCharacter,
    getCurrentCharacterScope,
    liveContext,
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
    importFailureMessage,
    listOwnImageFiles,
    uploadImage,
    uploadRefusalMessage,
    uploadStickerImage,
} from './upload.js';

const ACCEPTED_MIME = 'image/png,image/jpeg,image/webp,image/gif';

const CONSTRAINT_REASONS = {
    empty: 'cannot be empty',
    'too-long': 'is too long',
    'forbidden-character': 'cannot contain [ ] < or >',
    newline: 'must stay on a single line',
    colon: 'cannot contain ":"',
    invalid: 'must start with a letter and use only letters, digits and "-"',
    reserved: 'is a real HTML tag name',
};

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
 * @param {string} field
 * @param {string} reason
 * @returns {string}
 */
function constraintMessage(field, reason) {
    return `${field} ${CONSTRAINT_REASONS[reason] ?? 'is invalid'}.`;
}

/**
 * Validate a new pack name and its app-wide uniqueness.
 *
 * @param {import('./settings.js').Settings} settings
 * @param {unknown} value
 * @param {object} [except]
 * @returns {{ok: true, value: string} | {ok: false, message: string}}
 */
function checkPackName(settings, value, except) {
    const result = validatePackName(value);
    if (!result.ok) {
        return { ok: false, message: constraintMessage('Pack name', result.reason) };
    }
    if (findPackByName(settings.packs, result.value, { except })) {
        return { ok: false, message: `A pack named "${result.value}" already exists.` };
    }
    return { ok: true, value: result.value };
}

/**
 * Validate a label and its uniqueness inside one pack.
 *
 * @param {import('./settings.js').PackRecord} pack
 * @param {unknown} value
 * @param {object} [except]
 * @returns {{ok: true, value: string} | {ok: false, message: string}}
 */
function checkLabel(pack, value, except) {
    const result = validateLabel(value);
    if (!result.ok) {
        return { ok: false, message: constraintMessage('Label', result.reason) };
    }
    if (findStickerByLabel(pack.stickers, result.value, { except })) {
        return { ok: false, message: `This pack already has a sticker labelled "${result.value}".` };
    }
    return { ok: true, value: result.value };
}

/**
 * @param {'success'|'warning'|'error'} kind
 * @param {string} message
 */
function toast(kind, message) {
    const toastr = window.toastr;
    if (toastr && typeof toastr[kind] === 'function') {
        toastr[kind](message, 'st-emote');
        return;
    }
    console.info(`${LOG_PREFIX} ${message}`);
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
 * Ask the user to confirm something, through the client's own dialog when it
 * offers one. Falls back to the browser's `confirm` so the panel still works on
 * a client that does not expose the popup API.
 *
 * @param {any} context
 * @param {string} message
 * @returns {Promise<boolean>}
 */
async function confirmWithUser(context, message) {
    // Read through `liveContext`: the context captured when the extension loaded
    // can be stale, and the client's popup helpers are the kind of thing a
    // rebound context replaces.
    const live = liveContext(context);
    const popup = live?.callGenericPopup;
    if (typeof popup === 'function' && live?.POPUP_TYPE?.CONFIRM) {
        const result = await popup.call(live, message, live.POPUP_TYPE.CONFIRM);
        return result === (live.POPUP_RESULT?.AFFIRMATIVE ?? 1);
    }
    return globalThis.confirm?.(message) === true;
}

/**
 * Ask the user for a line of text, through the client's own dialog when it
 * offers one.
 *
 * @param {any} context
 * @param {string} message
 * @param {string} [defaultValue]
 * @returns {Promise<string|null>}
 */
async function askForText(context, message, defaultValue = '') {
    const live = liveContext(context);
    const popup = live?.callGenericPopup;
    if (typeof popup === 'function' && live?.POPUP_TYPE?.INPUT) {
        const result = await popup.call(live, message, live.POPUP_TYPE.INPUT, defaultValue);
        return typeof result === 'string' ? result : null;
    }
    const answer = globalThis.prompt?.(message, defaultValue);
    return answer === null ? null : answer;
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
    root.innerHTML = [
        '<div class="inline-drawer-toggle inline-drawer-header">',
        '<b>st-emote</b>',
        '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>',
        '</div>',
        '<div class="inline-drawer-content">',
        '<div class="st-emote-hint">',
        'Upload images into a pack and give each sticker a label. ',
        'Enable a pack globally, per character or per chat to render ',
        '<code>[[sticker:pack:label]]</code> in AI replies.',
        '</div>',
        '<div class="st-emote-options">',
        '<label class="st-emote-option">',
        '<input type="checkbox" id="st_emote_render_user"> Render stickers in user messages',
        '</label>',
        '<label class="st-emote-option">',
        'HTML tag form: <input type="text" class="text_pole" id="st_emote_tag_name">',
        '</label>',
        '</div>',
        '<div class="st-emote-hint">',
        'Where a sticker shows up and how big it is. Write sizes as a number with ',
        '<code>em</code>, <code>px</code> or <code>%</code>; <code>1em</code> is the ',
        'current chat text height. An empty field falls back to its default. ',
        '<code>%</code> is only meaningful on a width: a percentage height depends ',
        'on the parent having a height of its own.',
        '</div>',
        '<div class="st-emote-placement">',
        '<label class="st-emote-field">',
        '<span>Placement</span>',
        '<select class="text_pole" id="st_emote_placement"></select>',
        '</label>',
        '</div>',
        '<div id="st_emote_sizes" class="st-emote-sizes"></div>',
        '<div class="st-emote-create">',
        '<input type="text" class="text_pole" id="st_emote_new_pack" placeholder="New pack name">',
        '<div class="menu_button" id="st_emote_create_pack">Create pack</div>',
        '</div>',
        '<div id="st_emote_missing" class="st-emote-missing"></div>',
        '<div class="st-emote-hint">',
        'Write one of these in your own preset to get the sticker listing:',
        '</div>',
        '<pre class="st-emote-code">{{st-emote}}       one "pack:label" per line\n',
        '{{st-emote::simple}}   bare labels only\n',
        '{{st-emote::full}}     same as {{st-emote}}</pre>',
        '<div class="st-emote-hint">',
        'Clear tokens from the context only (the chat still shows the images). ',
        'Copy this JSON and import it into the Regex extension with "Import To: Global".',
        '</div>',
        '<pre class="st-emote-code" id="st_emote_regex"></pre>',
        '<div class="menu_button" id="st_emote_copy_regex">Copy regex JSON</div>',
        '<div class="st-emote-hint">',
        'Move a whole pack around: export writes one zip with the images and their ',
        'labels, descriptions and placement overrides; import takes such a zip back. ',
        'An imported pack is not enabled anywhere until you say so.',
        '</div>',
        '<div class="st-emote-import">',
        '<input type="text" class="text_pole" id="st_emote_search" placeholder="Search labels and descriptions">',
        '<div class="menu_button" id="st_emote_import_pack">Import pack (.zip)</div>',
        '</div>',
        '<div id="st_emote_packs" class="st-emote-packs"></div>',
        '</div>',
    ].join('');
    container.append(root);

    const settings = ensureSettings(context);
    const packContainer = root.querySelector('#st_emote_packs');
    const missingContainer = root.querySelector('#st_emote_missing');
    const regexBlock = root.querySelector('#st_emote_regex');
    const searchInput = root.querySelector('#st_emote_search');
    const refresh = () => renderPackList(context, packContainer, missingContainer, refresh);

    const tagInput = root.querySelector('#st_emote_tag_name');
    tagInput.value = settings.stickerTag;
    regexBlock.textContent = clearContextRegexJson(settings.stickerTag);
    tagInput.addEventListener('change', () => {
        const result = validateStickerTag(tagInput.value);
        if (!result.ok) {
            toast('warning', constraintMessage('HTML tag name', result.reason));
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
            toast('success', 'Regex JSON copied.');
        } catch (error) {
            console.error(`${LOG_PREFIX} failed to copy regex JSON`, error);
            toast('error', 'Could not copy to the clipboard; select the text manually.');
        }
    });

    const renderUserCheckbox = root.querySelector('#st_emote_render_user');
    renderUserCheckbox.checked = settings.renderUserMessages;
    renderUserCheckbox.addEventListener('change', () => {
        ensureSettings(context).renderUserMessages = renderUserCheckbox.checked;
        saveAndRefresh(context);
    });

    mountPlacementSection(context, root);

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

/**
 * Labels for the 投放方式, including the "follow the global setting" choice a
 * single sticker's override starts from.
 */
const PLACEMENT_LABELS = {
    'in-place': 'In place',
    'after-block': 'After the block',
    'message-end': 'End of message',
};

const PLACEMENT_FOLLOW_LABEL = 'Follow the global setting';

const SIZE_SET_TITLES = {
    inline: 'Inline size (in place)',
    block: 'Block size (after the block / end of message)',
};

const SIZE_FIELD_LABELS = {
    minWidth: 'Min width',
    minHeight: 'Min height',
    maxWidth: 'Max width',
    maxHeight: 'Max height',
    fit: 'Fill',
};

const SIZE_VALUE_HINT = 'needs a number with em, px or %';

/** How each `PACK_STATES` value reads in the list. */
const PACK_STATE_LABELS = {
    [PACK_STATES.empty]: '空',
    [PACK_STATES.imagesMissing]: '图片未同步',
};

/**
 * @param {string} value
 * @param {string} label
 * @returns {HTMLOptionElement}
 */
function option(value, label) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
}

/**
 * @param {string} hint - Empty hides the hint and clears the invalid state.
 */
function showFieldHint(input, hintElement, hint) {
    hintElement.textContent = hint;
    hintElement.classList.toggle('st-emote-hint-bad', hint !== '');
    input.classList.toggle('st-emote-input-bad', hint !== '');
}

/**
 * One hand-typed size field with its own hint. The typed text is stored as
 * written even when it is invalid: an unusable value is treated as unset while
 * rendering, and the user keeps what they typed so they can fix it.
 *
 * @param {string} label
 * @param {string} placeholder
 * @returns {{wrapper: Element, input: HTMLInputElement, hint: Element}}
 */
function buildSizeInput(label, placeholder) {
    const wrapper = document.createElement('label');
    wrapper.className = 'st-emote-field';

    const caption = document.createElement('span');
    caption.textContent = label;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text_pole st-emote-size';
    input.placeholder = placeholder;

    const hint = document.createElement('span');
    hint.className = 'st-emote-field-hint';

    wrapper.append(caption, input, hint);
    return { wrapper, input, hint };
}

/**
 * The fill-mode control: a `<select>`, because the three modes are a closed
 * set rather than something to hand-type.
 *
 * @param {import('../core/size.js').SizeSet} stored
 * @param {(fit: string) => void} onChange
 * @returns {Element}
 */
function buildFitField(stored, onChange) {
    const wrapper = document.createElement('label');
    wrapper.className = 'st-emote-field';

    const caption = document.createElement('span');
    caption.textContent = SIZE_FIELD_LABELS.fit;

    const select = document.createElement('select');
    select.className = 'text_pole';
    select.append(option('', 'default'));
    for (const mode of FIT_MODES) {
        select.append(option(mode, mode));
    }
    const check = validateFitMode(stored.fit);
    select.value = check.ok ? check.value : '';
    select.addEventListener('change', () => onChange(select.value));

    wrapper.append(caption, select);
    return wrapper;
}

/**
 * One 尺寸集: its hand-typed bounds plus its fill mode. The field list comes
 * from `SIZE_FIELDS`, so a field added to the core shows up here on its own.
 *
 * @param {any} context
 * @param {import('../core/size.js').SizeSetKey} sizeSet
 * @param {import('./settings.js').Settings} settings
 * @returns {Element}
 */
function buildSizeSet(context, sizeSet, settings) {
    const group = document.createElement('div');
    group.className = 'st-emote-size-set';

    const title = document.createElement('div');
    title.className = 'st-emote-size-set-title';
    title.textContent = SIZE_SET_TITLES[sizeSet];
    group.append(title);

    const fields = document.createElement('div');
    fields.className = 'st-emote-size-fields';
    group.append(fields);

    for (const field of SIZE_FIELDS) {
        if (field === 'fit') {
            fields.append(buildFitField(settings.sizes[sizeSet].fit, (fit) => {
                ensureSettings(context).sizes[sizeSet].fit = fit;
                saveAndRefresh(context);
            }));
            continue;
        }
        const { wrapper, input, hint } = buildSizeInput(
            SIZE_FIELD_LABELS[field],
            defaultSizeValue(sizeSet, field) || '—',
        );
        input.value = settings.sizes[sizeSet][field];
        input.addEventListener('change', () => {
            const result = validateSizeValue(input.value);
            // Stored verbatim, valid or not: an unusable value is treated as
            // unset while rendering, and the user keeps what they typed.
            ensureSettings(context).sizes[sizeSet][field] = input.value;
            if (result.ok) {
                showFieldHint(input, hint, '');
            } else {
                showFieldHint(input, hint, SIZE_VALUE_HINT);
                console.info(
                    `${LOG_PREFIX} ${sizeSet} ${field} "${input.value}" is not a size; using the default instead`,
                );
            }
            saveAndRefresh(context);
        });
        // A value that was left invalid stays visible as such across a reload.
        if (!validateSizeValue(input.value).ok) {
            showFieldHint(input, hint, SIZE_VALUE_HINT);
        }
        fields.append(wrapper);
    }

    return group;
}

/**
 * Build the 投放方式 and size controls: the global placement and the two size
 * sets. Each sticker carries its own override entry point in the pack list.
 *
 * @param {any} context
 * @param {Element} root
 */
function mountPlacementSection(context, root) {
    const settings = ensureSettings(context);
    const select = root.querySelector('#st_emote_placement');
    for (const placement of PLACEMENTS) {
        select.append(option(placement, PLACEMENT_LABELS[placement]));
    }
    select.value = settings.placement;
    select.addEventListener('change', () => {
        ensureSettings(context).placement = select.value;
        saveAndRefresh(context);
    });

    const sizes = root.querySelector('#st_emote_sizes');
    for (const sizeSet of SIZE_SETS) {
        sizes.append(buildSizeSet(context, sizeSet, settings));
    }
}

/**
 * The per-sticker 投放方式 override. An empty value means the sticker follows
 * the global setting; anything else also switches it to the other size set.
 *
 * @param {any} context
 * @param {import('./settings.js').StickerRecord} sticker
 * @returns {Element}
 */
function buildStickerPlacementSelect(context, sticker) {
    const select = document.createElement('select');
    select.className = 'text_pole st-emote-sticker-placement';
    select.title = 'Placement override for this sticker';
    select.append(option('', PLACEMENT_FOLLOW_LABEL));
    for (const placement of PLACEMENTS) {
        select.append(option(placement, PLACEMENT_LABELS[placement]));
    }
    select.value = sticker.placement ?? '';
    select.addEventListener('change', () => {
        sticker.placement = select.value;
        saveAndRefresh(context);
    });
    return select;
}

/**
 * @param {string} text
 * @returns {Promise<void>}
 */
async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
}

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
            ? 'No packs yet. Create one to upload images.'
            : `No sticker matches "${query}".`;
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
    header.textContent = `Missing packs referenced by this chat's characters (${missing.length})`;
    container.append(header);

    const list = document.createElement('div');
    list.className = 'st-emote-missing-list';
    list.textContent = missing.join(', ');
    container.append(list);

    const button = actionButton('Create missing packs');
    button.addEventListener('click', () => {
        const current = ensureSettings(context);
        for (const name of missing) {
            if (!findPackByName(current.packs, name)) {
                createPack(current, name);
            }
        }
        context.saveSettingsDebounced();
        rerenderChat(context);
        toast('success', `Created ${missing.length} empty pack${missing.length === 1 ? '' : 's'}. Add images to them.`);
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
    count.textContent = `${pack.stickers.length} sticker${pack.stickers.length === 1 ? '' : 's'}`;
    header.append(count);

    if (PACK_STATE_LABELS[state]) {
        const badge = document.createElement('span');
        badge.className = `st-emote-badge st-emote-badge-${state}`;
        badge.textContent = PACK_STATE_LABELS[state];
        badge.title = state === PACK_STATES.empty
            ? 'This pack has no stickers yet. It can be enabled, but no token will resolve to it.'
            : 'The image files are not on this server. The pack still works — re-point the '
                + 'stickers at your own copies of the images.';
        header.append(badge);
    }

    header.append(filePickerButton(
        'Upload images',
        { accept: ACCEPTED_MIME, multiple: true, className: 'st-emote-upload' },
        (files) => handleUploads(context, pack, files, refresh),
    ));
    header.append(actionButton('Add image URL', 'st-emote-add-url'));
    header.querySelector('.st-emote-add-url').addEventListener('click', async () => {
        await handleExternalUrl(context, pack, refresh);
    });

    if (!searching) {
        header.append(actionButton('Export .zip', 'st-emote-export'));
        header.querySelector('.st-emote-export').addEventListener('click', async () => {
            await handleExport(context, pack);
        });
        header.append(actionButton('Delete pack', 'st-emote-delete-pack'));
        header.querySelector('.st-emote-delete-pack').addEventListener('click', async () => {
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
        cover.title = 'Images are not on this server — click to re-point the first missing sticker';
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
        toast('warning', `Renamed to "${check.value}". Tokens using the old name no longer match.`);
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
    all.title = 'Select every sticker in this pack';
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
    label.textContent = searching ? 'Select the matches' : 'Select all';
    const wrapper = document.createElement('label');
    wrapper.className = 'st-emote-enable';
    wrapper.append(all, label);
    bar.append(wrapper);

    const chosen = selectedInPack(pack);
    const count = document.createElement('span');
    count.className = 'st-emote-pack-count';
    count.textContent = chosen === 0 ? '' : `${chosen} selected`;
    bar.append(count);

    if (chosen > 0) {
        const remove = actionButton(`Delete ${chosen} selected`, 'st-emote-delete-selected');
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
            textContent: 'Clear the search to delete selected stickers.',
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

    group.append(buildScopeToggle('Global', isPackEnabled(ensureSettings(context), pack.name), (checked) => {
        setPackEnabled(ensureSettings(context), pack.name, checked);
        saveAndRefresh(context);
    }));

    const currentCharacter = getCurrentCharacter(context);
    const hasCharacter = Boolean(currentCharacter);
    group.append(buildScopeToggle(
        'Character',
        hasCharacter && scopeHasPack(getCurrentCharacterScope(context), pack.name),
        (checked) => {
            const next = setPackInScope(getCurrentCharacterScope(context), pack.name, checked);
            setCurrentCharacterScope(context, next).finally(() => rerenderChat(context));
        },
        !hasCharacter,
    ));

    group.append(buildScopeToggle(
        'Chat',
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
    tick.title = 'Select for a batch delete';
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
    labelInput.placeholder = 'Label';
    labelInput.value = sticker.label;
    labelInput.addEventListener('change', () => {
        const previousLabel = sticker.label;
        const check = checkLabel(pack, labelInput.value, sticker);
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
            toast('warning', `Label is now "${check.value}". Tokens using the old label no longer match.`);
        }
        refresh();
    });
    row.append(labelInput);

    if (!normalizeLabel(sticker.label)) {
        row.append(badge('待填标签', ''));
    }
    if (isExternalImageUrl(sticker.image)) {
        row.append(badge('外链', 'st-emote-badge-external', 'The image comes from a URL and is not stored here.'));
    }

    const descriptionInput = document.createElement('input');
    descriptionInput.type = 'text';
    descriptionInput.className = 'text_pole st-emote-description';
    descriptionInput.placeholder = '—';
    descriptionInput.value = sticker.description ?? '';
    descriptionInput.addEventListener('change', () => {
        const result = validateDescription(descriptionInput.value);
        if (!result.ok) {
            toast('warning', constraintMessage('Description', result.reason));
            descriptionInput.value = sticker.description ?? '';
            return;
        }
        sticker.description = result.value;
        context.saveSettingsDebounced();
    });
    row.append(descriptionInput);
    row.append(buildStickerPlacementSelect(context, sticker));

    const replace = filePickerButton(
        'Replace',
        { accept: ACCEPTED_MIME, className: 'st-emote-replace' },
        async (files) => {
            await replaceStickerImageWithFile(context, pack, sticker, refresh, files[0]);
        },
    );
    row.append(replace);

    if (!searching) {
        const remove = actionButton('Delete', 'st-emote-sticker-delete');
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
            sticker.image = await uploadStickerImage(context, file, sticker.id);
        } catch (error) {
            console.error(`${LOG_PREFIX} upload failed for ${file.name}`, error);
            toast('error', `${file.name} was not added: ${error.message}`);
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
        toast('success', `Uploaded ${uploaded} image${uploaded === 1 ? '' : 's'} into "${pack.name}".`);
    }
    if (tooTall.length > 0) {
        toast(
            'warning',
            `Taller than the suggested ${SUGGESTED_MAX_HEIGHT_PX}px: ${tooTall.join(', ')}. `
            + 'They still work; a smaller image just reads better inline.',
        );
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
    const answer = await askForText(context, 'Image URL (http:// or https://):');
    if (answer === null) {
        return;
    }
    const check = validateExternalImageUrl(answer);
    if (!check.ok) {
        toast('warning', check.reason === 'empty'
            ? 'No address given.'
            : 'That is not an http(s) image address.');
        return;
    }
    const sticker = createSticker();
    sticker.image = check.value;
    pack.stickers.push(sticker);
    context.saveSettingsDebounced();
    toast('success', `Added an external sticker to "${pack.name}". Give it a label to use it.`);
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
        console.error(`${LOG_PREFIX} could not replace the image of ${sticker.id}`, error);
        toast('error', `The image was not replaced: ${error.message}`);
        return;
    }

    // The old file goes only after the new one is safely stored, so a failed
    // upload can never leave the sticker with no image at all.
    const previous = replaceStickerImage(sticker, stored);
    if (previous) {
        await deleteImageQuietly(context, previous);
    }
    context.saveSettingsDebounced();
    toast('success', previous
        ? 'Image replaced; the label and description are unchanged.'
        : 'Image set.');
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
    const label = sticker.label ? `"${sticker.label}"` : 'this sticker';
    const confirmed = await confirmWithUser(context, `Delete ${label} and its image file?`);
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
        `Delete ${chosen.length} sticker${chosen.length === 1 ? '' : 's'} and their image files?`,
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
        `Delete the pack "${pack.name}"? `
        + `That removes ${count} sticker${count === 1 ? '' : 's'} and deletes their image files, `
        + 'and takes the pack out of every scope. Tokens naming it will stop matching.',
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
    toast('success', `Deleted "${pack.name}".`);
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
        toast('success', `Exported "${pack.name}" with ${count} image${count === 1 ? '' : 's'}.`);
    } catch (error) {
        console.error(`${LOG_PREFIX} could not export "${pack.name}"`, error);
        toast('error', `Could not export "${pack.name}": ${error.message}`);
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
        console.error(`${LOG_PREFIX} could not read ${file.name}`, error);
        toast('error', `Could not read ${file.name}: ${error.message}`);
        return;
    }
    if (!archive.ok) {
        toast('warning', importFailureMessage(archive.reason));
        return;
    }

    const current = ensureSettings(context);
    const plan = planImport(archive.manifest, current.packs, newId);
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
            console.error(`${LOG_PREFIX} could not store ${upload.path} from ${file.name}`, error);
            toast('warning', `${upload.path} could not be stored: ${error.message}`);
        }
    }

    // Added last, and into no scope: an imported pack is inert until the user
    // enables it, so importing can never change what a chat renders.
    addImportedPack(current, plan.pack);
    context.saveSettingsDebounced();
    await refreshStoredImages(context);
    toast(
        'success',
        `Imported "${plan.pack.name}" with ${plan.pack.stickers.length} sticker`
        + `${plan.pack.stickers.length === 1 ? '' : 's'} (${stored} image${stored === 1 ? '' : 's'}). `
        + 'It is not enabled anywhere yet.',
    );
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
        console.error(`${LOG_PREFIX} could not delete ${path}`, error);
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
