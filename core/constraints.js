import { normalizeLabel, normalizePackName } from './normalize.js';

/** Maximum number of code points a label may contain. */
export const LABEL_MAX_CODEPOINTS = 32;

/** Maximum number of code points a pack name may contain. */
export const PACK_NAME_MAX_CODEPOINTS = 32;

/** Maximum number of code points a description may contain. */
export const DESCRIPTION_MAX_CODEPOINTS = 1000;

/** The HTML-tag-like token name used when the user does not pick one. */
export const DEFAULT_STICKER_TAG = 'sticker';

const FORBIDDEN_IN_NAME = /[[\]<>]/;

/**
 * Known HTML, SVG and MathML element names, plus the tag ST injects. A token
 * tag may not reuse any of them, otherwise enabling the tag form would collide
 * with markup the browser already understands.
 */
const RESERVED_TAG_NAMES = new Set([
    // HTML
    'a', 'abbr', 'acronym', 'address', 'applet', 'area', 'article', 'aside',
    'audio', 'b', 'base', 'basefont', 'bdi', 'bdo', 'bgsound', 'big', 'blink',
    'blockquote', 'body', 'br', 'button', 'canvas', 'caption', 'center', 'cite',
    'code', 'col', 'colgroup', 'command', 'content', 'data', 'datalist', 'dd',
    'del', 'details', 'dfn', 'dialog', 'dir', 'div', 'dl', 'dt', 'element',
    'em', 'embed', 'fieldset', 'figcaption', 'figure', 'font', 'footer', 'form',
    'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header',
    'hgroup', 'hr', 'html', 'i', 'iframe', 'image', 'img', 'input', 'ins',
    'isindex', 'kbd', 'keygen', 'label', 'legend', 'li', 'link', 'listing',
    'main', 'map', 'mark', 'marquee', 'menu', 'menuitem', 'meta', 'meter',
    'nav', 'nobr', 'noembed', 'noframes', 'noscript', 'object', 'ol',
    'optgroup', 'option', 'output', 'p', 'param', 'picture', 'plaintext',
    'portal', 'pre', 'progress', 'q', 'rb', 'rp', 'rt', 'rtc', 'ruby', 's',
    'samp', 'script', 'search', 'section', 'select', 'shadow', 'slot', 'small',
    'source', 'spacer', 'span', 'strike', 'strong', 'style', 'sub', 'summary',
    'sup', 'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th',
    'thead', 'time', 'title', 'tr', 'track', 'tt', 'u', 'ul', 'var', 'video',
    'wbr', 'xmp', 'custom-style',
    // SVG
    'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
    'g', 'defs', 'use', 'symbol', 'text', 'tspan', 'desc', 'metadata', 'switch',
    'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'marker',
    'pattern', 'filter', 'foreignobject', 'view', 'textpath', 'animate',
    'animatemotion', 'animatetransform', 'mpath', 'set', 'feblend',
    'fecolormatrix', 'fecomponenttransfer', 'fecomposite', 'feconvolvematrix',
    'fedisplacementmap', 'fegaussianblur', 'feimage', 'femerge', 'femergenode',
    'feoffset', 'fespecularlighting', 'fetile', 'feturbulence',
    // MathML
    'math', 'mi', 'mo', 'mn', 'ms', 'mtext', 'mspace', 'mrow', 'mfrac',
    'msqrt', 'mstyle', 'merror', 'mpadded', 'mphantom', 'mfenced', 'menclose',
    'msub', 'msup', 'msubsup', 'munder', 'mover', 'munderover',
    'mmultiscripts', 'mtable', 'mtr', 'mtd', 'maction', 'semantics',
    'annotation', 'annotation-xml', 'semx',
]);

/**
 * @param {unknown} value
 * @returns {number}
 */
