import { buildEffectiveSet } from '../core/effective-set.js';
import { STICKER_CLASS, renderText } from '../core/render.js';
import { ensureSettings } from './settings.js';

export const LOG_PREFIX = '[st-emote]';

function describeMiss(miss) {
    const qualified = miss.packName ? `${miss.packName}:${miss.label}` : miss.label;
    return `${LOG_PREFIX} sticker not rendered (${miss.reason}): ${qualified}`;
}

/**
 * Build the effective set from the current global scope.
 *
 * @param {any} context
 * @returns {import('../core/effective-set.js').EffectiveSet}
 */
function buildResolver(context) {
    const settings = ensureSettings(context);
    return buildEffectiveSet(settings.packs, settings.enabledPackNames);
}

/**
 * @param {Element} messageElement
 * @returns {boolean}
 */
function isSkippedMessage(messageElement) {
    if (messageElement.getAttribute('is_user') === 'true') {
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
 * Replace tokens inside one rendered message. Idempotent: once a token is
 * replaced the text is gone, so re-running touches nothing.
 *
 * @param {any} context
 * @param {Element} messageElement
 * @returns {number} Number of text nodes that were rewritten.
 */
export function renderMessageElement(context, messageElement) {
    if (!messageElement || isSkippedMessage(messageElement)) {
        return 0;
    }

    const textElement = messageElement.querySelector('.mes_text');
    if (!textElement) {
        return 0;
    }

    const effectiveSet = buildResolver(context);
    const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.data || node.data.indexOf('[[sticker:') === -1) {
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
        const { html, misses } = renderText(node.data, effectiveSet);
        for (const miss of misses) {
            console.info(describeMiss(miss));
        }
        if (html === node.data) {
            continue;
        }
        const template = document.createElement('template');
        template.innerHTML = html;
        node.replaceWith(template.content);
        rewritten += 1;
    }
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
    if (!chatElement || !Array.isArray(context.chat)) {
        return;
    }
    chatElement.querySelectorAll('.mes').forEach((messageElement) => {
        const messageId = Number(messageElement.getAttribute('mesid'));
        const message = Number.isInteger(messageId) ? context.chat[messageId] : null;
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
