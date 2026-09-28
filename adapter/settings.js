import { renamePackInScope, scopeHasPack, setPackInScope } from '../core/effective-set.js';
import { DEFAULT_STICKER_TAG, validateStickerTag } from '../core/constraints.js';
import { IMAGE_SUBFOLDER } from '../core/image-rules.js';
import { DEFAULT_PLACEMENT, validatePlacement } from '../core/placement.js';
import { ensureSizeSets } from '../core/size.js';

/** Key under `extension_settings` that holds this extension's data. */
export const STORAGE_KEY = 'st-emote';

/**
 * Sub-folder inside `user/images/` where uploaded sticker files are written.
 * Re-exported from the pure core, which owns it: where the files go and what
 * they may be called are one decision, and the delete filter depends on both.
 */
export { IMAGE_SUBFOLDER };

const SCHEMA_VERSION = 1;

/**
 * @typedef {Object} StickerRecord
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {string} image - Client-relative path, e.g. `user/images/st-emote/x.png`.
 * @property {string} [placement] - This sticker's 投放方式 override. Empty
 *   means "follow the global setting".
 */

/**
 * @typedef {Object} PackRecord
 * @property {string} name
 * @property {StickerRecord[]} stickers
 */

/**
 * @typedef {Object} Settings
 * @property {number} version
 * @property {PackRecord[]} packs
 * @property {string[]} enabledPackNames - Global scope.
 * @property {string} stickerTag - Name of the HTML-tag token form.
 * @property {boolean} renderUserMessages - Render tokens in user messages too.
 * @property {import('../core/placement.js').Placement} placement - Global 投放方式.
 * @property {import('../core/size.js').SizeSets} sizes - The `inline` and
 *   `block` 尺寸集, always both present after `ensureSettings`.
 */

/**
 * Read the extension settings, creating the default shape on first run.
 *
 * @param {{extensionSettings: Record<string, any>}} context
 * @returns {Settings}
 */
export function ensureSettings(context) {
    const store = context.extensionSettings;
    if (!store[STORAGE_KEY] || typeof store[STORAGE_KEY] !== 'object') {
        store[STORAGE_KEY] = {
            version: SCHEMA_VERSION,
            packs: [],
            enabledPackNames: [],
            stickerTag: DEFAULT_STICKER_TAG,
            renderUserMessages: false,
            placement: DEFAULT_PLACEMENT,
            sizes: ensureSizeSets(null),
        };
    }
    const settings = store[STORAGE_KEY];
    if (!Array.isArray(settings.packs)) {
        settings.packs = [];
    }
    if (!Array.isArray(settings.enabledPackNames)) {
        settings.enabledPackNames = [];
    }
    if (!validateStickerTag(settings.stickerTag).ok) {
        settings.stickerTag = DEFAULT_STICKER_TAG;
    }
    settings.renderUserMessages = settings.renderUserMessages === true;
    if (!validatePlacement(settings.placement).ok) {
        settings.placement = DEFAULT_PLACEMENT;
    }
    // Size values are stored exactly as typed, valid or not. An invalid value is
    // treated as unset while rendering, and the panel still shows it so the user
    // can fix it instead of losing what they wrote.
    settings.sizes = ensureSizeSets(settings.sizes);
    for (const pack of settings.packs) {
        if (!pack || typeof pack !== 'object') {
            continue;
        }
        if (!Array.isArray(pack.stickers)) {
            pack.stickers = [];
        }
        for (const sticker of pack.stickers) {
            if (sticker && !validatePlacement(sticker.placement).ok) {
                sticker.placement = '';
            }
        }
    }
    return settings;
}

/**
 * @param {Settings} settings
 * @param {string} name
 * @returns {PackRecord}
 */
export function createPack(settings, name) {
    const pack = { name: String(name).trim(), stickers: [] };
    settings.packs.push(pack);
    return pack;
}

/**
 * Remap a pack's enabled reference when it is renamed.
 *
 * @param {Settings} settings
 * @param {PackRecord} pack
 * @param {string} newName
 */
export function renamePack(settings, pack, newName) {
    const oldName = pack.name;
    pack.name = newName;
    settings.enabledPackNames = renamePackInScope(settings.enabledPackNames, oldName, newName);
}

/**
 * @param {Settings} settings
 * @param {string} name
 * @returns {boolean}
 */
export function isPackEnabled(settings, name) {
    return scopeHasPack(settings.enabledPackNames, name);
}

/**
 * @param {Settings} settings
 * @param {string} name
 * @param {boolean} enabled
 */
export function setPackEnabled(settings, name, enabled) {
    settings.enabledPackNames = setPackInScope(settings.enabledPackNames, name, enabled);
}

/**
 * @returns {StickerRecord}
 */
export function createSticker() {
    return { id: newId('sticker'), label: '', description: '', image: '', placement: '' };
}

/**
 * Generate a URL-safe identifier. `crypto.randomUUID` needs a secure context,
 * so a weak fallback covers plain-HTTP LAN deployments.
 *
 * @param {string} prefix
 * @returns {string}
 */
export function newId(prefix) {
    const random = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID().replace(/-/g, '')
        : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    return `${prefix}_${random.slice(0, 16)}`;
}
