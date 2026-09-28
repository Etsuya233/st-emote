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
 * **It goes through `renderHtml`, not `renderText`, and that is the whole
 * difference between a preview and a fair one.** `renderText` rewrites the tokens
 * and stops: it has no idea where a 块后 image belongs, and no idea that a token
 * inside a code block must be left alone. `renderHtml` is the function both real
 * paths end in, so it applies `relocatePlacedImages` and skips `<pre>` / `<code>`.
 * A preview built on the other one showed an image exactly where the chat would
 * never put one.
 *
 * **Plain text in, HTML renderer in — so the paste needs a converter.** The user
 * pastes raw text into a textarea; `renderHtml` takes the message body the
 * client's pipeline produced, because a code fence only becomes `<pre><code>`
 * *after* markdown runs, and that is exactly what decides whether a token inside
 * it renders. So the conversion is an **argument** rather than a guess:
 *
 * - `toMessageBody` is the client's own step. The adapter supplies one built from
 *   the copy of showdown the client already ships (see `adapter/debug-panel.js`);
 *   the core does not reach for a global, because a pure function of the pasted
 *   text plus an effective set is what makes this testable.
 * - The default is `escapeText`, which is the honest floor: the paste is treated
 *   as text, so token *rewriting* and `message-end` placement are right, and
 *   block-level placement and code skipping are not. The panel says which of the
 *   two it is doing, because a preview that quietly misplaces an image is worse
 *   than one that admits a limit.
 *
 * Escaping is what the default does, and it is also what keeps the debug box
 * safe: `output.innerHTML` is the only place this extension writes rendered HTML
 * into the panel, so a pasted `<img onerror=…>` must not survive the trip.
 *
 * The image class is the **final** one (`custom-st-emote`), not the hook path's
 * un-prefixed `st-emote`: the preview's HTML is inserted as-is and no sanitizer
 * runs over it, so nothing would add the prefix. Taking the hook path's name
 * would render a correctly-sized but entirely unstyled image.
 */

import { escapeText } from './escape.js';
import { t } from './i18n.js';
import { renderHtml } from './render.js';
import { findTokens } from './token.js';

/**
 * @typedef {Object} Preview
 * @property {string} html - The rendered message, ready to be shown as-is.
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
 * @param {(text: string) => string} [toMessageBody] - Turns the pasted text into
 *   the message body `renderHtml` expects. Defaults to `escapeText`, which treats
 *   the paste as plain text.
 * @returns {Preview}
 */
export function buildPreview(text, effectiveSet, options = {}, toMessageBody = escapeText) {
    const source = String(text ?? '');
    // Counted on the raw text, before conversion: converting turns `<sticker>`
    // into an element, and the count has to be the number of tokens the *user*
    // wrote either way.
    const tokenCount = findTokens(source, options).length;
    const result = renderHtml(toMessageBody(source), effectiveSet, options);
    return {
        html: result.html,
        misses: result.misses,
        invalidSizes: result.invalidSizes,
        tokenCount,
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
