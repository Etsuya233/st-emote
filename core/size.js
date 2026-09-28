/**
 * 尺寸集 (Size set): the size configuration for one kind of sticker. There are
 * two — `inline` for 原地 images, `block` for 块后 and 消息末尾 images — and
 * each is a minimum/maximum width and height plus a fill mode.
 *
 * Values are hand-typed strings that are handed to CSS verbatim. A value that
 * is not a `<number><em|px|%>` pair is *not* an error that blocks editing: it
 * is treated as unset (the default for that field applies) and reported so the
 * caller can surface a hint.
 *
 * Nothing in this module is called a "context": in this project that word means
 * the SillyTavern context in the adapter and 作用域 on the user-facing side.
 */

/** The two 尺寸集, in the order the settings panel shows them. */
export const SIZE_SETS = ['inline', 'block'];

/** The fill modes offered for each 尺寸集. */
export const FIT_MODES = ['cover', 'contain', 'fill'];

/** Fill mode used when the user picked none. */
export const DEFAULT_FIT = 'contain';

/**
 * Stored field name -> CSS property. The stored names are camelCase to match
 * the rest of the settings payload; the emitted ones are the CSS properties.
 */
const SIZE_PROPERTIES = {
    minWidth: 'min-width',
    minHeight: 'min-height',
    maxWidth: 'max-width',
    maxHeight: 'max-height',
    fit: 'object-fit',
};

/** The stored fields, in the order they appear in the settings panel. */
export const SIZE_FIELDS = Object.keys(SIZE_PROPERTIES);

/**
 * Values applied for fields the user left empty. `inline` keeps images in the
 * text line, so its only promise is a height; `block` images must not push the
 * layout wider than the message column.
 */
export const SIZE_DEFAULTS = {
    inline: { 'max-height': '3em' },
    block: { 'max-width': '100%' },
};

/**
 * `<number><unit>` with `em`, `px` or `%`. A bare number is rejected: without a
 * unit the value would silently mean pixels, which is never what a hand-typed
 * `3` intends. Zero is the one exception worth allowing, since `0` is the
 * idiomatic CSS way to drop a bound.
 */
const SIZE_VALUE_PATTERN = /^(?:0|\d*\.?\d+(?:em|px|%))$/i;

/**
 * @typedef {'inline'|'block'} SizeSetKey
 */

/**
 * @typedef {Object} SizeSet
 * @property {string} minWidth
 * @property {string} minHeight
 * @property {string} maxWidth
 * @property {string} maxHeight
 * @property {string} fit - `cover` / `contain` / `fill`, or empty for the
 *   default fill mode.
 */

/**
 * The stored configuration: both 尺寸集 are always present, because
 * `ensureSizeSets` fills in whatever the payload is missing.
 *
 * @typedef {Object} SizeSets
 * @property {SizeSet} inline
 * @property {SizeSet} block
 */

/**
 * The same shape, for input that may be incomplete: a caller reading a
 * configuration does not have to have run it through `ensureSizeSets` first.
 *
 * @typedef {Object} PartialSizeSets
 * @property {SizeSet} [inline]
 * @property {SizeSet} [block]
 */

/**
 * @typedef {Object} InvalidSize
 * @property {string} field - Stored field name, e.g. `maxHeight`.
 * @property {string} value - The rejected text, exactly as typed.
 */

/**
 * @typedef {Object} SizeEvaluation
 * @property {SizeSetKey} sizeSet
 * @property {string} style - CSS declaration text for a `style` attribute.
 * @property {InvalidSize[]} invalid - Values that were treated as unset.
 */

/**
 * @typedef {{ok: true, value: string} | {ok: false, reason: string}} SizeValidation
 */

/**
 * @param {unknown} sizeSet
 * @returns {SizeSetKey}
 */
function resolveSizeSetKey(sizeSet) {
    return SIZE_SETS.includes(sizeSet) ? /** @type {SizeSetKey} */ (sizeSet) : 'inline';
}

/**
 * Validate one hand-typed length. An empty value is valid and means "unset":
 * the field is not configured and its default applies.
 *
 * @param {unknown} value
 * @returns {SizeValidation}
 */
