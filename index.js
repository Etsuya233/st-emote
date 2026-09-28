import { installRendering, processAllMessages } from './adapter/rendering.js';
import { ensureSettings } from './adapter/settings.js';
import { mountSettingsPanel } from './adapter/ui.js';

const context = SillyTavern.getContext();

ensureSettings(context);

jQuery(() => {
    mountSettingsPanel(context);
    installRendering(context);
    processAllMessages(context);
});
