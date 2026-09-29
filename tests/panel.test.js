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

import { ACTION_ICONS } from '../adapter/buttons.js';
import { STORAGE_KEY } from '../adapter/settings.js';
import { t } from '../core/i18n.js';
import { FREE_ICON_CLASSES, FREE_ICON_CODEPOINTS } from './contract/font-awesome.js';
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
 * @param {object} [options.client] - Fields written onto the context **before**
 *   the panel mounts, for the facts the panel reads once at mount rather than
 *   per event — a character card naming a pack that is not installed, for
 *   instance, which is what puts the "create missing packs" button on screen.
 * @param {(document: Document) => (() => void)|void} [options.arrange] - Drive the
 *   panel after it mounts, for the controls that only exist once something has
 *   been ticked. Whatever it returns is run when `body` is done, so the panel's
 *   module state does not leak into the next test: `selectedStickerIds` in
 *   `adapter/ui.js` is deliberately kept across re-renders and across mounts,
 *   because a real user's selection should survive a re-render, and a shared
 *   one is exactly what makes a later test's control surface depend on an
 *   earlier test's ticks.
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
        Object.assign(harness, options?.client ?? {});
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
        // Declared out here so the `finally` can undo it even if the mount
        // throws, and assigned after the first paint — `arrange` drives the
        // mounted panel, not the settings.
        let restore = () => {};
        try {
            const { mountSettingsPanel } = await import('../adapter/ui.js');
            mountSettingsPanel(harness);
            // The first paint waits for the stored-file listing, so let it land.
            await new Promise((resolve) => setTimeout(resolve, 0));
            restore = options?.arrange?.(globalThis.document) ?? (() => {});
            await body({ ...harness, toasts, fetchImpl });
        } finally {
            restore();
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
        assert.match(button.getAttribute('aria-label'), /Delete 2 selected/);
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
        assert.equal(button.getAttribute('aria-label'), 'Re-render the current chat');

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
// The panel's interaction: icon buttons and collapsible sections (ticket 11).
//
// Two changes, and the failure each one causes is not the same kind of thing.
// An icon that Font Awesome has never heard of renders as **nothing** — no
// error, no fallback, just a button that does nothing and says nothing — so
// what is tested is that every glyph comes from one table and every entry in
// that table is drawn by somebody. A collapsed section can hide an error, so
// what is tested is that a 尺寸集 holding a value that is not a size opens
// itself, and that it opens with the client's own drawer classes rather than
// with a widget of our own that nobody would remember to keep accessible.
// ---------------------------------------------------------------------------

test('every icon the panel draws is one whose glyph is in the client\'s free font', async () => {
    // The one failure this feature cannot detect on its own. Font Awesome
    // resolves a glyph by class name and draws *nothing* for a name it does not
    // have: no error, no fallback, nothing in the DOM that says the name was
    // wrong. A Pro-only name therefore looks exactly like a working one, and
    // every other test here would report it as a pass.
    //
    // `FREE_ICON_CLASSES` is the recorded evidence — each name was resolved
    // against the client's stylesheet *and* found in the client's free solid
    // webfont — and the class strings in `ACTION_ICONS` are compared against it,
    // so a glyph typed into the table by hand has to agree with what was
    // verified. See `tests/contract/font-awesome.js`.
    for (const [action, classes] of Object.entries(ACTION_ICONS)) {
        const recorded = FREE_ICON_CLASSES[action];
        assert.ok(recorded, `${action} is in ACTION_ICONS but no glyph was verified for it`);
        const [family, glyph] = classes.split(' ');
        assert.equal(family, 'fa-solid', `${action} does not ask for the solid family`);
        assert.equal(
            glyph,
            recorded,
            `${action} draws "${glyph}", which is not the recorded, verified glyph "${recorded}"`,
        );
        assert.ok(
            Number.isInteger(FREE_ICON_CODEPOINTS[action]),
            `${action} has no recorded codepoint, so nothing was verified about it`,
        );
    }

    // And the two chevrons the collapsible headers use, which are not in
    // `ACTION_ICONS` because they are not buttons. The client picks the class
    // and the free font has to carry both directions, or a section opens onto a
    // blank arrow.
    assert.equal(FREE_ICON_CLASSES.sectionChevronDown, 'fa-circle-chevron-down');
    assert.equal(FREE_ICON_CLASSES.sectionChevronUp, 'fa-circle-chevron-up');
});

test('every button draws one of those glyphs, and every one of those is drawn', async () => {
    // The orphan test, in both directions, because the ticket's failure is a
    // *dead name left behind*. An entry nothing draws is a name a future button
    // might reach for, and if it was renamed or dropped from the free set in the
    // meantime it would fail silently. A class on a button that is not in the
    // table is the other half: a name nobody ever checked in the first place.
    const drawn = new Set();
    for (const state of iconButtonStates()) {
        // eslint-disable-next-line no-await-in-loop
        await withPanelMounted(state.options, ({ document }) => {
            for (const button of document.querySelectorAll('.st-emote-icon-button')) {
                const handle = buttonHandle(button);
                const glyph = button.querySelector('.st-emote-icon');
                assert.ok(glyph, `${handle} has no icon element`);
                // `fa-solid` is the family rather than a glyph; the other class
                // is the name, and that is the one that has to be recorded.
                const fa = [...glyph.classList].filter((name) => name !== 'st-emote-icon');
                assert.equal(fa.length, 2, `${handle} does not draw exactly one glyph`);
                for (const name of fa) {
                    drawn.add(name);
                }
            }
        });
    }

    // `fa-solid` names the font rather than a glyph — it is what makes the
    // glyph a *solid* one — so it is allowed on its own and is not a name that
    // could come back blank.
    const allowed = new Set(['fa-solid', ...Object.values(FREE_ICON_CLASSES)]);
    for (const name of drawn) {
        assert.equal(allowed.has(name), true, `"${name}" is drawn but was never verified`);
    }
    for (const name of allowed) {
        if (name === 'fa-solid' || name.startsWith('fa-circle-chevron-')) {
            continue; // the family, and the client's own chevrons
        }
        assert.ok(
            drawn.has(name),
            `"${name}" was verified but no button draws it — a dead name waiting to be reached for`,
        );
    }

    // And the buttons themselves: every one is in the table of catalog keys, and
    // every key in it is a button. Without this, deleting a button would leave
    // the orphan half above passing happily.
    const handles = new Set((await iconButtonLabels()).keys());
    assert.deepEqual(
        [...handles].sort(),
        Object.keys(EXPECTED_ICON_BUTTON_KEYS).sort(),
        'the icon buttons on the panel and the table of catalog keys disagree',
    );
});

test('every icon button names itself, in both languages', async () => {
    // The cost of a glyph is that it does not say what it is. Two things put
    // the sentence back — a `title` for the pointer and an `aria-label` for a
    // screen reader — and they come from the *same* catalog key, so a
    // translation can never reach one and miss the other.
    //
    // Looped over every button rather than asserted on one, because the failure
    // is per-button: a new action added with only a `title` looks correct in
    // every screenshot ever taken of it.
    for (const { label, pattern } of [
        { label: 'English', pattern: /[A-Za-z]/ },
        { label: 'Chinese', pattern: /[一-鿿]/ },
    ]) {
        // eslint-disable-next-line no-await-in-loop
        const sentences = await collectIconButtonSentences(label, pattern);
        assert.ok(sentences.length >= 13, `only ${sentences.length} icon buttons were mounted`);
    }
});

test('the catalog sentence behind an icon button is the one it used to paint', async () => {
    // Iconifying must not *lose* a sentence. Each button is paired with the key
    // it draws, and the key's value has to be the button's tooltip — in both
    // languages. A key deleted as "no longer the button's text" would fail here.
    // The `{count}` a few sentences carry is filled in at build time, so the
    // comparison substitutes a value the key is then asked to substitute — the
    // point is that the *sentence* is the key's, not the number in it.
    const PROBE = '7';
    const english = await iconButtonLabels();
    for (const [handle, expected] of Object.entries(EXPECTED_ICON_BUTTON_KEYS)) {
        const sentence = t(expected.key, { count: PROBE });
        const actual = english.get(handle) ?? '';
        if (expected.count) {
            assert.equal(
                actual.replace(expected.count, PROBE),
                sentence,
                `${handle} does not say ${expected.key}`,
            );
        } else {
            assert.equal(actual, sentence, `${handle} does not say ${expected.key}`);
        }
    }

    // And in the other language, from the same key — so a translation can never
    // reach the tooltip and miss the accessible name, or the reverse.
    const chinese = await iconButtonLabels({ locale: 'zh-cn' });
    for (const [handle, expected] of Object.entries(EXPECTED_ICON_BUTTON_KEYS)) {
        const sentence = t(expected.key, { count: PROBE });
        const actual = chinese.get(handle) ?? '';
        if (expected.count) {
            assert.equal(
                actual.replace(expected.count, PROBE),
                sentence,
                `${handle} does not say ${expected.key} in Chinese`,
            );
        } else {
            assert.equal(actual, sentence, `${handle} does not say ${expected.key} in Chinese`);
        }
        assert.notEqual(actual, english.get(handle), `${handle} is not translated`);
    }
});

test('the sections that hold an explanation start collapsed, and use the client\'s drawer', async () => {
    // Two things at once, because they are one commitment. The list is what the
    // ticket decided collapses; the class names are how "we used the client's
    // drawer" becomes checkable rather than a claim in a comment. A hand-rolled
    // `<details>`, a `max-height` transition or a bespoke toggle would fail
    // here even if it looked right.
    await withPanelMounted({}, ({ document }) => {
        for (const title of ['Listing macro', 'Context-clearing regex', 'Import and export a pack']) {
            const section = sectionByTitle(document, title);
            assert.ok(section, `no section titled "${title}"`);
            assert.equal(section.classList.contains('inline-drawer'), true, `${title} is not a drawer`);

            const toggle = section.querySelector(':scope > .inline-drawer-toggle');
            const content = section.querySelector(':scope > .inline-drawer-content');
            assert.ok(toggle, `${title} has no .inline-drawer-toggle`);
            assert.ok(content, `${title} has no .inline-drawer-content`);
            // The state lives on the header, which is the control — a section
            // that announced its own state would be a second, unspeakable one.
            assert.equal(toggle.getAttribute('aria-expanded'), 'false', `${title} starts open`);
            assert.equal(content.style.display, 'none', `${title} is not hidden`);
            // The two classes the client's own click handler looks for, by
            // direct child of the drawer — a toggle nested one level deeper
            // would not be found, and the section would never open.
            assert.equal(toggle.classList.contains('inline-drawer-header'), true);
            assert.equal(toggle.parentElement, section);
            assert.equal(content.parentElement, section);
            // The chevron, in the closed state the client expects to find.
            const icon = section.querySelector(':scope > .inline-drawer-toggle > .inline-drawer-icon');
            assert.ok(icon, `${title} has no chevron`);
            assert.equal(icon.classList.contains('down'), true, `${title} does not start pointing down`);
            assert.equal(icon.classList.contains('fa-circle-chevron-down'), true);
        }
    });
});

test('the settings that are not explanations are not behind a header', async () => {
    // The other half of the ticket's table, and the half that is easy to
    // over-apply. 投放方式 is one select, 标记 is one input, and the 处理 group
    // holds the 总开关: hiding the master switch behind a header would be
    // hiding it. This asserts they are *reachable without a click* rather than
    // that they lack a class.
    await withPanelMounted({}, ({ document }) => {
        for (const id of [
            'st_emote_enabled',
            'st_emote_render_user',
            'st_emote_bracket_form',
            'st_emote_tag_form',
            'st_emote_tag_name',
            'st_emote_placement',
        ]) {
            const control = document.getElementById(id);
            assert.ok(control, `#${id} is missing`);
            const section = control.closest('.st-emote-section');
            assert.equal(section, null, `#${id} is behind a collapsible header`);
        }
        // The search box too: it filters the list right below it, so it is the
        // one control a user reaches for without deciding to open anything.
        assert.equal(document.getElementById('st_emote_search').closest('.st-emote-section'), null);
    });
});

test('a 尺寸集 holding a value that is not a size opens itself', async () => {
    // The one this ticket exists to get right. A refused size shows a hint
    // beside the input that was refused; a collapsed section would store the
    // value, log it, and hide the only place the user could learn about it. The
    // section opens itself, says why, and its content is reachable.
    await withPanelMounted({
        settings: { sizes: { inline: { maxHeight: 'not a size' } } },
    }, ({ document }) => {
        const section = document.querySelector('.st-emote-size-set');
        const toggle = section.querySelector('.inline-drawer-toggle');
        assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'the 尺寸集 stayed closed');
        assert.equal(
            section.querySelector('.st-emote-size-set-invalid') !== null,
            true,
            'the header does not say why it opened',
        );
        // The hint itself is where it always was: beside the input, inside the
        // content the user can now actually see.
        const hint = section.querySelector('.st-emote-hint-bad');
        assert.ok(hint, 'the invalid hint is not in the section');
        assert.equal(
            hint.closest('.inline-drawer-content'),
            section.querySelector('.inline-drawer-content'),
        );

        // The other set has no bad value, so it is still closed.
        const other = document.querySelectorAll('.st-emote-size-set')[1];
        assert.equal(other.querySelector('.inline-drawer-toggle').getAttribute('aria-expanded'), 'false');
    });
});

