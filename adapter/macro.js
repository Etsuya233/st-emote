import { buildScopedEffectiveSet } from '../core/effective-set.js';
import { buildListing } from '../core/listing.js';
import { LOG_PREFIX } from './rendering.js';
import { ensureSettings } from './settings.js';
import { getChatScope, getCurrentCharacterScope, liveContext } from './scope.js';

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
    const locale = liveContext(context)?.getCurrentLocale?.() ?? 'en';
    return buildListing(effectiveSet, { mode, locale });
}

const MACRO_DESCRIPTION = 'Lists the stickers available to the current scopes, one row per sticker.';
const MACRO_RETURNS = 'One "pack:label" row per sticker. With "simple" it prints bare labels. An empty set prints the word for "none".';
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
    if (context.macros?.register) {
        context.macros.register(MACRO_NAME, {
            category: 'utility',
            unnamedArgs: [
                {
                    name: 'mode',
                    optional: true,
                    defaultValue: 'full',
                    description: 'Listing mode: "simple" prints bare labels, "full" prints "pack:label".',
                    sampleValue: 'simple',
                },
            ],
            description: MACRO_DESCRIPTION,
            returns: MACRO_RETURNS,
            exampleUsage: MACRO_EXAMPLES,
            handler: ({ unnamedArgs }) => expandListing(context, unnamedArgs?.[0]),
        });
    }

    if (context.powerUserSettings?.experimental_macro_engine === true) {
        return;
    }
    if (typeof context.registerMacro !== 'function') {
        console.warn(`${LOG_PREFIX} no macro API available; {{${MACRO_NAME}}} will not expand.`);
        return;
    }
    context.registerMacro(MACRO_NAME, () => expandListing(context, 'full'), MACRO_DESCRIPTION);
}
