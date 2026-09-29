import { escapeAttribute, escapeText } from './escape.js';
import {
    BLOCK_CONTAINER_TAGS,
    PLACED_ATTRIBUTE,
    PLACEMENT_ATTRIBUTE,
    blockBoundaryMode,
    isBlockPlacement,
    resolvePlacement,
    sizeSetForPlacement,
} from './placement.js';
import { evaluateSize } from './size.js';
import { findTokens, tokenText } from './token.js';

/**
 * The class name the official message-formatter hook writes, before
 * SillyTavern's sanitizer has had its way with it.
 *
 * Every sticker image carries this class, whatever its 投放方式, because both
 * render paths select on it. Whether an image was placed in place or moved is a
 * behaviour question, and behaviour is carried by `data-*` (ADR-0002), never by
 * the class list.
 */
export const STICKER_HOOK_CLASS = 'st-emote';

/**
 * The prefix SillyTavern's sanitizer puts in front of every class in message
 * content. The hook path gets it for free; the DOM path has to add it itself.
 */
export const SANITIZER_CLASS_PREFIX = 'custom-';

/**
 * The class as it exists in the final DOM, which is what the stylesheet targets
 * and what both paths converge on (ADR-0002). It is derived from
 * `STICKER_HOOK_CLASS` so the two names cannot drift apart: the DOM path writes
 * the prefixed name directly, the hook path writes the bare name and lets the
 * sanitizer produce the same one.
 */
export const STICKER_CLASS = `${SANITIZER_CLASS_PREFIX}${STICKER_HOOK_CLASS}`;

/**
 * The marker text the image stands for, recorded verbatim so disabling the
 * extension can put it back where the image was. Both paths emit it, so the
 * restore works the same way whichever one rendered the image.
 */
export const TOKEN_ATTRIBUTE = 'data-st-emote-token';

/**
 * Whether the running SillyTavern offers the official message-formatter hook.
 * Feature detection rather than a version check: the hook is the only thing this
 * extension needs from that API, and a client that has it is one the hook path
 * can use. Everything else — 净化, 事件 — works on every version from 1.15.0 up.
 *
 * @param {unknown} messageFormatter - The `messageFormatter` from the context.
 * @returns {boolean}
 */
export function supportsMessageFormatter(messageFormatter) {
    return Boolean(messageFormatter) && typeof messageFormatter.addHook === 'function';
}

/**
 * Modifier class added alongside `STICKER_CLASS` to a sticker that owns its own
 * block. Applied as an addition, not a replacement: `img.custom-st-emote` has to
 * keep matching block images, or the DOM path would stop seeing them.
 */
export const STICKER_BLOCK_SUFFIX = '-block';

/**
 * @typedef {Object} Miss
 * @property {'pack-not-found'|'pack-not-enabled'|'label-not-found'|'ambiguous-bare-label'|'image-missing'|'external-link-failed'} reason
 * @property {string} raw
 * @property {string|null} packName
 * @property {string} label
 */

/**
 * @typedef {Object} RenderResult
 * @property {string} html
 * @property {Miss[]} misses
 * @property {import('./size.js').InvalidSize[]} invalidSizes
 */

/**
 * @typedef {Object} RenderOptions
 * @property {string} [tagName] - Name of the configurable HTML-tag form.
 * @property {boolean} [bracketForm] - Whether the `[[sticker:…]]` 标记 form is
 *   accepted at all. Off means the form is not grammar: the text is left
 *   exactly as written rather than being reported as a 未命中.
 * @property {boolean} [tagForm] - Whether the HTML-tag 标记 form is accepted.
 * @property {import('./placement.js').Placement} [placement] - The global
 *   投放方式; a sticker may override it.
 * @property {import('./size.js').PartialSizeSets} [sizes] - The `inline` and
 *   `block` 尺寸集.
 * @property {string} [className] - Base class name. The DOM path writes the
 *   final `custom-st-emote`; the official-hook path passes the un-prefixed
 *   `st-emote` and lets SillyTavern's sanitizer add the `custom-` prefix, so
 *   both paths converge on one name and one stylesheet.
 */

/**
 * The class list of one sticker image: the base class every image carries, plus
 * the block modifier when the sticker is not rendered in place.
 *
 * @param {import('./placement.js').Placement} placement
 * @param {string} [className] - Base class name, so the official-hook path can
 *   pass the un-prefixed `st-emote` and let SillyTavern's sanitizer add
 *   `custom-` to both classes.
 * @returns {string}
 */
export function stickerClassNames(placement, className = STICKER_CLASS) {
    if (!isBlockPlacement(placement)) {
        return className;
    }
    return `${className} ${className}${STICKER_BLOCK_SUFFIX}`;
}

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
        // No source at all. A source that is *there* but does not load — a file
        // that never arrived, or a dead 外链 — cannot be known here; it surfaces
        // later as an `error` on the image, which is where `external-link-failed`
        // comes from.
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

