import { normalizePackName } from '../core/normalize.js';

/** Key under `extension_settings` that holds this extension's data. */
export const STORAGE_KEY = 'st-emote';

/** Sub-folder inside `user/images/` where uploaded sticker files are written. */
export const IMAGE_SUBFOLDER = 'st-emote';

const SCHEMA_VERSION = 1;

/**
 * @typedef {Object} StickerRecord
 * @property {string} id
 * @property {string} label
 * @property {string} description
 * @property {string} image - Client-relative path, e.g. `user/images/st-emote/x.png`.
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
        store[STORAGE_KEY] = { version: SCHEMA_VERSION, packs: [], enabledPackNames: [] };
    }
    const settings = store[STORAGE_KEY];
    if (!Array.isArray(settings.packs)) {
        settings.packs = [];
    }
    if (!Array.isArray(settings.enabledPackNames)) {
        settings.enabledPackNames = [];
    }
    for (const pack of settings.packs) {
        if (!pack || typeof pack !== 'object') {
            continue;
        }
        if (!Array.isArray(pack.stickers)) {
            pack.stickers = [];
        }
    }
    return settings;
}

/**
 * @param {Settings} settings
 * @param {string} name
 * @returns {PackRecord|null}
 */
export function findPack(settings, name) {
    const key = normalizePackName(name);
    return settings.packs.find((pack) => normalizePackName(pack.name) === key) ?? null;
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
 * @param {Settings} settings
 * @param {string} name
 * @returns {boolean}
 */
export function isPackEnabled(settings, name) {
    const key = normalizePackName(name);
    return settings.enabledPackNames.some((item) => normalizePackName(item) === key);
}

/**
 * @param {Settings} settings
 * @param {string} name
 * @param {boolean} enabled
 */
export function setPackEnabled(settings, name, enabled) {
    const key = normalizePackName(name);
    settings.enabledPackNames = settings.enabledPackNames.filter(
        (item) => normalizePackName(item) !== key,
    );
    if (enabled) {
        settings.enabledPackNames.push(String(name).trim());
    }
}

/**
 * @returns {StickerRecord}
 */
export function createSticker() {
    return { id: newId('sticker'), label: '', description: '', image: '' };
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
