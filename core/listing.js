import { t } from './i18n.js';
import { normalizeLabel } from './normalize.js';

/**
 * @typedef {Object} ListingOptions
 * @property {'simple'|'full'|string} [mode='full'] - `simple` prints bare
 *   labels, `full` (and anything unrecognized) prints `pack:label` rows.
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
        // The one word the macro expands to when there is nothing to list. It
        // comes from the same catalog as the panel, so the two cannot end up
        // disagreeing about what this extension calls an empty set — and the
        // listing is the one place where the language reaches the *prompt*.
        return t('listing.empty');
    }
    return rows.join('\n');
}
