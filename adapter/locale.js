/**
 * The panel's language.
 *
 * "Which language is this client in" is the one fact the adapter owns and the
 * pure core cannot know: `CONTEXT.md` puts the seam between the core and the
 * client right there. This module is the whole of it — read the locale once,
 * hand it to `core/i18n.js`, and every sentence in the panel, the 查冲突 report
 * and the macro listing comes out of the same catalog.
 *
 * Reading it through `liveContext` rather than the context captured at load
 * matters for the same reason the scope code does it: `getContext()` hands out a
 * fresh object, and a captured one goes stale as the user moves around.
 *
 * **The locale is read at mount, not watched.** SillyTavern has no event for a
 * language change, and its own language switch reloads the page, so a panel built
 * during load is rebuilt in the new language anyway.
 *
 * There is no escaped sibling to this lookup, and there is no reason for one.
 * Every surface applies a sentence with `textContent`, so a value that came from
 * the user is never in a markup position to begin with; if one ever is,
 * `escapeText` belongs at that call site, where a reader can see what is being
 * assembled.
 */

import { DEFAULT_LOCALE, t } from '../core/i18n.js';
import { liveContext } from './scope.js';

/**
 * The client's UI locale, as `getCurrentLocale()` reports it (`en`, `zh-cn`, …).
 *
 * The raw id, not a resolved one: `core/i18n.js` owns the mapping from an id to a
 * catalog, and a locale it ships no catalog for has to be able to fall back to
 * English from inside there.
 *
 * @param {any} context
 * @returns {string}
 */
export function currentLocale(context) {
    const reported = liveContext(context)?.getCurrentLocale?.();
    return typeof reported === 'string' && reported.trim() !== '' ? reported : DEFAULT_LOCALE;
}

/**
 * One sentence in the client's language, as plain text. Use this wherever the
 * result goes into `textContent` — which is everywhere a user value can appear.
 *
 * @param {any} context
 * @param {string} key
 * @param {Record<string, unknown>} [values]
 * @returns {string}
 */
export function tr(context, key, values) {
    return t(key, currentLocale(context), values);
}
