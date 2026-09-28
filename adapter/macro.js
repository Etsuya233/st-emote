import { buildScopedEffectiveSet } from '../core/effective-set.js';
import { t } from '../core/i18n.js';
import { buildListing } from '../core/listing.js';
import { currentLocale } from './locale.js';
import { logInfo } from './log.js';
import { ensureSettings } from './settings.js';
import { getChatScope, getCurrentCharacterScope } from './scope.js';

/** Macro the user writes in their own preset to get the sticker listing. */
export const MACRO_NAME = 'st-emote';

/**
 * Expand the listing for the scopes active right now. Evaluated on every prompt
 * build, so enabling a pack needs no refresh step.
 *
 * @param {any} context
 * @param {unknown} mode
 * @returns {string}
 */
export function expandListing(context, mode) {
    const settings = ensureSettings(context);
    const effectiveSet = buildScopedEffectiveSet(settings.packs, {
        global: settings.enabledPackNames,
        character: getCurrentCharacterScope(context),
        chat: getChatScope(context),
    });
    return buildListing(effectiveSet, { mode, locale: currentLocale(context) });
}

const MACRO_EXAMPLES = ['{{st-emote}}', '{{st-emote::simple}}', '{{st-emote::full}}'];

/**
 * Register the listing macro.
 *
 * The argument-capable engine (ST 1.15+) is registered whenever it is present,
 * so `{{st-emote::simple}}` keeps working even if the user later flips the
 * experimental-engine switch on. When that switch is off, prompt substitution
 * runs through the legacy parser instead, so a no-argument registration is
 * added there too.
 *
 * @param {any} context
 */
export function installMacro(context) {
    // The macro's own description is documentation, not interface: the client
    // shows it in its macro help, which the user reads in whatever language the
    // client is in, so it comes from the same catalog as the panel. Read once —
    // a locale change reloads the page, so it cannot go stale underneath us.
    const locale = currentLocale(context);

    if (context.macros?.register) {
        context.macros.register(MACRO_NAME, {
            category: 'utility',
            unnamedArgs: [
                {
                    name: 'mode',
                    optional: true,
                    defaultValue: 'full',
                    description: t('macro.modeDescription', locale),
                    sampleValue: 'simple',
                },
            ],
            description: t('macro.description', locale),
            returns: t('macro.returns', locale),
            exampleUsage: MACRO_EXAMPLES,
            handler: ({ unnamedArgs }) => expandListing(context, unnamedArgs?.[0]),
        });
    }

    if (context.powerUserSettings?.experimental_macro_engine === true) {
        return;
    }
    if (typeof context.registerMacro !== 'function') {
        logInfo(`no macro API available; {{${MACRO_NAME}}} will not expand.`);
        return;
    }
    context.registerMacro(
        MACRO_NAME,
        () => expandListing(context, 'full'),
        t('macro.description', locale),
    );
}
