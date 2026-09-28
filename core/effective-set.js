import { normalizeLabel, normalizePackName } from './normalize.js';

/**
 * @typedef {Object} Sticker
 * @property {string} [id]
 * @property {string} label
 * @property {string} [description]
 * @property {string} [image]
 * @property {string} [placement] - This sticker's 投放方式 override; empty or
 *   absent means it follows the global setting.
 */

/**
 * @typedef {Object} Pack
 * @property {string} [id]
 * @property {string} name
 * @property {Sticker[]} stickers
 */

/**
 * @typedef {Object} LookupHit
 * @property {true} hit
 * @property {Pack} pack
 * @property {Sticker} sticker
 */

/**
 * @typedef {Object} LookupMiss
 * @property {false} hit
 * @property {'pack-not-found'|'pack-not-enabled'|'label-not-found'|'ambiguous-bare-label'} reason
 */

/**
 * @typedef {Object} EffectiveSet
 * @property {Pack[]} packs - The enabled packs, in enabled order. Each pack
 *   carries only its labeled stickers: an unlabeled sticker cannot be named by
 *   a token, so it is not part of the usable set and never appears in a
 *   listing.
 * @property {(packName: string|null, label: string) => LookupHit|LookupMiss} lookup
 */

/**
 * Merge the pack names enabled by several scopes into the effective set's
 * source list. The scopes are pure union: only additions, no exclusions,
 * overrides or priorities. Duplicates are dropped case-insensitively, keeping
 * the spelling and order of the first occurrence.
 *
 * @param {...(string[]|null|undefined)} sources - Any number of scope lists,
 *   conventionally global, then character, then chat.
 * @returns {string[]}
 */
export function mergeEnabledPackNames(...sources) {
    const merged = [];
    const seen = new Set();
    for (const source of sources) {
        for (const value of Array.isArray(source) ? source : []) {
            const text = String(value ?? '').trim();
            const key = normalizePackName(text);
            if (!key || seen.has(key)) {
                continue;
            }
            seen.add(key);
            merged.push(text);
        }
    }
    return merged;
}

/**
 * Whether a scope's enabled list contains a pack (case-insensitive).
 *
 * @param {string[]|null|undefined} names
 * @param {unknown} packName
 * @returns {boolean}
 */
export function scopeHasPack(names, packName) {
    const key = normalizePackName(packName);
    if (!key) {
        return false;
    }
    return (Array.isArray(names) ? names : [])
        .some((name) => normalizePackName(name) === key);
}

/**
 * Return a copy of a scope's enabled list with one pack turned on or off.
 * Enabling keeps the caller's spelling and never duplicates an existing entry.
 *
 * @param {string[]|null|undefined} names
 * @param {unknown} packName
 * @param {boolean} enabled
 * @returns {string[]}
 */
export function setPackInScope(names, packName, enabled) {
    const key = normalizePackName(packName);
    const list = Array.isArray(names) ? names : [];
    if (!key) {
        return list.slice();
    }
    if (!enabled) {
        return list.filter((name) => normalizePackName(name) !== key);
    }
    if (list.some((name) => normalizePackName(name) === key)) {
        return list.slice();
    }
    return [...list, String(packName).trim()];
}

/**
 * Remap one pack name inside a scope's enabled list, for renames. Names other
 * than the renamed pack are left untouched.
 *
 * @param {string[]|null|undefined} names
 * @param {unknown} oldName
 * @param {unknown} newName
 * @returns {string[]}
 */
export function renamePackInScope(names, oldName, newName) {
    const oldKey = normalizePackName(oldName);
    return (Array.isArray(names) ? names : []).map(
        (name) => (normalizePackName(name) === oldKey ? String(newName).trim() : name),
    );
}

/**
 * Resolve the effective set: the union of the packs enabled by the active
 * scopes. It receives the already merged list of enabled pack names and the
 * full pack catalogue.
 *
 * A bare label (`[[sticker:label]]`) only resolves when exactly one pack is
 * enabled. With several packs enabled it is ambiguous and counts as a miss.
 *
 * @param {Pack[]} packs
 * @param {string[]} enabledPackNames
 * @returns {EffectiveSet}
 */
export function buildEffectiveSet(packs, enabledPackNames) {
    const allPacks = Array.isArray(packs) ? packs : [];
    const packsByName = new Map();
    for (const pack of allPacks) {
        if (!pack || typeof pack.name !== 'string') {
            continue;
        }
        packsByName.set(normalizePackName(pack.name), pack);
    }

    const enabled = [];
    const seen = new Set();
    for (const name of Array.isArray(enabledPackNames) ? enabledPackNames : []) {
        const key = normalizePackName(name);
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        const pack = packsByName.get(key);
        if (pack) {
            enabled.push({
                ...pack,
                stickers: (Array.isArray(pack.stickers) ? pack.stickers : [])
                    .filter((sticker) => sticker && normalizeLabel(sticker.label)),
            });
        }
    }

    const enabledByName = new Map(
        enabled.map((pack) => [normalizePackName(pack.name), pack]),
    );

    return {
        packs: enabled,
        lookup(packName, label) {
            const normalizedLabel = normalizeLabel(label);
            if (!normalizedLabel) {
                return { hit: false, reason: 'label-not-found' };
            }

            let pack;
            if (packName === null || packName === undefined || packName === '') {
                if (enabled.length === 0) {
                    return { hit: false, reason: 'pack-not-enabled' };
                }
                if (enabled.length > 1) {
                    return { hit: false, reason: 'ambiguous-bare-label' };
                }
                pack = enabled[0];
            } else {
                const key = normalizePackName(packName);
                pack = enabledByName.get(key);
                if (!pack) {
                    return {
                        hit: false,
                        reason: packsByName.has(key) ? 'pack-not-enabled' : 'pack-not-found',
                    };
                }
            }

            const stickers = Array.isArray(pack.stickers) ? pack.stickers : [];
            const sticker = stickers.find(
                (item) => item && item.label && normalizeLabel(item.label) === normalizedLabel,
            );
            if (!sticker) {
                return { hit: false, reason: 'label-not-found' };
            }
            return { hit: true, pack, sticker };
        },
    };
}

/**
 * Build the effective set straight from the three scopes. This is the one place
 * the union rule lives: global, then character, then chat, deduped by pack name.
 *
 * @param {Pack[]} packs - Full pack catalogue.
 * @param {{global?: string[], character?: string[], chat?: string[]}} [scopes]
 * @returns {EffectiveSet}
 */
export function buildScopedEffectiveSet(packs, scopes = {}) {
    return buildEffectiveSet(
        packs,
        mergeEnabledPackNames(scopes.global, scopes.character, scopes.chat),
    );
}
