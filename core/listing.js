import { normalizeLabel } from './normalize.js';

/** Text the listing expands to when the effective set is empty, by language. */
const EMPTY_TEXT = {
    zh: '无',
    en: 'none',
};

/**
 * @typedef {Object} ListingOptions
 * @property {'simple'|'full'|string} [mode='full'] - `simple` prints bare
 *   labels, `full` (and anything unrecognized) prints `pack:label` rows.
 * @property {string} [locale='en'] - SillyTavern UI locale; only used to pick
 *   the wording of the empty listing.
 */

/**
 * Build the macro listing for the current effective set. Every labeled sticker
 * of every enabled pack becomes one row; descriptions never enter the listing.
 * A sticker's label can repeat across packs, and in `simple` mode those repeats
 * stay visible.
 *
 * @param {import('./effective-set.js').EffectiveSet} effectiveSet
 * @param {ListingOptions} [options]
 * @returns {string}
 */
export function buildListing(effectiveSet, options = {}) {
    const simple = String(options.mode ?? '').trim().toLowerCase() === 'simple';
    const packs = Array.isArray(effectiveSet?.packs) ? effectiveSet.packs : [];

    const rows = [];
    for (const pack of packs) {
        if (!pack) {
            continue;
        }
        for (const sticker of Array.isArray(pack.stickers) ? pack.stickers : []) {
            if (!sticker || !normalizeLabel(sticker.label)) {
                continue;
            }
            rows.push(simple ? sticker.label : `${pack.name}:${sticker.label}`);
        }
    }

    if (rows.length === 0) {
        const locale = String(options.locale ?? 'en').toLowerCase();
        return locale.startsWith('zh') ? EMPTY_TEXT.zh : EMPTY_TEXT.en;
    }
    return rows.join('\n');
}
