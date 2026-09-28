import { validateStickerTag } from '../core/constraints.js';
import { buildScopedEffectiveSet } from '../core/effective-set.js';
import { STICKER_CLASS, renderText, renderTokenHtml } from '../core/render.js';
import { parseTokenBody, tokenPrefixes } from '../core/token.js';
import { ensureSettings } from './settings.js';
import {
    getCharacterScopeForAvatar,
    getChatScope,
    getCurrentCharacterScope,
    liveContext,
} from './scope.js';

export const LOG_PREFIX = '[st-emote]';

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

function describeMiss(miss) {
    const qualified = miss.packName ? `${miss.packName}:${miss.label}` : miss.label;
    return `${LOG_PREFIX} sticker not rendered (${miss.reason}): ${qualified}`;
}

function logMisses(misses) {
    for (const miss of misses) {
        console.info(describeMiss(miss));
    }
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
 * The avatar of the character who authored one rendered message. Group chats
 * store the author on the message itself, so each message resolves its own
 * role scope. Single-character messages carry the same field after generation.
 *
 * @param {any} context
 * @param {Element} messageElement
 * @returns {string|null}
 */
function messageAuthorAvatar(context, messageElement) {
    const messageId = Number(messageElement.getAttribute('mesid'));
    const chat = liveContext(context)?.chat;
    if (!Number.isInteger(messageId) || !Array.isArray(chat)) {
        return null;
    }
    return chat[messageId]?.original_avatar ?? null;
}

/**
 * Build the effective set for one message: the union of the global scope, the
 * author's character scope and the chat scope.
 *
 * @param {any} context
 * @param {Element} messageElement
 * @returns {import('../core/effective-set.js').EffectiveSet}
 */
function effectiveSetForMessage(context, messageElement) {
    const settings = ensureSettings(context);
    const avatar = messageAuthorAvatar(context, messageElement);
    return buildScopedEffectiveSet(settings.packs, {
        global: settings.enabledPackNames,
        character: avatar
            ? getCharacterScopeForAvatar(context, avatar)
            : getCurrentCharacterScope(context),
        chat: getChatScope(context),
    });
}

/**
 * @param {any} context
 * @param {Element} messageElement
 * @returns {boolean}
 */
function isSkippedMessage(context, messageElement) {
    const settings = ensureSettings(context);
    if (messageElement.getAttribute('is_user') === 'true' && !settings.renderUserMessages) {
        return true;
    }
    if (messageElement.getAttribute('is_system') === 'true') {
        return true;
    }
    // Narrator lines stay raw. Reasoning is rendered outside `.mes_text`, so it
    // is already out of reach.
    return messageElement.getAttribute('type') === 'narrator';
}

/**
 * Replace raw `<tag>pack:label</tag>` elements. This form only reaches the DOM
 * when SillyTavern is configured not to encode tags; the entity-escaped form
 * arrives as ordinary text and is handled by the text-node pass below.
 *
 * @param {Element} textElement
 * @param {import('../core/effective-set.js').EffectiveSet} effectiveSet
 * @param {string} tagName
 * @returns {number}
 */
function renderStickerElements(textElement, effectiveSet, tagName) {
    const elements = textElement.querySelectorAll(tagName);
    const misses = [];
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
        );
        if (!html) {
            element.remove();
            continue;
        }
        replaceWithHtml(element, html);
        rewritten += 1;
    }

    logMisses(misses);
    return rewritten;
}

/**
 * Replace tokens inside the text nodes of a rendered message.
 *
 * @param {Element} textElement
 * @param {import('../core/effective-set.js').EffectiveSet} effectiveSet
 * @param {string} tagName
 * @returns {number}
 */
function renderTextNodes(textElement, effectiveSet, tagName) {
    const hints = tokenPrefixes(tagName).map((prefix) => prefix.toLowerCase());
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
        const { html, misses } = renderText(node.data, effectiveSet, { tagName });
        logMisses(misses);
        if (html === node.data) {
            continue;
        }
        replaceWithHtml(node, html);
        rewritten += 1;
    }
    return rewritten;
}

/**
 * Replace tokens inside one rendered message. Idempotent: once a token is
 * replaced the markup is gone, so re-running touches nothing.
 *
 * @param {any} context
 * @param {Element} messageElement
 * @returns {number} Number of places that were rewritten.
 */
export function renderMessageElement(context, messageElement) {
    if (!messageElement || isSkippedMessage(context, messageElement)) {
        return 0;
    }

    const textElement = messageElement.querySelector('.mes_text');
    if (!textElement) {
        return 0;
    }

    const effectiveSet = effectiveSetForMessage(context, messageElement);
    const tagName = ensureSettings(context).stickerTag;
    let rewritten = renderStickerElements(textElement, effectiveSet, tagName);
    rewritten += renderTextNodes(textElement, effectiveSet, tagName);
    return rewritten;
}

/**
 * @param {any} context
 */
export function processAllMessages(context) {
    const chatElement = document.getElementById('chat');
    if (!chatElement) {
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
    const chat = liveContext(context)?.chat;
    if (!chatElement || !Array.isArray(chat)) {
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
 * @param {any} context
 */
export function installRendering(context) {
    const { eventSource, eventTypes } = context;
    allowStickerTag(ensureSettings(context).stickerTag);

    eventSource.on(eventTypes.CHARACTER_MESSAGE_RENDERED, (messageId) => {
        renderMessageById(context, messageId);
    });
    eventSource.on(eventTypes.MESSAGE_UPDATED, (messageId) => {
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