test('a 尺寸 set with every value valid opens collapsed again on the next mount', async () => {
    // "Until the value is fixed or cleared" is a claim about the state, not
    // about the moment: the section opens while the value is unusable and goes
    // back to the default the next time the panel is built. Storage is what
    // decides, so the fix is a settings change and a remount.
    await withPanelMounted({ settings: { sizes: { inline: { maxHeight: '2em' } } } }, ({ document }) => {
        for (const section of document.querySelectorAll('.st-emote-size-set')) {
            assert.equal(section.querySelector('.inline-drawer-toggle').getAttribute('aria-expanded'), 'false');
            assert.equal(section.querySelector('.st-emote-size-set-invalid'), null);
        }
    });
    // And the same shape with the bad value back: it opens again, so the state
    // is read from the value rather than remembered from a previous mount.
    await withPanelMounted({
        settings: { sizes: { inline: { maxHeight: 'not a size' } } },
    }, ({ document }) => {
        assert.equal(
            document.querySelector('.st-emote-size-set .inline-drawer-toggle')
                .getAttribute('aria-expanded'),
            'true',
        );
    });
});

test('a 尺寸 set that has been changed says so on its collapsed header', async () => {
    // Both sets are seven empty fields by default, so two collapsed sets look
    // identical and neither is worth opening. The one with a value in it is the
    // one the user is looking for, so the header says which.
    await withPanelMounted({}, ({ document }) => {
        for (const section of document.querySelectorAll('.st-emote-size-set')) {
            assert.equal(section.querySelector('.st-emote-size-set-mark'), null, 'an untouched set is marked');
        }
    });
    await withPanelMounted({
        settings: { sizes: { inline: { maxHeight: '2em' } } },
    }, ({ document }) => {
        const [inline, block] = document.querySelectorAll('.st-emote-size-set');
        assert.equal(inline.querySelector('.st-emote-size-set-mark') !== null, true);
        assert.equal(block.querySelector('.st-emote-size-set-mark'), null);
    });
});

