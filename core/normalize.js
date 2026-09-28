/**
 * Canonical form of a label used for comparison: trimmed, inner whitespace
 * collapsed, case-insensitive. Storage always keeps the user's original text.
 *
 * @param {unknown} label
 * @returns {string}
 */
export function normalizeLabel(label) {
    return String(label ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

/**
 * Canonical form of a pack name used for comparison: trimmed and
 * case-insensitive.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function normalizePackName(name) {
    return String(name ?? '').trim().toLowerCase();
}