function stickerHtml(pack, sticker, options, invalidSizes, marker) {
    const placement = resolvePlacement(sticker.placement, options.placement);
    const size = evaluateSize(sizeSetForPlacement(placement), options.sizes);
    invalidSizes.push(...size.invalid);
    return `<img class="${stickerClassNames(placement, options.className ?? STICKER_CLASS)}"`
        + ` src="${escapeAttribute(sticker.image)}"`
        + ` alt="${escapeAttribute(sticker.label)}"`
        + ` style="${escapeAttribute(size.style)}"`
        + ` data-st-emote-pack="${escapeAttribute(pack.name)}"`
        + ` data-st-emote-label="${escapeAttribute(sticker.label)}"`
        + ` ${TOKEN_ATTRIBUTE}="${escapeAttribute(marker)}"`
        + ` ${PLACEMENT_ATTRIBUTE}="${placement}">`;
}

/**
 * Resolve one token and return its `<img>` markup, or an empty string when the
 * token misses. Every miss is appended to `misses`. Exported so the DOM path
 * can render the raw HTML-tag form through the exact same rules.
 *
 * @param {{raw: string, packName: string|null, label: string}} token
 * @param {import('./effective-set.js').EffectiveSet} effectiveSet
 * @param {Miss[]} misses
 * @param {RenderOptions} [options]
 * @param {import('./size.js').InvalidSize[]} [invalidSizes] - Collects the
 *   hand-typed size values that were treated as unset, so the caller can log
 *   them.
 * @returns {string}
 */
