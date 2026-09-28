/**
 * Escape a value so it can be inserted as HTML text content.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeText(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Escape a value so it can be inserted inside a double-quoted HTML attribute.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeAttribute(value) {
    return escapeText(value).replace(/"/g, '&quot;');
}
