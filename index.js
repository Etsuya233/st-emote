import { installCommands } from './adapter/commands.js';
import { installMacro } from './adapter/macro.js';
import { installRendering, isEnabled } from './adapter/render-path.js';
import { rerenderChat } from './adapter/rendering.js';
import { ensureSettings } from './adapter/settings.js';
import { stopRendering, resumeRendering } from './adapter/restore.js';
import { mountSettingsPanel } from './adapter/ui.js';

const context = SillyTavern.getContext();

ensureSettings(context);
installMacro(context);

jQuery(() => {
    mountSettingsPanel(context);
    // Registered inside the ready-callback rather than at load: the command
    // parser is one of the things the client builds while it is starting, and a
    // registration that found it half-built would be a silently missing command.
    installCommands(context);
    // The 总开关 is honoured here, not left to the flag alone: a client that
    // loads with it off should never subscribe to a single chat event. The
    // event subscriptions outlive a disable — which is why `adapter/restore.js`
    // gates every pass on the flag — and not subscribing at all is stronger
    // than gating.
    if (isEnabled(context)) {
        installRendering(context);
    }
});

/**
 * SillyTavern's enable hook. Reached when the user turns the extension back on
 * from the extensions panel, which then asks for a reload.
 *
 * The panel import *is* the install, so by the time this runs the path is already
 * in place; re-installing is a no-op. What it has to do is flip the flag back
 * and repaint, so the extension is usable even if the user declines the reload.
 * Scheduling that through jQuery puts it after the module's own ready-callback,
 * which is registered first and so runs first.
 *
 * **It asks the 总开关, which is what makes the two switches independent.** This
 * hook speaks about SillyTavern's extension switch, which is a different fact
 * from ours, so re-enabling here returns the extension to whatever
 * `settings.enabled` says rather than blindly resuming. Without that check the
 * two are entangled in the worst direction: a user who turned the 总开关 off and
 * then toggles the extension off and on in SillyTavern's own panel would come
 * back to a st-emote that renders, with the switch still reading off.
 */
export function onEnable() {
    if (!isEnabled(context)) {
        // Deliberately no `resumeRendering()`: the 总开关 shares the one flag
        // with this hook, and the 总开关 is the one that is off. The chat is
        // already back to its markers — the switch put it there when it was
        // flipped — and any subscriptions the path installed are gated on that
        // same flag, so nothing renders until the user turns the switch on.
        return;
    }
    resumeRendering();
    jQuery(() => {
        installRendering(context);
        rerenderChat(context);
    });
}

/**
 * SillyTavern's disable hook.
 *
 * Disabling from the panel does not reload the page, so without this the chat
 * would keep showing stickers from a disabled extension until the next reload —
 * and, on the hook path, keep *producing* them, because the hook stays
 * registered either way. `stopRendering` turns the hook into a pass-through and
 * puts every already-rendered image back to its marker.
 */
export function onDisable() {
    stopRendering(context);
}
