import { DEFAULT_STICKER_TAG, validateStickerTag } from './constraints.js';

/**
 * Token parsing for both accepted forms:
 *
 * - bracket form: `[[sticker:pack:label]]` or `[[sticker:label]]`
 * - HTML-tag form: `<sticker>pack:label</sticker>` (tag name configurable)
 *
 * The HTML-tag form is matched both raw and entity-escaped, because a message
 * reaches us either already rendered (escaped) or as sanitized markup.
 *
 * @typedef {Object} Token
 * @property {number} index - Start index of the token in the source text.
 * @property {number} length - Length of the raw token.
 * @property {string} raw - The full matched token, exactly as written.
 * @property {string|null} packName - Qualifying pack name, or null when the
 *   token carries a bare label.
 * @property {string} label
 */

/**
 * Split the body of a token (everything between the delimiters) at its first
 * colon: the left side is the pack name, the right side is the label. With no
 * colon the whole body is a bare label.
 *
 * @param {string} body
 * @returns {{packName: string|null, label: string}}
 */
export function parseTokenBody(body) {
    const text = String(body ?? '');
    const firstColon = text.indexOf(':');
    if (firstColon === -1) {
        return { packName: null, label: text.trim() };
    }
    const packName = text.slice(0, firstColon).trim();
    const label = text.slice(firstColon + 1).trim();
    return { packName: packName === '' ? null : packName, label };
}

/**
 * @param {unknown} tagName
 * @returns {string}
 */
function resolveTagName(tagName) {
    const result = validateStickerTag(tagName ?? DEFAULT_STICKER_TAG);
    return result.ok ? result.value : DEFAULT_STICKER_TAG;
}

/**
 * The opening markers a token can start with. The adapter uses this as a cheap
 * "might this text contain a token?" pre-filter, so token grammar stays here.
 *
 * @param {unknown} tagName
 * @returns {string[]}
 */
export function tokenPrefixes(tagName) {
    const tag = resolveTagName(tagName);
    return ['[[sticker:', `<${tag}>`, `&lt;${tag}&gt;`];
}

/**
 * @param {string} source
 * @param {string} tagName
 * @returns {{index: number, length: number, raw: string, body: string}[]}
 */
function findCandidates(source, tagName) {
    const tag = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
        /\[\[sticker:([^[\]\n]*)\]\]/g,
        new RegExp(`<${tag}>([^<\\n]*?)</${tag}>`, 'gi'),
        new RegExp(`&lt;${tag}&gt;([^<\\n]*?)&lt;/${tag}&gt;`, 'gi'),
    ];

    const candidates = [];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(source)) !== null) {
            candidates.push({
                index: match.index,
                length: match[0].length,
                raw: match[0],
                body: match[1],
            });
        }
    }
    return candidates;
}

/**
 * The marker text a token stands for, rebuilt from its parsed parts.
 *
 * Used to put the original marker back where a rendered image was, so disabling
 * the extension restores what the user can see and edit. Which of the two forms
 * is rebuilt is taken from the token's own raw text, so a message written with
 * the HTML-tag form comes back as the HTML-tag form.
 *
 * The body is the parsed, trimmed `pack:label`, never the raw match: the raw
 * text of the escaped form is entity-encoded, and writing that back would show
 * the user `&lt;sticker&gt;` instead of `<sticker>`.
 *
 * @param {Token} token
 * @param {{tagName?: string}} [options]
 * @returns {string}
 */
export function tokenText(token, options = {}) {
    const body = token.packName ? `${token.packName}:${token.label}` : token.label;
    if (!/^(?:&lt;|<)/i.test(String(token.raw ?? '').trimStart())) {
        return `[[sticker:${body}]]`;
    }
    const tag = resolveTagName(options.tagName);
    return `<${tag}>${body}</${tag}>`;
}

/**
 * Find every token occurrence in a plain text string, in source order. Tokens
 * with an empty label are ignored and left untouched.
 *
 * @param {string} text
 * @param {{tagName?: string}} [options]
 * @returns {Token[]}
 */
export function findTokens(text, options = {}) {
    const source = String(text ?? '');
    const candidates = findCandidates(source, resolveTagName(options.tagName));
    candidates.sort((a, b) => a.index - b.index || b.length - a.length);

    const tokens = [];
    let consumedUntil = -1;
    for (const candidate of candidates) {
        if (candidate.index < consumedUntil) {
            continue;
        }
        consumedUntil = candidate.index + candidate.length;
        const parsed = parseTokenBody(candidate.body);
        if (!parsed.label) {
            continue;
        }
        tokens.push({
            index: candidate.index,
            length: candidate.length,
            raw: candidate.raw,
            packName: parsed.packName,
            label: parsed.label,
        });
    }
    return tokens;
}
