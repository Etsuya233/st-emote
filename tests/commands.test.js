/**
 * `/st-emote`: the slash command, driven as the client drives it.
 *
 * Registration itself is a handful of property lookups against the client's own
 * classes, and there is nothing to assert about it that a reader would not rather
 * check in the client. What is worth holding down is the other half: **which
 * store each action writes to**, and **what it says when it does not**. Those are
 * the parts that have a rule behind them — three scopes with three different
 * homes, a pure union with no removal across them, and a refusal that has to tell
 * the user what to type instead.
 *
 * The runs go through the real `runCommand`, so a command whose argument name
 * drifted from the catalog's example would fail here rather than in a chat box.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { installCommands, runCommand, SCOPES } from '../adapter/commands.js';
import { STORAGE_KEY } from '../adapter/settings.js';
import { withChat } from './contract/st-dom.js';

/** Two packs, one of which collides with the other on `happy`. */
const CATALOGUE = {
    packs: [
        {
            name: 'daily',
            stickers: [{ id: 'd1', label: 'happy', description: '', image: 'user/images/st-emote/a.png' }],
        },
        {
            name: 'roleplay',
            stickers: [{ id: 'r1', label: 'Happy', description: '', image: 'user/images/st-emote/b.png' }],
        },
    ],
    enabledPackNames: ['daily'],
};

/**
 * A client with a character selected, so the role scope has somewhere to go.
 *
 * @returns {object}
 */
function withCharacter() {
    return {
        characterId: 0,
        characters: [{
            avatar: 'someone.png',
            data: { extensions: { [STORAGE_KEY]: { enabledPackNames: [] } } },
        }],
    };
}

/**
 * Run one command against a jsdom-backed context.
 *
 * @param {object} [options]
 * @param {object} [options.character] - Character to select, from `withCharacter`.
 * @param {object} [options.settings] - Settings overrides, merged into the fixture.
 * @param {string} [options.locale]
 * @param {string} [action]
 * @param {Record<string, string>} [namedArgs]
 * @returns {Promise<{result: string, context: any, logs: string[]}>}
 */
async function run(options = {}) {
    let outcome;
    await withChat('', async (harness) => {
        const context = { ...harness, ...(options.character ?? {}), getCurrentLocale: () => options.locale ?? 'en' };
        context.extensionSettings[STORAGE_KEY] = {
            ...structuredClone(CATALOGUE),
            ...(options.settings ?? {}),
        };
        const saved = console.info;
        const logs = [];
        console.info = (...parts) => logs.push(parts.join(' '));
        try {
            const result = await runCommand(context, options.namedArgs ?? {}, [options.action]);
            outcome = { result, context, logs };
        } finally {
            console.info = saved;
        }
    });
    return outcome;
}

// Ordered deliberately: the refusal below is the only call that leaves the
// module's "registered" flag alone, and `installCommands` is idempotent from
// then on. node:test runs a file's tests in declaration order.
test('a client with no slash command parser says so rather than failing silently', async () => {
    await withChat('', async (harness) => {
        const saved = console.info;
        const logs = [];
        console.info = (...parts) => logs.push(parts.join(' '));
        try {
            assert.equal(installCommands(harness), false);
        } finally {
            console.info = saved;
        }
        // Reported through the shared prefix, so a user looking for the reason a
        // command does nothing finds it beside everything else.
        assert.equal(logs.length, 1);
        assert.match(logs[0], /^\[st-emote\]/);
        assert.match(logs[0], /unavailable/);
    });
});

