import { installMacro } from './adapter/macro.js';
import { installRendering } from './adapter/render-path.js';
import { rerenderChat } from './adapter/rendering.js';
import { ensureSettings } from './adapter/settings.js';
import { stopRendering, resumeRendering } from './adapter/restore.js';
import { mountSettingsPanel } from './adapter/ui.js';

const context = SillyTavern.getContext();

ensureSettings(context);
installMacro(context);

jQuery(() => {
    mountSettingsPanel(context);
    installRendering(context);
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
 */
export function onEnable() {
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
