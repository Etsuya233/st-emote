/**
 * The DOM render path: SillyTavern 1.15.0–1.18.x, which has no official
 * message-formatter hook, so tokens are replaced in the already-rendered
 * message instead.
 *
 * Everything here is the DOM half of the contract in ADR-0002. It writes the
 * final `custom-st-emote` class directly, and it must leave a message in the
 * state the hook path would have produced — same class, same `data-*`, same
 * size style — so the two paths are interchangeable and one stylesheet serves
 * both. `tests/render-paths.test.js` checks that claim against both paths with
 * one shared assertion.
 */

import { DEFAULT_STICKER_TAG, validateStickerTag } from '../core/constraints.js';
import { isOwnImagePath } from '../core/image-rules.js';
import {
    BLOCK_CONTAINER_SELECTOR,
    PLACED_ATTRIBUTE,
    PLACEMENT_ATTRIBUTE,
    blockBoundaryMode,
    isBlockPlacement,
} from '../core/placement.js';
import { STICKER_CLASS, TOKEN_ATTRIBUTE, renderText, renderTokenHtml } from '../core/render.js';
import { parseTokenBody, tokenPrefixes } from '../core/token.js';
import {
    eachMessageElement,
    effectiveSetForMessage,
    isInScope,
    logRenderResult,
    renderOptions,
    restitchChat,
} from './render-common.js';
import { isRenderingEnabled } from './restore.js';
import { logInfo } from './log.js';

/**
 * The tag name the sanitizer must let through. A configured sticker tag is not
 * a real HTML element, so without this SillyTavern's DOMPurify pass would strip
 * the raw `<sticker>…</sticker>` form before the DOM path can see it.
 */
let activeStickerTag = '';
let purifierHookInstalled = false;

/**
 * Let the configured HTML-tag form survive message sanitization. Safe to call
 * repeatedly; the hook itself is registered once.
 *
 * @param {unknown} tagName
 */
export function allowStickerTag(tagName) {
    const result = validateStickerTag(tagName);
    if (!result.ok) {
        return;
    }
    activeStickerTag = result.value.toLowerCase();
    if (purifierHookInstalled) {
        return;
    }
    const purifier = globalThis.DOMPurify;
    if (!purifier || typeof purifier.addHook !== 'function') {
        return;
    }
    purifierHookInstalled = true;
    purifier.addHook('uponSanitizeElement', (node, data) => {
        if (activeStickerTag && String(data?.tagName ?? '').toLowerCase() === activeStickerTag) {
            data.allowedTags[activeStickerTag] = true;
        }
    });
}

/**
 * @param {Node} node
 * @param {string} html
 */
function replaceWithHtml(node, html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    node.replaceWith(template.content);
}

/**
 * Replace raw `<tag>pack:label</tag>` elements. This form only reaches the DOM
 * when SillyTavern is configured not to encode tags; the entity-escaped form
 * arrives as ordinary text and is handled by the text-node pass below.
 *
 * @param {Element} textElement
 * @param {import('../core/effective-set.js').EffectiveSet} effectiveSet
 * @param {import('../core/render.js').RenderOptions} options
 * @returns {number}
 */
function renderStickerElements(textElement, effectiveSet, options) {
    const elements = textElement.querySelectorAll(options.tagName ?? DEFAULT_STICKER_TAG);
    const misses = [];
    const invalidSizes = [];
    let rewritten = 0;

    for (const element of elements) {
        if (element.closest('code, pre')) {
            continue;
        }
        const parsed = parseTokenBody(element.textContent ?? '');
        if (!parsed.label) {
            continue;
        }
        const html = renderTokenHtml(
            { raw: element.outerHTML, packName: parsed.packName, label: parsed.label },
            effectiveSet,
            misses,
            options,
            invalidSizes,
        );
        // A miss comes back as the marker, escaped — so this replaces the
        // element with a text node rather than dropping it, and there is no
        // empty result to branch on.
        replaceWithHtml(element, html);
        rewritten += 1;
    }

    logRenderResult({ misses, invalidSizes });
    return rewritten;
}

/**
 * Replace tokens inside the text nodes of a rendered message.
 *
 * @param {Element} textElement
 * @param {import('../core/effective-set.js').EffectiveSet} effectiveSet
 * @param {import('../core/render.js').RenderOptions} options
 * @returns {number}
 */
