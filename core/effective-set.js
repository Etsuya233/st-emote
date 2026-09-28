import { normalizeLabel, normalizePackName } from './normalize.js';

/**
 * @typedef {Object} Sticker
 * @property {string} [id]
 * @property {string} label
 * @property {string} [description]
 * @property {string} [image]
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
 * @property {Pack[]} packs - The enabled packs, in enabled order.
 * @property {(packName: string|null, label: string) => LookupHit|LookupMiss} lookup
 */

/**
 * Resolve the effective set: the union of the packs enabled by the active
 * scopes. Ticket 01 only knows the global scope, so this receives the already
 * merged list of enabled pack names and the full pack catalogue.
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
            enabled.push(pack);
        }
    }

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
                const known = packsByName.get(normalizePackName(packName));
                if (!known) {
                    return { hit: false, reason: 'pack-not-found' };
                }
                if (!enabled.includes(known)) {
                    return { hit: false, reason: 'pack-not-enabled' };
                }
                pack = known;
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
