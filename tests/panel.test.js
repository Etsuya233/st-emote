/**
 * The management panel, driven through a real jsdom page.
 *
 * The panel is the one part of the adapter that is nothing but DOM, so jsdom is
 * the only honest way to drive it — a hand-written element tree would be a
 * second implementation of the browser, and every bug it hid would be reported
 * here as a pass.
 *
 * What is faked is the client's surface and its two image endpoints; the rules
 * themselves live in the pure core and are tested there. What these tests hold
 * down is the wiring: that the panel renders what the core decided, and that the
 * buttons call the endpoints with the paths the core produced.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { STORAGE_KEY } from '../adapter/settings.js';
import { fakeFetch, withJsZip, withPanel } from './contract/st-dom.js';

/**
 * A stored image path. The file name carries the `st-emote-` prefix the upload
 * gives every file, because that prefix is what makes a path *ours* — and
 * therefore what makes it deletable (ADR-0003). A fixture with realistic names
 * is the only way the delete path gets exercised at all.
 *
 * @param {string} name
 * @returns {string}
 */
const local = (name) => `user/images/st-emote/st-emote-${name}`;

const CATALOGUE = {
    version: 1,
    packs: [
        {
            name: 'zeta',
            stickers: [
                { id: 'z1', label: 'zappy', description: 'a big zap', image: local('z1.png') },
            ],
        },
        {
            name: 'daily',
            stickers: [
                { id: 'd1', label: 'happy', description: 'a wide grin', image: local('d1.png') },
                { id: 'd2', label: 'sad', description: 'a frown', image: local('d2.png') },
                { id: 'd3', label: 'wave', description: 'from a link', image: 'https://example.com/w.gif' },
            ],
        },
        { name: 'blank', stickers: [] },
    ],
    enabledPackNames: ['daily'],
};

/**
 * Mount the panel with a stubbed server and hand the test the pieces it needs.
 *
 * @param {object} [options]
 * @param {object} [options.settings]
 * @param {string[]} [options.storedFiles] - File names the server reports.
 * @param {object} [options.fetch] - A `fakeFetch` replacement.
 * @param {string} [options.locale] - The locale the client reports.
 * @param {object} [options.sillyTavern] - The client's global, installed **before**
 *   the panel mounts. The debug area reads `SillyTavern.libs` while mounting,
 *   which is when the real client has it too, so a test cannot add it afterwards
 *   and expect the converter to appear.
 * @param {(context: any) => void|Promise<void>} body
 */
async function withPanelMounted(options, body) {
    await withPanel(async (harness) => {
        // Deep-cloned: the panel edits these records in place, and a shared
        // fixture would let one test's delete show up in the next one's counts.
        harness.extensionSettings[STORAGE_KEY] = {
            ...structuredClone(CATALOGUE),
            ...(options?.settings ?? {}),
        };
        const stored = options?.storedFiles ?? ['st-emote-d1.png', 'st-emote-d2.png', 'st-emote-z1.png'];
        const fetchImpl = options?.fetch ?? fakeFetch({
            list: { body: stored },
            upload: (body) => ({ body: { path: `user/images/st-emote/st-emote-new.${body.format}` } }),
            remove: { status: 200 },
        });
        const savedFetch = globalThis.fetch;
        globalThis.fetch = fetchImpl;
        const savedClient = globalThis.SillyTavern;
        if (options?.sillyTavern) {
            globalThis.SillyTavern = options.sillyTavern;
        }
        const toasts = [];
        globalThis.window.toastr = {
            success: (message) => toasts.push(['success', message]),
            warning: (message) => toasts.push(['warning', message]),
            error: (message) => toasts.push(['error', message]),
        };
        try {
            const { mountSettingsPanel } = await import('../adapter/ui.js');
            mountSettingsPanel(harness);
            // The first paint waits for the stored-file listing, so let it land.
            await new Promise((resolve) => setTimeout(resolve, 0));
            await body({ ...harness, toasts, fetchImpl });
        } finally {
            globalThis.fetch = savedFetch;
            globalThis.SillyTavern = savedClient;
            delete globalThis.window.toastr;
        }
    }, { locale: options?.locale });
}

test('the panel lists packs sorted by name, with the first sticker as the cover', async () => {
    await withPanelMounted({}, ({ document }) => {
        const names = [...document.querySelectorAll('.st-emote-pack-name')].map((input) => input.value);
        assert.deepEqual(names, ['blank', 'daily', 'zeta']);

        const covers = [...document.querySelectorAll('.st-emote-cover')];
        assert.equal(covers[0].classList.contains('st-emote-cover-empty'), true);
        assert.equal(covers[1].getAttribute('src'), local('d1.png'));
        assert.equal(covers[2].getAttribute('src'), local('z1.png'));
    });
});

test('a pack with no stickers reads as empty', async () => {
    await withPanelMounted({}, ({ document }) => {
        const badges = [...document.querySelectorAll('.st-emote-badge')].map((badge) => badge.textContent);
        assert.equal(badges.includes('empty'), true);
    });
});

test('a pack whose image file is not on the server is greyed but still enableable', async () => {
    // The server reports none of our files: the settings travelled, the images
    // did not. A pack with a 外链 in it is still "ok" — an external address is
    // not a file this server could be missing.
    await withPanelMounted({ storedFiles: [] }, ({ document }) => {
        const packs = [...document.querySelectorAll('.st-emote-pack')];
        const daily = packs.find((pack) => pack.querySelector('.st-emote-pack-name').value === 'daily');
        assert.equal(daily.classList.contains('st-emote-pack-missing'), true);
        assert.match(
            daily.querySelector('.st-emote-badge-images-missing').textContent,
            /images not synced/,
        );

        // Still enableable: the scope boxes a greyed-out pack offers are the
        // same ones an ordinary pack gets, and the Global one works. (Character
        // is disabled here for an unrelated reason: no character is selected.)
        const toggles = [...daily.querySelectorAll('.st-emote-scopes input')];
        assert.equal(toggles.length, 3);
        const [globalBox, , chatBox] = toggles;
        assert.equal(globalBox.disabled, false);
        assert.equal(chatBox.disabled, false);

        // And the way back in: the cover is a control that re-points the images.
        const cover = daily.querySelector('.st-emote-cover');
        assert.equal(cover.classList.contains('st-emote-cover-action'), true);
    });
});

test('a pack whose images are all present is not greyed', async () => {
    await withPanelMounted({}, ({ document }) => {
        const daily = packByName(document, 'daily');
        assert.equal(daily.classList.contains('st-emote-pack-missing'), false);
        assert.equal(daily.querySelector('.st-emote-badge-images-missing'), null);
    });
});

test('importing a pack with an image the rules refuse stores nothing', async (t) => {
    // The import is a way for an arbitrary zip to put bytes into the image
    // directory; if it skipped the format and size limits, those limits would
    // only ever have governed manual uploads.
    for (const [label, file, payload, expected] of [
        ['a bmp', 'images/001-a.bmp', 'bytes', /not a png, jpg, webp or gif/],
        ['an oversized gif', 'images/001-a.gif', 'x'.repeat(6 * 1024 * 1024), /larger than 5MB/],
    ]) {
        const fetchImpl = fakeFetch({
            list: { body: ['st-emote-d1.png', 'st-emote-d2.png'] },
            upload: { body: { path: 'user/images/st-emote/st-emote-x.png' } },
        });
        // eslint-disable-next-line no-await-in-loop
        await withJsZip(t, async (JSZip) => {
            const zip = new JSZip();
            zip.file('st-emote.json', JSON.stringify({
                format: 'st-emote-pack',
                version: 1,
                name: 'incoming',
                stickers: [{ label: 'a', description: '', file }],
            }));
            zip.file(file, payload);
            const bytes = new Uint8Array(
                await (await zip.generateAsync({ type: 'blob' })).arrayBuffer(),
            );

            // eslint-disable-next-line no-await-in-loop
            await withPanelMounted({ fetch: fetchImpl }, async ({ document, extensionSettings, toasts }) => {
                const picker = document.querySelector('#st_emote_import_pack').nextElementSibling;
                const chosen = new globalThis.window.File([bytes], 'incoming.zip');
                Object.defineProperty(picker, 'files', { value: [chosen], configurable: true });
                picker.dispatchEvent(new globalThis.window.Event('change'));
                // eslint-disable-next-line no-await-in-loop
                await waitFor(() => toasts.length > 0, `the import of ${label} to be refused`);

                assert.equal(
                    extensionSettings[STORAGE_KEY].packs.some((pack) => pack.name === 'incoming'),
                    false,
                    `a pack with ${label} was added`,
                );
                assert.equal(fetchImpl.calls.some((call) => call.url.endsWith('/upload')), false);
                assert.match(toasts.at(-1)[1], expected);
            });
        });
    }
});

