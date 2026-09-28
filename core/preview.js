/**
 * 试渲染: rendering a pasted message, without a chat.
 *
 * The panel's debug area has to answer "what would this text look like with the
 * settings as they are right now" and it may not touch the chat to find out — a
 * preview that wrote a message into the history, or that re-rendered one, would
 * be a tool that changes the thing it is measuring. So the preview is the same
 * pure core the two render paths use, handed a string instead of a message, and
 * the panel does nothing but drop the HTML into a box.
 *
 * The only thing it adds over `renderText` is the count of tokens in the source,
 * which is what separates "there is nothing here to render" from "everything
 * here failed to render" — two very different sentences to show the user.
 */

import { t } from './i18n.js';
import { renderText } from './render.js';
import { findTokens } from './token.js';

/**
 * @typedef {Object} Preview
 * @property {string} html - The rendered message. Non-token text is escaped.
 * @property {import('./render.js').Miss[]} misses
 * @property {import('./size.js').InvalidSize[]} invalidSizes
 * @property {number} tokenCount - Tokens the source held, hit or missed.
 */

/**
 * Render one pasted message with the current settings.
 *
 * @param {string} text - Plain text, as typed into the debug box.
 * @param {import('./effective-set.js').EffectiveSet} effectiveSet
 * @param {import('./render.js').RenderOptions} [options]
 * @returns {Preview}
 */
export function buildPreview(text, effectiveSet, options = {}) {
    const source = String(text ?? '');
    const result = renderText(source, effectiveSet, options);
    return {
        html: result.html,
        misses: result.misses,
        invalidSizes: result.invalidSizes,
        tokenCount: findTokens(source, options).length,
    };
}

/**
 * The one line the debug area shows under the preview, in the user's language.
 *
 * Empty when there is nothing to say: no token in the source, or every token
 * rendered. The misses themselves go to the console behind the shared prefix,
 * never into a panel — this line is a summary, not a log.
 *
 * Each distinct reason is named once, whatever the token count, because the
 * question is "what is wrong" rather than "how many times".
 *
 * @param {Preview} preview
 * @param {string} [locale]
 * @returns {string}
 */
export function formatPreview(preview, locale) {
    if (!preview || preview.tokenCount === 0) {
        return t('panel.previewEmpty', locale);
    }
    if (preview.misses.length === 0) {
        return '';
    }
    const reasons = [...new Set(preview.misses.map((miss) => miss.reason))]
        .map((reason) => t(`miss.reason.${reason}`, locale));
    return t('panel.previewMisses', locale, { reasons: reasons.join(', ') });
}
