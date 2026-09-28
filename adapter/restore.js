/**
 * Turning the extension off without leaving the chat dirty.
 *
 * Disabling an extension from SillyTavern's own panel does *not* reload the
 * page, so the live DOM still holds whatever we put there. Restoring is
 * therefore not a page-reload side effect but a step the extension performs on
 * the way out: every image we inserted goes back to the marker it replaced.
 *
 * The rule is the pure core's (`TOKEN_ATTRIBUTE` in `core/render.js`); this is
 * the DOM half, so the string and DOM paths restore the same text. Note the
 * marker, not the settings: restoring must not depend on the packs still being
 * enabled, or a token that was rendered would come back as a miss.
 */

import { STICKER_CLASS, TOKEN_ATTRIBUTE } from '../core/render.js';
import { LOG_PREFIX } from './render-common.js';
import { liveContext } from './scope.js';

/**
 * Put the marker text back where one message's sticker images are.
 *
 * @param {Element} messageElement
 * @returns {number} Number of images that were put back.
 */
export function restoreMessageElement(messageElement) {
    const textElement = messageElement?.querySelector('.mes_text');
    if (!textElement) {
        return 0;
    }
    const images = Array.from(textElement.querySelectorAll(`img.${STICKER_CLASS}[${TOKEN_ATTRIBUTE}]`));
    for (const image of images) {
        image.replaceWith(document.createTextNode(image.getAttribute(TOKEN_ATTRIBUTE)));
    }
    return images.length;
}

/**
 * Put every rendered message's markers back.
 *
 * Iterating the DOM rather than the chat is deliberate. A message can be on
 * screen without being in `context.chat` — a streaming preview, a message the
 * user has not sent yet — and those need restoring just as much. Anything the
 * DOM does not show was never rendered, so there is nothing to undo.
 *
 * @param {any} [context]
 * @returns {number} Number of images that were put back.
 */
export function restoreMessageText(context) {
    const chatElement = document.getElementById('chat');
    if (!chatElement) {
        return 0;
    }
    let restored = 0;
    chatElement.querySelectorAll('.mes').forEach((messageElement) => {
        restored += restoreMessageElement(messageElement);
    });
    return restored;
}

/**
 * Re-render each message from its source text, which is the client's own job and
 * gives back the message exactly as it was written.
 *
 * This is the faithful half of the restore, and it is what puts a 块后 or
 * 消息末尾 image's marker back *inside* its paragraph: swapping the image for
 * its marker in place can only put it back where the image now is, and a
 * relocated image is no longer where the model wrote it. The source text has the
 * position; the DOM does not.
 *
 * The hook is already a pass-through by the time this runs, so a message
 * restitched this way comes back with its raw markers on the hook path too.
 *
 * @param {any} [context]
 * @returns {number} Number of messages re-rendered.
 */
function restitchMessages(context) {
    const chatElement = document.getElementById('chat');
    const chat = context?.chat;
    if (!chatElement || !Array.isArray(chat) || typeof context.updateMessageBlock !== 'function') {
        return 0;
    }
    let restitched = 0;
    for (const messageElement of chatElement.querySelectorAll('.mes')) {
        const messageId = Number(messageElement.getAttribute('mesid'));
        const message = Number.isInteger(messageId) && messageId >= 0 ? chat[messageId] : null;
        if (!message) {
            continue;
        }
        try {
            context.updateMessageBlock(messageId, message);
            restitched += 1;
        } catch (error) {
            console.error(`${LOG_PREFIX} failed to restore message ${messageId}`, error);
        }
    }
    return restitched;
}

/**
 * Whether the extension is currently rendering, tracked so the way out knows
 * whether there is anything to undo. Held here rather than in the render paths
 * because both of them need it: the DOM path stops walking the chat, and the
 * hook path stops rewriting messages.
 */
let renderingEnabled = true;

/**
 * @returns {boolean}
 */
export function isRenderingEnabled() {
    return renderingEnabled;
}

/**
 * Turn rendering off and put the chat back the way it was.
 *
 * The flag goes first, so nothing re-renders a sticker while the undo is running
 * and nothing puts an image back after it. Then the two halves of the restore,
 * faithful first: re-render the messages the chat knows about from their source
 * text, then swap any image left over — a streaming preview, a message the chat
 * has no entry for — back to its marker.
 *
 * @param {any} [context]
 * @returns {number} Number of images that were put back.
 */
export function stopRendering(context) {
    renderingEnabled = false;
    const live = liveContext(context) ?? context;
    restitchMessages(live);
    return restoreMessageText(live);
}

/**
 * Turn rendering back on. Repainting is the caller's business, because only one
 * of the two paths needs it: the DOM path's images are gone and only a re-render
 * brings them back, while the hook path repaints itself on the next message the
 * client formats.
 */
export function resumeRendering() {
    renderingEnabled = true;
}