test('the command registers itself once, with the three scopes named', async () => {
    let registered = null;
    await withChat('', async (harness) => {
        const context = {
            ...harness,
            getCurrentLocale: () => 'en',
            ARGUMENT_TYPE: { STRING: 'string' },
            SlashCommand: { fromProps: (props) => ({ ...props }) },
            SlashCommandArgument: { fromProps: (props) => ({ ...props }) },
            SlashCommandNamedArgument: { fromProps: (props) => ({ ...props }) },
            SlashCommandParser: { addCommandObject: (command) => { registered = command; } },
        };
        assert.equal(installCommands(context), true);
        // A second call must not subscribe the client twice, which would run
        // every action twice for one keystroke.
        assert.equal(installCommands(context), true);
    });

    assert.equal(registered.name, 'st-emote');
    assert.equal(typeof registered.callback, 'function');
    assert.deepEqual(
        registered.namedArgumentList.map((argument) => argument.name),
        ['pack', 'scope'],
    );
    assert.equal(registered.unnamedArgumentList.length, 1);
    // The help is markup assembled from catalog sentences, so it is bilingual like
    // the rest.
    assert.match(registered.helpString, /<div>/);
    assert.match(registered.helpString, /\/st-emote enable pack=daily scope=chat/);
    // The scope argument's own description is where the accepted values are
    // listed, and they come from `SCOPES` — one list, not two.
    const scopeArgument = registered.namedArgumentList.find((argument) => argument.name === 'scope');
    for (const scope of SCOPES) {
        assert.ok(
            scopeArgument.description.includes(scope),
            `the scope argument does not name ${scope}`,
        );
    }
});

test('enable and disable write the global scope in the extension settings', async () => {
    const enabled = await run({ action: 'enable', namedArgs: { pack: 'roleplay' } });
    assert.deepEqual(enabled.context.extensionSettings[STORAGE_KEY].enabledPackNames,
        ['daily', 'roleplay']);
    assert.match(enabled.result, /Enabled "roleplay" in the Global scope/);

    const disabled = await run({
        action: 'disable',
        namedArgs: { pack: 'roleplay', scope: 'global' },
    });
    assert.deepEqual(disabled.context.extensionSettings[STORAGE_KEY].enabledPackNames, ['daily']);
    assert.match(disabled.result, /Disabled "roleplay" in the Global scope/);
});

test('the chat scope is written into the chat metadata, not the settings', async () => {
    const { result, context } = await run({
        action: 'enable',
        namedArgs: { pack: 'roleplay', scope: 'chat' },
    });

    assert.deepEqual(context.extensionSettings[STORAGE_KEY].enabledPackNames, ['daily']);
    assert.deepEqual(context.chatMetadata[STORAGE_KEY].enabledPackNames, ['roleplay']);
    assert.match(result, /Enabled "roleplay" in the Chat scope/);
});

test('the character scope is written into the card, and refuses when none is selected', async () => {
    const withCard = await run({
        character: withCharacter(),
        action: 'enable',
        namedArgs: { pack: 'roleplay', scope: 'character' },
    });
    assert.equal(withCard.context.writtenFields.length, 1);
    assert.equal(withCard.context.writtenFields[0].key, STORAGE_KEY);
    assert.deepEqual(withCard.context.writtenFields[0].value.enabledPackNames, ['roleplay']);
    assert.match(withCard.result, /Enabled "roleplay" in the Character scope/);

    // A group chat with no focused member has nowhere to put it, and saying so
    // beats silently doing nothing.
    const noCard = await run({
        action: 'enable',
        namedArgs: { pack: 'roleplay', scope: 'character' },
    });
    assert.equal(noCard.context.writtenFields.length, 0);
    assert.match(noCard.result, /No character card is selected/);
});

test('a scope union is not a subtraction: another scope keeps the pack enabled', async () => {
    // Disabling in the chat scope leaves the global one alone. That is the whole
    // "cannot remove across scopes" rule, and it is why "why is this still
    // rendering" always has one answer to look for.
    const { context } = await run({ action: 'disable', namedArgs: { pack: 'daily', scope: 'chat' } });
    assert.deepEqual(context.extensionSettings[STORAGE_KEY].enabledPackNames, ['daily']);
    // The chat scope gets written (as an empty list), because "not in this scope"
    // is a fact worth recording — but the global one is untouched.
    assert.deepEqual(context.chatMetadata[STORAGE_KEY].enabledPackNames, []);
});