export function validateSizeValue(value) {
    const text = String(value ?? '').trim();
    if (text === '') {
        return { ok: true, value: '' };
    }
    if (!SIZE_VALUE_PATTERN.test(text)) {
        return { ok: false, reason: 'invalid' };
    }
    return { ok: true, value: text };
}

/**
 * Validate the fill mode. Empty is valid and means "unset".
 *
 * @param {unknown} value
 * @returns {SizeValidation}
 */
export function validateFitMode(value) {
    const text = String(value ?? '').trim().toLowerCase();
    if (text === '') {
        return { ok: true, value: '' };
    }
    if (!FIT_MODES.includes(text)) {
        return { ok: false, reason: 'invalid' };
    }
    return { ok: true, value: text };
}

/**
 * Give a stored 尺寸集 the full field set, so the settings panel always has an
 * input to bind to. No validation happens here: an invalid value is kept as
 * typed, because it is not a reason to stop the user from editing.
 *
 * @param {unknown} raw
 * @returns {SizeSet}
 */
export function ensureSizeSet(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const set = {};
    for (const field of SIZE_FIELDS) {
        set[field] = typeof source[field] === 'string' ? source[field] : '';
    }
    return set;
}

/**
 * Give a stored size configuration both 尺寸集.
 *
 * @param {unknown} raw
 * @returns {SizeSets}
 */
export function ensureSizeSets(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        inline: ensureSizeSet(source.inline),
        block: ensureSizeSet(source.block),
    };
}

/**
 * Validate one stored 尺寸集. Valid values are returned trimmed; invalid ones
 * come back as empty (treated as unset) and are listed so the caller can log
 * them and show a hint.
 *
 * @param {unknown} raw
 * @returns {{set: SizeSet, invalid: InvalidSize[]}}
 */
export function readSizeSet(raw) {
    const source = ensureSizeSet(raw);
    const invalid = [];
    const set = {};
    for (const field of SIZE_FIELDS) {
        const check = field === 'fit' ? validateFitMode(source[field]) : validateSizeValue(source[field]);
        if (check.ok) {
            set[field] = check.value;
        } else {
            set[field] = '';
            invalid.push({ field, value: source[field] });
        }
    }
    return { set, invalid };
}

/**
 * The default value of one stored field in one 尺寸集, or an empty string when
 * that field has no default. The settings panel shows it as the input's
 * placeholder, so leaving a field empty reads as a decision rather than a gap.
 *
 * @param {unknown} sizeSet
 * @param {unknown} field - Stored field name, e.g. `maxHeight`.
 * @returns {string}
 */
export function defaultSizeValue(sizeSet, field) {
    return SIZE_DEFAULTS[resolveSizeSetKey(sizeSet)][SIZE_PROPERTIES[String(field)]] ?? '';
}

/**
 * Evaluate one 尺寸集 into a CSS declaration string. Empty and invalid fields
 * fall back to the default for that field, so a huge image never blows the
 * layout apart even with no configuration at all.
 *
 * @param {unknown} sizeSet - Which 尺寸集 to evaluate.
 * @param {PartialSizeSets|null|undefined} sizes - The whole configuration; the
 *   set for `sizeSet` is picked out of it.
 * @returns {SizeEvaluation}
 */
export function evaluateSize(sizeSet, sizes) {
    const which = resolveSizeSetKey(sizeSet);
    const source = sizes && typeof sizes === 'object' ? sizes[which] : null;
    const { set, invalid } = readSizeSet(source);
    const defaults = SIZE_DEFAULTS[which];

    const declarations = [];
    for (const [field, property] of Object.entries(SIZE_PROPERTIES)) {
        const value = set[field] || defaults[property] || '';
        // The fill mode always lands on the image; a size bound only appears
        // when a value or a default exists for it.
        if (value || property === 'object-fit') {
            declarations.push(`${property}: ${value || DEFAULT_FIT}`);
        }
    }
    return { sizeSet: which, style: declarations.join('; '), invalid };
}
