/**
 * The message-catalog lookup: which sentence, in which language.
 *
 * The sentences themselves are data and live in `core/i18n-catalogs.js`; this
 * file is the ~100 lines of reasoning that decide between them. Keeping them
 * apart is what makes each one editable — a new key is an edit to a file that is
 * nothing but keys, and a change to the fallback rule is an edit to a file that
 * is nothing but the fallback rule.
 *
 * No dependency on SillyTavern: `CONTEXT.md` puts the seam between the pure core
 * and the client adapter, and "which language is the client in" is the one fact
 * the adapter owns. It reads `getCurrentLocale()` and passes the result here;
 * everything else — the fallbacks, the plural rule — is decided without a
 * browser, so `tests/i18n.test.js` can hold the whole thing down.
 *
 * **English is the source, not a translation.** A key that has no entry in the
 * requested locale comes back as its English text, which is the same rule
 * SillyTavern's own `translate` follows and the reason a half-finished
 * translation degrades to readable English rather than to a blank label.
 *
 * **Nothing here escapes, because nothing needs to.** Every surface that shows a
 * sentence applies it with `textContent`, so a pack name or a search query
 * interpolated into one cannot become an element. That is why there is no
 * `tHtml`: an HTML-assembling lookup would be a second way to do a job the
 * panel does not have. If a sentence ever does have to be assembled into markup
 * beside a user's own value, `escapeText` on that value is the fix — and it
 * belongs at the call site, where the reader can see what is being assembled.
 */

import { CATALOG_SCRIPTS, CATALOGS, DEFAULT_LOCALE, SHIPPED_LOCALES } from './i18n-catalogs.js';

export { CATALOGS, DEFAULT_LOCALE };

/** A BCP-47 script subtag: four letters, title case (`Hans`). */
const SCRIPT_PATTERN = /^[a-z]{4}$/i;

/**
 * The catalog a client locale reads, given the id `getCurrentLocale()` reports.
 *
 * A prefix match rather than an equality check, because the ids are not
 * homogeneous: SillyTavern reports `zh-cn` but a browser may hand out `zh`, and
 * `zh-hans` and `zh_CN` all name the same language. A locale nothing matches —
 * and there are sixteen of them — reads as English, which is the same promise
 * the fallback makes for a key with no translation.
 *
 * @param {unknown} locale
 * @returns {string} A key of `CATALOGS`.
 */
export function resolveLocale(locale) {
    const subtags = String(locale ?? '').trim().toLowerCase().replace(/_/g, '-').split('-').filter(Boolean);
    for (const candidate of SHIPPED_LOCALES) {
        if (servesLocale(candidate, subtags)) {
            return candidate;
        }
    }
    return DEFAULT_LOCALE;
}

/**
 * Whether one shipped catalog serves the locale a client reported.
 *
 * Compared subtag by subtag rather than as a prefix, because the two sides are
 * not the same kind of thing: the catalog is named by region, the client may
 * name a script. A subtag the client leaves out is not a disagreement — `zh`,
 * `zh-hans` and `zh-cn` are all questions this catalog answers — while a subtag
 * that contradicts one of the catalog's is a different language variant, and the
 * honest answer there is the English source.
 *
 * @param {string} candidate - A key of `CATALOGS`.
 * @param {string[]} subtags - The client's locale, split on `-`.
 * @returns {boolean}
 */
function servesLocale(candidate, subtags) {
    if (subtags.length === 0 || subtags[0] !== candidate.split('-')[0]) {
        return false;
    }
    const script = CATALOG_SCRIPTS[candidate] ?? null;
    for (const subtag of subtags.slice(1)) {
        // A single-letter subtag opens a BCP-47 extension (`zh-cn-x-foo`), and
        // everything after it is private use. It says nothing about the language.
        if (subtag.length === 1) {
            break;
        }
        if (SCRIPT_PATTERN.test(subtag)) {
            if (subtag !== script) {
                return false;
            }
        } else if (subtag !== candidate.split('-')[1]) {
            return false;
        }
    }
    return true;
}

/**
 * The keys one catalog defines. A deliberate testing surface rather than an
 * accident: the parity check needs "every key this catalog has" for each locale,
 * and exposing it here means a test never has to reach into the data file's own
 * layout to ask.
 *
 * @param {string} [locale]
 * @returns {string[]}
 */
export function tKeys(locale = DEFAULT_LOCALE) {
    return Object.keys(CATALOGS[resolveLocale(locale)] ?? CATALOGS[DEFAULT_LOCALE]);
}

/**
 * The sentence for one key, in one locale.
 *
 * The lookup walks the requested locale and then the English source, so a key
 * added to `EN` and not yet translated reads as English instead of vanishing.
 * A key nobody defines comes back as its own name: a visible, reportable gap.
 *
 * `count` picks the singular wording when the catalog has one. The rule is
 * "try `.one` first" rather than "every counted key must have a `.one`", so a
 * sentence that has no plural (the missing-packs header, "2 packs") is not
 * forced into one.
 *
 * @param {string} key
 * @param {string} [locale] - The client's locale id, as `getCurrentLocale()` gives it.
 * @param {Record<string, unknown>} [values] - Values for `{name}` placeholders.
 * @returns {string}
 */
export function t(key, locale, values = {}) {
    const resolved = resolveLocale(locale);
    const catalog = CATALOGS[resolved] ?? CATALOGS[DEFAULT_LOCALE];
    const source = CATALOGS[DEFAULT_LOCALE];

    const singular = values.count === 1;
    const text = (singular ? catalog[`${key}.one`] ?? source[`${key}.one`] : undefined)
        ?? catalog[key]
        ?? source[key]
        ?? key;

    return text.replace(/\{(\w+)\}/g, (match, name) => (
        Object.hasOwn(values, name) ? String(values[name]) : match
    ));
}
