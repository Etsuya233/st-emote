/**
 * 斜杠命令: `/st-emote …`, so the scopes and the conflict list can be worked on
 * without walking into the panel.
 *
 * One command with an action rather than four commands, because the four share
 * their vocabulary: `pack` and `scope` mean the same thing to all of them, and
 * `/st-emote enable pack=daily scope=chat` is one shape a user learns once. An
 * action nobody recognises says what it wanted rather than doing nothing
 * quietly.
 *
 * Every decision it makes belongs to the pure core — which packs a 作用域 holds
 * is `core/effective-set.js`, which labels collide is `core/conflict.js`. What is
 * here is registration, the client's argument plumbing, and the three places the
 * scopes actually live: extension settings, the character card and the chat
 * metadata. Each write goes through the same `setPackInScope` the panel's
 * checkboxes use, so a slash command and a click cannot drift apart.
 *
 * **Every result is a sentence from the catalog, never a thrown error.** A slash
 * command that throws shows the user a stack trace; one that returns a sentence
 * shows what went wrong and what to type instead. The return value doubles as
 * the STscript result, so the same string is what a script sees.
 *
 * The 冲突 list goes to the **console** behind the shared prefix, like every other
 * log this extension writes — the spec draws that line and there is no log panel
 * in the UI. The command's return value carries the report too, for the person
 * who just ran it.
 */

import { conflictLogLine, findConflicts, formatConflicts } from '../core/conflict.js';
import { findPackByName } from '../core/constraints.js';
import { setPackInScope } from '../core/effective-set.js';
import { LOG_PREFIX, logInfo } from './log.js';
import { currentLocale, tr } from './locale.js';
import { effectiveSetForMessage } from './render-common.js';
import { rerenderChat } from './rendering.js';
import { ensureSettings, setPackEnabled } from './settings.js';
import {
    getChatScope,
    getCurrentCharacter,
    getCurrentCharacterScope,
    setChatScope,
    setCurrentCharacterScope,
} from './scope.js';

/** The name the user types. */
export const COMMAND_NAME = 'st-emote';

/**
 * The 作用域 an action may name, in the order the panel offers them. That order
 * is the one the union rule is defined in (global, then character, then chat),
 * so a rejection that lists them lists them in the order they stack.
 */
export const SCOPES = ['global', 'character', 'chat'];

/** The four things the command can do. */
const ACTIONS = ['enable', 'disable', 'reload', 'conflicts'];

/** Whether the command is registered, so a second call is a no-op. */
let installed = false;

/**
 * Register `/st-emote`.
 *
 * Feature-detected, never version-checked, and a no-op when the pieces are
 * missing: a client without `SlashCommand.fromProps` is one where only the older
 * `registerSlashCommand` works, and the rest of the panel is unaffected by it.
 * What matters is that the absence is reported rather than silent — a user who
 * expects a command should not have to guess why it does nothing.
 *
 * Idempotent, because the entry point and the enable hook can both reach it.
 *
 * @param {any} context
 * @returns {boolean} Whether the command is available.
 */
export function installCommands(context) {
    if (installed) {
        return true;
    }
    if (!canRegister(context)) {
        logInfo('this client has no slash command parser; /st-emote is unavailable');
        return false;
    }
    try {
        context.SlashCommandParser.addCommandObject(context.SlashCommand.fromProps({
            name: COMMAND_NAME,
            callback: (namedArgs, unnamedArgs) => runCommand(context, namedArgs, unnamedArgs),
            returns: tr(context, 'command.returns'),
            namedArgumentList: buildNamedArguments(context),
            unnamedArgumentList: [context.SlashCommandArgument.fromProps({
                description: tr(context, 'command.needAction'),
                typeList: context.ARGUMENT_TYPE.STRING,
                isRequired: true,
            })],
            helpString: helpHtml(context),
        }));
        installed = true;
        return true;
    } catch (error) {
        console.error(`${LOG_PREFIX} could not register /${COMMAND_NAME}`, error);
        return false;
    }
}

/**
 * Whether this client exposes every piece the registration needs.
 *
 * @param {any} context
 * @returns {boolean}
 */
function canRegister(context) {
    return typeof context?.SlashCommand?.fromProps === 'function'
        && typeof context?.SlashCommandParser?.addCommandObject === 'function'
        && typeof context?.SlashCommandArgument?.fromProps === 'function'
        && typeof context?.SlashCommandNamedArgument?.fromProps === 'function'
        && Boolean(context?.ARGUMENT_TYPE?.STRING);
}

/**
 * @param {any} context
 * @returns {object[]}
 */
function buildNamedArguments(context) {
    return [
        context.SlashCommandNamedArgument.fromProps({
            name: 'pack',
            description: tr(context, 'command.packArgument'),
            typeList: context.ARGUMENT_TYPE.STRING,
        }),
        context.SlashCommandNamedArgument.fromProps({
            name: 'scope',
            description: tr(context, 'command.scopeArgument', { scopes: SCOPES.join(', ') }),
            typeList: context.ARGUMENT_TYPE.STRING,
        }),
    ];
}