export function renderTokenHtml(token, effectiveSet, misses, options = {}, invalidSizes = []) {
    const result = resolveToken(token, effectiveSet, misses);
    if (!result) {
        return '';
    }
    return stickerHtml(
        result.pack,
        result.sticker,
        options,
        invalidSizes,
        tokenText(token, options),
    );
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
function renderChunk(chunk, effectiveSet, misses, escape, options, invalidSizes) {
    const tokens = findTokens(chunk, options);
    if (tokens.length === 0) {
        return escape ? escapeText(chunk) : chunk;
    }

    let out = '';
    let cursor = 0;
    for (const token of tokens) {
        const between = chunk.slice(cursor, token.index);
        out += escape ? escapeText(between) : between;
        out += renderTokenHtml(token, effectiveSet, misses, options, invalidSizes);
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
    const invalidSizes = [];
    const html = renderChunk(String(text ?? ''), effectiveSet, misses, true, options, invalidSizes);
    return { html, misses, invalidSizes };
}

const TAG_PATTERN = /<[^>]*>/g;
const TAG_NAME_PATTERN = /^<\/?\s*([a-zA-Z0-9-]+)/;
const SELF_CLOSING_SUFFIX = '/>';
const PLACED_IMG_PATTERN = /<img\b[^>]*>/g;
const PLACEMENT_ATTRIBUTE_PATTERN = new RegExp(`\\b${PLACEMENT_ATTRIBUTE}="([^"]*)"`);

function htmlTagName(tag) {
    const match = TAG_NAME_PATTERN.exec(tag);
    return match ? match[1].toLowerCase() : null;
}

/**
 * Elements that never have a closing tag. The tag-stack walk must not push
 * them, or every following boundary would be attributed to them.
 */
const VOID_TAGS = new Set([
    'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
    'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Record the extent of every block container in a piece of HTML, so a sticker
 * can be moved to the boundary of the block it was written in.
 *
 * A line break is not a block: `<br>` is a void element and never opens a
 * container, so a token after one still resolves to the paragraph it sits in.
 *
 * @param {string} html
 * @returns {{name: string, start: number, contentEnd: number, end: number}[]}
 */
function findBlockContainers(html) {
    const containers = [];
    const stack = [];
    TAG_PATTERN.lastIndex = 0;

    let match;
    while ((match = TAG_PATTERN.exec(html)) !== null) {
        const tag = match[0];
        const name = htmlTagName(tag);
        if (!name) {
            continue;
        }
        if (tag.startsWith('</')) {
            for (let i = stack.length - 1; i >= 0; i -= 1) {
                if (stack[i].name !== name) {
                    continue;
                }
                const frame = stack[i];
                stack.length = i;
                frame.contentEnd = match.index;
                frame.end = match.index + tag.length;
                containers.push(frame);
                break;
            }
            continue;
        }
        if (VOID_TAGS.has(name) || tag.endsWith(SELF_CLOSING_SUFFIX)) {
            continue;
        }
        const frame = { name, start: match.index, contentEnd: -1, end: -1 };
        stack.push(frame);
        if (BLOCK_CONTAINER_TAGS.has(name)) {
            containers.push(frame);
        }
    }

    // A block container left open runs to the end of the message.
    for (const frame of stack) {
        if (BLOCK_CONTAINER_TAGS.has(frame.name)) {
            frame.contentEnd = html.length;
            frame.end = html.length;
            containers.push(frame);
        }
    }
    return containers;
}

/**
 * The innermost block container holding the offset, or null at the top level.
 *
 * @param {{name: string, start: number, end: number}[]} containers
 * @param {number} offset
 * @returns {{name: string, start: number, contentEnd: number, end: number}|null}
 */
function innermostContainer(containers, offset) {
    let best = null;
    for (const container of containers) {
        if (container.start > offset || container.end <= offset) {
            continue;
        }
        if (!best || container.start > best.start) {
            best = container;
        }
    }
    return best;
}

/**
 * Tag an image as already placed, so a later pass over the same message leaves
 * it where it is. Only our own `<img …>` markup reaches here, so the tag always
 * ends with `>`.
 *
 * @param {string} imgTag
 * @returns {string}
 */
function markPlaced(imgTag) {
    return `${imgTag.slice(0, -1)} ${PLACED_ATTRIBUTE}="1">`;
}

/**
 * Move every sticker that is not rendered in place to where its 投放方式 says
 * it belongs: `after-block` to just past the block the token was written in,
 * `message-end` to the end of the message. Images heading for the same boundary
 * keep their source order, so a block of them stacks the way it was written.
 *
 * This is the HTML-in/HTML-out half of the rule. The DOM path applies the same
 * boundaries to live nodes, walking up with `BLOCK_CONTAINER_SELECTOR` and
 * asking `blockBoundaryMode` from `core/placement.js` where the image goes.
 *
 * @param {string} html
 * @returns {string}
 */
export function relocatePlacedImages(html) {
    const source = String(html ?? '');
    if (!source.includes(PLACEMENT_ATTRIBUTE)) {
        return source;
    }

    // Collect the images that are not rendered in place and have not been moved
    // yet, with the placement that decides where each of them goes.
    const placed = [];
    PLACED_IMG_PATTERN.lastIndex = 0;
    let match;
    while ((match = PLACED_IMG_PATTERN.exec(source)) !== null) {
        const placement = PLACEMENT_ATTRIBUTE_PATTERN.exec(match[0])?.[1];
        if (placement === undefined || !isBlockPlacement(placement)) {
            continue;
        }
        if (match[0].includes(PLACED_ATTRIBUTE)) {
            continue;
        }
        placed.push({
            placement,
            start: match.index,
            end: match.index + match[0].length,
            text: markPlaced(match[0]),
        });
    }
    if (placed.length === 0) {
        return source;
    }

    // The container scan only pays off when something wants a block boundary;
    // `message-end` images all head for the same place regardless.
    const containers = placed.some((image) => image.placement === 'after-block')
        ? findBlockContainers(source)
        : [];

    /** @type {Map<number, {text: string, start: number, end: number}[]>} */
    const insertions = new Map();
    for (const image of placed) {
        const container = image.placement === 'after-block'
            ? innermostContainer(containers, image.start)
            : null;
        const mode = image.placement === 'message-end'
            ? 'message-end'
            : blockBoundaryMode(container?.name ?? null);
        const at = mode === 'message-end'
            ? source.length
            : mode === 'inside' ? container.contentEnd : container.end;
        if (!insertions.has(at)) {
            insertions.set(at, []);
        }
        insertions.get(at).push(image);
    }

    // One forward pass over the untouched source: drop each image where it was
    // written and re-emit it at its boundary. A boundary never falls inside a
    // removed range, because a boundary is a `</…>` position (or the end of the
    // message) and a removed range is a whole `<img …>` tag.
    const boundaries = [...insertions.keys()].sort((a, b) => a - b);
    const removals = [...placed].sort((a, b) => a.start - b.start);
    let out = '';
    let cursor = 0;
    let removalIndex = 0;

    for (const at of boundaries) {
        while (removalIndex < removals.length && removals[removalIndex].end <= at) {
            const removal = removals[removalIndex];
            removalIndex += 1;
            out += source.slice(cursor, removal.start);
            cursor = removal.end;
        }
        out += source.slice(cursor, at);
        cursor = at;
        for (const image of insertions.get(at)) {
            out += image.text;
        }
    }
    out += source.slice(cursor);
    return out;
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
    const invalidSizes = [];
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
            out += renderChunk(source.slice(cursor, nextToken.index), effectiveSet, misses, false, options, invalidSizes);
            out += renderTokenHtml(nextToken, effectiveSet, misses, options, invalidSizes);
            cursor = nextToken.index + nextToken.raw.length;
            continue;
        }

        if (!nextTag) {
            const tail = source.slice(cursor);
            out += codeDepth > 0
                ? tail
                : renderChunk(tail, effectiveSet, misses, false, options, invalidSizes);
            break;
        }

        const between = source.slice(cursor, nextTag.index);
        out += codeDepth > 0
            ? between
            : renderChunk(between, effectiveSet, misses, false, options, invalidSizes);
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

    return { html: relocatePlacedImages(out), misses, invalidSizes };
}
