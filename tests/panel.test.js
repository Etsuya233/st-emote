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
            delete globalThis.window.toastr;
        }
    });
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

test('a pack with no stickers reads as 空', async () => {
    await withPanelMounted({}, ({ document }) => {
        const badges = [...document.querySelectorAll('.st-emote-badge')].map((badge) => badge.textContent);
        assert.equal(badges.includes('空'), true);
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
            /图片未同步/,
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

test('an external sticker is marked 外链, and its row has no local file to lose', async () => {
    await withPanelMounted({}, ({ document }) => {
        const badges = [...document.querySelectorAll('.st-emote-badge-external')].map((b) => b.textContent);
        assert.deepEqual(badges, ['外链']);
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

test('adding a URL sticker stores the address and marks it 外链', async () => {
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
            /外链/,
        );
        delete globalThis.prompt;
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
