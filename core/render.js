import { escapeAttribute, escapeText } from './escape.js';
import { findTokens } from './token.js';

/**
 * Class emitted by the DOM path, which writes it directly. This is the *final*
 * class name; the official-hook path (ticket 05) must emit the un-prefixed
 * `st-emote` and let SillyTavern's sanitizer add the `custom-` prefix, so the
 * two paths converge on this one name and one stylesheet.
 */
export const STICKER_CLASS = 'custom-st-emote';

/**
 * @typedef {Object} Miss
 * @property {'pack-not-found'|'pack-not-enabled'|'label-not-found'|'ambiguous-bare-label'|'image-missing'} reason
 * @property {string} raw
 * @property {string|null} packName
 * @property {string} label
 */

/**
 * @typedef {Object} RenderResult
 * @property {string} html
 * @property {Miss[]} misses
 */

/**
 * @typedef {Object} RenderOptions
 * @property {string} [tagName] - Name of the configurable HTML-tag form.
 */

function resolveToken(token, effectiveSet, misses) {
    const result = effectiveSet.lookup(token.packName, token.label);
    if (!result.hit) {
        misses.push({
            reason: result.reason,
            raw: token.raw,
            packName: token.packName,
            label: token.label,
        });
        return null;
    }
    if (!result.sticker.image) {
        misses.push({
            reason: 'image-missing',
            raw: token.raw,
            packName: result.pack.name,
            label: result.sticker.label,
        });
        return null;
    }
    return result;
}

function stickerHtml(pack, sticker) {
    return `<img class="${STICKER_CLASS}" src="${escapeAttribute(sticker.image)}"`
        + ` alt="${escapeAttribute(sticker.label)}"`
        + ` data-st-emote-pack="${escapeAttribute(pack.name)}"`
        + ` data-st-emote-label="${escapeAttribute(sticker.label)}">`;
}

/**
 * Resolve one token and return its `<img>` markup, or an empty string when the
 * token misses. Every miss is appended to `misses`. Exported so the DOM path
 * can render the raw HTML-tag form through the exact same rules.
 *
 * @param {{raw: string, packName: string|null, label: string}} token
 * @param {import('./effective-set.js').EffectiveSet} effectiveSet
 * @param {Miss[]} misses
 * @returns {string}
 */
export function renderTokenHtml(token, effectiveSet, misses) {
    const result = resolveToken(token, effectiveSet, misses);
    return result ? stickerHtml(result.pack, result.sticker) : '';
}

/**
 * Replace tokens inside one chunk of text.
 *
 * @param {string} chunk
 * @param {import('./effective-set.js').EffectiveSet} effectiveSet
 * @param {Miss[]} misses
 * @param {boolean} escape - True when the chunk is decoded plain text (DOM text
 *   nodes) and must be escaped before being emitted as HTML. False when the
 *   chunk is already HTML-encoded (showdown output).
 * @param {RenderOptions} options
 * @returns {string}
 */
function renderChunk(chunk, effectiveSet, misses, escape, options) {
    const tokens = findTokens(chunk, options);
    if (tokens.length === 0) {
        return escape ? escapeText(chunk) : chunk;
    }

    let out = '';
    let cursor = 0;
    for (const token of tokens) {
        const between = chunk.slice(cursor, token.index);
        out += escape ? escapeText(between) : between;
        out += renderTokenHtml(token, effectiveSet, misses);
        cursor = token.index + token.raw.length;
    }
    const tail = chunk.slice(cursor);
    out += escape ? escapeText(tail) : tail;
    return out;
}

/**
 * Render tokens inside decoded plain text, such as the data of a DOM text
 * node. Non-token text is HTML-escaped in the output.
 *
 * @param {string} text
 * @param {import('./effective-set.js').EffectiveSet} effectiveSet
 * @param {RenderOptions} [options]
 * @returns {RenderResult}
 */
export function renderText(text, effectiveSet, options = {}) {
    const misses = [];
    const html = renderChunk(String(text ?? ''), effectiveSet, misses, true, options);
    return { html, misses };
}

const TAG_PATTERN = /<[^>]*>/g;
const TAG_NAME_PATTERN = /^<\/?\s*([a-zA-Z0-9-]+)/;

function htmlTagName(tag) {
    const match = TAG_NAME_PATTERN.exec(tag);
    return match ? match[1].toLowerCase() : null;
}

/**
 * Render tokens inside an HTML string, such as the already-rendered contents
 * of a message. Tokens inside `<code>` and `<pre>` are left untouched.
 *
 * Both accepted forms are handled here, including the raw HTML-tag form that
 * appears when SillyTavern is configured not to encode tags. The scanner walks
 * tokens and markup together so a raw `<sticker>…</sticker>` is consumed as a
 * token rather than mistaken for a stray element.
 *
 * @param {string} html
 * @param {import('./effective-set.js').EffectiveSet} effectiveSet
 * @param {RenderOptions} [options]
 * @returns {RenderResult}
 */
export function renderHtml(html, effectiveSet, options = {}) {
    const source = String(html ?? '');
    const misses = [];
    const tokens = findTokens(source, options);
    let tokenIndex = 0;
    let out = '';
    let cursor = 0;
    let codeDepth = 0;

    while (cursor <= source.length) {
        TAG_PATTERN.lastIndex = cursor;
        const tagMatch = TAG_PATTERN.exec(source);
        const nextTag = tagMatch ? { index: tagMatch.index, text: tagMatch[0] } : null;

        while (tokenIndex < tokens.length && tokens[tokenIndex].index < cursor) {
            tokenIndex += 1;
        }
        const nextToken = tokenIndex < tokens.length ? tokens[tokenIndex] : null;

        if (nextToken && (!nextTag || nextToken.index <= nextTag.index)) {
            tokenIndex += 1;
            if (codeDepth > 0) {
                // Consumed as ordinary text below, once a tag moves the cursor.
                continue;
            }
            out += renderChunk(source.slice(cursor, nextToken.index), effectiveSet, misses, false, options);
            out += renderTokenHtml(nextToken, effectiveSet, misses);
            cursor = nextToken.index + nextToken.raw.length;
            continue;
        }

        if (!nextTag) {
            const tail = source.slice(cursor);
            out += codeDepth > 0
                ? tail
                : renderChunk(tail, effectiveSet, misses, false, options);
            break;
        }

        const between = source.slice(cursor, nextTag.index);
        out += codeDepth > 0
            ? between
            : renderChunk(between, effectiveSet, misses, false, options);
        out += nextTag.text;

        const name = htmlTagName(nextTag.text);
        if (name === 'code' || name === 'pre') {
            if (nextTag.text.startsWith('</')) {
                codeDepth = Math.max(0, codeDepth - 1);
            } else if (!nextTag.text.endsWith('/>')) {
                codeDepth += 1;
            }
        }
        cursor = nextTag.index + nextTag.text.length;
    }

    return { html: out, misses };
}
