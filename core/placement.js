/**
 * 投放方式 (Placement): where a sticker image shows up in a message.
 *
 * - `in-place`  原地: the image takes the token's own spot, inside the text.
 * - `after-block` 块后: the image moves to just after the block the token was
 *   written in, so it lands between that block and the next one.
 * - `message-end` 消息末尾: the image moves to the end of the whole message.
 *
 * The global setting supplies the default; a single sticker may override it.
 * Overriding the placement also switches the size set in use, because `in-place`
 * images are sized as inline text and the other two are sized as blocks.
 */

/** The accepted placements, in the order the settings panel lists them. */
export const PLACEMENTS = ['in-place', 'after-block', 'message-end'];

/** The placement used when nothing is configured. */
export const DEFAULT_PLACEMENT = 'in-place';

/**
 * The 投放方式 a sticker resolved to. This is the behaviour marker both render
 * paths and the stylesheet-free logic read; the class list only ever carries
 * presentation (ADR-0002).
 */
export const PLACEMENT_ATTRIBUTE = 'data-st-emote-placement';

/**
 * Set once a sticker has been moved to its 投放方式's position. Relocation is
 * not something that can be re-derived from the DOM (an image that already sits
 * after its block has no block left to point at), so the marker is what keeps a
 * second pass from dragging it somewhere else.
 */
export const PLACED_ATTRIBUTE = 'data-st-emote-placed';

/**
 * Which 尺寸集 each 投放方式 is sized with. The only mapping between the two
 * vocabularies: `isBlockPlacement` is defined in terms of it, so "is this a
 * block?" can never drift from "which 尺寸集 does it use?".
 */
const SIZE_SET_BY_PLACEMENT = {
    'in-place': 'inline',
    'after-block': 'block',
    'message-end': 'block',
};

/**
 * Elements that end a block. A token inside one of these is relocated to just
 * after that element's closing tag. `<br>` is deliberately absent: a line break
 * is not a block, so it never becomes a boundary.
 *
 * @type {ReadonlySet<string>}
 */
export const BLOCK_CONTAINER_TAGS = new Set([
    'address', 'article', 'aside', 'blockquote', 'caption', 'dd', 'details',
    'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'h1',
    'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'li', 'main', 'nav', 'ol', 'p',
    'pre', 'section', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th',
    'thead', 'tr', 'ul',
]);

/**
 * @typedef {'in-place'|'after-block'|'message-end'} Placement
 */

/**
 * @typedef {{ok: true, value: string} | {ok: false, reason: string}} PlacementValidation
 */

/**
 * Validate one placement value. Empty is valid and means "unset", which is how
 * a sticker says "follow the global setting".
 *
 * @param {unknown} value
 * @returns {PlacementValidation}
 */
export function validatePlacement(value) {
    const text = String(value ?? '').trim();
    if (text === '') {
        return { ok: true, value: '' };
    }
    if (!PLACEMENTS.includes(text)) {
        return { ok: false, reason: 'invalid' };
    }
    return { ok: true, value: text };
}

/**
 * Resolve the placement of one sticker: its own override when it has a valid
 * one, otherwise the global default, otherwise the built-in default.
 *
 * @param {unknown} stickerPlacement - The sticker's own override.
 * @param {unknown} globalPlacement
 * @returns {Placement}
 */
export function resolvePlacement(stickerPlacement, globalPlacement) {
    const own = validatePlacement(stickerPlacement);
    if (own.ok && own.value) {
        return /** @type {Placement} */ (own.value);
    }
    const global = validatePlacement(globalPlacement);
    if (global.ok && global.value) {
        return /** @type {Placement} */ (global.value);
    }
    return DEFAULT_PLACEMENT;
}

/**
 * The 尺寸集 a 投放方式 is sized with.
 *
 * @param {unknown} placement
 * @returns {import('./size.js').SizeSetKey}
 */
export function sizeSetForPlacement(placement) {
    return SIZE_SET_BY_PLACEMENT[resolvePlacement(null, placement)];
}

/**
 * Whether a 投放方式 takes the image out of the text it was written in. Defined
 * as "is this sized with the block 尺寸集" so the two never disagree.
 *
 * @param {unknown} placement
 * @returns {boolean}
 */
export function isBlockPlacement(placement) {
    return sizeSetForPlacement(placement) === 'block';
}

/**
 * Blocks whose content cannot be left behind. A token sitting directly in a
 * table cell has the cell as its block container, but moving an image *after*
 * `</td>` would be invalid markup that browsers foster-parent out of the table
 * entirely. Inside a cell the image therefore goes at the end of the cell's own
 * content — a deliberate deviation from "after the block", kept because the
 * literal reading produces a broken table.
 */
const CELL_TAGS = new Set(['td', 'th']);

/** A CSS selector matching every block container, for the DOM path. */
export const BLOCK_CONTAINER_SELECTOR = [...BLOCK_CONTAINER_TAGS].join(',');

/**
 * Where an image goes relative to the block container it was written in.
 *
 * - `after`: just past the container's closing tag, i.e. between that block and
 *   the next one.
 * - `inside`: at the end of the container's own content, for table cells.
 * - `message-end`: no block container at all, so the image ends the message.
 *
 * @param {unknown} tagName - The block container's tag name, or null.
 * @returns {'after'|'inside'|'message-end'}
 */
export function blockBoundaryMode(tagName) {
    const name = String(tagName ?? '').toLowerCase();
    if (name === '') {
        return 'message-end';
    }
    return CELL_TAGS.has(name) ? 'inside' : 'after';
}
