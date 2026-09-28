/**
 * Token parsing for the bracket form: `[[sticker:pack:label]]` or
 * `[[sticker:label]]`.
 *
 * @typedef {Object} Token
 * @property {number} index - Start index of the token in the source text.
 * @property {number} length - Length of the raw token.
 * @property {string} raw - The full matched token, exactly as written.
 * @property {string|null} packName - Qualifying pack name, or null when the
 *   token carries a bare label.
 * @property {string} label
 */

const TOKEN_SOURCE = '\\[\\[sticker:([^\\[\\]\\n]*)\\]\\]';

/**
 * Split the body of a token (everything between `[[sticker:` and `]]`) at its
 * first colon: the left side is the pack name, the right side is the label.
 * With no colon the whole body is a bare label.
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
 * Find every token occurrence in a plain text string. Tokens with an empty
 * label are ignored and left untouched.
 *
 * @param {string} text
 * @returns {Token[]}
 */
export function findTokens(text) {
    const source = String(text ?? '');
    const tokens = [];
    const regex = new RegExp(TOKEN_SOURCE, 'g');
    let match;
    while ((match = regex.exec(source)) !== null) {
        const parsed = parseTokenBody(match[1]);
        if (!parsed.label) {
            continue;
        }
        tokens.push({
            index: match.index,
            length: match[0].length,
            raw: match[0],
            packName: parsed.packName,
            label: parsed.label,
        });
    }
    return tokens;
}
