/**
 * The entry point, on a client that loads with the 总开关 already off.
 *
 * Its own file for one reason: `index.js` is cached by the module system and runs
 * its body exactly once per process, so a client that loads with the switch off
 * and a client that loads with it on cannot both be observed in one suite. Every
 * other module-level guard in this project is tested the same way —
 * `tests/render-paths.test.js` says so for the path chooser — and this is the
 * claim that most needs its own process: a client that never subscribes to a
 * single chat event, rather than one that subscribes and is gated afterwards.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { STORAGE_KEY } from '../adapter/settings.js';
import { STICKER_CLASS } from '../core/render.js';
import { defaultPacks, message, withChat } from './contract/st-dom.js';

test('a client that loads with the 总开关 off installs no render path at all', async (t) => {
    const source = '[[sticker:daily:happy]]';
    await withChat(message({ mesid: 0, html: `<p>${source}</p>` }), async (harness) => {
        harness.chat = [{ mes: `<p>${source}</p>` }];
        const context = { ...harness };
        context.extensionSettings[STORAGE_KEY] = defaultPacks({ enabled: false });
        globalThis.SillyTavern = { getContext: () => context };
        globalThis.jQuery = (ready) => ready();
        t.after(async () => {
            delete globalThis.SillyTavern;
            delete globalThis.jQuery;
            const { resumeRendering } = await import('../adapter/restore.js');
            resumeRendering();
        });

        await import('../index.js');

        // Not "every pass returns 0": nothing was subscribed, so there is nothing
        // for the next message the client renders to arrive on. That is stronger
        // than the flag `adapter/restore.js` keeps for the disable case, where
        // the subscriptions necessarily outlive the turn-off.
        for (const event of Object.values(context.eventTypes)) {
            assert.equal(context.eventSource.listenerCount(event), 0, event);
        }
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 0);
    });
});

test('ST\'s own disable/enable cycle leaves the 总开关 in charge', async (t) => {
    // The claim that "the two switches do not interfere" only means something in
    // the direction that is easy to get wrong. `onEnable` used to call
    // `resumeRendering()` unconditionally, so a user who turned the 总开关 off and
    // then toggled the extension off and on in SillyTavern's own panel came back
    // to a st-emote that rendered, with the switch still reading off.
    //
    // `index.js` is cached by the module system and its body ran for the test
    // above with *that* test's context, so this one re-imports it with a
    // cache-busting query. A second module instance of the entry point is
    // exactly what two page loads are, which is the situation being modelled.
    const source = '[[sticker:daily:happy]]';
    await withChat(message({ mesid: 0, html: `<p>${source}</p>` }), async (harness) => {
        harness.chat = [{ mes: `<p>${source}</p>` }];
        const context = { ...harness };
        context.extensionSettings[STORAGE_KEY] = defaultPacks({ enabled: false });
        context.updateMessageBlock = function restitch(messageId, chatMessage) {
            harness.document
                .querySelector(`.mes[mesid="${messageId}"] .mes_text`).innerHTML = chatMessage.mes;
        };
        globalThis.SillyTavern = { getContext: () => context };
        globalThis.jQuery = (ready) => ready();
        t.after(async () => {
            delete globalThis.SillyTavern;
            delete globalThis.jQuery;
            const { resumeRendering } = await import('../adapter/restore.js');
            resumeRendering();
        });

        const entry = await import(`../index.js?st-emote-total-switch=${Date.now()}`);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 0);

        // SillyTavern's own panel: off, then on again.
        entry.onDisable();
        entry.onEnable();
        await new Promise((resolve) => setTimeout(resolve, 0));

        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 0,
            're-enabling the extension must not override the 总开关');
        assert.equal(context.extensionSettings[STORAGE_KEY].enabled, false);
    });
});

test('the settings default the 总开关 to on, and only an explicit false turns it off', async () => {
    // A settings payload written before this switch existed has no `enabled` key
    // at all, and reading "absent" as "off" would silently switch a working
    // extension off on upgrade. The same rule the two 标记 form switches follow.
    const { ensureSettings } = await import('../adapter/settings.js');
    await withChat('', async (harness) => {
        const legacy = { ...harness, extensionSettings: { [STORAGE_KEY]: { version: 1, packs: [] } } };
        assert.equal(ensureSettings(legacy).enabled, true);
        assert.equal(ensureSettings(legacy).bracketForm, true);
        assert.equal(ensureSettings(legacy).tagForm, true);

        ensureSettings(legacy).enabled = false;
        assert.equal(ensureSettings(legacy).enabled, false, 'a stored false must stick');

        const fresh = { ...harness, extensionSettings: {} };
        assert.equal(ensureSettings(fresh).enabled, true);
    });
});
