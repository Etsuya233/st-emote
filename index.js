import { installMacro } from './adapter/macro.js';
import { installRendering, processAllMessages } from './adapter/rendering.js';
import { ensureSettings } from './adapter/settings.js';
import { mountSettingsPanel } from './adapter/ui.js';

const context = SillyTavern.getContext();

ensureSettings(context);
installMacro(context);

jQuery(() => {
    mountSettingsPanel(context);
    installRendering(context);
    processAllMessages(context);
});