/**
 * The command's help, as the client renders it.
 *
 * Assembled here rather than kept in the catalog as one string, because a
 * catalog value is plain text and this has to be markup. Every sentence inside
 * still comes from the catalog, so the help is as bilingual as the panel.
 *
 * @param {any} context
 * @returns {string}
 */
function helpHtml(context) {
    const examples = [
        'enable pack=daily scope=chat',
        'disable pack=daily scope=global',
        'reload',
        'conflicts',
    ];
    const items = examples
        .map((example) => `<li><code class="language-stscript">/${COMMAND_NAME} ${example}</code></li>`)
        .join('');
    return `<div>${tr(context, 'command.help')}</div><ul>${items}</ul>`;
}

/**
 * Run one `/st-emote` invocation and return the sentence to show.
 *
 * Exported because the tests drive the behaviour without a parser: registering a
 * command is the client's business, deciding what one means is ours.
 *
 * @param {any} context
 * @param {Record<string, unknown>} [namedArgs]
 * @param {unknown[]} [unnamedArgs]
 * @returns {Promise<string>}
 */
export async function runCommand(context, namedArgs = {}, unnamedArgs = []) {
    const action = String(unnamedArgs?.[0] ?? '').trim().toLowerCase();
    if (!ACTIONS.includes(action)) {
        return tr(context, 'command.needAction');
    }
    if (action === 'reload') {
        return reloadStEmote(context);
    }
    if (action === 'conflicts') {
        return reportConflicts(context);
    }
    return setPackEnabledInScope(context, action === 'enable', namedArgs);
}

/**
 * Re-read the stored settings and repaint the chat.
 *
 * A "reload" that only re-read settings would be very nearly a no-op, since they
 * are read fresh on every render anyway. What it is really for is a chat that
 * looks stale — a marker that was missed, a size changed by hand — so the point
 * is the repaint. Saving afterwards is what makes a hand-edited settings file
 * survive the next load.
 *
 * @param {any} context
 * @returns {Promise<string>}
 */
function reloadStEmote(context) {
    ensureSettings(context);
    context.saveSettingsDebounced();
    rerenderChat(context);
    return tr(context, 'command.reloaded');
}

/**
 * List the 冲突 in the 生效集, and say how many there were.
 *
 * The report is the *current chat's* effective set: the global scope, the
 * selected character's scope and the chat's — the set the messages on screen
 * actually resolve against. A group chat resolves each member's tokens against
 * that member's own 生效集, so what this answers is "the set in front of you";
 * the per-member answer needs its own message to ask about.
 *
 * @param {any} context
 * @returns {string}
 */
function reportConflicts(context) {
    const locale = currentLocale(context);
    const effectiveSet = effectiveSetForMessage(context, -1);
    const conflicts = findConflicts(effectiveSet);

    if (conflicts.length === 0) {
        // A clean set says so rather than printing an empty list: "there is no
        // problem" and "the report is broken" look the same if one is blank.
        const sentence = tr(context, 'conflict.none');
        logInfo(sentence);
        return sentence;
    }
    for (const conflict of conflicts) {
        logInfo(conflictLogLine(conflict, locale));
    }
    return `${tr(context, 'command.conflictsShown', { count: conflicts.length })}\n`
        + formatConflicts(effectiveSet, locale);
}

/**
 * Turn one pack on or off in one 作用域.
 *
 * Each scope is written through its own store, and the global one through
 * `setPackEnabled` so the settings key the panel reads is the key that changed.
 * The 生效集 is a pure union with no removal across scopes, so switching a pack
 * off in one scope only bites where that scope is what enabled it — the same
 * rule the panel's unchecked box follows, and the same "why is this not
 * rendering" question it leaves the user to answer.
 *
 * @param {any} context
 * @param {boolean} enabled
 * @param {Record<string, unknown>} namedArgs
 * @returns {Promise<string>}
 */
async function setPackEnabledInScope(context, enabled, namedArgs) {
    const packName = String(namedArgs?.pack ?? '').trim();
    if (packName === '') {
        return tr(context, 'command.needPack', { command: `/${COMMAND_NAME}` });
    }
    if (!findPackByName(ensureSettings(context).packs, packName)) {
        return tr(context, 'command.unknownPack', { name: packName });
    }

    const scope = String(namedArgs?.scope ?? '').trim().toLowerCase() || 'global';
    if (!SCOPES.includes(scope)) {
        return tr(context, 'command.unknownScope', {
            scope: namedArgs?.scope ?? '',
            scopes: SCOPES.join(', '),
        });
    }
    if (scope === 'character' && !getCurrentCharacter(context)) {
        return tr(context, 'command.noCharacter');
    }

    if (scope === 'global') {
        setPackEnabled(ensureSettings(context), packName, enabled);
        context.saveSettingsDebounced();
    } else if (scope === 'character') {
        await setCurrentCharacterScope(context, setPackInScope(
            getCurrentCharacterScope(context), packName, enabled,
        ));
    } else {
        setChatScope(context, setPackInScope(getChatScope(context), packName, enabled));
    }

    rerenderChat(context);
    return tr(context, enabled ? 'command.enabled' : 'command.disabled', {
        name: packName,
        scope: tr(context, `scope.${scope}`),
    });
}