test('a URL that is not an http address is refused', async () => {
    await withPanelMounted({}, async ({ document, extensionSettings, toasts }) => {
        globalThis.prompt = () => 'javascript:alert(1)';
        packByName(document, 'daily').querySelector('.st-emote-add-url').click();
        await settle();

        assert.equal(extensionSettings[STORAGE_KEY].packs.find((p) => p.name === 'daily').stickers.length, 3);
        assert.match(toasts.at(-1)[1], /not an http\(s\) image address/);
        delete globalThis.prompt;
    });
});

test('an external sticker is marked as one, and its row has no local file to lose', async () => {
    await withPanelMounted({}, ({ document }) => {
        const badges = [...document.querySelectorAll('.st-emote-badge-external')].map((b) => b.textContent);
        assert.deepEqual(badges, ['external']);
    });
});

test('the search box filters by label and by description, case- and space-insensitively', async () => {
    await withPanelMounted({}, ({ document }) => {
        const search = document.getElementById('st_emote_search');
        const searchFor = (value) => {
            search.value = value;
            search.dispatchEvent(new globalThis.window.Event('input'));
            return {
                packs: [...document.querySelectorAll('.st-emote-pack-name')].map((i) => i.value),
                labels: [...document.querySelectorAll('.st-emote-label')].map((i) => i.value),
            };
        };

        // By description, with the query's case and spacing normalised away.
        assert.deepEqual(searchFor('  WIDE GRIN '), { packs: ['daily'], labels: ['happy'] });
        // By description of another sticker in the same pack.
        assert.deepEqual(searchFor('a frown'), { packs: ['daily'], labels: ['sad'] });
        // By label.
        assert.deepEqual(searchFor('ZAPPY'), { packs: ['zeta'], labels: ['zappy'] });
        // Nothing matches: an empty pack drops out of the list entirely.
        assert.deepEqual(searchFor('nothing here'), { packs: [], labels: [] });
        assert.match(document.querySelector('.st-emote-empty').textContent, /No sticker matches/);
    });
});

test('selecting several stickers and deleting them removes the records and calls the endpoint', async () => {
    const fetchImpl = fakeFetch({
        list: { body: ['st-emote-d1.png', 'st-emote-d2.png'] },
        remove: { status: 200 },
    });
    await withPanelMounted({ fetch: fetchImpl }, async ({ document, extensionSettings }) => {
        harnessConfirm(true);

        // Tick two rows. Each tick re-renders the list, so the next row is looked
        // up again rather than held on to.
        for (const label of ['happy', 'sad']) {
            const row = stickerRow(document, 'daily', label);
            const tick = row.querySelector('.st-emote-sticker-tick');
            tick.checked = true;
            tick.dispatchEvent(new globalThis.window.Event('change'));
        }

        const button = document.querySelector('.st-emote-delete-selected');
        assert.match(button.textContent, /Delete 2 selected/);
        button.click();
        await settle();

        const settings = extensionSettings[STORAGE_KEY];
        const remaining = settings.packs.find((pack) => pack.name === 'daily').stickers;
        assert.deepEqual(remaining.map((sticker) => sticker.label), ['wave']);

        const deleted = fetchImpl.calls.filter((call) => call.url.endsWith('/delete'));
        assert.deepEqual(deleted.map((call) => call.body.path), [local('d1.png'), local('d2.png')]);
        globalThis.__confirm = null;
    });
});

test('deleting a pack asks first, and only then removes it from the catalogue and every scope', async () => {
    const fetchImpl = fakeFetch({
        list: { body: ['st-emote-d1.png', 'st-emote-d2.png'] },
        remove: { status: 200 },
    });
    await withPanelMounted({ fetch: fetchImpl }, async ({ document, extensionSettings }) => {
        harnessConfirm(true);

        packByName(document, 'daily').querySelector('.st-emote-delete-pack').click();
        await settle();

        assert.equal(globalThis.__confirm.asked, true);
        assert.match(globalThis.__confirm.message, /Tokens naming it will stop matching/);
        assert.deepEqual(
            extensionSettings[STORAGE_KEY].packs.map((pack) => pack.name),
            ['zeta', 'blank'],
        );
        assert.deepEqual(extensionSettings[STORAGE_KEY].enabledPackNames, []);
        assert.equal(fetchImpl.calls.filter((call) => call.url.endsWith('/delete')).length, 2);
        globalThis.__confirm = null;
    });
});

test('a declined delete leaves the pack and its files alone', async () => {
    const fetchImpl = fakeFetch({
        list: { body: ['st-emote-d1.png', 'st-emote-d2.png'] },
        remove: { status: 200 },
    });
    await withPanelMounted({ fetch: fetchImpl }, async ({ document, extensionSettings }) => {
        harnessConfirm(false);
        packByName(document, 'daily').querySelector('.st-emote-delete-pack').click();
        await settle();

        assert.equal(extensionSettings[STORAGE_KEY].packs.length, 3);
        assert.equal(fetchImpl.calls.some((call) => call.url.endsWith('/delete')), false);
        globalThis.__confirm = null;
    });
});

test('replacing a sticker image keeps the label and description and drops the old file', async () => {
    const fetchImpl = fakeFetch({
        list: { body: ['st-emote-d1.png', 'st-emote-d2.png'] },
        upload: (body) => ({ body: { path: `user/images/st-emote/st-emote-new.${body.format}` } }),
        remove: { status: 200 },
    });
    await withPanelMounted({ fetch: fetchImpl }, async ({ document, extensionSettings }) => {
        const picker = stickerRow(document, 'daily', 'happy').querySelector('input[type=file]');
        const file = new globalThis.window.File(['x'], 'new.png', { type: 'image/png' });
        Object.defineProperty(picker, 'files', { value: [file], configurable: true });
        picker.dispatchEvent(new globalThis.window.Event('change'));
        await settle();

        const sticker = extensionSettings[STORAGE_KEY].packs
            .find((pack) => pack.name === 'daily').stickers[0];
        assert.equal(sticker.label, 'happy');
        assert.equal(sticker.description, 'a wide grin');
        assert.equal(sticker.image, 'user/images/st-emote/st-emote-new.png');

        const deleted = fetchImpl.calls.filter((call) => call.url.endsWith('/delete'));
        assert.deepEqual(deleted.map((call) => call.body.path), [local('d1.png')]);
    });
});

test('uploading refuses a file the core rejects, and says why', async () => {
    const fetchImpl = fakeFetch({
        list: { body: ['st-emote-d1.png', 'st-emote-d2.png'] },
        upload: (body) => ({ body: { path: `user/images/st-emote/st-emote-new.${body.format}` } }),
    });
    await withPanelMounted({ fetch: fetchImpl }, async ({ document, extensionSettings, toasts }) => {
        const picker = packByName(document, 'daily').querySelector('input[type=file]');
        const tooBig = new globalThis.window.File(['x'], 'huge.png', { type: 'image/png' });
        Object.defineProperty(tooBig, 'size', { value: 6 * 1024 * 1024 });
        const wrongType = new globalThis.window.File(['x'], 'drawing.svg', { type: 'image/svg+xml' });
        Object.defineProperty(picker, 'files', { value: [tooBig, wrongType], configurable: true });
        picker.dispatchEvent(new globalThis.window.Event('change'));
        await settle();

        const errors = toasts.filter(([kind]) => kind === 'error').map(([, message]) => message);
        assert.equal(errors.length, 2);
        assert.match(errors.join('\n'), /larger than 5MB/);
        assert.match(errors.join('\n'), /not a png, jpg, webp or gif/);
        // Nothing was added, and nothing was sent.
        assert.equal(extensionSettings[STORAGE_KEY].packs.find((p) => p.name === 'daily').stickers.length, 3);
        assert.equal(fetchImpl.calls.some((call) => call.url.endsWith('/upload')), false);
    });
});

