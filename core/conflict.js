/**
 * 冲突: the label collisions `查冲突` reports, and the report it prints.
 *
 * The definition is `CONTEXT.md`'s and this module only implements it. A 冲突 is
 * a **normalized** label that two or more **enabled** packs in the 生效集 both
 * define. Three clauses, each load-bearing:
 *
 * - *normalized*, or `Happy` in one pack and `happy ` in another would read as
 *   two labels and the ambiguity the definition exists to name would be
 *   invisible;
 * - *two or more **packs***, or a pack's own two spellings of one label would
 *   report against itself — the ambiguity that matters is the one a bare token
 *   cannot resolve, which needs more than one pack;
 * - *in the 生效集*, or a pack the user has switched off would keep warning about
 *   tokens that resolve fine today.
 *
 * The report carries each owning pack's **own spelling** next to its name,
 * because the whole point of the report is telling the user which spelling to
 * change: reporting only the normalized form would leave them guessing.
 *
 * Nothing here is a SillyTavern concern, so the whole thing is a pure function
 * of the effective set the caller already built.
 */

import { t } from './i18n.js';
import { normalizeLabel } from './normalize.js';

/**
 * @typedef {Object} ConflictOwner
 * @property {string} name - The pack that defines the label.
 * @property {string} label - That pack's own spelling of it.
 */

/**
 * @typedef {Object} Conflict
 * @property {string} label - The normalized label the packs collide on.
 * @property {ConflictOwner[]} packs - The packs that define it, in 生效集 order.
 */

/**
 * Every 冲突 in the effective set.
 *
 * **Order is the effective set's**, defined as the order each label is *first*
 * defined in: packs in enabled order, stickers in the order the pack holds them.
 * The report is read by a person comparing it against the panel's own list, and
 * that list is in the same order — a report sorted by label text instead would
 * be one more thing to line up by hand.
 *
 * A label is reported when **two or more distinct packs** define it, however
 * many times any one of them spells it. Within-pack collisions are a different
 * thing: the pack manager already refuses them, and a single pack can never make
 * a bare token ambiguous.
 *
 * @param {import('./effective-set.js').EffectiveSet} effectiveSet
 * @returns {Conflict[]}
 */
export function findConflicts(effectiveSet) {
    /** @type {Map<string, ConflictOwner[]>} */
    const byLabel = new Map();
    for (const pack of Array.isArray(effectiveSet?.packs) ? effectiveSet.packs : []) {
        if (!pack) {
            continue;
        }
        for (const sticker of Array.isArray(pack.stickers) ? pack.stickers : []) {
            const label = normalizeLabel(sticker?.label);
            // The 生效集 already drops unlabeled stickers, so an empty label here
            // would mean the caller passed something the effective set never
            // promises. Treating it as a label would report every unfinished
            // sticker in the library as a collision on the empty string.
            if (!label) {
                continue;
            }
            const owners = byLabel.get(label) ?? [];
            owners.push({ name: String(pack.name ?? ''), label: String(sticker.label) });
            byLabel.set(label, owners);
        }
    }

    const conflicts = [];
    for (const [label, owners] of byLabel) {
        if (new Set(owners.map((owner) => owner.name.toLowerCase())).size < 2) {
            continue;
        }
        conflicts.push({ label, packs: owners });
    }
    return conflicts;
}

/**
 * The packs behind one 冲突, as one string: every name, and each pack's own
 * spelling when it differs from the normalized label the report leads with.
 *
 * The spelling is quoted so `daily ("Happy")` cannot be misread as a pack named
 * something else, and omitted when it would only repeat the label.
 *
 * @param {Conflict} conflict
 * @returns {string}
 */
export function formatConflictPacks(conflict) {
    return (conflict?.packs ?? [])
        .map((owner) => (owner.label === conflict.label
            ? owner.name
            : `${owner.name} ("${owner.label}")`))
        .join(', ');
}

/**
 * The 查冲突 report, in one language: a header with the count, then one row per
 * label and the packs behind it.
 *
 * A clean effective set gets the sentence that says so rather than an empty
 * list. The two are very different things to read — "there is no problem" and
 * "the report is broken" look the same if one of them is a blank string, and a
 * user who just fixed a conflict needs to be able to tell.
 *
 * @param {import('./effective-set.js').EffectiveSet} effectiveSet
 * @returns {string}
 */
export function formatConflicts(effectiveSet) {
    const conflicts = findConflicts(effectiveSet);
    if (conflicts.length === 0) {
        return t('conflict.none');
    }
    return [
        t('conflict.header', { count: conflicts.length }),
        ...conflicts.map((conflict) => t('conflict.row', {
            label: conflict.label,
            packs: formatConflictPacks(conflict),
        })),
    ].join('\n');
}

/**
 * The one console line one 冲突 gets, in one language.
 *
 * Separate from `formatConflicts` on purpose: the report is a block a person
 * reads, while this is one line per collision carrying the same prefix as every
 * other log this extension writes, so a console full of render misses still has
 * a single `st-emote` filter and the conflicts sit in the middle of it.
 *
 * @param {Conflict} conflict
 * @returns {string}
 */
export function conflictLogLine(conflict) {
    return t('conflict.logLine', {
        label: conflict.label,
        packs: formatConflictPacks(conflict),
    });
}