test('查冲突 lists the labels two enabled packs both define, naming each pack', async () => {
    const { result, logs } = await run({
        settings: { enabledPackNames: ['daily', 'roleplay'] },
        action: 'conflicts',
    });

    assert.match(result, /Conflicts: 1/);
    assert.match(result, /happy/);
    // Both packs, and the spelling that differs from the normalized label, so the
    // user knows which one to change.
    assert.match(result, /daily/);
    assert.match(result, /roleplay \("Happy"\)/);

    // And the console carries the same thing behind the shared prefix.
    const conflictLines = logs.filter((line) => line.includes('label conflict'));
    assert.equal(conflictLines.length, 1);
    assert.match(conflictLines[0], /^\[st-emote\]/);
    assert.match(conflictLines[0], /daily/);
});

test('查冲突 says so when nothing collides, rather than printing an empty list', async () => {
    // Only `daily` is enabled, so there is no 冲突 — and an empty report would
    // read exactly like a broken one.
    const { result, logs } = await run({ action: 'conflicts' });

    assert.equal(result, 'No label is defined by more than one enabled pack.');
    assert.equal(logs.filter((line) => line.includes('label conflict')).length, 0);
    assert.ok(logs.some((line) => line.startsWith('[st-emote]')));
});

test('a 冲突 is only a 冲突 while both packs are enabled', async () => {
    const { result } = await run({ action: 'conflicts', namedArgs: { scope: 'chat' } });
    assert.equal(result, 'No label is defined by more than one enabled pack.');
});

test('the whole command answers in the client\'s language', async () => {
    const { result } = await run({ action: 'conflicts', locale: 'zh-cn' });
    assert.match(result, /生效集/);
    assert.doesNotMatch(result, /conflict/i);
});

test('reload re-reads the settings, repaints, and says so', async () => {
    const { result, context } = await run({ action: 'reload' });
    assert.match(result, /Reloaded st-emote/);
    // A hand-edited settings file survives the next load because the reload
    // saves what it just normalized.
    assert.equal(typeof context.saveSettingsDebounced, 'function');
});

test('every refusal names what to type instead of throwing', async () => {
    // A slash command that throws shows a stack trace; these four are the cases
    // a user will actually hit, and each has to come back as a sentence.
    const noAction = await run({});
    assert.match(noAction.result, /Say what to do/);

    const unknownAction = await run({ action: 'sideways' });
    assert.match(unknownAction.result, /Say what to do/);

    const noPack = await run({ action: 'enable' });
    assert.match(noPack.result, /\/st-emote enable pack=daily scope=chat/);

    const unknownPack = await run({ action: 'enable', namedArgs: { pack: 'nope' } });
    assert.match(unknownPack.result, /no pack named "nope"/i);

    const unknownScope = await run({ action: 'enable', namedArgs: { pack: 'daily', scope: 'nowhere' } });
    assert.match(unknownScope.result, /Unknown scope "nowhere"/);
    assert.match(unknownScope.result, /global, character, chat/);
    // And nothing was written on the way to the refusal.
    assert.deepEqual(unknownScope.context.extensionSettings[STORAGE_KEY].enabledPackNames, ['daily']);
});

test('a refused action changes nothing at all', async () => {
    // The packs and the enabled lists are what a refusal must not have touched.
    // The rest of the settings object is filled in with defaults on first read,
    // which is not a change the user made.
    for (const options of [
        { action: 'enable', namedArgs: { pack: 'nope' } },
        { action: 'enable', namedArgs: { pack: 'daily', scope: 'nowhere' } },
        { action: 'sideways' },
    ]) {
        const { context } = await run(options);
        const settings = context.extensionSettings[STORAGE_KEY];
        assert.deepEqual(settings.enabledPackNames, ['daily'], JSON.stringify(options));
        assert.deepEqual(settings.packs, structuredClone(CATALOGUE.packs), JSON.stringify(options));
        assert.equal(context.chatMetadata[STORAGE_KEY], undefined, JSON.stringify(options));
    }
});