test('adding a URL sticker stores the address and marks it external', async () => {
    await withPanelMounted({}, async ({ document, extensionSettings }) => {
        globalThis.prompt = () => 'https://example.com/cat.gif';
        packByName(document, 'daily').querySelector('.st-emote-add-url').click();
        await settle();

        const added = extensionSettings[STORAGE_KEY].packs
            .find((pack) => pack.name === 'daily').stickers.at(-1);
        assert.equal(added.image, 'https://example.com/cat.gif');
        assert.equal(added.label, '');
        assert.match(
            document.querySelectorAll('.st-emote-badge-external')[0].textContent,
            /external/,
        );
        delete globalThis.prompt;
    });
});

test('replacing a sticker image keeps the label and description and drops the old file', async () => {
    const fetchImpl = fakeFetch({
        list: { body: ['st-emote-d1.png', 'st-emote-d2.png'] },
        // The real endpoint re-appends the format's extension, so each upload
        // lands on a fresh name; the sticker id keeps it identifiable as ours.
        upload: (body) => ({
            body: { path: `user/images/st-emote/st-emote-d1-${body.image.slice(0, 4)}.${body.format}` },
        }),
        remove: { status: 200 },
    });
    await withPanelMounted({ fetch: fetchImpl }, async ({ document, extensionSettings }) => {
        const picker = stickerRow(document, 'daily', 'happy').querySelector('input[type=file]');
        const file = new globalThis.window.File(['new'], 'new.png', { type: 'image/png' });
        Object.defineProperty(picker, 'files', { value: [file], configurable: true });
        picker.dispatchEvent(new globalThis.window.Event('change'));
        await settle();

        const sticker = extensionSettings[STORAGE_KEY].packs
            .find((pack) => pack.name === 'daily').stickers[0];
        assert.equal(sticker.label, 'happy');
        assert.equal(sticker.description, 'a wide grin');
        assert.notEqual(sticker.image, local('d1.png'));

        const deleted = fetchImpl.calls.filter((call) => call.url.endsWith('/delete'));
        assert.deepEqual(deleted.map((call) => call.body.path), [local('d1.png')]);
    });
});

test('a replace that lands on the same path does not delete the image it just wrote', async () => {
    // The regression: the endpoint strips the extension off the name it is given
    // and re-appends the format's, so a png→png replace can land on the very
    // same path. Deleting "the old file" then deletes the new image, and the
    // sticker is left pointing at a file that is no longer there.
    const fetchImpl = fakeFetch({
        list: { body: ['st-emote-d1.png', 'st-emote-d2.png'] },
        upload: { body: { path: local('d1.png') } },
        remove: { status: 200 },
    });
    await withPanelMounted({ fetch: fetchImpl }, async ({ document, extensionSettings }) => {
        const picker = stickerRow(document, 'daily', 'happy').querySelector('input[type=file]');
        const file = new globalThis.window.File(['new'], 'new.png', { type: 'image/png' });
        Object.defineProperty(picker, 'files', { value: [file], configurable: true });
        picker.dispatchEvent(new globalThis.window.Event('change'));
        await settle();

        const sticker = extensionSettings[STORAGE_KEY].packs
            .find((pack) => pack.name === 'daily').stickers[0];
        assert.equal(sticker.image, local('d1.png'));
        // Nothing was deleted: the file the sticker points at is the file that
        // was just written.
        assert.equal(fetchImpl.calls.some((call) => call.url.endsWith('/delete')), false);
        // And the pack does not grey out as a result.
        assert.equal(
            packByName(document, 'daily').classList.contains('st-emote-pack-missing'),
            false,
        );
    });
});

test('renaming a label that only changes its spelling warns about nothing', async () => {
    await withPanelMounted({}, async ({ document, toasts, extensionSettings }) => {
        const input = packByName(document, 'daily').querySelector('.st-emote-label');
        input.value = 'Happy';
        input.dispatchEvent(new globalThis.window.Event('change'));

        const warnings = toasts.filter(([kind]) => kind === 'warning').map(([, message]) => message);
        assert.equal(warnings.some((message) => /old label no longer match/.test(message)), false);
        assert.equal(
            extensionSettings[STORAGE_KEY].packs.find((pack) => pack.name === 'daily').stickers[0].label,
            'Happy',
        );
    });
});

test('renaming a label for real warns that the old tokens stop matching', async () => {
    await withPanelMounted({}, async ({ document, toasts, extensionSettings }) => {
        const input = packByName(document, 'daily').querySelector('.st-emote-label');
        input.value = 'grinning';
        input.dispatchEvent(new globalThis.window.Event('change'));

        const warnings = toasts.filter(([kind]) => kind === 'warning').map(([, message]) => message);
        assert.equal(
            warnings.some((message) => /Tokens using the old label no longer match/.test(message)),
            true,
        );
        assert.equal(
            extensionSettings[STORAGE_KEY].packs.find((pack) => pack.name === 'daily').stickers[0].label,
            'grinning',
        );
    });
});

test('importing a pack adds it, uploads its images, and enables it nowhere', async (t) => {
    const fetchImpl = fakeFetch({
        list: { body: ['st-emote-d1.png', 'st-emote-d2.png'] },
        upload: (body) => ({ body: { path: `user/images/st-emote/st-emote-imported.${body.format}` } }),
    });
    await withJsZip(t, async (JSZip) => {
        const zip = new JSZip();
        zip.file('st-emote.json', JSON.stringify({
            format: 'st-emote-pack',
            version: 1,
            name: 'shared',
            stickers: [
                { label: 'hi', description: 'a greeting', file: 'images/001-hi.png', placement: 'message-end' },
                { label: 'bye', description: '', url: 'https://example.com/bye.gif' },
            ],
        }));
        zip.file('images/001-hi.png', 'bytes');
        const bytes = new Uint8Array(await (await zip.generateAsync({ type: 'blob' })).arrayBuffer());

        await withPanelMounted({ fetch: fetchImpl }, async ({ document, extensionSettings, toasts }) => {
            const picker = document.querySelector('#st_emote_import_pack').nextElementSibling;
            const file = new globalThis.window.File([bytes], 'shared.zip');
            Object.defineProperty(picker, 'files', { value: [file], configurable: true });
            picker.dispatchEvent(new globalThis.window.Event('change'));
            await settle();

            const added = extensionSettings[STORAGE_KEY].packs.find((pack) => pack.name === 'shared');
            assert.ok(added, 'the pack was not added');
            assert.deepEqual(added.stickers.map((sticker) => sticker.label), ['hi', 'bye']);
            assert.equal(added.stickers[0].description, 'a greeting');
            // The placement override came across; so did the 外链 as an address.
            assert.equal(added.stickers[0].placement, 'message-end');
            assert.equal(added.stickers[1].image, 'https://example.com/bye.gif');
            // The archived image was uploaded, so the sticker points at a real file.
            assert.equal(added.stickers[0].image, 'user/images/st-emote/st-emote-imported.png');
            assert.equal(fetchImpl.calls.filter((call) => call.url.endsWith('/upload')).length, 1);

            // Not enabled anywhere: it is in the catalogue and in no scope.
            assert.equal(extensionSettings[STORAGE_KEY].enabledPackNames.includes('shared'), false);
            assert.match(toasts.at(-1)[1], /not enabled anywhere yet/);
        });
    });
});

