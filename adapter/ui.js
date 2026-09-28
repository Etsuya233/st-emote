import {
    findPackByName,
    findStickerByLabel,
    validateDescription,
    validateLabel,
    validatePackName,
    validateStickerTag,
} from '../core/constraints.js';
import { renamePackInScope, scopeHasPack, setPackInScope } from '../core/effective-set.js';
import { normalizeLabel } from '../core/normalize.js';
import { allowStickerTag, LOG_PREFIX, rerenderChat } from './rendering.js';
import { clearContextRegexJson } from './regex.js';
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
    renamePack,
    setPackEnabled,
} from './settings.js';
import { uploadStickerImage } from './upload.js';

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
        '<div id="st_emote_packs" class="st-emote-packs"></div>',
        '</div>',
    ].join('');
    container.append(root);

    const settings = ensureSettings(context);
    const packContainer = root.querySelector('#st_emote_packs');
    const missingContainer = root.querySelector('#st_emote_missing');
    const regexBlock = root.querySelector('#st_emote_regex');
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

    const events = context.eventTypes;
    if (context.eventSource && events?.CHAT_CHANGED) {
        context.eventSource.on(events.CHAT_CHANGED, refresh);
    }

    refresh();
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
 * @param {any} context
 * @param {Element} packContainer
 * @param {Element} missingContainer
 * @param {() => void} refresh
 */
function renderPackList(context, packContainer, missingContainer, refresh) {
    const settings = ensureSettings(context);
    renderMissingPacks(context, settings, missingContainer, refresh);

    packContainer.textContent = '';
    if (settings.packs.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'st-emote-empty';
        empty.textContent = 'No packs yet. Create one to upload images.';
        packContainer.append(empty);
        return;
    }

    const sorted = [...settings.packs].sort((a, b) => a.name.localeCompare(b.name));
    for (const pack of sorted) {
        packContainer.append(buildPackElement(context, pack, refresh));
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

    const button = document.createElement('div');
    button.className = 'menu_button';
    button.textContent = 'Create missing packs';
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
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {() => void} refresh
 * @returns {Element}
 */
function buildPackElement(context, pack, refresh) {
    const wrapper = document.createElement('div');
    wrapper.className = 'st-emote-pack';

    const header = document.createElement('div');
    header.className = 'st-emote-pack-header';

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
    header.append(name);

    const count = document.createElement('span');
    count.className = 'st-emote-pack-count';
    count.textContent = `${pack.stickers.length} sticker${pack.stickers.length === 1 ? '' : 's'}`;
    header.append(count);

    const uploadButton = document.createElement('div');
    uploadButton.className = 'menu_button st-emote-upload';
    uploadButton.textContent = 'Upload images';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = ACCEPTED_MIME;
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    uploadButton.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async () => {
        const files = Array.from(fileInput.files ?? []);
        fileInput.value = '';
        if (files.length > 0) {
            await handleUploads(context, pack, files, refresh);
        }
    });
    header.append(uploadButton, fileInput);

    header.append(buildScopeToggles(context, pack));
    wrapper.append(header);

    const stickers = document.createElement('div');
    stickers.className = 'st-emote-stickers';
    for (const sticker of pack.stickers) {
        stickers.append(buildStickerElement(context, pack, sticker, refresh));
    }
    wrapper.append(stickers);

    return wrapper;
}

/**
 * The Global / Character / Chat checkboxes for one pack. Scopes are a pure
 * union, so every box is independent: checking one never unchecks another.
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
 * @returns {Element}
 */
function buildStickerElement(context, pack, sticker, refresh) {
    const row = document.createElement('div');
    row.className = 'st-emote-sticker';

    const thumb = document.createElement('img');
    thumb.className = 'st-emote-thumb';
    thumb.alt = '';
    if (sticker.image) {
        thumb.src = sticker.image;
    } else {
        thumb.classList.add('st-emote-thumb-missing');
    }
    row.append(thumb);

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'text_pole st-emote-label';
    labelInput.placeholder = 'Label';
    labelInput.value = sticker.label;
    labelInput.addEventListener('change', () => {
        const check = checkLabel(pack, labelInput.value, sticker);
        if (!check.ok) {
            toast('warning', check.message);
            labelInput.value = sticker.label;
            return;
        }
        sticker.label = check.value;
        saveAndRefresh(context);
        refresh();
    });
    row.append(labelInput);

    if (!normalizeLabel(sticker.label)) {
        const badge = document.createElement('span');
        badge.className = 'st-emote-badge';
        badge.textContent = '待填标签';
        row.append(badge);
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

    return row;
}

/**
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {File[]} files
 * @param {() => void} refresh
 */
async function handleUploads(context, pack, files, refresh) {
    let uploaded = 0;

    for (const file of files) {
        const sticker = createSticker();
        try {
            sticker.image = await uploadStickerImage(context, file, sticker.id);
            pack.stickers.push(sticker);
            uploaded += 1;
        } catch (error) {
            console.error(`${LOG_PREFIX} upload failed for ${file.name}`, error);
            toast('error', `Upload failed for ${file.name}: ${error.message}`);
        }
    }

    if (uploaded > 0) {
        context.saveSettingsDebounced();
        toast('success', `Uploaded ${uploaded} image${uploaded === 1 ? '' : 's'} into "${pack.name}".`);
    }
    rerenderChat(context);
    refresh();
}
