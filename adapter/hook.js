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
    isNarratorMessage,
    logRenderResult,
    renderOptions,
} from './render-common.js';
import { isRenderingEnabled } from './restore.js';
import { logError } from './log.js';
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

        const messageId = Number.isInteger(Number(hookContext?.messageId)) ? Number(hookContext.messageId) : -1;
        if (!isInScope(context, messageFactsFromHook(context, hookContext, messageId))) {
            return message;
        }

        const effectiveSet = effectiveSetForMessage(context, messageId);
        // The un-prefixed name: the sanitizer adds `custom-` to it, which is how
        // this path arrives at the same `custom-st-emote` the DOM path writes.
        const options = renderOptions(context, { className: STICKER_HOOK_CLASS });

        const result = renderHtml(message, effectiveSet, options);
        logRenderResult(result);
        return result.html;
    };
}

/**
 * The 处理范围 facts the hook path can read.
 *
 * The context is frozen and carries the same distinctions the DOM element does,
 * so both paths hand the pure core's one rule the same shape of answer. The one
 * it does not carry is 旁白, which is read from the chat instead — see
 * `isNarratorMessage`.
 *
 * @param {any} context
 * @param {any} hookContext
 * @param {number} messageId
 * @returns {{isUser: boolean, isSystem: boolean, isNarrator: boolean, isReasoning: boolean}}
 */
function messageFactsFromHook(context, hookContext, messageId) {
    return {
        isUser: hookContext?.isUser === true,
        isSystem: hookContext?.isSystem === true,
        isNarrator: isNarratorMessage(context, messageId),
        isReasoning: hookContext?.isReasoning === true,
    };
}

/**
 * The registration options, built from whatever the formatter actually exposes.
 *
 * The hook's own default stage is already `afterMarkdown` — which is the stage
 * this path needs, the one before the sanitizer — so a client that has `addHook`
 * but not the enums still gets correct placement, just at the default order
 * rather than early. Better that than refusing to work, or throwing on the way
 * to a path that would.
 *
 * @param {any} messageFormatter
 * @returns {{stage?: string, order?: number}}
 */
function hookOptions(messageFormatter) {
    const options = {};
    if (messageFormatter?.stage?.AFTER_MARKDOWN) {
        options.stage = messageFormatter.stage.AFTER_MARKDOWN;
    }
    if (Number.isFinite(messageFormatter?.order?.EARLY)) {
        options.order = messageFormatter.order.EARLY;
    }
    return options;
}

/**
 * Install the official-hook path.
 *
 * Never throws. `addHook` is the feature we detect on, but a client that has it
 * with a different signature must not take the whole extension down with it —
 * so a failure is logged and reported, and the caller falls back to the DOM
 * path, which works on every version from the floor up.
 *
 * @param {any} context
 * @returns {boolean} Whether the hook was installed.
 */
export function installHookRendering(context) {
    const messageFormatter = liveContext(context)?.messageFormatter;
    if (!supportsMessageFormatter(messageFormatter)) {
        return false;
    }
    try {
        messageFormatter.addHook(createMessageFormatterHook(context), hookOptions(messageFormatter));
        return true;
    } catch (error) {
        logError('could not install the message formatter hook', error);
        return false;
    }
}