test('importing a pack whose name is taken is refused, and nothing is stored', async (t) => {
    const fetchImpl = fakeFetch({
        list: { body: ['st-emote-d1.png', 'st-emote-d2.png'] },
        upload: { body: { path: 'user/images/st-emote/st-emote-x.png' } },
    });
    await withJsZip(t, async (JSZip) => {
        const zip = new JSZip();
        zip.file('st-emote.json', JSON.stringify({
            format: 'st-emote-pack',
            version: 1,
            name: 'DAILY',
            stickers: [{ label: 'hi', description: '', file: 'images/001-hi.png' }],
        }));
        zip.file('images/001-hi.png', 'bytes');
        const bytes = new Uint8Array(await (await zip.generateAsync({ type: 'blob' })).arrayBuffer());

        await withPanelMounted({ fetch: fetchImpl }, async ({ document, extensionSettings, toasts }) => {
            const picker = document.querySelector('#st_emote_import_pack').nextElementSibling;
            const file = new globalThis.window.File([bytes], 'daily.zip');
            Object.defineProperty(picker, 'files', { value: [file], configurable: true });
            picker.dispatchEvent(new globalThis.window.Event('change'));
            await settle();

            assert.equal(extensionSettings[STORAGE_KEY].packs.length, 3);
            assert.equal(fetchImpl.calls.some((call) => call.url.endsWith('/upload')), false);
            assert.match(toasts.at(-1)[1], /already exists/);
        });
    });
});

test('the panel speaks the client\'s language, and the whole of it', async () => {
    // One test for the whole surface, because the failure it guards is "someone
    // added a sentence to a new place and forgot the other language" — and that
    // shows up as one English string on a Chinese page, not as a missing feature.
    const english = await panelText({});
    const chinese = await panelText({ locale: 'zh-cn' });

    // The static part of the panel.
    for (const probe of [
        'Create pack', 'Search labels and descriptions', 'Import pack (.zip)',
        'Copy regex JSON', 'Render stickers in user messages', 'Render stickers at all',
        'Token forms', 'Gap between stickers (left/right)',
        'In place', 'Inline size (in place)', 'Min width',
    ]) {
        assert.ok(english.includes(probe), `the English panel is missing "${probe}"`);
    }
    for (const probe of ['新建表情包', '搜索标签与描述', '原地', '最小宽度', '标记形态', '表情之间的空隙（左右）']) {
        assert.ok(chinese.includes(probe), `the Chinese panel is missing "${probe}"`);
    }

    // And the per-pack part, which is built separately on every refresh.
    assert.ok(english.includes('Upload images') && english.includes('3 stickers'));
    assert.ok(chinese.includes('上传图片') && chinese.includes('3 个表情'));

    // A locale the catalog does not ship reads as English rather than blank.
    const french = await panelText({ locale: 'fr-fr' });
    assert.ok(french.includes('Create pack'));
    assert.equal(french, english);
});

test('a pack name and a search query reach the panel as text, never as markup', async () => {
    // The panel interpolates the user's own strings into sentences. It applies
    // them with `textContent`, so a name chosen to break out of its label stays a
    // name; this is the test that would notice a future `innerHTML` in the path.
    await withPanelMounted({
        settings: {
            packs: [{
                name: '<img src=x>',
                stickers: [{ id: 'x1', label: '<b>hi</b>', description: '', image: '' }],
            }],
        },
    }, ({ document }) => {
        assert.equal(document.querySelectorAll('img[src="x"]').length, 0);
        assert.equal(document.querySelectorAll('#st_emote_packs b').length, 0);
        assert.equal(document.querySelector('.st-emote-pack-name').value, '<img src=x>');
        // And the search box, the other place a user string is echoed back.
        const search = document.getElementById('st_emote_search');
        search.value = '<b>nothing</b>';
        search.dispatchEvent(new globalThis.window.Event('input'));
        assert.equal(document.querySelectorAll('.st-emote-empty b').length, 0);
        assert.match(document.querySelector('.st-emote-empty').textContent, /<b>nothing<\/b>/);
    });
});

test('each 标记 form has its own switch, and turning one off repaints the chat', async () => {
    // The switch has to reach three places — the scanner, the DOM element pass and
    // the prompt-only regex — and this drives the one a user reaches for first
    // and then watches the chat.
    const source = '<p>a [[sticker:daily:happy]] b <sticker>daily:happy</sticker></p>';
    await withPanelMounted({}, async ({ document, extensionSettings }) => {
        const tagBox = document.getElementById('st_emote_tag_form');
        const bracketBox = document.getElementById('st_emote_bracket_form');
        const tagInput = document.getElementById('st_emote_tag_name');
        assert.equal(tagBox.checked, true);
        assert.equal(bracketBox.checked, true);
        assert.equal(tagInput.disabled, false);

        tagBox.checked = false;
        tagBox.dispatchEvent(new globalThis.window.Event('change'));

        assert.equal(extensionSettings[STORAGE_KEY].tagForm, false);
        // The tag name still shows its state, greyed: the setting is stored, only
        // the form it names is off.
        assert.equal(tagInput.disabled, true);
        // One form off is a normal state, so nothing warns.
        assert.equal(document.getElementById('st_emote_form_hint').textContent, '');

        bracketBox.checked = false;
        bracketBox.dispatchEvent(new globalThis.window.Event('change'));
        // Both off is legal, and the panel says so rather than leaving the user to
        // wonder why nothing renders.
        assert.match(document.getElementById('st_emote_form_hint').textContent, /Both token forms are off/);
    });
});

test('the context-clearing regex JSON stops matching a 标记 form that is off', async () => {
    // The failure this prevents: the user writes `<sticker>…</sticker>`, sees it
    // do nothing, and finds it gone from the prompt as well. A form that is off
    // must not be in the JSON at all.
    // The pattern is regex source, so its own brackets arrive escaped; matching
    // the marker names rather than the escaped source is what says which forms
    // are in there.
    const readPattern = () => JSON.parse(document.getElementById('st_emote_regex').textContent).findRegex;
    await withPanelMounted({}, async ({ document }) => {
        assert.match(readPattern(), /sticker:/);
        assert.match(readPattern(), /<sticker>/);

        const box = document.getElementById('st_emote_tag_form');
        box.checked = false;
        box.dispatchEvent(new globalThis.window.Event('change'));

        const pattern = readPattern();
        assert.doesNotMatch(pattern, /sticker>/);
        assert.match(pattern, /sticker:/);
    });
});

test('with both 标记 forms off the regex JSON cannot match anything at all', async () => {
    // An empty alternation would match the empty string at every position, which
    // in a user's prompt is the worst thing this file could hand out. Both forms
    // off is a legal state, so the pattern has to be one that simply never fires.
    await withPanelMounted({}, async ({ document }) => {
        for (const id of ['st_emote_bracket_form', 'st_emote_tag_form']) {
            const box = document.getElementById(id);
            box.checked = false;
            box.dispatchEvent(new globalThis.window.Event('change'));
        }
        const findRegex = JSON.parse(document.getElementById('st_emote_regex').textContent).findRegex;
        assert.equal(findRegex, '/(?!)/gi');
    });
});

test('renaming the HTML tag regenerates the regex JSON, forms included', async () => {
    // Two settings decide the same string, so both have to re-run the same step.
    await withPanelMounted({}, async ({ document }) => {
        const input = document.getElementById('st_emote_tag_name');
        input.value = 'emote';
        input.dispatchEvent(new globalThis.window.Event('change'));
        assert.match(JSON.parse(document.getElementById('st_emote_regex').textContent).findRegex, /<emote>/);
    });
});

test('the 总开关 turns rendering off in the live chat, and back on again', async () => {
    const source = '<p>a [[sticker:daily:happy]] b</p>';
    await withPanelMounted({}, async (harness) => {
        const { document, extensionSettings } = harness;
        const checkbox = document.getElementById('st_emote_enabled');
        assert.equal(checkbox.checked, true);
        // The consequence a user is most likely to be surprised by is stated on
        // the switch rather than discovered from a preset that stopped working.
        assert.match(document.getElementById('st_emote_enabled_hint').textContent, /expands to nothing/);

        // Rendered, so there is something to turn off. `processAllMessages`
        // rather than an event: the path is installed once per process and each
        // harness here has its own event bus, so an event would reach whichever
        // earlier test installed the path, not this one.
        document.getElementById('chat').innerHTML
            = '<div class="mes" mesid="0" is_user="false" is_system="false" type="">'
            + `<div class="mes_text">${source}</div></div>`;
        const { installRendering } = await import('../adapter/render-path.js');
        const { processAllMessages } = await import('../adapter/rendering.js');
        installRendering(harness);
        processAllMessages(harness);
        assert.equal(document.querySelectorAll('img.custom-st-emote').length, 1);

        checkbox.checked = false;
        checkbox.dispatchEvent(new globalThis.window.Event('change'));

        // Back to the marker, without a page reload.
        assert.equal(extensionSettings[STORAGE_KEY].enabled, false);
        assert.equal(document.querySelectorAll('img.custom-st-emote').length, 0);
        assert.equal(document.querySelector('.mes_text').textContent, 'a [[sticker:daily:happy]] b');

        // And on again, with the images back.
        checkbox.checked = true;
        checkbox.dispatchEvent(new globalThis.window.Event('change'));
        assert.equal(extensionSettings[STORAGE_KEY].enabled, true);
        assert.equal(document.querySelectorAll('img.custom-st-emote').length, 1);
    });
});

