/**
 * The one place both render paths are checked against.
 *
 * ADR-0002 makes the two paths an implementation detail: the official hook
 * writes `st-emote` and the sanitizer prefixes it, the DOM path writes
 * `custom-st-emote` itself. Everything downstream of that — the stylesheet, the
 * selectors, the user's eyes — sees one result. So the contract below is written
 * once, against the **final DOM**, and each path is handed the same expectations.
 *
 * A path is turned into a final DOM by `parsePathResult`, which does only the
 * last mechanical step the client would do: the sanitizer's class prefix. No
 * other behaviour is simulated, because simulating more is how a shared contract
 * quietly stops testing anything.
 */

import { JSDOM } from 'jsdom';

import { PLACED_ATTRIBUTE, PLACEMENT_ATTRIBUTE } from '../../core/placement.js';
import { SANITIZER_CLASS_PREFIX, STICKER_CLASS, TOKEN_ATTRIBUTE } from '../../core/render.js';

const STICKER_QUERY = `img.${STICKER_CLASS}`;

/**
 * The inline `style` an image carries with no configuration at all, per 尺寸集.
 *
 * Named constants rather than a literal repeated at every call site, so the
 * expected default of each 尺寸集 is stated once — including the 间隙, which is
 * part of it and used to live only in `style.css`.
 */
const INLINE_STYLE = 'max-height: 3em; object-fit: contain; margin: 0 0.15em';
const BLOCK_STYLE = 'max-width: 100%; object-fit: contain; margin: 0.25em 0';

/**
 * Parse an HTML string the way a browser would, so both paths are compared as
 * DOM rather than as strings. Attributes arrive decoded, which is what makes
 * this the right level to assert at: `<img class="…&lt;…">` and the tag it stands
 * for stop being two different things.
 *
 * Returns the message body rather than the document, because that is the node
 * a real render path is handed and therefore the node the assertions read.
 *
 * @param {string} html
 * @returns {Element}
 */
export function parseHtml(html) {
    return new JSDOM(`<!doctype html><body><div class="mes_text">${html}</div></body>`)
        .window.document.querySelector('.mes_text');
}

/**
 * Apply the class prefix SillyTavern's sanitizer adds to message content.
 *
 * This is the *only* part of the client modelled here, and it is modelled
 * because it is the step that makes the two class names agree. It applies to
 * the hook path alone: that path hands the client a string, and the client
 * sanitizes it. The DOM path's markup is inserted after sanitization has
 * already run, so nothing prefixes it — it writes the final name itself.
 *
 * It is a documented behaviour of the client, verified by hand on 1.19+ (see
 * the ticket's manual checklist) rather than asserted against the client.
 *
 * @param {Element} root
 * @returns {Element}
 */
export function applySanitizerClassPrefix(root) {
    for (const element of [root, ...root.querySelectorAll('[class]')]) {
        // Replace, not add: the sanitizer rewrites the attribute, so the bare
        // name must not survive alongside the prefixed one.
        element.className = [...element.classList]
            .map((name) => `${SANITIZER_CLASS_PREFIX}${name}`)
            .join(' ');
    }
    return root;
}

/**
 * One sticker image, as the contract sees it: what the user can observe, and
 * nothing about how any path got there.
 *
 * @typedef {Object} StickerView
 * @property {string[]} classes - The class list, split on whitespace.
 * @property {string} src
 * @property {string} alt
 * @property {string} style - The inline size/fill declarations.
 * @property {string} pack
 * @property {string} label
 * @property {string} token - The marker this image stands for.
 * @property {string} placement
 * @property {boolean} placed - Whether relocation already happened.
 * @property {number} depth - Block nesting depth of the image's parent, so
 *   原地 vs 块后 is visible without asserting on the surrounding markup.
 */

/**
 * The class names one `<img …>` carries, split on whitespace.
 *
 * Splitting rather than substring-matching is what makes an assertion about the
 * block modifier an assertion about the class *list*. A substring check passes
 * for a tag that has the modifier but lost the base class — the exact bug the
 * base-class rule in ADR-0002 exists to prevent.
 *
 * @param {string} imgTag
 * @returns {string[]}
 */
export function stickerClassList(imgTag) {
    const value = /class="([^"]*)"/.exec(imgTag)?.[1] ?? '';
    return value.split(/\s+/).filter(Boolean);
}

/**
 * Read every sticker image in a rendered message, in document order.
 *
 * @param {Element} root
 * @returns {StickerView[]}
 */
export function readStickers(root) {
    return [...root.querySelectorAll(STICKER_QUERY)].map((image) => ({
        classes: [...image.classList],
        src: image.getAttribute('src'),
        alt: image.getAttribute('alt'),
        style: image.getAttribute('style'),
        pack: image.getAttribute('data-st-emote-pack'),
        label: image.getAttribute('data-st-emote-label'),
        token: image.getAttribute(TOKEN_ATTRIBUTE),
        placement: image.getAttribute(PLACEMENT_ATTRIBUTE),
        placed: image.hasAttribute(PLACED_ATTRIBUTE),
        depth: blockDepth(image, root),
    }));
}

/**
 * How many block ancestors the image has inside the message body. 原地 sits
 * inside the paragraph it was written in (depth 1), 块后 sits beside that
 * paragraph (depth 0), 消息末尾 sits at the end of the body (depth 0). A
 * structural fact about the final DOM, not an assertion about a function call.
 *
 * The message body itself is the root and is not counted: it is the container
 * every path is handed, not part of what the placement decided.
 *
 * @param {Element} image
 * @param {Element} root
 * @returns {number}
 */
