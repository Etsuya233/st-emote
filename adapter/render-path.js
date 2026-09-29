/**
 * Picking one render path.
 *
 * Two paths exist because the client only grew the official hook in 1.19.0
 * (ADR-0002), and the supported floor is 1.15.0. The choice is made by feature
 * detection on the one API the hook path needs, not by parsing a version: a
 * client that has `messageFormatter.addHook` gets the hook path, anything else
 * gets the DOM path, and neither has to know what the other does.
 *
 * Exactly one is installed. Installing both would render every token twice on
 * any client that has the hook, and the two would then fight over placement —
 * the hook path relocates in the string, the DOM path relocates in the nodes.
 */

import { supportsMessageFormatter } from '../core/render.js';
import { installHookRendering } from './hook.js';
import {
    allowStickerTag,
    installDomRendering,
    installStickerImageGuard,
    processAllMessages,
    rerenderChat,
} from './rendering.js';
import { resumeRendering, stopRendering } from './restore.js';
import { ensureSettings } from './settings.js';
import { liveContext } from './scope.js';

/** The installed path, so a second call is a no-op rather than a double install. */
let activePath = null;

/**
 * Which path this client gets.
 *
 * @param {any} context
 * @returns {'hook'|'dom'}
 */
export function selectRenderPath(context) {
    const live = liveContext(context) ?? context;
    return supportsMessageFormatter(live?.messageFormatter) ? 'hook' : 'dom';
}

/**
 * Install whichever path this client supports, and paint the messages already on
 * screen.
 *
 * Only the DOM path has messages to paint: the hook path runs inside the
 * client's own formatting, so a message drawn while the extension was active
 * already went through the hook, and a message drawn afterwards will too.
 *
 * The DOM path is also the fallback. A client that advertises `addHook` but
 * refuses the call is not a client this extension can do nothing about — the DOM
 * path works on every version from the floor up, including that one. So the
 * decision is "prefer the hook", not "require the hook".
 *
 * Idempotent, because the entry point and the enable hook can both reach this —
 * the client imports the module to call `onEnable`, and the module's own
 * ready-callback also installs. A second install would subscribe every event
 * twice and render every message twice.
 *
 * @param {any} context
 * @returns {'hook'|'dom'}
 */
export function installRendering(context) {
    if (activePath) {
        return activePath;
    }
    // Both paths need this. The hook path consumes a raw `<sticker>…</sticker>`
    // before the sanitizer runs, so a token it *skips* — an out-of-scope message,
    // or one inside a code block — would otherwise be stripped by DOMPurify,
    // while the DOM path would have shown it. Installing it on both is what
    // keeps "out of scope" looking the same on either client.
    //
    // And it is conditional on the form being on, which is the same property
    // arriving from the other side: with the form off nothing renders it on
    // either path, so leaving the hole open would preserve a `<sticker>` element
    // that no pass would ever touch. The two paths then agree on "not handled"
    // for the wrong reason *and* the right one (ADR-0002).
    const settings = ensureSettings(context);
    allowStickerTag(settings.tagForm ? settings.stickerTag : null);
    // Shared by both paths, so a sticker image that cannot be drawn — a file
    // that never arrived, a 外链 that has gone dead — is taken out of the chat
    // and logged on either client.
    installStickerImageGuard();
    if (selectRenderPath(context) === 'hook' && installHookRendering(context)) {
        activePath = 'hook';
        return activePath;
    }
    activePath = 'dom';
    installDomRendering(context);
    processAllMessages(context);
    return activePath;
}

/**
 * The 总开关: this extension's own on/off, as the single entry point the panel's
 * checkbox and `/st-emote on|off` both go through.
 *
 * **It is not a third gate.** `stopRendering` / `resumeRendering` are already
 * the mechanism SillyTavern's own enable and disable hooks use, and the way out
 * they perform is the one this needs too: the page is not reloading, so turning
 * the switch off has to put the markers back itself rather than wait for a
 * refresh. That is also what makes the two switches independent — ST's switch
 * and this one both move the same flag, so whichever was used last decides the
 * state and the other one finds it already right.
 *
 * Turning it *on* installs the path as well as flipping the flag, because the
 * extension may have loaded with the switch off and therefore never installed
 * anything; `installRendering` is idempotent, so doing it again on the way out
 * of a normal disable is a no-op.
 *
 * @param {any} context
 * @param {boolean} enabled
 * @returns {boolean} The state now in force.
 */
export function setEnabled(context, enabled) {
    ensureSettings(context).enabled = enabled;
    if (enabled) {
        resumeRendering();
        installRendering(context);
        rerenderChat(context);
    } else {
        stopRendering(context);
    }
    return enabled;
}

/**
 * Read the 总开关 without changing anything. The entry point asks this before
 * installing, so a client that loads with the switch off never subscribes to
 * anything — the subscription outliving a disable is the very thing
 * `adapter/restore.js` exists to guard against, and not subscribing at all is
 * stronger than guarding.
 *
 * @param {any} context
 * @returns {boolean}
 */
export function isEnabled(context) {
    return ensureSettings(context).enabled;
}