test('the 总开关 puts a 块后 image back where the model wrote it', async () => {
    // Not the same as "the image goes away". A 块后 image is not where the model
    // wrote it, so swapping it for its marker in place would put the text in the
    // wrong paragraph; this is the claim that the way out is a restitch rather
    // than an in-place replacement, and it is the reason the total switch could
    // reuse `stopRendering` instead of growing its own undo.
    const source = '<p>a [[sticker:daily:happy]] b [[sticker:daily:sad]] c</p>';
    await withPanelMounted({ settings: { placement: 'after-block' } }, async (harness) => {
        const { document } = harness;
        // The chat entry is what the restitch reads from: a message on screen
        // with no source is the case `stopRendering` can only partly undo.
        harness.chat = [{ mes: source }];
        document.getElementById('chat').innerHTML
            = '<div class="mes" mesid="0" is_user="false" is_system="false" type="">'
            + `<div class="mes_text">${source}</div></div>`;
        const { installRendering, setEnabled } = await import('../adapter/render-path.js');
        const { processAllMessages } = await import('../adapter/rendering.js');
        installRendering(harness);
        processAllMessages(harness);
        assert.equal(document.querySelectorAll('img.custom-st-emote').length, 2);
        // Both relocated: neither is inside the paragraph any more, which is what
        // makes the restore non-trivial.
        assert.equal(document.querySelector('.mes p img'), null);
        assert.equal(document.querySelector('.mes_text').textContent, 'a  b  c');

        setEnabled(harness, false);
        assert.equal(document.querySelectorAll('img.custom-st-emote').length, 0);
        assert.equal(document.querySelector('.mes_text').innerHTML, source);
    });
});

test('the 总开关 does not suppress the debug preview', async () => {
    // Deliberate, and the reason is in `core/preview.js`'s note: the preview
    // pastes text rather than touching a chat, and "rendering is off" is exactly
    // the state a user is trying to look at. A preview that returned bare text
    // then would answer nothing.
    await withPanelMounted({}, async ({ document }) => {
        const checkbox = document.getElementById('st_emote_enabled');
        checkbox.checked = false;
        checkbox.dispatchEvent(new globalThis.window.Event('change'));

        const box = document.getElementById('st_emote_preview');
        box.value = 'She smiles. [[sticker:daily:happy]]';
        document.getElementById('st_emote_preview_run').click();
        await settle();
        assert.match(document.getElementById('st_emote_preview_out').innerHTML, /custom-st-emote/);
    });
});

test('pasting a message into the debug box renders it without touching the chat', async () => {
    await withPanelMounted({}, async ({ document, chat, extensionSettings }) => {
        const box = document.getElementById('st_emote_preview');
        const output = document.getElementById('st_emote_preview_out');
        const note = document.getElementById('st_emote_preview_note');
        assert.ok(box, 'the debug box is missing');
        assert.equal(output.innerHTML, '');

        box.value = 'She smiles. [[sticker:daily:happy]]';
        document.getElementById('st_emote_preview_run').click();
        await settle();

        // The same markup a message in the chat would get.
        assert.match(output.innerHTML, /custom-st-emote/);
        assert.match(output.innerHTML, /data-st-emote-label="happy"/);
        assert.match(output.innerHTML, /She smiles\./);
        // Nothing rendered, so there is nothing to warn about.
        assert.equal(note.textContent, '');

        // And the chat is exactly as it was: the whole point of the tool.
        assert.equal(chat.length, 0);
        assert.equal(document.querySelectorAll('#chat .mes').length, 0);
        assert.equal(extensionSettings[STORAGE_KEY].packs.length, 3);
    });
});

test('the debug box says what did not render, in the panel\'s language', async () => {
    await withPanelMounted({}, async ({ document }) => {
        const box = document.getElementById('st_emote_preview');
        const output = document.getElementById('st_emote_preview_out');
        const note = document.getElementById('st_emote_preview_note');

        box.value = '[[sticker:daily:nope]]';
        document.getElementById('st_emote_preview_run').click();
        await settle();

        // The marker stays, exactly as it would in a chat, and the line below
        // still names the reason. Neither replaces the other.
        assert.equal(output.textContent, '[[sticker:daily:nope]]');
        assert.match(note.textContent, /Not rendered/);
        assert.match(note.textContent, /no sticker of that label/);
    });
});

test('text with no token in it says so rather than reporting a miss', async () => {
    await withPanelMounted({}, async ({ document }) => {
        const box = document.getElementById('st_emote_preview');
        const note = document.getElementById('st_emote_preview_note');

        box.value = 'just a sentence';
        document.getElementById('st_emote_preview_run').click();
        await settle();
        assert.match(note.textContent, /no sticker token in it/);

        // An untouched box is not a question, so it gets no answer.
        box.value = '';
        document.getElementById('st_emote_preview_run').click();
        await settle();
        assert.equal(note.textContent, '');
    });
});

test('the re-render button repaints the chat and says so', async () => {
    await withPanelMounted({}, async ({ document, toasts }) => {
        const button = document.getElementById('st_emote_rerender');
        assert.ok(button, 'the re-render button is missing');
        assert.match(button.textContent, /Re-render the current chat/);

        button.click();
        await settle();
        assert.equal(toasts.at(-1)[0], 'success');
        assert.match(toasts.at(-1)[1], /Re-rendered the current chat/);
    });
});

test('the debug box hands the paste through the client\'s own markdown step', async () => {
    // The renderer only knows about HTML, and a code fence only becomes
    // `<pre><code>` after markdown runs — so the converter is what decides
    // whether a token inside a fence renders. The adapter must supply the
    // client's own showdown rather than guess, and the global has to be in place
    // before the panel mounts, which is when the real client has it too.
    const converterOptions = [];
    let shown = '';
    await withPanelMounted({
        sillyTavern: {
            libs: {
                showdown: {
                    Converter: class {
                        constructor(options) {
                            converterOptions.push(options);
                        }

                        makeHtml(text) {
                            return `<p>${text}</p>`;
                        }
                    },
                },
            },
        },
    }, async ({ document }) => {
        const box = document.getElementById('st_emote_preview');
        box.value = 'a [[sticker:daily:happy]]';
        document.getElementById('st_emote_preview_run').click();
        await settle();
        shown = document.getElementById('st_emote_preview_out').innerHTML;
    });

    // The converter was used, and configured for the cases the spec's 解析边界
    // list names: a fence is skipped, and a table cell holds its own 块后 image.
    assert.deepEqual(converterOptions, [{
        fencedCodeBlocks: true,
        tables: true,
        simpleLineBreaks: false,
    }]);
    // And its output is what got rendered, rather than the raw paste.
    assert.match(shown, /^<p>a <img /);
    assert.match(shown, /<\/p>$/);
});

test('a client with no markdown converter falls back to treating a paste as text', async () => {
    // The fallback has to be a *stated* one, not a silent degradation: the hint
    // tells the user the paste is plain text and that a fence is not honoured.
    let probe = null;
    await withPanelMounted({}, async ({ document }) => {
        const box = document.getElementById('st_emote_preview');
        box.value = '**bold** [[sticker:daily:happy]]';
        document.getElementById('st_emote_preview_run').click();
        await settle();
        probe = {
            output: document.getElementById('st_emote_preview_out').innerHTML,
            hint: document.querySelector('.st-emote-debug .st-emote-hint').textContent,
        };
    });

    // `escapeText` escapes `& < >` and nothing else, so `**bold**` survives as the
    // literal text the user typed — which is exactly the proof: markdown was not
    // turned into an element, because nothing converted it.
    assert.match(probe.output, /^\*\*bold\*\* <img /);
    assert.equal(probe.output.includes('<strong>'), false);
    assert.match(probe.hint, /plain text/i);
    assert.match(probe.hint, /code fence/i);
});