function blockDepth(image, root) {
    let depth = 0;
    for (let node = image.parentElement; node && node !== root; node = node.parentElement) {
        if (/^(P|LI|BLOCKQUOTE|H[1-6]|TD|TH|DIV|PRE|UL|OL|TABLE)$/.test(node.tagName)) {
            depth += 1;
        }
    }
    return depth;
}

/**
 * The message's text with every sticker image collapsed to a marker, so a test
 * can assert *where* the images sit without asserting on the markup around them.
 *
 * @param {Element} root
 * @returns {string}
 */
export function readText(root) {
    const clone = root.cloneNode(true);
    for (const image of clone.querySelectorAll(STICKER_QUERY)) {
        image.replaceWith(image.getAttribute(TOKEN_ATTRIBUTE));
    }
    return clone.textContent;
}

/**
 * Assert that a rendered message matches the contract.
 *
 * Deliberately structural: it compares the observable sticker views and the
 * surrounding text. A path passes by producing the right DOM, whether it got
 * there through the official hook, the DOM post-processor, or something invented
 * tomorrow.
 *
 * @param {import('node:assert/strict').Assert} assert
 * @param {Element} root
 * @param {{stickers: object[], text?: string}} expected
 * @param {string} [label] - Which path this is, so a failure names one.
 */
export function assertRendersAs(assert, root, expected, label = 'render path') {
    assert.deepEqual(
        readStickers(root).map(({ classes, src, alt, style, pack, label, token, placement, placed, depth }) => ({
            classes, src, alt, style, pack, label, token, placement, placed, depth,
        })),
        expected.stickers,
        label,
    );
    if (expected.text !== undefined) {
        assert.equal(readText(root), expected.text, label);
    }
}

/**
 * The expected view of one sticker image.
 *
 * Only `src` and `label` are required; everything else is derived the same way
 * both paths derive it, so an expectation stays a statement about the sticker
 * rather than a transcription of the markup.
 *
 * @param {object} spec
 * @returns {StickerView}
 */
export function sticker(spec) {
    const placement = spec.placement ?? 'in-place';
    const block = placement !== 'in-place';
    return {
        classes: block ? [STICKER_CLASS, `${STICKER_CLASS}-block`] : [STICKER_CLASS],
        src: spec.src,
        alt: spec.alt ?? spec.label,
        style: spec.style ?? (block ? BLOCK_STYLE : INLINE_STYLE),
        pack: spec.pack,
        label: spec.label,
        token: spec.token,
        placement,
        placed: spec.placed ?? block,
        depth: spec.depth ?? (block ? 0 : 1),
    };
}

/**
 * The exact `<img …>` markup one sticker produces.
 *
 * Shared so the suite states what a sticker *is* once, instead of transcribing
 * the attribute list into every test that cares about something else. A new
 * `data-*` marker then costs one edit here rather than one per assertion, and a
 * test can no longer pass while quietly disagreeing about the markup.
 *
 * @param {{src: string, pack: string, label: string, token?: string, placement?: string,
 *   style?: string, className?: string, placed?: boolean}} spec
 * @returns {string}
 */
export function stickerMarkup(spec) {
    const placement = spec.placement ?? 'in-place';
    const block = placement !== 'in-place';
    const classes = spec.className ?? STICKER_CLASS;
    const placed = spec.placed ?? block;
    return `<img class="${block ? `${classes} ${classes}-block` : classes}"`
        + ` src="${spec.src}"`
        + ` alt="${spec.label}"`
        + ` style="${spec.style ?? (block ? BLOCK_STYLE : INLINE_STYLE)}"`
        + ` data-st-emote-pack="${spec.pack}"`
        + ` data-st-emote-label="${spec.label}"`
        + ` ${TOKEN_ATTRIBUTE}="${spec.token ?? `[[sticker:${spec.pack}:${spec.label}]]`}"`
        + ` ${PLACEMENT_ATTRIBUTE}="${placement}"`
        + `${placed ? ` ${PLACED_ATTRIBUTE}="1"` : ''}>`;
}

/**
 * The text a message shows, with the sticker images left out entirely.
 *
 * The right level for "is this marker still on screen": a rendered image carries
 * its marker in a `data-*` attribute, so asserting on the raw markup would find
 * it there and report a token that is no longer displayed as still present.
 * Use {@link readText} instead when the question is where a marker sits in the
 * flow of the message.
 *
 * @param {Element} root
 * @returns {string}
 */
export function visibleText(root) {
    const clone = root.cloneNode(true);
    for (const image of clone.querySelectorAll(STICKER_QUERY)) {
        image.remove();
    }
    return clone.textContent;
}

/**
 * {@link visibleText} for a message given as HTML.
 *
 * @param {string} html
 * @returns {string}
 */
export function messageText(html) {
    return visibleText(parseHtml(html));
}

/**
 * Turn a path's result into the final DOM the user sees.
 *
 * The hook path hands back a string the client will sanitize, so its result goes
 * through {@link applySanitizerClassPrefix} on the way. The DOM path hands back
 * a node the client has already placed, so it does not. That asymmetry is the
 * whole point of ADR-0002: the two paths start from different places and land on
 * one DOM.
 *
 * @param {Element|string} result
 * @param {{sanitizedByClient?: boolean}} [options]
 * @returns {Element}
 */
export function parsePathResult(result, options = {}) {
    const root = typeof result === 'string' ? parseHtml(result) : result;
    return options.sanitizedByClient ? applySanitizerClassPrefix(root) : root;
}
