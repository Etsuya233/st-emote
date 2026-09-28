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
 * Replace tokens inside one chunk of text.
 *
 * @param {string} chunk
 * @param {import('./effective-set.js').EffectiveSet} effectiveSet
 * @param {Miss[]} misses
 * @param {boolean} escape - True when the chunk is decoded plain text (DOM text
 *   nodes) and must be escaped before being emitted as HTML. False when the
 *   chunk is already HTML-encoded (showdown output).
 * @returns {string}
 */
function renderChunk(chunk, effectiveSet, misses, escape) {
    const tokens = findTokens(chunk);
    if (tokens.length === 0) {
        return escape ? escapeText(chunk) : chunk;
    }

    let out = '';
    let cursor = 0;
    for (const token of tokens) {
        const between = chunk.slice(cursor, token.index);
        out += escape ? escapeText(between) : between;
        const result = resolveToken(token, effectiveSet, misses);
        if (result) {
            out += stickerHtml(result.pack, result.sticker);
        }
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
 * @returns {RenderResult}
 */
export function renderText(text, effectiveSet) {
    const misses = [];
    const html = renderChunk(String(text ?? ''), effectiveSet, misses, true);
    return { html, misses };
}

const TAG_PATTERN = /<[^>]*>/g;
const TAG_NAME_PATTERN = /^<\/?\s*([a-zA-Z0-9-]+)/;

function tagName(tag) {
    const match = TAG_NAME_PATTERN.exec(tag);
    return match ? match[1].toLowerCase() : null;
}

/**
 * Render tokens inside an HTML string, such as the already-rendered contents
 * of a message. Tokens inside `<code>` and `<pre>` are left untouched.
 *
 * The scanner treats every `<...>` as a tag. Showdown escapes literal `<` and
 * `>` in text as entities, so this is safe for real SillyTavern output.
 *
 * @param {string} html
 * @param {import('./effective-set.js').EffectiveSet} effectiveSet
 * @returns {RenderResult}
 */
export function renderHtml(html, effectiveSet) {
    const source = String(html ?? '');
    const misses = [];
    let out = '';
    let cursor = 0;
    let codeDepth = 0;
    let match;

    TAG_PATTERN.lastIndex = 0;
    while ((match = TAG_PATTERN.exec(source)) !== null) {
        const chunk = source.slice(cursor, match.index);
        out += codeDepth > 0 ? chunk : renderChunk(chunk, effectiveSet, misses, false);

        const tag = match[0];
        out += tag;
        const name = tagName(tag);
        if (name === 'code' || name === 'pre') {
            if (tag.startsWith('</')) {
                codeDepth = Math.max(0, codeDepth - 1);
            } else if (!tag.endsWith('/>')) {
                codeDepth += 1;
            }
        }
        cursor = match.index + tag.length;
    }

    const tail = source.slice(cursor);
    out += codeDepth > 0 ? tail : renderChunk(tail, effectiveSet, misses, false);
    return { html: out, misses };
}