function renderTextNodes(textElement, effectiveSet, options) {
    const hints = tokenPrefixes(options.tagName ?? DEFAULT_STICKER_TAG).map((prefix) => prefix.toLowerCase());
    const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const lower = (node.data ?? '').toLowerCase();
            if (!hints.some((hint) => lower.includes(hint))) {
                return NodeFilter.FILTER_REJECT;
            }
            let parent = node.parentElement;
            while (parent && parent !== textElement) {
                const tag = parent.tagName;
                if (tag === 'CODE' || tag === 'PRE') {
                    return NodeFilter.FILTER_REJECT;
                }
                parent = parent.parentElement;
            }
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    const nodes = [];
    while (walker.nextNode()) {
        nodes.push(walker.currentNode);
    }

    let rewritten = 0;
    for (const node of nodes) {
        const { html, misses, invalidSizes } = renderText(node.data, effectiveSet, options);
        logRenderResult({ misses, invalidSizes });
        if (html === node.data) {
            continue;
        }
        replaceWithHtml(node, html);
        rewritten += 1;
    }
    return rewritten;
}

/**
 * The closest block container the image was written inside. `textElement` is
 * the message itself rather than one of its blocks, so it is never a candidate.
 * Which elements count as blocks is the pure core's list.
 *
 * @param {Element} image
 * @param {Element} root
 * @returns {Element|null}
 */
function nearestBlockAncestorElement(image, root) {
    let node = image.parentElement;
    while (node && node !== root) {
        if (node.matches(BLOCK_CONTAINER_SELECTOR)) {
            return node;
        }
        node = node.parentElement;
    }
    return null;
}

/**
 * Move the stickers that are not rendered in place to where their 投放方式 says
 * they belong: `after-block` just past the block the token was written in,
 * `message-end` at the end of the message.
 *
 * The boundary rule itself is the pure core's (`blockBoundaryMode` over the
 * block container set); this only performs the DOM move. Targets are resolved
 * before anything moves, so relocating one image never changes where another
 * one lands, and each target keeps a running anchor so images bound for the
 * same place stay in the order they were written.
 *
 * Idempotent, and that is load-bearing twice over. A relocated image is marked
 * with `PLACED_ATTRIBUTE` and skipped from then on, which keeps re-render, Show
 * more and swipe passes from dragging an image that is already home. It also
 * means a second pass cannot move an image the *hook* path already placed: the
 * hook path relocates in the string and marks the image the same way, so even if
 * both paths were somehow installed, the placement would be applied once.
 *
 * @param {Element} textElement
 * @returns {number} Number of images that were not rendered in place.
 */
function relocateStickerImages(textElement) {
    const images = Array.from(
        textElement.querySelectorAll(
            `img.${STICKER_CLASS}[${PLACEMENT_ATTRIBUTE}]:not([${PLACED_ATTRIBUTE}])`,
        ),
    ).filter((image) => isBlockPlacement(image.getAttribute(PLACEMENT_ATTRIBUTE)));
    if (images.length === 0) {
        return 0;
    }

    const targets = images.map((image) => ({
        image,
        placement: image.getAttribute(PLACEMENT_ATTRIBUTE),
        container: nearestBlockAncestorElement(image, textElement),
    }));

    const anchors = new Map();
    for (const { image, placement, container } of targets) {
        // 消息末尾 has exactly one destination — the end of the message — and the
        // block it was written in is irrelevant to that. Deciding on
        // `blockBoundaryMode` alone would answer "after this paragraph" for a
        // token inside one, silently turning 消息末尾 into 块后; the placement is
        // what chooses between the two, and the boundary only chooses *where*
        // within an 块后.
        if (placement === 'message-end' || container === null) {
            textElement.append(image);
            image.setAttribute(PLACED_ATTRIBUTE, '1');
            continue;
        }
        const mode = blockBoundaryMode(container.tagName);
        const previous = anchors.get(container);
        if (mode === 'inside') {
            // A table cell: the image joins the end of the cell's own content.
            if (previous && previous.parentElement === container) {
                previous.after(image);
            } else {
                container.append(image);
            }
        } else if (previous && previous.parentElement === container.parentElement) {
            previous.after(image);
        } else {
            container.after(image);
        }
        anchors.set(container, image);
        image.setAttribute(PLACED_ATTRIBUTE, '1');
    }
    return targets.length;
}

/**
 * Whether this client is on the DOM path at all. Set by `installDomRendering`
 * and consulted by every entry point into the DOM pass, so a caller that is not
 * path-aware — a settings change, a re-enable — cannot run the DOM pass on a
 * client whose messages were already rendered by the official hook. Rendering
 * twice would not corrupt anything (the second pass finds no tokens and skips
 * placed images), but it would do the walk for nothing, and "the DOM post-
 * processing does not run on the hook path" is a property worth being able to
 * state rather than merely observe.
 */
let domPathInstalled = false;

