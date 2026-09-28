/**
 * Talking to the user: a toast, a confirmation, a line of text, the clipboard.
 *
 * Every one of these has a preferred path through the client's own UI and a
 * fallback for a client that does not offer it, because the panel has to work on
 * every version from the floor up and cannot assume a popup API exists. Keeping
 * the two paths side by side in one place is what stops "the confirm shows on
 * 1.18 but silently does nothing on 1.15" from being a per-call-site surprise.
 */

import { logInfo } from './log.js';
import { liveContext } from './scope.js';

/**
 * @param {'success'|'warning'|'error'} kind
 * @param {string} message
 */
export function toast(kind, message) {
    const toastr = globalThis.window?.toastr;
    if (toastr && typeof toastr[kind] === 'function') {
        toastr[kind](message, 'st-emote');
        return;
    }
    logInfo(message);
}

/**
 * Ask the user to confirm something.
 *
 * `context` is read through `liveContext`: the context captured when the
 * extension loaded can be stale, and the client's popup helpers are exactly the
 * kind of thing a rebound context replaces.
 *
 * @param {any} context
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export async function confirmWithUser(context, message) {
    const live = liveContext(context);
    const popup = live?.callGenericPopup;
    if (typeof popup === 'function' && live?.POPUP_TYPE?.CONFIRM) {
        const result = await popup.call(live, message, live.POPUP_TYPE.CONFIRM);
        return result === (live.POPUP_RESULT?.AFFIRMATIVE ?? 1);
    }
    return globalThis.confirm?.(message) === true;
}

/**
 * Ask the user for a line of text. Null means they cancelled.
 *
 * @param {any} context
 * @param {string} message
 * @param {string} [defaultValue]
 * @returns {Promise<string|null>}
 */
export async function askForText(context, message, defaultValue = '') {
    const live = liveContext(context);
    const popup = live?.callGenericPopup;
    if (typeof popup === 'function' && live?.POPUP_TYPE?.INPUT) {
        const result = await popup.call(live, message, live.POPUP_TYPE.INPUT, defaultValue);
        return typeof result === 'string' ? result : null;
    }
    const answer = globalThis.prompt?.(message, defaultValue);
    return answer === null ? null : answer;
}

/**
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
}
