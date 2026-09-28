/**
 * The official-hook render path: SillyTavern 1.19.0 and newer, where
 * `messageFormatter.addHook` lets a message be rewritten as a string before the
 * client sanitizes it.
 *
 * The path exists so 1.15.0–1.18.x users see the same stickers as everyone else
 * (ADR-0002). Two things make that true, and both are load-bearing:
 *
 * - The class name is emitted **un-prefixed** (`st-emote`) and the sanitizer
 *   adds `custom-`, landing on exactly the name the DOM path writes itself. One
 *   name, one stylesheet. See `STICKER_CLASS` in `core/render.js`.
 * - The engine is the pure core's `renderHtml`, the same function the DOM path
 *   is built on, so token forms, 命中规则, 未命中, 投放方式 and 尺寸 cannot differ
 *   between the two. What differs is only this file: how the string gets made
 *   and how the message's facts are read.
 */

import { STICKER_HOOK_CLASS, renderHtml, supportsMessageFormatter } from '../core/render.js';
import {
    effectiveSetForMessage,
    isInScope,
    renderOptions,
    reportResult,
} from './render-common.js';
import { isRenderingEnabled } from './restore.js';
import { liveContext } from './scope.js';

/**
 * Build the hook SillyTavern calls for every message it formats.
 *
 * Synchronous and string-returning, which is the only shape the hook accepts.
 * Nothing here may be async and nothing here may touch the DOM: the hook runs
 * before the message exists as nodes, and the DOM path is the thing that runs
 * after.
 *
 * @param {any} context
 * @returns {(message: string, hookContext: any) => string}
 */
export function createMessageFormatterHook(context) {
    return function stEmoteMessageFormatterHook(message, hookContext) {
        // The extension is off. Returning the message untouched is what puts the
        // raw markers back on every future message; the undo of what is already
        // on screen is `restoreMessageText`'s job.
        if (!isRenderingEnabled()) {
            return message;
        }
        if (!isInScope(context, messageFactsFromHook(hookContext))) {
            return message;
        }

        const messageId = Number(hookContext?.messageId);
        const effectiveSet = effectiveSetForMessage(context, Number.isInteger(messageId) ? messageId : -1);
        // The un-prefixed name: the sanitizer adds `custom-` to it, which is how
        // this path arrives at the same `custom-st-emote` the DOM path writes.
        const options = renderOptions(context, { className: STICKER_HOOK_CLASS });

        const result = renderHtml(message, effectiveSet, options);
        reportResult(result, 0);
        return result.html;
    };
}

/**
 * The 处理范围 facts the hook path reads off the hook context. The context is
 * frozen and carries the same distinctions the DOM element does, so both paths
 * hand the pure core's one rule the same shape of answer.
 *
 * @param {any} hookContext
 * @returns {{isUser: boolean, isSystem: boolean, isNarrator: boolean, isReasoning: boolean}}
 */
function messageFactsFromHook(hookContext) {
    return {
        isUser: hookContext?.isUser === true,
        isSystem: hookContext?.isSystem === true,
        // The context has no narrator flag of its own; a narrator line reaches
        // us as a system message, which the rule already excludes.
        isNarrator: false,
        isReasoning: hookContext?.isReasoning === true,
    };
}

/**
 * Install the official-hook path.
 *
 * @param {any} context
 * @returns {boolean} Whether the hook was installed.
 */
export function installHookRendering(context) {
    const live = liveContext(context);
    const messageFormatter = live?.messageFormatter;
    if (!supportsMessageFormatter(messageFormatter)) {
        return false;
    }
    messageFormatter.addHook(createMessageFormatterHook(context), {
        stage: messageFormatter.stage.AFTER_MARKDOWN,
        order: messageFormatter.order.EARLY,
    });
    return true;
}