// ---------------------------------------------------------------------------
// The panel's layout (ticket 10).
//
// The 观感 of the panel is CSS, and jsdom cannot see any of it. What jsdom *can*
// see is the thing that would wreck a pure-layout change by accident: the set of
// controls. So the tests below hold two lines.
//   1. the control set is exactly what it was before the reflow (one snapshot);
//   2. the shape the reflow is supposed to have actually happened.
// ---------------------------------------------------------------------------

test('the panel still offers exactly the controls it offered before the layout reflow', async () => {
    // The guard for the whole ticket. A layout change is allowed to move
    // controls around the panel; it is not allowed to add one, drop one, rename
    // one or change what one says. This list is the panel's control surface as
    // it stood before anything moved, and a line appearing or disappearing is a
    // real finding rather than a snapshot to be updated.
    //
    // Every control is one line: **where** it is, **what** it is (tag, input
    // type, id, classes, and for a select the choices it offers), and **what it
    // says** (its caption, or its title / placeholder where there is none). The
    // sort makes the list indifferent to the order the panel happens to build
    // things in, which is the one thing a reflow is allowed to change.
    await withPanelMounted({}, ({ document }) => {
        assert.deepEqual(controlSurface(document), EXPECTED_CONTROL_SURFACE);
    });
});

test('a sticker row is two rows: the 标签 on top with the 投放方式, the 描述 below', async () => {
    await withPanelMounted({}, ({ document }) => {
        const row = stickerRow(document, 'daily', 'happy');
        const top = row.querySelector('.st-emote-sticker-main');
        const bottom = row.querySelector('.st-emote-sticker-detail');

        assert.ok(top, 'the sticker row has no first row');
        assert.ok(bottom, 'the sticker row has no second row');
        // Two rows, and only two: a third would mean something moved back up.
        assert.deepEqual([...row.children], [top, bottom]);

        // The 标签 is the 标识 and has to be readable at a glance, so it stays on
        // top; the 描述 is content and gets the width of the whole row below.
        for (const selector of ['.st-emote-sticker-tick', '.st-emote-thumb', '.st-emote-label']) {
            assert.equal(top.querySelector(selector)?.closest('.st-emote-sticker') === row, true, selector);
            assert.equal(top.querySelector(selector) !== null, true, `${selector} is not on the first row`);
        }
        assert.equal(bottom.querySelector('.st-emote-description') !== null, true);
        assert.equal(top.querySelector('.st-emote-description'), null);
        // The 投放方式 override rides on the first row; the two image actions sit
        // with the 描述 they belong to.
        assert.equal(top.querySelector('.st-emote-sticker-placement') !== null, true);
        for (const selector of ['.st-emote-replace', '.st-emote-sticker-delete']) {
            assert.equal(bottom.querySelector(selector) !== null, true, `${selector} is not on the second row`);
        }
    });
});

test('the 作用域 toggles and "Select all" share one row', async () => {
    await withPanelMounted({}, ({ document }) => {
        const pack = packByName(document, 'daily');
        const row = pack.querySelector('.st-emote-pack-controls');
        assert.ok(row, 'the pack has no shared controls row');

        // Both halves are direct children of the one row, so neither can claim a
        // line of its own while the 表情 rows below fight over the space.
        const scopes = pack.querySelector('.st-emote-scopes');
        const selection = pack.querySelector('.st-emote-selection');
        assert.equal(scopes.parentElement, row);
        assert.equal(selection.parentElement, row);
        assert.deepEqual([...row.children], [scopes, selection]);

        assert.equal(scopes.querySelectorAll('input[type=checkbox]').length, 3);
        assert.equal(selection.querySelector('input[type=checkbox]') !== null, true);
        // And they are out of the pack header, which used to push the whole
        // 作用域 row below the actions it belongs with.
        assert.equal(row.closest('.st-emote-pack-header'), null);
    });
});

test('every action button in the panel carries the one shared action-button class', async () => {
    // Three areas build their own buttons — the pack header, a 表情 row and the
    // debug area — and one hook class is what keeps them looking like the same
    // kind of control. The stylesheet turns that class into the no-wrap rule, so a
    // button added without it would wrap into a tall block again.
    await withPanelMounted({}, ({ document }) => {
        const buttons = [...document.querySelectorAll('#st_emote_drawer .menu_button')];
        assert.ok(buttons.length > 0);
        for (const button of buttons) {
            assert.equal(
                button.classList.contains('st-emote-button'),
                true,
                `"${button.textContent}" is an action button with no action-button class`,
            );
        }

        // The style exists, and it beats the client's own `.menu_button`, which
        // is a flex column — that is what turned a long label into a four-line
        // block in the first place.
        const rules = readStyleSheet();
        assert.match(
            rules['.menu_button.st-emote-button'] ?? '',
            /white-space:\s*nowrap/,
        );
    });
});

test('every class the panel puts on an element is either styled or a declared query hook', async () => {
    // A class nobody styles and nobody queries is a class the next change cannot
    // find, and the failure shows up as an element quietly looking like the
    // default one. The classes in QUERY_HOOKS are the deliberate exception: they
    // exist to be found — by a test, or by `showFieldHint` toggling a state — and
    // adding one is a decision to record here rather than an oversight.
    const rules = readStyleSheet();
    const used = new Set();
    await withPanelMounted({}, ({ document }) => {
        for (const element of document.querySelectorAll('#st_emote_drawer *')) {
            for (const name of element.classList) {
                if (name.startsWith('st-emote')) {
                    used.add(name);
                }
            }
        }
    });

    const orphaned = [...used]
        .filter((name) => !QUERY_HOOKS.includes(name) && !(`.${name}` in rules))
        .sort();
    assert.deepEqual(orphaned, []);
});

test('every class the 尺寸 controls toggle is styled', async () => {
    // The two state classes `showFieldHint` flips. They are the panel's only
    // classes applied from outside a markup template, so nothing else would notice
    // if one of them lost its rule and the invalid state became invisible.
    const rules = readStyleSheet();
    for (const name of ['st-emote-hint-bad', 'st-emote-input-bad']) {
        assert.ok(`.${name}` in rules, `${name} has no rule`);
    }
});

/**
 * Classes that carry no identity of their own, so the control surface leaves them
 * out. A hook applied to *every* action button says nothing about which controls
 * exist, and recording it would mean the snapshot fails on every styling pass
 * while still not noticing one control appearing or disappearing. Their being
 * styled at all is the subject of their own test.
 */
const PRESENTATION_HOOKS = ['st-emote-button'];

/**
 * Classes the panel applies to be *found* rather than to be styled: the per-pack
 * and per-sticker action buttons (a test clicks `.st-emote-delete-pack`),
 * `st-emote-badge-empty` (the state with nothing to say, so it needs no colour),
 * and the three container classes that carry an id and no appearance of their own.
 *
 * Every other `st-emote-*` class the panel applies must have a rule, which is what
 * the test above enforces.
 */
const QUERY_HOOKS = [
    'st-emote-add-url',
    'st-emote-badge-empty',
    'st-emote-delete-pack',
    'st-emote-export',
    'st-emote-packs',
    'st-emote-placement',
    'st-emote-replace',
    'st-emote-sizes',
    'st-emote-sticker-delete',
    'st-emote-upload',
];

/**
 * The panel's control surface, one line per control: `where :: what it is what
 * it says`.
 *
 * Read it as the answer to "what can a user do on this panel". The `where` half
 * is what makes it a layout snapshot rather than a bag of strings — two 尺寸集
 * with the same seven fields are told apart by which set they are in, two
 * buttons that both say "Delete" are told apart by the 表情 they act on.
 */
