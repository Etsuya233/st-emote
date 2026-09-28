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
 * There is no `trHtml` here on purpose. `core/i18n.js` has one for the case where
 * a sentence is assembled into markup beside a value the *user* supplied, and the
 * panel has no such case: it puts the prose through `textContent` and builds the
 * two or three places it wants a `<code>` sample as their own elements. If a
 * future sentence does need assembling, reach for `tHtml` from the core rather
 * than adding a second lookup path here.
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