function codepointLength(value) {
    return Array.from(String(value ?? '')).length;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function hasLineBreak(text) {
    return /[\r\n\u2028\u2029]/.test(text);
}

/**
 * @typedef {{ok: true, value: string} | {ok: false, reason: string}} Validation
 */

/**
 * Validate a sticker label. Empty is allowed: a label is filled in later and an
 * unlabeled sticker is simply not usable yet.
 *
 * @param {unknown} value
 * @returns {Validation}
 */
export function validateLabel(value) {
    const text = String(value ?? '');
    if (hasLineBreak(text)) {
        return { ok: false, reason: 'newline' };
    }
    if (FORBIDDEN_IN_NAME.test(text)) {
        return { ok: false, reason: 'forbidden-character' };
    }
    if (codepointLength(text) > LABEL_MAX_CODEPOINTS) {
        return { ok: false, reason: 'too-long' };
    }
    return { ok: true, value: text };
}

/**
 * Validate a pack name and return its stored form (trimmed). A pack name may
 * not be empty and may not contain a colon, because a token splits at its
 * first colon.
 *
 * @param {unknown} value
 * @returns {Validation}
 */
export function validatePackName(value) {
    const text = String(value ?? '').trim();
    if (text === '') {
        return { ok: false, reason: 'empty' };
    }
    if (hasLineBreak(text)) {
        return { ok: false, reason: 'newline' };
    }
    if (text.includes(':')) {
        return { ok: false, reason: 'colon' };
    }
    if (FORBIDDEN_IN_NAME.test(text)) {
        return { ok: false, reason: 'forbidden-character' };
    }
    if (codepointLength(text) > PACK_NAME_MAX_CODEPOINTS) {
        return { ok: false, reason: 'too-long' };
    }
    return { ok: true, value: text };
}

/**
 * Validate a sticker description. Empty is allowed; it is shown as an em dash
 * in the management panel.
 *
 * @param {unknown} value
 * @returns {Validation}
 */
export function validateDescription(value) {
    const text = String(value ?? '');
    if (hasLineBreak(text)) {
        return { ok: false, reason: 'newline' };
    }
    if (codepointLength(text) > DESCRIPTION_MAX_CODEPOINTS) {
        return { ok: false, reason: 'too-long' };
    }
    return { ok: true, value: text };
}

/**
 * Validate the configurable name of the HTML-tag token form.
 *
 * @param {unknown} value
 * @returns {Validation}
 */
export function validateStickerTag(value) {
    const text = String(value ?? '').trim();
    if (text === '') {
        return { ok: false, reason: 'empty' };
    }
    if (!/^[a-zA-Z][a-zA-Z0-9-]*$/.test(text)) {
        return { ok: false, reason: 'invalid' };
    }
    if (RESERVED_TAG_NAMES.has(text.toLowerCase())) {
        return { ok: false, reason: 'reserved' };
    }
    return { ok: true, value: text };
}

/**
 * Find the sticker in a pack whose label normalizes to the same value.
 *
 * @param {object[]} stickers
 * @param {unknown} label
 * @param {{except?: object}} [options]
 * @returns {object|null}
 */
export function findStickerByLabel(stickers, label, options = {}) {
    const key = normalizeLabel(label);
    if (!key) {
        return null;
    }
    const list = Array.isArray(stickers) ? stickers : [];
    return list.find(
        (sticker) => sticker !== options.except
            && sticker
            && sticker.label
            && normalizeLabel(sticker.label) === key,
    ) ?? null;
}

/**
 * Find the pack whose name normalizes to the same value.
 *
 * @param {import('./effective-set.js').Pack[]} packs
 * @param {unknown} name
 * @param {{except?: object}} [options]
 * @returns {object|null}
 */
export function findPackByName(packs, name, options = {}) {
    const key = normalizePackName(name);
    if (!key) {
        return null;
    }
    const list = Array.isArray(packs) ? packs : [];
    return list.find(
        (pack) => pack !== options.except && pack && normalizePackName(pack.name) === key,
    ) ?? null;
}
