/**
 * 处理范围 (Processing scope), from `CONTEXT.md`: which messages the extension
 * renders at all. One rule, two render paths — the official-hook path reads the
 * facts off the frozen hook context, the DOM path off the message element's
 * attributes, and both hand them here. The paths can only agree about
 * 系统 / 旁白 / 思考链 / 用户消息 if the decision itself is not duplicated per
 * path.
 *
 * Not to be confused with 作用域 (Scope), which decides *which 表情包* are
 * available. That is `core/effective-set.js`.
 */

/**
 * @typedef {Object} MessageFacts
 * @property {boolean} [isUser] - The user wrote it.
 * @property {boolean} [isSystem] - A system message.
 * @property {boolean} [isNarrator] - A narrator line.
 * @property {boolean} [isReasoning] - Part of the reasoning chain.
 */

/**
 * @typedef {Object} ProcessingScope
 * @property {boolean} [renderUserMessages] - Whether user messages are
 *   rendered too. Off by default, so a marker the user typed by hand is left
 *   alone.
 */

/**
 * Whether tokens in one message should be rendered.
 *
 * System messages, narrator lines and the reasoning chain are never touched: the
 * reasoning chain is rendered outside the message body anyway, so passing it
 * here is belt and braces rather than the only guard. User messages are opt-in.
 *
 * @param {MessageFacts} facts
 * @param {ProcessingScope} [scope]
 * @returns {boolean}
 */
export function shouldRenderMessage(facts, scope = {}) {
    if (facts?.isSystem || facts?.isNarrator || facts?.isReasoning) {
        return false;
    }
    if (facts?.isUser && scope?.renderUserMessages !== true) {
        return false;
    }
    return true;
}
