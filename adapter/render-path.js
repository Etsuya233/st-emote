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
import { allowStickerTag, installDomRendering, processAllMessages } from './rendering.js';
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
    allowStickerTag(ensureSettings(context).stickerTag);
    if (selectRenderPath(context) === 'hook' && installHookRendering(context)) {
        activePath = 'hook';
        return activePath;
    }
    activePath = 'dom';
    installDomRendering(context);
    processAllMessages(context);
    return activePath;
}