const EXPECTED_CONTROL_SURFACE = [
    'debug area :: div#st_emote_preview_run.menu_button "Render"',
    'debug area :: div#st_emote_rerender.menu_button "Re-render the current chat"',
    'debug area :: textarea#st_emote_preview.text_pole "Paste a message, e.g. She smiles. [[sticker:daily:happy]]"',
    'pack "blank" / header :: div.menu_button.st-emote-add-url "Add image URL"',
    'pack "blank" / header :: div.menu_button.st-emote-delete-pack "Delete pack"',
    'pack "blank" / header :: div.menu_button.st-emote-export "Export .zip"',
    'pack "blank" / header :: div.menu_button.st-emote-upload "Upload images"',
    'pack "blank" / header :: input[file][image/png,image/jpeg,image/webp,image/gif multiple] (no caption)',
    'pack "blank" / header :: input[text].st-emote-pack-name.text_pole "blank"',
    'pack "blank" / selection bar :: input[checkbox] "Select all"',
    'pack "blank" / 作用域 :: input[checkbox] "Character"',
    'pack "blank" / 作用域 :: input[checkbox] "Chat"',
    'pack "blank" / 作用域 :: input[checkbox] "Global"',
    'pack "daily" / header :: div.menu_button.st-emote-add-url "Add image URL"',
    'pack "daily" / header :: div.menu_button.st-emote-delete-pack "Delete pack"',
    'pack "daily" / header :: div.menu_button.st-emote-export "Export .zip"',
    'pack "daily" / header :: div.menu_button.st-emote-upload "Upload images"',
    'pack "daily" / header :: input[file][image/png,image/jpeg,image/webp,image/gif multiple] (no caption)',
    'pack "daily" / header :: input[text].st-emote-pack-name.text_pole "daily"',
    'pack "daily" / selection bar :: input[checkbox] "Select all"',
    'pack "daily" / sticker "happy" :: div.menu_button.st-emote-replace "Replace"',
    'pack "daily" / sticker "happy" :: div.menu_button.st-emote-sticker-delete "Delete"',
    'pack "daily" / sticker "happy" :: input[checkbox].st-emote-sticker-tick "Select for a batch delete"',
    'pack "daily" / sticker "happy" :: input[file][image/png,image/jpeg,image/webp,image/gif single] (no caption)',
    'pack "daily" / sticker "happy" :: input[text].st-emote-description.text_pole "—"',
    'pack "daily" / sticker "happy" :: input[text].st-emote-label.text_pole "Label"',
    'pack "daily" / sticker "happy" :: select.st-emote-sticker-placement.text_pole[="Follow the global setting" | in-place="In place" | after-block="After the block" | message-end="End of message"] "Placement override for this sticker"',
    'pack "daily" / sticker "sad" :: div.menu_button.st-emote-replace "Replace"',
    'pack "daily" / sticker "sad" :: div.menu_button.st-emote-sticker-delete "Delete"',
    'pack "daily" / sticker "sad" :: input[checkbox].st-emote-sticker-tick "Select for a batch delete"',
    'pack "daily" / sticker "sad" :: input[file][image/png,image/jpeg,image/webp,image/gif single] (no caption)',
    'pack "daily" / sticker "sad" :: input[text].st-emote-description.text_pole "—"',
    'pack "daily" / sticker "sad" :: input[text].st-emote-label.text_pole "Label"',
    'pack "daily" / sticker "sad" :: select.st-emote-sticker-placement.text_pole[="Follow the global setting" | in-place="In place" | after-block="After the block" | message-end="End of message"] "Placement override for this sticker"',
    'pack "daily" / sticker "wave" :: div.menu_button.st-emote-replace "Replace"',
    'pack "daily" / sticker "wave" :: div.menu_button.st-emote-sticker-delete "Delete"',
    'pack "daily" / sticker "wave" :: input[checkbox].st-emote-sticker-tick "Select for a batch delete"',
    'pack "daily" / sticker "wave" :: input[file][image/png,image/jpeg,image/webp,image/gif single] (no caption)',
    'pack "daily" / sticker "wave" :: input[text].st-emote-description.text_pole "—"',
    'pack "daily" / sticker "wave" :: input[text].st-emote-label.text_pole "Label"',
    'pack "daily" / sticker "wave" :: select.st-emote-sticker-placement.text_pole[="Follow the global setting" | in-place="In place" | after-block="After the block" | message-end="End of message"] "Placement override for this sticker"',
    'pack "daily" / 作用域 :: input[checkbox] "Character"',
    'pack "daily" / 作用域 :: input[checkbox] "Chat"',
    'pack "daily" / 作用域 :: input[checkbox] "Global"',
    'pack "zeta" / header :: div.menu_button.st-emote-add-url "Add image URL"',
    'pack "zeta" / header :: div.menu_button.st-emote-delete-pack "Delete pack"',
    'pack "zeta" / header :: div.menu_button.st-emote-export "Export .zip"',
    'pack "zeta" / header :: div.menu_button.st-emote-upload "Upload images"',
    'pack "zeta" / header :: input[file][image/png,image/jpeg,image/webp,image/gif multiple] (no caption)',
    'pack "zeta" / header :: input[text].st-emote-pack-name.text_pole "zeta"',
    'pack "zeta" / selection bar :: input[checkbox] "Select all"',
    'pack "zeta" / sticker "zappy" :: div.menu_button.st-emote-replace "Replace"',
    'pack "zeta" / sticker "zappy" :: div.menu_button.st-emote-sticker-delete "Delete"',
    'pack "zeta" / sticker "zappy" :: input[checkbox].st-emote-sticker-tick "Select for a batch delete"',
    'pack "zeta" / sticker "zappy" :: input[file][image/png,image/jpeg,image/webp,image/gif single] (no caption)',
    'pack "zeta" / sticker "zappy" :: input[text].st-emote-description.text_pole "—"',
    'pack "zeta" / sticker "zappy" :: input[text].st-emote-label.text_pole "Label"',
    'pack "zeta" / sticker "zappy" :: select.st-emote-sticker-placement.text_pole[="Follow the global setting" | in-place="In place" | after-block="After the block" | message-end="End of message"] "Placement override for this sticker"',
    'pack "zeta" / 作用域 :: input[checkbox] "Character"',
    'pack "zeta" / 作用域 :: input[checkbox] "Chat"',
    'pack "zeta" / 作用域 :: input[checkbox] "Global"',
    'settings :: div#st_emote_copy_regex.menu_button "Copy regex JSON"',
    'settings :: div#st_emote_create_pack.menu_button "Create pack"',
    'settings :: div#st_emote_import_pack.menu_button "Import pack (.zip)"',
    'settings :: input[checkbox]#st_emote_bracket_form "Bracket form: [[sticker:pack:label]]"',
    'settings :: input[checkbox]#st_emote_enabled "Render stickers at all"',
    'settings :: input[checkbox]#st_emote_render_user "Render stickers in user messages"',
    'settings :: input[checkbox]#st_emote_tag_form "HTML tag form: the tag name below, wrapping pack:label"',
    'settings :: input[file][.zip,application/zip single] (no caption)',
    'settings :: input[text]#st_emote_new_pack.text_pole "New pack name"',
    'settings :: input[text]#st_emote_search.text_pole "Search labels and descriptions"',
    'settings :: input[text]#st_emote_tag_name.text_pole "HTML tag form:"',
    'settings :: select#st_emote_placement.text_pole[in-place="In place" | after-block="After the block" | message-end="End of message"] "Placement"',
    '尺寸集 "Block size (after the block / end of message)" :: input[text].st-emote-size.text_pole "Gap between stickers (left/right)"',
    '尺寸集 "Block size (after the block / end of message)" :: input[text].st-emote-size.text_pole "Gap between stickers (top/bottom)"',
    '尺寸集 "Block size (after the block / end of message)" :: input[text].st-emote-size.text_pole "Max height"',
    '尺寸集 "Block size (after the block / end of message)" :: input[text].st-emote-size.text_pole "Max width"',
    '尺寸集 "Block size (after the block / end of message)" :: input[text].st-emote-size.text_pole "Min height"',
    '尺寸集 "Block size (after the block / end of message)" :: input[text].st-emote-size.text_pole "Min width"',
    '尺寸集 "Block size (after the block / end of message)" :: select.text_pole[="default" | cover="cover" | contain="contain" | fill="fill"] "Fill"',
    '尺寸集 "Inline size (in place)" :: input[text].st-emote-size.text_pole "Gap between stickers (left/right)"',
    '尺寸集 "Inline size (in place)" :: input[text].st-emote-size.text_pole "Gap between stickers (top/bottom)"',
    '尺寸集 "Inline size (in place)" :: input[text].st-emote-size.text_pole "Max height"',
    '尺寸集 "Inline size (in place)" :: input[text].st-emote-size.text_pole "Max width"',
    '尺寸集 "Inline size (in place)" :: input[text].st-emote-size.text_pole "Min height"',
    '尺寸集 "Inline size (in place)" :: input[text].st-emote-size.text_pole "Min width"',
    '尺寸集 "Inline size (in place)" :: select.text_pole[="default" | cover="cover" | contain="contain" | fill="fill"] "Fill"',
];