/**
 * Whether the DOM pass may run at all. Both conditions are needed, and each
 * closes a different hole:
 *
 * - `domPathInstalled` keeps the pass off a client whose messages the official
 *   hook already rendered, so a caller that is not path-aware — a settings
 *   change, a re-enable — cannot walk the chat for nothing.
 * - `isRenderingEnabled()` keeps the pass off a **disabled** extension. The
 *   event subscriptions outlive `onDisable` (the client does not reload, and
 *   unsubscribing would mean remembering every listener), so without this the
 *   next `CHARACTER_MESSAGE_RENDERED` would put the stickers straight back into
 *   a chat the user had just turned them off in. The hook path is gated on the
 *   same flag for the same reason.
 *
 * @returns {boolean}
 */
function shouldRunDomPass() {
    return domPathInstalled && isRenderingEnabled();
}

/**
 * Replace tokens inside one rendered message.
 *
 * Idempotent in both directions, and the second half is what keeps the extension
 * safe to turn off. Re-running this touches nothing: the token markup is gone
 * once replaced, and a relocated image is marked. And every image it inserted
 * carries the marker it replaced, so `adapter/restore.js` can put the text back
 * without re-deriving anything from the settings.
 *
 * @param {any} context
 * @param {Element} messageElement
 * @returns {number} Number of places that were rewritten.
 */
export function renderMessageElement(context, messageElement) {
    if (!shouldRunDomPass() || !messageElement) {
        return 0;
    }
    if (!isInScope(context, messageFactsFromElement(messageElement))) {
        return 0;
    }

    const textElement = messageElement.querySelector('.mes_text');
    if (!textElement) {
        return 0;
    }

    const messageId = Number(messageElement.getAttribute('mesid'));
    const effectiveSet = effectiveSetForMessage(context, messageId);
    const options = renderOptions(context);
    let rewritten = renderStickerElements(textElement, effectiveSet, options);
    rewritten += renderTextNodes(textElement, effectiveSet, options);
    // Placement is applied once, after every token in the message is an image:
    // moving one image must not change where another one lands.
    relocateStickerImages(textElement);
    return rewritten;
}

/**
 * The 处理范围 facts the DOM path reads off a message element. The reasoning
 * chain is rendered outside `.mes_text`, so it is out of reach here by
 * construction; the flag is still read so both paths present the same facts to
 * the one rule that decides.
 *
 * @param {Element} messageElement
 * @returns {{isUser: boolean, isSystem: boolean, isNarrator: boolean, isReasoning: boolean}}
 */
function messageFactsFromElement(messageElement) {
    return {
        isUser: messageElement.getAttribute('is_user') === 'true',
        isSystem: messageElement.getAttribute('is_system') === 'true',
        isNarrator: messageElement.getAttribute('type') === 'narrator',
        isReasoning: messageElement.getAttribute('is_reasoning') === 'true',
    };
}

/**
 * @param {any} context
 */
export function processAllMessages(context) {
    if (!shouldRunDomPass()) {
        return;
    }
    eachMessageElement((messageElement) => {
        renderMessageElement(context, messageElement);
    });
}

/**
 * Repaint the current chat: every message goes back to the client to be
 * re-formatted from its source text, and then — on the DOM path only — the token
 * pass runs over the freshly rebuilt body.
 *
 * The two halves are separate because the **restitch is what works on both
 * paths**. `updateMessageBlock` re-runs the client's whole formatting pipeline,
 * and on ST ≥ 1.19 the official hook is a stage of that pipeline: restitching a
 * message is what brings its stickers back, with no help from us. On 1.15.0 –
 * 1.18.x the pipeline has no hook in it, so the body comes back holding its raw
 * markers and the DOM pass turns them into images again.
 *
 * That is why this used to be a no-op on the hook path, and why it must not be
 * again: gating the *whole* repaint on "is this the DOM path" left the panel's
 * re-render button and `/st-emote reload` reporting a repaint they had not
 * performed. The DOM pass keeps its own gate (`shouldRunDomPass`, inside
 * `renderMessageElement`), which is where that decision belongs.
 *
 * Repaints from source text rather than from the current DOM on purpose: an
 * image already standing in for a token cannot be turned back into a token
 * without the source, and a 块后 image in particular would land in the wrong place
 * if the only thing that happened was a second pass over the nodes.
 *
 * Does nothing at all while the extension is disabled. The hook is a
 * pass-through then, so a restitch would produce the right text at the cost of
 * walking every message, and the DOM pass is gated off regardless.
 *
 * @param {any} context
 * @returns {number} How many messages were handed back to the client.
 */
