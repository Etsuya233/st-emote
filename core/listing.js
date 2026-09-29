import { t } from './i18n.js';
import { normalizeLabel } from './normalize.js';

/**
 * @typedef {Object} ListingOptions
 * @property {'simple'|'full'|string} [mode='full'] - `simple` prints
 *   `pack:label` rows, `full` (and anything unrecognized) appends the
 *   description in half-width parentheses.
 */

/**
 * Build the macro listing for the current effective set. Every labeled sticker
 * of every enabled pack becomes one row.
 *
 * A sticker's label can repeat across packs. Both modes qualify every row with
 * its pack name, so those two rows differ in their text instead of repeating
 * one line; what the modes trade is the description, not the qualifier.
 *
 * **One sticker per line is load-bearing on a rule that lives elsewhere.**
 * `validateDescription` (`core/constraints.js`) refuses a line break in a
 * description, which is what keeps a description from pushing a row onto a
 * second line — where it would read to the model as a sticker that does not
 * exist. Allow one and the listing silently stops being a list.
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
            // The description enters the listing as the user wrote it; only
            // surrounding whitespace is dropped, so a row never carries a stray
            // space just inside its parentheses. Half-width parentheses, because
            // the listing is prompt text in two languages and the content is
            // just as likely to use the full-width ones.
            const description = simple ? '' : String(sticker.description ?? '').trim();
            rows.push(
                `${pack.name}:${sticker.label}`
                + (description ? ` (${description})` : ''),
            );
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