/**
 * Where in the panel a control sits, named by the thing it belongs to rather
 * than by its position in the tree — so a reflow that moves a control from one
 * row to another is visible in the surface but a reflow that only nests it
 * deeper is not mistaken for a change.
 *
 * @param {Element} element
 * @returns {string}
 */
function controlRegion(element) {
    const pack = element.closest('.st-emote-pack');
    if (pack) {
        const name = pack.querySelector('.st-emote-pack-name')?.value ?? '?';
        const row = element.closest('.st-emote-sticker');
        if (row) {
            const label = row.querySelector('.st-emote-label')?.value;
            return label === undefined
                ? `pack "${name}" / sticker with no label input`
                : `pack "${name}" / sticker "${label}"`;
        }
        if (element.closest('.st-emote-scopes')) {
            return `pack "${name}" / 作用域`;
        }
        if (element.closest('.st-emote-selection')) {
            return `pack "${name}" / selection bar`;
        }
        return `pack "${name}" / header`;
    }
    const sizeSet = element.closest('.st-emote-size-set');
    if (sizeSet) {
        return `尺寸集 "${sizeSet.querySelector('.st-emote-size-set-title').textContent}"`;
    }
    if (element.closest('.st-emote-debug')) {
        return 'debug area';
    }
    return 'settings';
}

/**
 * What a control says. The order is the panel's own: a caption the author wrote
 * next to it, then the tooltip, then the placeholder, then — for a field with
 * nothing else — its current value. The hidden file pickers say nothing at all;
 * their caption is the button that opens them.
 *
 * @param {Element} element
 * @returns {string}
 */
function controlCaption(element) {
    if (element.classList.contains('menu_button')) {
        return `"${element.textContent}"`;
    }
    const label = element.closest('label');
    if (label) {
        const span = label.querySelector(':scope > span');
        if (span) {
            return `"${span.textContent.trim()}"`;
        }
        // A 作用域 toggle wraps its name in a bare text node rather than a span.
        const text = [...label.childNodes]
            .filter((node) => node.nodeType === 3)
            .map((node) => node.textContent)
            .join('')
            .trim();
        if (text !== '') {
            return `"${text}"`;
        }
    }
    for (const attribute of ['title', 'placeholder']) {
        const value = element.getAttribute(attribute);
        if (value) {
            return `"${value}"`;
        }
    }
    return element.value === '' ? '(no caption)' : `"${element.value}"`;
}

/**
 * The facts a caption cannot carry: what a file picker accepts, and what a select
 * offers. A renamed or dropped option changes the panel's behaviour without
 * changing a single word of its text, so it belongs in the surface.
 *
 * @param {Element} element
 * @returns {string}
 */
function controlDetails(element) {
    if (element.getAttribute('type') === 'file') {
        const flags = [element.accept, element.multiple ? 'multiple' : 'single']
            .filter(Boolean)
            .join(' ');
        return `[${flags}]`;
    }
    if (element.tagName === 'SELECT') {
        const options = [...element.options]
            .map((option) => `${option.value}="${option.textContent}"`)
            .join(' | ');
        return `[${options}]`;
    }
    return '';
}

/**
 * The whole panel's control surface as sorted lines. Every element a user can
 * operate is in: inputs, selects, the debug box, and the client's `.menu_button`
 * which is a `<div>` this extension paints rather than a real `<button>`.
 *
 * @param {Document} document
 * @returns {string[]}
 */
function controlSurface(document) {
    return [...document.querySelectorAll(
        '#st_emote_drawer input, #st_emote_drawer select, #st_emote_drawer textarea, #st_emote_drawer .menu_button',
    )].map((element) => {
        const type = element.getAttribute('type') ?? '';
        const classes = [...element.classList]
            .filter((name) => !PRESENTATION_HOOKS.includes(name))
            .sort();
        const head = `${element.tagName.toLowerCase()}`
            + `${type === '' ? '' : `[${type}]`}`
            + `${element.id === '' ? '' : `#${element.id}`}`
            + `${classes.length === 0 ? '' : `.${classes.join('.')}`}`;
        return `${controlRegion(element)} :: ${head}${controlDetails(element)} ${controlCaption(element)}`;
    }).sort();
}

/**
 * `style.css` as a selector → declarations map, so a test can ask "is there a rule
 * for this" without a browser. Comments are dropped, since a class named inside
 * one is a note rather than a rule.
 *
 * @returns {Record<string, string>}
 */
function readStyleSheet() {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = {};
    for (const block of css.split('}')) {
        const open = block.indexOf('{');
        if (open === -1) {
            continue;
        }
        rules[block.slice(0, open).trim()] = block.slice(open + 1);
    }
    return rules;
}

/**
 * Every word the panel paints, as one string. The panel is the only place a
 * sentence can be assembled, so collecting its text is how a test asks "is the
 * whole surface in this language" without holding down one control per key.
 *
 * @param {{locale?: string}} [options]
 * @returns {Promise<string>}
 */
async function panelText(options) {
    let collected = '';
    await withPanelMounted(options, ({ document }) => {
        const parts = [document.getElementById('st_emote_drawer').textContent];
        for (const node of document.querySelectorAll(
            '[placeholder], [title], option',
        )) {
            parts.push(node.getAttribute('placeholder') ?? '');
            parts.push(node.getAttribute('title') ?? '');
            parts.push(node.textContent ?? '');
        }
        collected = parts.join('\n');
    });
    return collected;
}

/**
 * @param {Document} document
 * @param {string} name
 * @returns {Element}
 */
function packByName(document, name) {
    return [...document.querySelectorAll('.st-emote-pack')]
        .find((pack) => pack.querySelector('.st-emote-pack-name').value === name);
}

/**
 * @param {Document} document
 * @param {string} packName
 * @param {string} label
 * @returns {Element}
 */
function stickerRow(document, packName, label) {
    return [...packByName(document, packName).querySelectorAll('.st-emote-sticker')]
        .find((row) => row.querySelector('.st-emote-label').value === label);
}

/**
 * Stand in for the browser's `confirm`, recording whether it was asked at all —
 * a delete that never asked is the failure this suite exists to catch.
 *
 * @param {boolean} answer
 */
function harnessConfirm(answer) {
    globalThis.confirm = (message) => {
        globalThis.__confirm = { asked: true, message };
        return answer;
    };
    globalThis.__confirm = { asked: false };
}

/** Let the panel's async handlers finish. */
async function settle() {
    // Several turns: a file read, a fetch, then the re-render and the refresh of
    // the stored-file listing are all separate turns of the event loop.
    for (let turn = 0; turn < 6; turn += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

/**
 * Wait until the panel has said something, rather than for a fixed number of
 * turns. A turn count is a guess that is wrong for exactly the slow cases, and
 * a wrong guess here does not just fail — the work is still in flight when the
 * next test swaps out `window.toastr`, and this test's message lands in that
 * one's assertions.
 *
 * @param {() => boolean} done
 * @param {string} what - What was being waited for, for the failure message.
 */
async function waitFor(done, what) {
    for (let attempt = 0; attempt < 500; attempt += 1) {
        if (done()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail(`timed out waiting for ${what}`);
}