export function rerenderChat(context) {
    if (!isRenderingEnabled()) {
        return 0;
    }
    const restitched = restitchChat(context);
    if (!domPathInstalled) {
        return restitched;
    }
    eachMessageElement((messageElement) => {
        renderMessageElement(context, messageElement);
    });
    return restitched;
}

/**
 * @param {any} context
 * @param {number} messageId
 */
function renderMessageById(context, messageId) {
    const messageElement = document.querySelector(`.mes[mesid="${messageId}"]`);
    if (messageElement) {
        renderMessageElement(context, messageElement);
    }
}

/**
 * Give an image that failed to load back its marker, and leave a console trace.
 * Missing files and dead external links both surface here.
 *
 * The check is on the base class, which every sticker image carries whatever its
 * 投放方式; a block image is still one of ours.
 *
 * @param {Event} event
 */
function handleImageError(event) {
    const target = event.target;
    if (!(target instanceof HTMLImageElement) || !target.classList.contains(STICKER_CLASS)) {
        return;
    }
    const src = target.getAttribute('src') ?? '';
    // The last of the 未命中 sources, and the only one observable only after the
    // fact: a file that is not on this server and a 外链 whose address has gone
    // dead both arrive here, long after the token matched. They are told apart
    // by whether the source is one of our files, because the fix differs — one
    // needs the picture put back, the other a working address.
    const reason = isOwnImagePath(src) ? 'image-missing' : 'external-link-failed';
    const qualified = `${target.getAttribute('data-st-emote-pack') ?? ''}`
        + `:${target.getAttribute('data-st-emote-label') ?? ''}`;
    logInfo(`sticker not rendered (${reason}): ${qualified} (${src})`);
    // An image that cannot be drawn falls back to the marker it stands for,
    // rather than leaving a broken-image icon in the reply. The same line
    // `adapter/restore.js` uses, and for the same reason: a sticker that could
    // not be shown gives its marker back. The attribute is on the image already,
    // so nothing has to be re-derived from the settings.
    target.replaceWith(document.createTextNode(target.getAttribute(TOKEN_ATTRIBUTE)));
}

/**
 * The element the guard is currently listening on.
 *
 * The element rather than a boolean, because `#chat` is a singleton in the
 * client but not necessarily in a test: a flag would claim to be installed while
 * pointing at an element that is no longer in the document, and a dead link
 * would quietly stop being cleaned up. Comparing the element re-installs only
 * when it genuinely changed.
 *
 * @type {Element|null}
 */
let stickerImageGuardTarget = null;

/**
 * Watch for sticker images that fail to load, on **both** render paths.
 *
 * A sticker whose file never arrived on this server, and a 外链 whose address has
 * gone dead, both have to count as a 未命中: the spec says so, and both arrive
 * here as an image that fired `error`. The two paths differ in how the image got
 * into the DOM and not at all in what should happen when it cannot be drawn, so
 * the listener is installed by the path chooser rather than by one path — the
 * hook path has no DOM pass to hang it off, and a dead link there would
 * otherwise sit on screen as a broken-image icon for good.
 *
 * Idempotent for the same element, because the entry point and the enable hook
 * can both reach it.
 */
export function installStickerImageGuard() {
    // `document` is read defensively: this is a nicety for the chat view, and
    // the hook path is installable in a context that has no DOM at all.
    const chatElement = globalThis.document?.getElementById('chat');
    if (!chatElement || chatElement === stickerImageGuardTarget) {
        return;
    }
    stickerImageGuardTarget = chatElement;
    // Capture phase: `error` on an image does not bubble.
    chatElement.addEventListener('error', handleImageError, true);
}

/**
 * Wire the DOM render path into SillyTavern's events.
 *
 * Every event here re-renders a message that the client has just rebuilt from
 * its source text, so each pass starts from the original markers. That is what
 * makes the path idempotent for re-render, Show more, swipe and edit: none of
 * them can find a token twice, and none of them can leave an image behind,
 * because the client replaces the message body wholesale before we see it.
 *
 * @param {any} context
 */
export function installDomRendering(context) {
    const { eventSource, eventTypes } = context;
    domPathInstalled = true;

    eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        renderMessageById(context, messageId);
    });
    eventSource.on(eventTypes.MESSAGE_UPDATED, (messageId) => {
        renderMessageById(context, messageId);
    });
    eventSource.on(eventTypes.MESSAGE_EDITED, (messageId) => {
        renderMessageById(context, messageId);
    });
    eventSource.on(eventTypes.MESSAGE_SWIPED, (messageId) => {
        renderMessageById(context, messageId);
    });
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        processAllMessages(context);
    });
    eventSource.on(eventTypes.MORE_MESSAGES_LOADED, () => {
        processAllMessages(context);
    });
}
