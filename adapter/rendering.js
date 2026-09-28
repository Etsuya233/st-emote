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
import {
    BLOCK_CONTAINER_SELECTOR,
    PLACED_ATTRIBUTE,
    PLACEMENT_ATTRIBUTE,
    blockBoundaryMode,
    isBlockPlacement,
} from '../core/placement.js';
import { STICKER_CLASS, renderText, renderTokenHtml } from '../core/render.js';
import { parseTokenBody, tokenPrefixes } from '../core/token.js';
import {
    LOG_PREFIX,
    effectiveSetForMessage,
    isInScope,
    renderOptions,
    reportResult,
} from './render-common.js';

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
        if (!html) {
            element.remove();
            continue;
        }
        replaceWithHtml(element, html);
        rewritten += 1;
    }

    return reportResult({ misses, invalidSizes }, rewritten);
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
        reportResult({ misses, invalidSizes }, 0);
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

    const targets = images.map((image) => {
        const container = nearestBlockAncestorElement(image, textElement);
        return { image, container, mode: blockBoundaryMode(container?.tagName ?? null) };
    });

    const anchors = new Map();
    for (const { image, container, mode } of targets) {
        if (container === null || mode === 'message-end') {
            textElement.append(image);
            image.setAttribute(PLACED_ATTRIBUTE, '1');
            continue;
        }
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
    if (!domPathInstalled || !messageElement) {
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
    const chatElement = document.getElementById('chat');
    if (!domPathInstalled || !chatElement) {
        return;
    }
    chatElement.querySelectorAll('.mes').forEach((messageElement) => {
        renderMessageElement(context, messageElement);
    });
}

/**
 * Re-render the current chat from its source text, then replace tokens again.
 * Used after settings change so previously hidden misses come back.
 *
 * @param {any} context
 */
export function rerenderChat(context) {
    const chatElement = document.getElementById('chat');
    const chat = context?.chat;
    if (!domPathInstalled || !chatElement || !Array.isArray(chat)) {
        return;
    }
    chatElement.querySelectorAll('.mes').forEach((messageElement) => {
        const messageId = Number(messageElement.getAttribute('mesid'));
        const message = Number.isInteger(messageId) ? chat[messageId] : null;
        if (message) {
            try {
                context.updateMessageBlock(messageId, message);
            } catch (error) {
                console.error(`${LOG_PREFIX} failed to re-render message ${messageId}`, error);
            }
        }
        renderMessageElement(context, messageElement);
    });
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
 * Remove an image that failed to load and leave a console trace. Missing
 * files and dead external links both surface here.
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
    console.info(`${LOG_PREFIX} sticker image not found: ${target.getAttribute('src')}`);
    target.remove();
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

    const chatElement = document.getElementById('chat');
    if (chatElement) {
        chatElement.addEventListener('error', handleImageError, true);
    }
}
