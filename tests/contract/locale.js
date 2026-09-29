/**
 * One assertion block in a chosen language, then English again.
 *
 * `core/i18n.js` reads the locale the adapter published with `setLocale`, so a
 * test that wants the other catalog publishes it the same way production does —
 * and restores the default when it is done. The reset matters because the value
 * is module state: without it the next test in the file would read whatever the
 * last one chose.
 */

import { DEFAULT_LOCALE, setLocale } from '../../core/i18n.js';

/**
 * Run `body` with `locale` published, restoring the default afterwards.
 *
 * @param {string} locale
 * @param {() => any} body
 * @returns {any}
 */
export function withLocale(locale, body) {
    try {
        setLocale(locale);
        return body();
    } finally {
        setLocale(DEFAULT_LOCALE);
    }
}
