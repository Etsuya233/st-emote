/**
 * The entry point, loaded the way the client loads it.
 *
 * The other suites import the adapter modules directly, which means they would
 * all keep passing if `index.js` stopped wiring them together — a broken import
 * in the entry point is invisible to them and fatal in the client. So this suite
 * imports the real entry module, with the client's globals standing in, and
 * checks the three things the client asks of it: which path got installed, the
 * exported enable hook, and the exported disable hook.
 *
 * The client reaches the hooks by name from `manifest.json`, so the names are
 * pinned here against the manifest rather than left to a reader to match up.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { STICKER_CLASS } from '../core/render.js';
import { defaultPacks, message, withChat } from './contract/st-dom.js';
import { STORAGE_KEY } from '../adapter/settings.js';

const ENTRY_HOOKS = ['onEnable', 'onDisable'];

test('the entry point installs the DOM path and its disable hook restores the chat', async (t) => {
    const source = '[[sticker:daily:happy]]';
    await withChat(message({ mesid: 0, html: `<p>${source}</p>` }), async (harness) => {
        // The client's own globals, at the moment it evaluates the script tag.
        harness.chat = [{ mes: `<p>${source}</p>` }];
        const context = { ...harness };
        context.extensionSettings[STORAGE_KEY] = defaultPacks();
        globalThis.SillyTavern = { getContext: () => context };
        globalThis.jQuery = (ready) => ready();
        t.after(async () => {
            delete globalThis.SillyTavern;
            delete globalThis.jQuery;
            // The entry module is cached; a second import would not re-run it, so
            // this suite owns it and leaves the render flag as it found it.
            const { resumeRendering } = await import('../adapter/restore.js');
            resumeRendering();
        });

        const entry = await import('../index.js');
        for (const name of ENTRY_HOOKS) {
            assert.equal(typeof entry[name], 'function', name);
        }

        // 1.18.0 has no messageFormatter, so the DOM path is the one that runs.
        assert.equal(context.eventSource.listenerCount('message_updated'), 1);
        assert.equal(context.messageFormatter, undefined);
        const images = document.querySelectorAll(`img.${STICKER_CLASS}`);
        assert.equal(images.length, 1);
        assert.equal(images[0].getAttribute('alt'), 'happy');

        // The client calls the disable hook by the name in the manifest.
        const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
        assert.deepEqual(Object.keys(manifest.hooks).sort(), ['disable', 'enable']);
        assert.equal(manifest.hooks.disable, 'onDisable');
        assert.equal(manifest.hooks.enable, 'onEnable');

        entry[manifest.hooks.disable]();
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 0);
        assert.equal(document.querySelector('.mes_text').textContent, source);

        // Re-enabling repaints, and re-installing is a no-op rather than a
        // second set of event subscriptions.
        entry[manifest.hooks.enable]();
        await Promise.resolve();
        assert.equal(context.eventSource.listenerCount('message_updated'), 1);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);
    });
});
