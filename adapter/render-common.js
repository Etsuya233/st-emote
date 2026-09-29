/**
 * What the two render paths need in common.
 *
 * The paths differ in exactly one step — how the result reaches the DOM — so
 * everything before it (settings, 生效集, 处理范围) and the logging after it
 * live here and are shared. If either path grew its own copy of one of these,
 * "the paths behave identically" would be a claim nothing kept true.
 *
 * `restitchChat` is here for exactly that reason and is the one piece of this
 * module that *reaches into* the client: asking it to re-format a message is the
 * only repaint that works on both paths, because it re-runs the client's whole
 * formatting pipeline, and on the hook path the pipeline is what drives us.
 */

import { buildScopedEffectiveSet } from '../core/effective-set.js';
import { shouldRenderMessage } from '../core/processing-scope.js';
import { logError, logInfo } from './log.js';
import { ensureSettings } from './settings.js';
import {
    getCharacterScopeForAvatar,
    getChatScope,
    getCurrentCharacterScope,
    liveContext,
} from './scope.js';

/**
 * The client's `system_message_types.NARRATOR`, which is what marks a 旁白 line.
 *
 * The client stores it on `message.extra.type` and copies that same value onto
 * the message element's `type` attribute, so both render paths are looking for
 * the same thing — they just reach it differently.
 */
const NARRATOR_TYPE = 'narrator';

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
        // Read here rather than at each call site: one 标记 form switch has to
        // reach `core/token.js`, the DOM path's element pass and the prompt-only
        // regex, and three places reading the same two booleans is three places
        // to forget one.
        bracketForm: settings.bracketForm,
        tagForm: settings.tagForm,
        placement: settings.placement,
        sizes: settings.sizes,
        className: options.className,
    };
}

/**
 * The chat the client is actually showing.
 *
 * Always through `liveContext`, never through the context object the extension
 * captured at load: `getContext()` hands out a fresh object and rebinds `chat`
 * as the user moves around, so a captured one names the chat that was open when
 * the extension loaded. Every path that needs the message list goes through
 * here for that reason.
 *
 * @param {any} context
 * @returns {any[]|null} The messages, or null when there is no chat to read.
 */
function liveChat(context) {
    const chat = liveContext(context)?.chat;
    return Array.isArray(chat) ? chat : null;
}

/**
 * One message from the chat, or null for an id the chat does not have — a
 * streaming preview is `-1`, and anything else out of range is a client quirk
 * rather than a reason to fail.
 *
 * @param {any} context
 * @param {number} messageId
 * @returns {any|null}
 */
export function liveMessage(context, messageId) {
    const chat = liveChat(context);
    if (!chat || !Number.isInteger(messageId) || messageId < 0) {
        return null;
    }
    return chat[messageId] ?? null;
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
    return liveMessage(context, messageId)?.original_avatar ?? null;
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
 * Whether one message in the chat is a 旁白 line.
 *
 * Needed because the official hook's frozen context carries no narrator flag,
 * and `isSystem` does not cover it: the client checks `is_system` and
 * `extra.type === 'narrator'` as two separate cases in several places, so a
 * narrator line is not reliably a system message. Without this lookup a narrator
 * line would be skipped on the DOM path (which reads the `type` attribute) and
 * rendered on the hook path — exactly the divergence ADR-0002 exists to prevent.
 *
 * @param {any} context
 * @param {number} messageId - `-1` for a streaming preview, which has no entry
 *   in the chat and therefore cannot be a narrator line.
 * @returns {boolean}
 */
export function isNarratorMessage(context, messageId) {
    return liveMessage(context, messageId)?.extra?.type === NARRATOR_TYPE;
}

/**
 * Whether one message is in scope for rendering, given the facts the path could
 * read. The rule itself is the pure core's; the two paths only differ in where
 * they read the facts from.
 *
 * @param {any} context
 * @param {{isUser?: boolean, isSystem?: boolean, isNarrator?: boolean, isReasoning?: boolean}} facts
 * @returns {boolean}
 */
export function isInScope(context, facts) {
    return shouldRenderMessage(facts, ensureSettings(context));
}

/**
 * Run `visit` over every rendered message in the chat.
 *
 * One place that knows the chat is `#chat`, a message is `.mes`, and the walk is
 * over the nodes rather than the chat — a message can be on screen without being
 * in the chat at all, a streaming preview being the obvious one. Every path
 * that walks the chat walks it the same way, so they cannot disagree about what
 * "a message" is.
 *
 * @param {(messageElement: Element) => void} visit
 * @returns {number} How many messages were visited.
 */
export function eachMessageElement(visit) {
    const chatElement = document.getElementById('chat');
    if (!chatElement) {
        return 0;
    }
    const messages = chatElement.querySelectorAll('.mes');
    for (const messageElement of messages) {
        visit(messageElement);
    }
    return messages.length;
}

/**
 * Hand every message on screen back to the client to re-format.
 *
 * **This is the repaint that works on both paths**, and it is the reason the
 * function is here rather than in either path. `updateMessageBlock` re-runs the
 * client's own formatting over the message's *source text* and replaces the
 * message body with the result — and that pipeline is where the official hook
 * lives. So on ST ≥ 1.19 the stickers come back because the hook ran again, and
 * on 1.15.0–1.18.x the body is rebuilt with the raw markers in it, ready for the
 * DOM pass to pick up.
 *
 * Walking the DOM rather than the chat is the same choice `restore.js` makes and
 * for the same reason: a message can be on screen without being in the chat — a
 * streaming preview, a message not yet sent — and a repaint that skipped those
 * would leave the oldest stale image in the chat being the one nobody refreshed.
 *
 * Iterating the nodes also means the list cannot change underneath the walk: the
 * client replaces `.mes_text`, never the `.mes` element, so a `NodeList` taken
 * once stays valid. A message the chat has no entry for is simply not restitched,
 * because there is no source text to restitch it from.
 *
 * @param {any} context
 * @returns {number} How many messages were handed back.
 */
export function restitchChat(context) {
    if (typeof context?.updateMessageBlock !== 'function') {
        return 0;
    }
    let restitched = 0;
    eachMessageElement((messageElement) => {
        const messageId = Number(messageElement.getAttribute('mesid'));
        const message = liveMessage(context, messageId);
        if (!message) {
            return;
        }
        try {
            context.updateMessageBlock(messageId, message);
            restitched += 1;
        } catch (error) {
            logError(`failed to re-render message ${messageId}`, error);
        }
    });
    return restitched;
}

/**
 * @param {import('../core/render.js').Miss[]} misses
 */
function logMisses(misses) {
    for (const miss of misses) {
        const qualified = miss.packName ? `${miss.packName}:${miss.label}` : miss.label;
        logInfo(`sticker not rendered (${miss.reason}): ${qualified}`);
    }
}

/**
 * @param {import('../core/size.js').InvalidSize[]} invalidSizes
 */
function logInvalidSizes(invalidSizes) {
    for (const entry of invalidSizes) {
        logInfo(`size value ignored, treated as unset: ${entry.field} = "${entry.value}"`);
    }
}

/**
 * Log what one render pass produced: the 未命中 and the hand-typed sizes that
 * were treated as unset.
 *
 * @param {{misses: import('../core/render.js').Miss[], invalidSizes: import('../core/size.js').InvalidSize[]}} result
 */
export function logRenderResult(result) {
    logMisses(result.misses);
    logInvalidSizes(result.invalidSizes);
}
