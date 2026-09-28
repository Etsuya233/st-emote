import {
    findPackByName,
    findStickerByLabel,
    validateDescription,
    validateLabel,
    validatePackName,
    validateStickerTag,
} from '../core/constraints.js';
import { normalizeLabel } from '../core/normalize.js';
import { allowStickerTag, LOG_PREFIX, rerenderChat } from './rendering.js';
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
        'Enable a pack globally to render <code>[[sticker:pack:label]]</code> in AI replies.',
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
        '<div id="st_emote_packs" class="st-emote-packs"></div>',
        '</div>',
    ].join('');
    container.append(root);

    const settings = ensureSettings(context);
    const packContainer = root.querySelector('#st_emote_packs');
    const refresh = () => renderPackList(context, packContainer, refresh);

    const tagInput = root.querySelector('#st_emote_tag_name');
    tagInput.value = settings.stickerTag;
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
        saveAndRefresh(context);
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

    refresh();
}

/**
 * @param {any} context
 * @param {Element} packContainer
 * @param {() => void} refresh
 */
function renderPackList(context, packContainer, refresh) {
    const settings = ensureSettings(context);
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

    const enableLabel = document.createElement('label');
    enableLabel.className = 'st-emote-enable';
    const enableCheckbox = document.createElement('input');
    enableCheckbox.type = 'checkbox';
    enableCheckbox.checked = isPackEnabled(ensureSettings(context), pack.name);
    enableCheckbox.addEventListener('change', () => {
        setPackEnabled(ensureSettings(context), pack.name, enableCheckbox.checked);
        saveAndRefresh(context);
    });
    enableLabel.append(enableCheckbox, document.createTextNode(' Enabled (global)'));
    header.append(enableLabel);

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'text_pole st-emote-pack-name';
    name.value = pack.name;
    name.addEventListener('change', () => {
        const current = ensureSettings(context);
        const check = checkPackName(current, name.value, pack);
        if (!check.ok) {
            toast('warning', check.message);
            name.value = pack.name;
            return;
        }
        renamePack(current, pack, check.value);
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