test('clicking a section header flips the state the client will animate', async () => {
    // jsdom has no jQuery, so it cannot check that the client *animates* the
    // content. What it can check is that our half agrees with the client's half
    // about which way it is going: the header advertises `aria-expanded` and the
    // chevron points the other way, and the chevron is the class the client
    // toggles. A header whose `aria-expanded` never moved would be a header
    // lying to a screen reader while looking perfectly correct.
    await withPanelMounted({}, ({ document }) => {
        const toggle = sectionByTitle(document, 'Listing macro').querySelector('.inline-drawer-toggle');
        const icon = toggle.querySelector('.inline-drawer-icon');

        assert.equal(toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(icon.classList.contains('down'), true);

        toggle.click();
        assert.equal(toggle.getAttribute('aria-expanded'), 'true');
        assert.equal(icon.classList.contains('up'), true);
        assert.equal(icon.classList.contains('fa-circle-chevron-up'), true);
        assert.equal(icon.classList.contains('down'), false);

        toggle.click();
        assert.equal(toggle.getAttribute('aria-expanded'), 'false');
        assert.equal(icon.classList.contains('down'), true);
        assert.equal(icon.classList.contains('up'), false);
    });
});

test('no collapsible section is built as a widget of our own', async () => {
    // The failure this catches is someone reaching past `collapsibleSection`
    // because a `<details>` was quicker, or because a `max-height` animation
    // looked nicer. Both are invisible in a screenshot of a *working* panel and
    // both throw away the client's keyboard handling and styling.
    await withPanelMounted({}, ({ document }) => {
        for (const section of document.querySelectorAll('.st-emote-section')) {
            assert.equal(section.classList.contains('inline-drawer'), true);
            assert.equal(section.querySelector('details, summary'), null);
        }
    });
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

test('a sticker row is two rows: the 标签 alone on top, the 描述 and the override below', async () => {
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
        // The 投放方式 override is a rarely-used per-sticker setting, so it sits on
        // the second row with the actions rather than between the two fields a user
        // actually types into. This also keeps the row's tab order identical to what
        // the one-line layout gave: 标签, 描述, 投放方式, Replace, Delete.
        assert.equal(top.querySelector('.st-emote-sticker-placement'), null);
        assert.equal(bottom.querySelector('.st-emote-sticker-placement') !== null, true);
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
    // A class no stylesheet knows about is a class the next change cannot find,
    // and the failure shows up as an element quietly looking like the default one.
    //
    // **Two panel states, not one.** Several classes only exist in some states —
    // `st-emote-pack-missing` needs the server to report none of our files,
    // `st-emote-delete-selected` needs a ticked sticker, `st-emote-input-bad` needs
    // a refused size value — so a single ordinary render would check a third of
    // the surface and pass anyway. The two states below are chosen to reach all of
    // them.
    //
    // "Styled" means the class appears in *some* selector, not that it heads one:
    // `.menu_button.st-emote-button` and `.st-emote-actions .st-emote-delete-pack`
    // are the two rules written that way on purpose — the first to outrank the
    // client's own `.menu_button`, the second to separate one action from the rest
    // of its group — and neither would a lookup by exact key find.
    //
    // QUERY_HOOKS is the deliberate exception: a class that appears in no selector
    // at all, put there to be found by a test. Adding one is a decision to record,
    // not an oversight.
    const known = styledClasses();
    const used = new Set();

    await withPanelMounted({}, ({ document }) => {
        collectClasses(document, used);
    });
    // The states the plain fixture never reaches.
    await withPanelMounted({ storedFiles: [] }, ({ document }) => {
        for (const tick of document.querySelectorAll('.st-emote-sticker-tick')) {
            tick.checked = true;
            tick.dispatchEvent(new globalThis.window.Event('change'));
        }
        const size = document.querySelector('.st-emote-size');
        size.value = 'not a size';
        size.dispatchEvent(new globalThis.window.Event('change'));
        collectClasses(document, used);
    });

    const unknown = [...used]
        .filter((name) => !known.has(name) && !QUERY_HOOKS.includes(name))
        .sort();
    assert.deepEqual(unknown, []);
});

/**
 * Every `st-emote-*` class in force anywhere under the drawer.
 *
 * @param {Document} document
 * @param {Set<string>} into
 */
function collectClasses(document, into) {
    for (const element of document.querySelectorAll('#st_emote_drawer *')) {
        for (const name of element.classList) {
            if (name.startsWith('st-emote')) {
                into.add(name);
            }
        }
    }
}

test('every class the 尺寸 controls toggle is styled', async () => {
    // The two state classes `showFieldHint` flips. They are the panel's only
    // classes applied from outside a markup template, and neither appears on a
    // mounted panel until a size value is refused — so nothing in the panel test
    // would notice if one of them lost its rule and the invalid state went
    // invisible exactly when it mattered.
    const known = styledClasses();
    for (const name of ['st-emote-hint-bad', 'st-emote-input-bad']) {
        assert.ok(known.has(name), `${name} has no rule`);
    }
});

/**
 * Classes that carry no identity of their own, so the control surface leaves them
 * out. A hook applied to *every* action button says nothing about which controls
 * exist, and recording it would mean the snapshot fails on every styling pass
 * while still not noticing one control appearing or disappearing. Their being
 * styled at all is the subject of their own test.
 *
 * `st-emote-icon-button` is in the same position as `st-emote-button` and for
 * the same reason: it says how a button is drawn, not what it does. It is
 * excluded rather than recorded so that iconifying every button on the panel
 * did not have to rewrite 30-odd lines of the snapshot — which is the point,
 * since a diff full of one added class is a diff nobody reads carefully.
 */
const PRESENTATION_HOOKS = ['st-emote-button', 'st-emote-icon-button'];

/**
 * Which catalog key each icon button says, by the query hook that reaches it.
 *
 * The hard boundary of ticket 11 in one table: these are the **actions**, and
 * each one's sentence moved from the button's text into its tooltip. Every key
 * here still exists in both catalogs — nothing was deleted, which the test
 * above checks by comparing each button against `t(key)` rather than against a
 * literal.
 *
 * **Deliberately absent**: every 标签 on the panel — the select captions, the
 * size-field names, the checkbox descriptions, and the colon-prefixed "HTML tag
 * form:". A field's name is not an action, and an interface where even the
 * field names are glyphs is one a user has to navigate from memory. That is a
 * boundary of this feature, so it is written down here rather than left to the
 * next person to re-decide.
 *
 * @type {Record<string, {key: string, count?: RegExp}>}
 */
const EXPECTED_ICON_BUTTON_KEYS = {
    '#st_emote_create_pack': { key: 'panel.createPack' },
    '#st_emote_copy_regex': { key: 'panel.copyRegex' },
    '#st_emote_import_pack': { key: 'panel.importPack' },
    // The only action button with neither a per-action hook nor an id, because it
    // had neither before this ticket either. Reached through its container.
    '#st_emote_missing .menu_button': { key: 'panel.createMissingPacks' },
    'st-emote-upload': { key: 'pack.uploadImages' },
    'st-emote-add-url': { key: 'pack.addImageUrl' },
    'st-emote-export': { key: 'pack.exportZip' },
    'st-emote-delete-pack': { key: 'pack.deletePack' },
    // The count is whichever stickers *this* pack has ticked, so it differs
    // from pack to pack and is matched as a number rather than pinned. The
    // count itself is the subject of the batch-delete test above; what matters
    // here is that the sentence is still this key and not a new one.
    'st-emote-delete-selected': { key: 'pack.deleteSelected', count: /\d+/ },
    'st-emote-replace': { key: 'sticker.replace' },
    'st-emote-sticker-delete': { key: 'sticker.delete' },
    '#st_emote_preview_run': { key: 'panel.previewRun' },
    '#st_emote_rerender': { key: 'panel.rerender' },
};

/**
 * Classes the panel applies to be *found* rather than to be styled: the
 * per-action query hooks a test clicks (`.st-emote-export`), `st-emote-badge-empty`
 * (the one state with nothing extra to say, so it needs no colour of its own), and
 * the container class that carries an id and no appearance.
 *
 * Every other `st-emote-*` class the panel applies must have a rule, which is what
 * the test above enforces — over two panel states, so the conditional ones count.
 */
const QUERY_HOOKS = [
    'st-emote-add-url',
    'st-emote-badge-empty',
    'st-emote-delete-selected',
    'st-emote-export',
    'st-emote-packs',
    'st-emote-replace',
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
    '尺寸集 "Block size (after the block / end of message)" :: select.st-emote-size.text_pole[="default" | cover="cover" | contain="contain" | fill="fill"] "Fill"',
    '尺寸集 "Inline size (in place)" :: input[text].st-emote-size.text_pole "Gap between stickers (left/right)"',
    '尺寸集 "Inline size (in place)" :: input[text].st-emote-size.text_pole "Gap between stickers (top/bottom)"',
    '尺寸集 "Inline size (in place)" :: input[text].st-emote-size.text_pole "Max height"',
    '尺寸集 "Inline size (in place)" :: input[text].st-emote-size.text_pole "Max width"',
    '尺寸集 "Inline size (in place)" :: input[text].st-emote-size.text_pole "Min height"',
    '尺寸集 "Inline size (in place)" :: input[text].st-emote-size.text_pole "Min width"',
    '尺寸集 "Inline size (in place)" :: select.st-emote-size.text_pole[="default" | cover="cover" | contain="contain" | fill="fill"] "Fill"',
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
        // The set's name is its drawer title now, not a heading of its own.
        return `尺寸集 "${sizeSet.querySelector('.st-emote-section-title').textContent}"`;
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
        // An action button is a glyph now, so the sentence it carries is the
        // one a user reads on hover and a screen reader announces — the same
        // catalog key either way, which is why the snapshot below is unchanged.
        return `"${element.getAttribute('aria-label') ?? ''}"`;
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
 * Every class name `style.css` mentions anywhere in a selector, from a rule that
 * is a bare `.name`, one of several in a list, or a descendant of something else.
 *
 * @returns {Set<string>}
 */
function styledClasses() {
    const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    const names = new Set();
    for (const match of css.matchAll(/\.([A-Za-z][\w-]*)/g)) {
        names.add(match[1]);
    }
    return names;
}

/**
 * `style.css` as a selector → declarations map, so a test can ask "is there a rule
 * for this" without a browser. Comments are dropped, since a class named inside
 * one is a note rather than a rule.
 *
 * Each selector in a comma-separated list gets its own entry, because
 * `.st-emote-placement, .st-emote-sizes` styles two classes and a lookup for
 * either of them has to find it.
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
        const declarations = block.slice(open + 1);
        for (const selector of block.slice(0, open).split(',')) {
            rules[selector.trim()] = declarations;
        }
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
 * The panel states between them reach every button the panel can draw.
 *
 * Three, not one, and for the same reason the class-coverage test above uses
 * two: several buttons exist only in some states. `deleteSelected` needs a
 * ticked sticker; `createMissingPacks` needs a character card naming a pack
 * that is not installed. A single ordinary render would check a third of the
 * icon table and pass anyway, and the orphan half of the test above would then
 * be asserting against a partial `drawn` set.
 *
 * @returns {{options: object}[]}
 */
function iconButtonStates() {
    return [
        { options: {} },
        { options: { storedFiles: [] } },
        {
            options: {
                client: {
                    characterId: 0,
                    characters: [{
                        avatar: 'someone.png',
                        data: { extensions: { [STORAGE_KEY]: { enabledPackNames: ['not-installed'] } } },
                    }],
                    chat: [{ mes: 'hi', original_avatar: 'someone.png' }],
                },
            },
        },
        {
            // `deleteSelected` exists only while something is ticked, and each
            // tick rebuilds the pack list — so this is the state where it has to
            // be caught, and the only way to catch it at all. Un-ticking is the
            // same code path in reverse, which also exercises it.
            options: {
                arrange: (document) => {
                    const ticks = [...document.querySelectorAll('.st-emote-sticker-tick')];
                    for (const tick of ticks) {
                        tick.checked = true;
                        tick.dispatchEvent(new globalThis.window.Event('change'));
                    }
                    return () => {
                        for (const tick of document.querySelectorAll('.st-emote-sticker-tick')) {
                            tick.checked = false;
                            tick.dispatchEvent(new globalThis.window.Event('change'));
                        }
                    };
                },
            },
        },
    ];
}

/**
 * Every icon button's tooltip and its accessible name, mounted in one locale.
 *
 * @param {string} label - Which language, for the failure message.
 * @param {RegExp} pattern - What that language's sentences look like, so a
 *   button that fell back to the source catalog is caught rather than passed.
 * @returns {Promise<string[]>}
 */
async function collectIconButtonSentences(label, pattern) {
    const sentences = [];
    for (const state of iconButtonStates()) {
        // eslint-disable-next-line no-await-in-loop
        await withPanelMounted({ ...state.options, locale: label === 'Chinese' ? 'zh-cn' : 'en' }, ({ document }) => {
            for (const button of document.querySelectorAll('.st-emote-icon-button')) {
                const where = buttonHandle(button);
                const title = button.getAttribute('title') ?? '';
                const aria = button.getAttribute('aria-label') ?? '';
                assert.notEqual(title, '', `${where} has no title in ${label}`);
                assert.equal(aria, title, `${where} announces something other than it says in ${label}`);
                assert.match(aria, pattern, `${where} does not say anything in ${label}: "${aria}"`);
                sentences.push(aria);
            }
        });
    }
    return sentences;
}

/**
 * Every icon button's tooltip, keyed by the query hook a test can reach it by.
 * A hook with no button is a wrong key rather than a missing control, so the
 * two are told apart by the caller.
 *
 * @param {{locale?: string}} [options]
 * @returns {Promise<Map<string, string>>}
 */
async function iconButtonLabels(options = {}) {
    const labels = new Map();
    for (const state of iconButtonStates()) {
        // eslint-disable-next-line no-await-in-loop
        await withPanelMounted({ ...state.options, locale: options.locale }, ({ document }) => {
            for (const button of document.querySelectorAll('.st-emote-icon-button')) {
                labels.set(buttonHandle(button), button.getAttribute('aria-label') ?? '');
            }
        });
    }
    return labels;
}

/**
 * How a test names one button.
 *
 * The id where the panel has one — the three skeleton actions and the two
 * debug actions are found by id in the code that wires them up, and inventing a
 * second handle for the same button would be a second thing to keep in step.
 * The per-action hook class otherwise, which is what the rest of the panel uses.
 *
 * @param {Element} button
 * @returns {string}
 */
function buttonHandle(button) {
    if (button.id !== '') {
        return `#${button.id}`;
    }
    const hook = [...button.classList]
        .find((name) => name.startsWith('st-emote-') && !PRESENTATION_HOOKS.includes(name));
    if (hook) {
        return hook;
    }
    // One button has neither: the "create missing packs" action, which was the
    // only one without a per-action hook before this ticket and stayed that way
    // rather than grow a class purely so a test could name it.
    assert.equal(
        button.closest('#st_emote_missing') !== null,
        true,
        `"${button.getAttribute('aria-label')}" has neither an id nor a query hook`,
    );
    return '#st_emote_missing .menu_button';
}

/**
 * The one collapsible section carrying a given header sentence.
 *
 * @param {Document} document
 * @param {string} title
 * @returns {Element|null}
 */
function sectionByTitle(document, title) {
    return [...document.querySelectorAll('.st-emote-section')]
        .find((section) => section.querySelector('.st-emote-section-title')?.textContent === title) ?? null;
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
