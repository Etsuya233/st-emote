/**
 * What the two render paths need in common.
 *
 * The paths differ in exactly one step — how the result reaches the DOM — so
 * everything before it (settings, 生效集, 处理范围) and the logging after it
 * live here and are shared. If either path grew its own copy of one of these,
 * "the paths behave identically" would be a claim nothing kept true.
 */

import { buildScopedEffectiveSet } from '../core/effective-set.js';
import { shouldRenderMessage } from '../core/processing-scope.js';
import { ensureSettings } from './settings.js';
import {
    getCharacterScopeForAvatar,
    getChatScope,
    getCurrentCharacterScope,
    liveContext,
} from './scope.js';

export const LOG_PREFIX = '[st-emote]';

/**
 * The 投放方式 and 尺寸 configuration, as plain data for the pure core.
 *
 * @param {any} context
 * @param {{className?: string}} [options] - `className` is what separates the
 *   two paths: the DOM path takes the default final name, the hook path passes
 *   the un-prefixed one and lets the sanitizer add the prefix.
 * @returns {import('../core/render.js').RenderOptions}
 */
export function renderOptions(context, options = {}) {
    const settings = ensureSettings(context);
    return {
        tagName: settings.stickerTag,
        placement: settings.placement,
        sizes: settings.sizes,
        className: options.className,
    };
}

/**
 * The avatar of whoever authored one message. Group chats store the author on
 * the message itself, so each message resolves its own 作用域. Single-character
 * messages carry the same field after generation.
 *
 * @param {any} context
 * @param {number} messageId
 * @returns {string|null}
 */
export function messageAuthorAvatar(context, messageId) {
    const chat = liveContext(context)?.chat;
    if (!Number.isInteger(messageId) || messageId < 0 || !Array.isArray(chat)) {
        return null;
    }
    return chat[messageId]?.original_avatar ?? null;
}

/**
 * The 生效集 for one message: the union of the global scope, the author's
 * character scope and the chat scope.
 *
 * @param {any} context
 * @param {number} messageId - `-1` for a streaming preview that has no entry in
 *   the chat yet, which falls back to the selected character.
 * @returns {import('../core/effective-set.js').EffectiveSet}
 */
export function effectiveSetForMessage(context, messageId) {
    const settings = ensureSettings(context);
    const avatar = messageAuthorAvatar(context, messageId);
    return buildScopedEffectiveSet(settings.packs, {
        global: settings.enabledPackNames,
        character: avatar
            ? getCharacterScopeForAvatar(context, avatar)
            : getCurrentCharacterScope(context),
        chat: getChatScope(context),
    });
}

/**
 * Whether one message is in scope for rendering, given the facts the path could
 * read. The rule itself is the pure core's; the two paths only differ in where
 * they read the facts from.
 *
 * @param {any} context
 * @param {{isUser?: boolean, isSystem?: boolean, isReasoning?: boolean}} facts
 * @returns {boolean}
 */
export function isInScope(context, facts) {
    return shouldRenderMessage(facts, ensureSettings(context));
}

/**
 * @param {import('../core/render.js').Miss[]} misses
 */
export function logMisses(misses) {
    for (const miss of misses) {
        const qualified = miss.packName ? `${miss.packName}:${miss.label}` : miss.label;
        console.info(`${LOG_PREFIX} sticker not rendered (${miss.reason}): ${qualified}`);
    }
}

/**
 * @param {import('../core/size.js').InvalidSize[]} invalidSizes
 */
export function logInvalidSizes(invalidSizes) {
    for (const entry of invalidSizes) {
        console.info(`${LOG_PREFIX} size value ignored, treated as unset: ${entry.field} = "${entry.value}"`);
    }
}

/**
 * Log everything one render pass produced and return the count of rewritten
 * places, so a caller can tell "did work" from "already done".
 *
 * @param {{misses: import('../core/render.js').Miss[], invalidSizes: import('../core/size.js').InvalidSize[]}} result
 * @param {number} rewritten
 * @returns {number}
 */
export function reportResult(result, rewritten) {
    logMisses(result.misses);
    logInvalidSizes(result.invalidSizes);
    return rewritten;
}
