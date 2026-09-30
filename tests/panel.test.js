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

import { ACTION_ICONS, MARK_ICONS } from '../adapter/buttons.js';
import { STORAGE_KEY } from '../adapter/settings.js';
import { closeStickerEditor } from '../adapter/sticker-editor.js';
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
 *   panel after it mounts, for the controls that only exist once a pack is open
 *   or an editor is showing. Whatever it returns is run when `body` is done —
 *   which matters for the editor, since it hangs off `document.body` and would
 *   otherwise outlive the page it was opened on.
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

test('every pack starts closed, and opening one closes the others', async () => {
    // The one commitment the whole ticket rests on. A list of forty packs was
    // forty times six rows; a list of forty closed headers is forty lines, and
    // "two packs open at once" is precisely the state this panel spent its life
    // in — the eye could never say which pack it was looking at.
    await withPanelMounted({}, ({ document }) => {
        const bodies = [...document.querySelectorAll('.st-emote-pack-body')];
        assert.equal(bodies.length, 3);
        for (const body of bodies) {
            assert.equal(body.hidden, true, 'a pack starts open');
        }
        for (const toggle of document.querySelectorAll('.st-emote-pack-toggle')) {
            assert.equal(toggle.getAttribute('aria-expanded'), 'false');
            // The state is on the control, and the control is reachable by
            // keyboard: without a tab stop the grid is a mouse-only feature.
            assert.equal(toggle.getAttribute('tabindex'), '0');
        }

        expandPack(document, 'daily');
        assert.equal(packByName(document, 'daily')
            .querySelector('.st-emote-pack-toggle').getAttribute('aria-expanded'), 'true');
        assert.equal(packByName(document, 'daily').querySelector('.st-emote-pack-body').hidden, false);
        // And only that one.
        assert.equal(packByName(document, 'zeta').querySelector('.st-emote-pack-body').hidden, true);
        assert.equal(packByName(document, 'blank').querySelector('.st-emote-pack-body').hidden, true);

        expandPack(document, 'zeta');
        assert.equal(packByName(document, 'daily').querySelector('.st-emote-pack-body').hidden, true);
        assert.equal(packByName(document, 'zeta').querySelector('.st-emote-pack-body').hidden, false);
    });
});

test('the pack header is a switch, and its own controls are not', async () => {
    // The header is one clickable row holding a text field and (in the
    // missing-images state) a picture that is itself a button. If the row's click
    // handler did not stand down for them, clicking to rename a pack would open
    // it and clicking to re-point its images would close it.
    await withPanelMounted({ storedFiles: [] }, ({ document }) => {
        expandPack(document, 'daily');
        const expanded = () => packByName(document, 'daily')
            .querySelector('.st-emote-pack-toggle').getAttribute('aria-expanded');

        packByName(document, 'daily').querySelector('.st-emote-pack-name').click();
        assert.equal(expanded(), 'true', 'clicking the 包名 field closed the pack');

        packByName(document, 'daily').querySelector('.st-emote-cover').click();
        assert.equal(expanded(), 'true', 'clicking the cover closed the pack');
    });
});

test('Enter and Space on the pack header open it, and Enter in the 包名 field does not', async () => {
    await withPanelMounted({}, ({ document }) => {
        const press = (element, key) => element
            .dispatchEvent(new globalThis.window.KeyboardEvent('keydown', { key }));
        const expanded = () => packByName(document, 'daily')
            .querySelector('.st-emote-pack-toggle').getAttribute('aria-expanded');

        press(packByName(document, 'daily').querySelector('.st-emote-pack-toggle'), 'Enter');
        assert.equal(expanded(), 'true');

        press(packByName(document, 'daily').querySelector('.st-emote-pack-toggle'), ' ');
        assert.equal(expanded(), 'false');

        // Open again, then press Enter in the name field: a rename is not a click
        // on the accordion.
        press(packByName(document, 'daily').querySelector('.st-emote-pack-toggle'), 'Enter');
        press(packByName(document, 'daily').querySelector('.st-emote-pack-name'), 'Enter');
        assert.equal(expanded(), 'true', 'Enter in the 包名 field toggled the pack');
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
        // Opening a pack repaints the whole list, so anything held from before it
        // is detached — hence the header assertions first and `daily` looked up
        // again after the expand.
        const dailyHeader = packByName(document, 'daily');
        assert.equal(dailyHeader.classList.contains('st-emote-pack-missing'), true);
        assert.match(
            dailyHeader.querySelector('.st-emote-badge-images-missing').textContent,
            /images not synced/,
        );

        // Still enableable: the scope boxes a greyed-out pack offers are the
        // same ones an ordinary pack gets, and the Global one works. (Character
        // is disabled here for an unrelated reason: no character is selected.)
        expandPack(document, 'daily');
        const daily = packByName(document, 'daily');
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
        expandPack(document, 'daily');
        globalThis.prompt = () => 'javascript:alert(1)';
        packByName(document, 'daily').querySelector('.st-emote-add-url').click();
        await settle();

        assert.equal(extensionSettings[STORAGE_KEY].packs.find((p) => p.name === 'daily').stickers.length, 3);
        assert.match(toasts.at(-1)[1], /not an http\(s\) image address/);
        delete globalThis.prompt;
    });
});

test('an external sticker wears a corner mark, and the editor still says "external"', async () => {
    // A 56px cell has no room for the word, so the word moved to the editor and
    // the grid got a mark. Both halves are asserted, because a mark with no word
    // anywhere is an unexplained glyph, and a word with no mark is a grid where
    // 外链 and a local file look identical.
    await withPanelMounted({}, ({ document }) => {
        expandPack(document, 'daily');
        const cells = [...packByName(document, 'daily').querySelectorAll('.st-emote-cell')];
        assert.deepEqual(
            cells.map((cell) => cell.querySelector('.st-emote-cell-external') !== null),
            [false, false, true],
        );

        const badge = openEditor(document, 'daily', 'wave').querySelector('.st-emote-badge-external');
        assert.equal(badge.textContent, 'external');
        assert.match(badge.title, /comes from a URL/);
    });
});

test('the grid is one square per sticker, and a square is a picture and its 标签 and nothing else', async () => {
    // The reduction this ticket exists for. A cell used to be two rows and six
    // controls; if one of them creeps back onto the cell the panel starts being
    // the wall of controls again, and nothing else about the ticket would fail.
    await withPanelMounted({}, ({ document }) => {
        expandPack(document, 'daily');
        const cells = [...packByName(document, 'daily').querySelectorAll('.st-emote-cell')];
        assert.equal(cells.length, 3);

        for (const cell of cells) {
            // A cell is a button, it is reachable, and it says what it is.
            assert.equal(cell.getAttribute('role'), 'button');
            assert.equal(cell.getAttribute('tabindex'), '0');
            assert.match(cell.getAttribute('aria-label'), /click to edit$/);
            // The picture and the 标签, and nothing that is a control.
            assert.equal(cell.querySelectorAll('input, select, .menu_button').length, 0);
            assert.ok(cell.querySelector('.st-emote-thumb'));
            assert.ok(cell.querySelector('.st-emote-cell-label'));
            // `data-label` and `data-sticker-id` are what a test — and
            // `revealSticker` — name a cell by.
            assert.equal(typeof cell.dataset.stickerId, 'string');
        }
        assert.deepEqual(
            cells.map((cell) => cell.querySelector('.st-emote-cell-label').textContent),
            ['happy', 'sad', 'wave'],
        );
        // And the 描述, which no longer has a field of its own, is one hover away.
        assert.match(cells[0].title, /^happy: a wide grin$/);
        assert.match(cells[1].title, /^sad: a frown$/);
    });
});

test('clicking a cell opens the editor, and it holds that sticker\'s five controls', async () => {
    await withPanelMounted({}, ({ document }) => {
        assert.equal(document.querySelector('.st-emote-editor'), null);

        const editor = openEditor(document, 'daily', 'happy');
        // The dialog names itself with the sticker, so a screen reader says which
        // of thirty stickers just opened rather than "dialog".
        assert.equal(editor.getAttribute('role'), 'dialog');
        assert.equal(editor.getAttribute('aria-modal'), 'true');
        assert.equal(editor.getAttribute('aria-label'), 'happy');
        // On the body rather than inside the panel: `#st_emote_drawer` lives in the
        // client's own drawer, which scrolls and clips a fixed layer, and the panel
        // scrolls as one long column either way.
        assert.equal(editor.closest('#st_emote_drawer'), null);

        assert.equal(editor.querySelector('.st-emote-label').value, 'happy');
        assert.equal(editor.querySelector('.st-emote-description').value, 'a wide grin');
        assert.ok(editor.querySelector('.st-emote-sticker-placement'));
        assert.ok(editor.querySelector('.st-emote-replace'));
        assert.ok(editor.querySelector('.st-emote-sticker-delete'));
        // And the 标签 field has the keyboard, because that is what was clicked.
        assert.equal(document.activeElement, editor.querySelector('.st-emote-label'));

        // Only one at a time: another cell moves the editor rather than stacking
        // a second copy of the same form on top of the first.
        stickerCell(document, 'daily', 'sad').click();
        assert.equal(document.querySelectorAll('.st-emote-editor').length, 1);
        assert.equal(document.querySelector('.st-emote-editor').getAttribute('aria-label'), 'sad');
    });
});

test('the editor closes on Escape, on the backdrop, and on its own close button', async () => {
    await withPanelMounted({}, ({ document }) => {
        openEditor(document, 'daily', 'happy')
            .dispatchEvent(new globalThis.window.KeyboardEvent('keydown', { key: 'Escape' }));
        assert.equal(document.querySelector('.st-emote-editor'), null, 'Escape did not close the editor');

        openEditor(document, 'daily', 'happy').querySelector('.st-emote-editor-backdrop').click();
        assert.equal(document.querySelector('.st-emote-editor'), null, 'the backdrop did not close it');

        openEditor(document, 'daily', 'happy').querySelector('.st-emote-editor-close').click();
        assert.equal(document.querySelector('.st-emote-editor'), null, 'the close button did not close it');
    });
});

test('a sticker with no label says so in the cell, in the hover text and in the editor', async () => {
    await withPanelMounted({
        settings: {
            packs: [{
                name: 'blank',
                stickers: [{ id: 'n1', label: '', description: 'a shrug', image: local('d1.png') }],
            }],
        },
    }, ({ document }) => {
        expandPack(document, 'blank');
        const cell = stickerCell(document, 'blank', '');
        assert.match(cell.getAttribute('aria-label'), /^No label yet/);
        assert.match(cell.title, /^No label yet: a shrug$/);
        assert.equal(cell.querySelector('.st-emote-cell-label').textContent, '');

        // And the editor names it the same way the cell does.
        assert.equal(
            openEditor(document, 'blank', '').getAttribute('aria-label'),
            'no label yet',
        );
    });
});

test('批量 is a mode: the ticks and the batch bar exist only while it is on', async () => {
    // The other half of the reduction. "Select for a batch delete" used to be a
    // checkbox on every sticker of every pack, permanently, so a once-a-month
    // operation owned a piece of the most valuable space on the panel.
    await withPanelMounted({}, ({ document }) => {
        expandPack(document, 'daily');
        assert.equal(document.querySelector('.st-emote-selection'), null, 'the batch bar is there unasked for');
        assert.equal(document.querySelector('.st-emote-cell-pick'), null, 'a cell wears a tick unasked for');
        for (const cell of packByName(document, 'daily').querySelectorAll('.st-emote-cell')) {
            assert.equal(cell.getAttribute('role'), 'button');
        }

        const batch = packByName(document, 'daily').querySelector('.st-emote-batch');
        assert.equal(batch.getAttribute('aria-pressed'), 'false');
        assert.match(batch.getAttribute('aria-label'), /^Select stickers$/);
        batch.click();

        const reopened = packByName(document, 'daily').querySelector('.st-emote-batch');
        assert.equal(reopened.getAttribute('aria-pressed'), 'true');
        assert.match(reopened.getAttribute('aria-label'), /^Stop selecting stickers$/);
        assert.ok(packByName(document, 'daily').querySelector('.st-emote-selection'));
        // In 批量 mode a cell is a checkbox, and clicking it ticks rather than
        // opens — a tick *inside* a clickable cell is a cell where half the
        // clicks do something the label did not promise.
        for (const cell of packByName(document, 'daily').querySelectorAll('.st-emote-cell')) {
            assert.equal(cell.getAttribute('role'), 'checkbox');
            assert.equal(cell.getAttribute('aria-checked'), 'false');
        }
        stickerCell(document, 'daily', 'happy').click();
        assert.equal(document.querySelector('.st-emote-editor'), null, 'a click in 批量 mode opened the editor');
        assert.equal(stickerCell(document, 'daily', 'happy').getAttribute('aria-checked'), 'true');
        assert.ok(stickerCell(document, 'daily', 'happy').querySelector('.st-emote-cell-pick'));

        // And out again: the same button, back to being a button.
        packByName(document, 'daily').querySelector('.st-emote-batch').click();
        assert.equal(document.querySelector('.st-emote-selection'), null);
        assert.equal(stickerCell(document, 'daily', 'happy').getAttribute('role'), 'button');
    });
});

test('a pack\'s batch mode and its ticks survive closing the pack and reopening it', async () => {
    // The panel's list is rebuilt from scratch on every change, so any of this
    // state held on an element would be gone by the next repaint. A selection
    // that reset itself on the first click of the next pack would be unusable.
    await withPanelMounted({}, ({ document }) => {
        enterBatchMode(document, 'daily');
        stickerCell(document, 'daily', 'happy').click();
        stickerCell(document, 'daily', 'sad').click();

        packByName(document, 'daily').querySelector('.st-emote-pack-toggle').click();
        assert.equal(packByName(document, 'daily').querySelector('.st-emote-pack-body').hidden, true);
        expandPack(document, 'daily');

        assert.equal(packByName(document, 'daily').querySelector('.st-emote-batch')
            .getAttribute('aria-pressed'), 'true');
        assert.equal(stickerCell(document, 'daily', 'happy').getAttribute('aria-checked'), 'true');
        assert.equal(stickerCell(document, 'daily', 'wave').getAttribute('aria-checked'), 'false');
        // Which is why the batch bar can offer a delete of exactly two.
        assert.match(
            packByName(document, 'daily').querySelector('.st-emote-delete-selected')
                .getAttribute('aria-label'),
            /^Delete 2 selected$/,
        );
    });
});

test('the search box filters by label and by description, case- and space-insensitively', async () => {
    await withPanelMounted({}, ({ document }) => {
        const search = document.getElementById('st_emote_search');
        // The labels come out of the matching packs' grids, so each of them is
        // opened first — a search narrows the list, it does not expand it.
        const searchFor = (value) => {
            search.value = value;
            search.dispatchEvent(new globalThis.window.Event('input'));
            const packs = [...document.querySelectorAll('.st-emote-pack-name')].map((i) => i.value);
            for (const name of packs) {
                expandPack(document, name);
            }
            return {
                packs,
                labels: [...document.querySelectorAll('.st-emote-cell')].map((cell) => cell.dataset.label),
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

test('a search narrows the grid but withholds the delete that would act on what it hides', async () => {
    // The rule the search already had, and the reason it still matters: the batch
    // delete reads a pack's whole sticker list, so while the grid is showing four
    // of forty, "delete the selected" is a button pointed at stickers nobody can
    // see. The grid is now one click further away than it was, so the guard is
    // worth saying out loud rather than leaving in the code.
    await withPanelMounted({}, ({ document }) => {
        const search = document.getElementById('st_emote_search');
        search.value = 'grin';
        search.dispatchEvent(new globalThis.window.Event('input'));
        enterBatchMode(document, 'daily');

        const bar = packByName(document, 'daily').querySelector('.st-emote-selection');
        assert.match(bar.textContent, /Select the matches/);
        assert.match(bar.textContent, /Clear the search/);
        // And the pack's own delete is withheld for the same reason.
        assert.equal(packByName(document, 'daily').querySelector('.st-emote-delete-pack'), null);

        // The editor offers no delete either — and it is opened with 批量 mode off,
        // because in 批量 mode a click on a cell is a tick and not a click.
        packByName(document, 'daily').querySelector('.st-emote-batch').click();
        const editor = openEditor(document, 'daily', 'happy');
        assert.equal(editor.querySelector('.st-emote-sticker-delete'), null);
        assert.ok(editor.querySelector('.st-emote-replace'));
        assert.ok(editor.querySelector('.st-emote-label'));
    });
});

test('selecting several stickers and deleting them removes the records and calls the endpoint', async () => {
    const fetchImpl = fakeFetch({
        list: { body: ['st-emote-d1.png', 'st-emote-d2.png'] },
        remove: { status: 200 },
    });
    await withPanelMounted({ fetch: fetchImpl }, async ({ document, extensionSettings }) => {
        harnessConfirm(true);

        // 批量 mode, then tick two cells. Each tick rebuilds the grid, so the next
        // cell is looked up again rather than held on to.
        enterBatchMode(document, 'daily');
        for (const label of ['happy', 'sad']) {
            stickerCell(document, 'daily', label).click();
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

        expandPack(document, 'daily');
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
        expandPack(document, 'daily');
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
        const picker = openEditor(document, 'daily', 'happy').querySelector('input[type=file]');
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
        expandPack(document, 'daily');
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
        expandPack(document, 'daily');
        globalThis.prompt = () => 'https://example.com/cat.gif';
        packByName(document, 'daily').querySelector('.st-emote-add-url').click();
        await settle();

        const added = extensionSettings[STORAGE_KEY].packs
            .find((pack) => pack.name === 'daily').stickers.at(-1);
        assert.equal(added.image, 'https://example.com/cat.gif');
        assert.equal(added.label, '');
        // The new sticker wears the corner mark, and the pack opened itself so the
        // cell it landed in is on screen at all.
        assert.equal(packByName(document, 'daily').querySelector('.st-emote-pack-toggle')
            .getAttribute('aria-expanded'), 'true');
        const cell = [...packByName(document, 'daily').querySelectorAll('.st-emote-cell')].at(-1);
        assert.ok(cell.querySelector('.st-emote-cell-external'));
        // And the word is one editor away, because a mark alone explains nothing.
        assert.match(
            openEditor(document, 'daily', '').querySelector('.st-emote-badge-external').textContent,
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
        const picker = openEditor(document, 'daily', 'happy').querySelector('input[type=file]');
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
        const picker = openEditor(document, 'daily', 'happy').querySelector('input[type=file]');
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
        const input = openEditor(document, 'daily', 'happy').querySelector('.st-emote-label');
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
        const input = openEditor(document, 'daily', 'happy').querySelector('.st-emote-label');
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
        // And the grid follows the rename: the editor lives outside the list, so
        // the list has to be repainted for the cell to stop saying "happy".
        assert.equal(stickerCell(document, 'daily', 'grinning') !== null, true);
        assert.equal(stickerCell(document, 'daily', 'happy'), null);
    });
});

test('deleting a sticker from the editor asks first, and the cell goes with it', async () => {
    const fetchImpl = fakeFetch({
        list: { body: ['st-emote-d1.png', 'st-emote-d2.png'] },
        remove: { status: 200 },
    });
    await withPanelMounted({ fetch: fetchImpl }, async ({ document, extensionSettings }) => {
        harnessConfirm(true);
        openEditor(document, 'daily', 'happy').querySelector('.st-emote-sticker-delete').click();
        await settle();

        assert.match(globalThis.__confirm.message, /"happy"/);
        assert.equal(document.querySelector('.st-emote-editor'), null, 'the editor outlived its sticker');
        assert.equal(stickerCell(document, 'daily', 'happy'), null);
        assert.deepEqual(
            extensionSettings[STORAGE_KEY].packs
                .find((pack) => pack.name === 'daily').stickers.map((sticker) => sticker.label),
            ['sad', 'wave'],
        );
        globalThis.__confirm = null;
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
        'Copy regex JSON', 'Render stickers in user messages', 'Master switch: render stickers',
        'Token forms', 'Gap between stickers (left/right)',
        'In place', 'Inline size (in place)', 'Min width',
        'Re-render the current chat',
    ]) {
        assert.ok(english.includes(probe), `the English panel is missing "${probe}"`);
    }
    for (const probe of ['新建表情包', '搜索标签与描述', '原地', '最小宽度', '标记形态', '表情之间的空隙（左右）', '重新渲染当前聊天']) {
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
        // the switch rather than discovered from a preset that stopped working —
        // and while the switch is *on*, four lines about it are four lines
        // between the user and the control they opened the panel for. So the
        // sentence is on the row as its tooltip, always, and on screen only once
        // the consequence is real.
        const row = document.getElementById('st_emote_master');
        const hint = document.getElementById('st_emote_enabled_hint');
        assert.match(row.getAttribute('title'), /expands to nothing/);
        assert.equal(hint.textContent, '', 'the consequence is on screen before it can happen');
        assert.equal(row.classList.contains('st-emote-master-off'), false);

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
        // And now the sentence is on screen, with the row drawn as off.
        assert.match(hint.textContent, /expands to nothing/);
        assert.equal(row.classList.contains('st-emote-master-off'), true);

        // And on again, with the images back.
        checkbox.checked = true;
        checkbox.dispatchEvent(new globalThis.window.Event('change'));
        assert.equal(extensionSettings[STORAGE_KEY].enabled, true);
        assert.equal(document.querySelectorAll('img.custom-st-emote').length, 1);
        assert.equal(hint.textContent, '', 'the sentence stayed after the switch came back on');
        assert.equal(row.classList.contains('st-emote-master-off'), false);
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

test('the re-render button is not beside the preview\'s render button', async () => {
    // The two are different actions on different things: `Render` reads the box
    // above it, `Re-render` repaints the whole chat — which is not on this panel
    // at all. In one row they read as a single action with two labels, and the
    // one that rewrites the user's chat is the one you least want pressed by
    // mistake. The caption is a sentence rather than a glyph's tooltip because a
    // lone icon in a lone row has nothing to be read against.
    await withPanelMounted({}, ({ document }) => {
        const run = document.getElementById('st_emote_preview_run');
        const rerender = document.getElementById('st_emote_rerender');

        assert.equal(run.closest('.st-emote-debug-actions') !== null, true);
        assert.equal(rerender.closest('.st-emote-debug-actions'), null, 'the two share a button row');
        assert.equal(run.parentElement.parentElement, rerender.parentElement.parentElement);

        // Below the preview output, and below the note that reports what the
        // preview did — the repaint is a separate step after looking.
        const debug = document.querySelector('.st-emote-debug');
        const order = [...debug.querySelectorAll('[id]')].map((element) => element.id);
        assert.ok(order.indexOf('st_emote_rerender') > order.indexOf('st_emote_preview_out'));

        // And it says what it does, on screen, not only on hover.
        assert.equal(
            document.getElementById('st_emote_rerender_label').textContent,
            t('panel.rerender'),
        );
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

    // The marks, which a grid cell wears rather than a button. Same two-part
    // evidence, so the class string in `MARK_ICONS` cannot drift from what was
    // verified either.
    for (const [mark, classes] of Object.entries(MARK_ICONS)) {
        const recorded = FREE_ICON_CLASSES[`${mark}Mark`];
        assert.ok(recorded, `the ${mark} mark draws a glyph nobody verified`);
        assert.equal(classes, `fa-solid ${recorded}`, `the ${mark} mark draws an unverified glyph`);
        assert.ok(
            Number.isInteger(FREE_ICON_CODEPOINTS[`${mark}Mark`]),
            `the ${mark} mark has no recorded codepoint`,
        );
    }

    // And the two chevrons the collapsible headers use, which are not in
    // `ACTION_ICONS` because they are not buttons. The client picks the class
    // and the free font has to carry both directions, or a section opens onto a
    // blank arrow.
    assert.equal(FREE_ICON_CLASSES.sectionChevronDown, 'fa-circle-chevron-down');
    assert.equal(FREE_ICON_CLASSES.sectionChevronUp, 'fa-circle-chevron-up');
});

test('every Font Awesome class on the panel is one the recorded font carries', async () => {
    // The belt to the test above's braces. `ACTION_ICONS` and `MARK_ICONS` are
    // where a glyph *should* come from; this asks what is actually on the page,
    // in every state the panel can reach, and fails on a class typed inline
    // somewhere nobody looked. Same question as the table test, asked of the DOM
    // rather than of the source.
    const known = new Set(
        [...Object.values(ACTION_ICONS), ...Object.values(MARK_ICONS)]
            .join(' ')
            .split(' '),
    );
    const drawn = new Set();
    for (const state of iconButtonStates()) {
        // eslint-disable-next-line no-await-in-loop
        await withPanelMounted(state.options, ({ document }) => {
            for (const element of document.querySelectorAll('#st_emote_drawer i, .st-emote-editor i')) {
                for (const name of element.classList) {
                    if (name.startsWith('fa-')) {
                        drawn.add(name);
                    }
                }
            }
        });
    }
    assert.ok(drawn.size > 0, 'no Font Awesome class was drawn at all');
    for (const name of drawn) {
        assert.equal(known.has(name), true, `"${name}" is drawn but is in neither icon table`);
    }
    // And the other direction, for the marks only: a mark nothing ever draws is a
    // name waiting for a cell that will never exist, which is the dead-name
    // failure the button table has an orphan test for.
    for (const classes of Object.values(MARK_ICONS)) {
        const [, glyph] = classes.split(' ');
        assert.ok(drawn.has(glyph), `the ${glyph} mark is verified but no cell ever draws it`);
    }
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
        if (name === 'fa-solid'
            || name.startsWith('fa-circle-chevron-')
            || Object.values(MARK_ICONS).includes(`fa-solid ${name}`)) {
            continue; // the family, the client's own chevrons, and the grid's marks
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
        const actual = english.get(handle) ?? '';
        // A toggle button names one handle twice — once per direction — so the
        // keys are listed rather than pinned to one.
        const keys = expected.keys ?? [expected.key];
        const sentences = keys.map((key) => t(key, { count: PROBE }));
        if (expected.count) {
            assert.ok(
                sentences.includes(actual.replace(expected.count, PROBE)),
                `${handle} does not say ${keys.join(' or ')}`,
            );
        } else {
            assert.ok(sentences.includes(actual), `${handle} does not say ${keys.join(' or ')}`);
        }
    }

    // And in the other language, from the same key — so a translation can never
    // reach the tooltip and miss the accessible name, or the reverse.
    const chinese = await iconButtonLabels({ locale: 'zh-cn' });
    for (const [handle, expected] of Object.entries(EXPECTED_ICON_BUTTON_KEYS)) {
        const keys = expected.keys ?? [expected.key];
        const sentences = keys.map((key) => t(key, { count: PROBE }));
        const actual = chinese.get(handle) ?? '';
        if (expected.count) {
            assert.ok(
                sentences.includes(actual.replace(expected.count, PROBE)),
                `${handle} does not say ${keys.join(' or ')} in Chinese`,
            );
        } else {
            assert.ok(sentences.includes(actual), `${handle} does not say ${keys.join(' or ')} in Chinese`);
        }
        assert.notEqual(actual, english.get(handle), `${handle} is not translated`);
    }
});

test('the collapsible sections are ordered by how often a user reaches for them', async () => {
    // The panel's whole order is a claim about frequency, and a claim like that
    // decays silently: nothing breaks when a section moves, the panel just gets
    // worse at something no test can see. So the order is stated here, once.
    //
    // Most reached for first. 尺寸集 is how a user changes how a sticker looks;
    // the debug area is where they go when one did not draw; then the three
    // setup-time explanations, rarest last, in the order a new user needs them:
    // the macro, the regex that refines it, and moving a pack between devices.
    await withPanelMounted({}, ({ document }) => {
        const titles = [...document.querySelectorAll('#st_emote_drawer .st-emote-section-title')]
            .map((element) => element.textContent);
        assert.deepEqual(titles, [
            'Inline size (in place)',
            'Block size (after the block / end of message)',
            'Try rendering / re-render',
            'Listing macro',
            'Context-clearing regex',
            'Import and export a pack',
        ]);
    });
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
    // section opens itself, marks its header, and its content is reachable.
    await withPanelMounted({
        settings: { sizes: { inline: { maxHeight: 'not a size' } } },
    }, ({ document }) => {
        const section = document.querySelector('.st-emote-size-set');
        const toggle = section.querySelector('.inline-drawer-toggle');
        assert.equal(toggle.getAttribute('aria-expanded'), 'true', 'the 尺寸集 stayed closed');
        const mark = section.querySelector('.st-emote-size-set-invalid');
        assert.ok(mark, 'the header does not mark itself as holding a bad value');
        // The mark is a glyph and the sentence is its tooltip. It used to be the
        // other way round, and a 60-character sentence with `white-space: nowrap`
        // in a ~300px header stretched the row past the panel: the title collapsed
        // into one word per line and the chevron went off the right edge. The hint
        // below carries the detail, and it is on screen because of the expand.
        assert.ok(mark.textContent.length <= 2, `the header mark is ${mark.textContent.length} characters`);
        assert.equal(mark.title, 'needs a number with em, px or %');
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

test('a 尺寸集 whose Fill was chosen is not a 尺寸集 holding a bad value', async () => {
    // The one that made the settings panel open by itself. `fit` is in
    // `SIZE_PANEL_FIELDS` and holds `cover` / `contain` / `fill`, and the check
    // that decides whether a set holds something the renderer cannot use was the
    // *length* rule — so a user who had ever picked a Fill mode got that section
    // expanded on every mount, with a `!` whose tooltip told them to type a number
    // with em, px or % and no field-level hint anywhere, because the field it was
    // complaining about is a select.
    await withPanelMounted({
        settings: { sizes: { inline: { fit: 'contain' } } },
    }, ({ document }) => {
        for (const section of document.querySelectorAll('.st-emote-size-set')) {
            assert.equal(
                section.querySelector('.inline-drawer-toggle').getAttribute('aria-expanded'),
                'false',
                'a chosen fill mode opened the section',
            );
            assert.equal(section.querySelector('.st-emote-size-set-invalid'), null);
        }
        // Still marked as changed — the value is real, it is just not a size —
        // and still on the select, so collapsing the section hides nothing and
        // the panel does not claim "default" to a user who chose a mode.
        const [inline, block] = document.querySelectorAll('.st-emote-size-set');
        assert.ok(inline.querySelector('.st-emote-size-set-mark'), 'a customised set is not marked');
        assert.equal(block.querySelector('.st-emote-size-set-mark'), null, 'an untouched set is marked');
        assert.equal(inline.querySelector('select').value, 'contain');
    });

    // A fill mode the select cannot produce — it can only arrive from settings
    // written outside the panel — is still refused, and now says so in words that
    // are about a fill mode.
    await withPanelMounted({
        settings: { sizes: { inline: { fit: 'squish' } } },
    }, ({ document }) => {
        const section = document.querySelector('.st-emote-size-set');
        assert.equal(section.querySelector('.inline-drawer-toggle').getAttribute('aria-expanded'), 'true');
        assert.equal(section.querySelector('.st-emote-size-set-invalid').title, 'is not one of cover, contain or fill');
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
// The panel's control surface.
//
// The 观感 of the panel is CSS, and jsdom cannot see any of it. What jsdom *can*
// see is the thing a layout change would wreck by accident: the set of controls.
// Tickets 10, 11 and 13 all moved controls around and left this list byte for
// byte identical, which is what proved that they had. **Ticket 12 is the first
// change to touch it**, and it did so deliberately: the 标签, 描述, 投放方式,
// replace and delete of every sticker stopped being on screen, and one 批量
// button per pack arrived. The diff on the list below is that change, in full.
// ---------------------------------------------------------------------------

test('the control surface says exactly what the panel offers', async () => {
    // Every control is one line: **where** it is, **what** it is (tag, input
    // type, id, classes, and for a select the choices it offers), and **what it
    // says** (its caption, or its title / placeholder where there is none). The
    // sort makes the list indifferent to the order the panel happens to build
    // things in.
    //
    // **The state it is read in is part of the assertion, and it says so.** A
    // closed pack with no ticks shows a third of the panel, so this reads the list
    // with one pack open, 批量 mode on and two stickers ticked — the state that
    // shows the most of the panel at once. The editor is the one thing it cannot
    // reach, and gets its own list in the test below.
    await withPanelMounted({
        arrange: (document) => {
            enterBatchMode(document, 'daily');
            stickerCell(document, 'daily', 'happy').click();
            stickerCell(document, 'daily', 'sad').click();
        },
    }, ({ document }) => {
        assert.deepEqual(controlSurface(document), EXPECTED_CONTROL_SURFACE);
    });
});

test('and the editor is the same list with one sticker\'s fields on top of it', async () => {
    await withPanelMounted({
        arrange: (document) => {
            openEditor(document, 'daily', 'happy');
            return () => closeStickerEditor();
        },
    }, ({ document }) => {
        assert.deepEqual(controlSurface(document), EXPECTED_EDITOR_SURFACE);
    });
});

test('the editor holds one sticker\'s fields, in the order the panel has always used', async () => {
    // The row it replaces was two rows in a fixed order, and a reflow that
    // silently reorders what Tab reaches is the kind of thing nobody notices
    // until it annoys them daily. The fields moved; the order did not.
    await withPanelMounted({}, ({ document }) => {
        const editor = openEditor(document, 'daily', 'happy');
        const body = editor.querySelector('.st-emote-editor-body');
        assert.deepEqual(
            [...body.children].map((child) => [...child.classList].at(-1)),
            [
                'st-emote-label',
                'st-emote-description',
                'st-emote-sticker-placement',
                'st-emote-actions',
            ],
        );
        // The picture is at the top of the dialog rather than among the fields:
        // the reason a user opens the editor is very often that a sticker is not
        // drawing.
        assert.ok(editor.querySelector('.st-emote-editor-preview img'));
    });
});

test('the editor is a surface of its own, above the drawer that opened it', async () => {
    // Three facts about how the dialog is painted, none of which jsdom and none
    // of which the DOM can see — and every one of them was wrong at once, which
    // is what made the dialog read as broken rather than as misplaced: it was
    // drawn *under* the extensions drawer, seen through that drawer's blurred
    // translucent background; its 标签 and badges were painted in the colour of
    // their own background; and its 投放方式 select was a 9em-tall box, because
    // the panel's row sizing was sizing it as a height.
    const rules = readStyleSheet();

    // Above `#top-settings-holder`, which is `position: relative; z-index: 3005`
    // and 4005 while a drawer is open — the state the editor is only ever opened
    // in. The layer hangs off `body`, so the two compete in the root stacking
    // context and this is the whole of the comparison.
    await withPanelMounted({
        arrange: (document) => {
            openEditor(document, 'daily', 'happy');
            return () => closeStickerEditor();
        },
    }, ({ document }) => {
        const layer = document.querySelector('.st-emote-editor');
        assert.equal(layer.parentElement, document.body, 'the layer is not a child of body');
    });
    const zIndex = Number((rules['.st-emote-editor'] ?? '').match(/z-index:\s*(\d+)/)?.[1]);
    assert.ok(
        Number.isFinite(zIndex) && zIndex > 4005,
        `the editor layer's z-index (${zIndex}) does not outrank the top settings holder`,
    );

    // A background and a text colour, and not the same variable twice: the
    // client's `body` is `color: var(--SmartThemeBodyColor)`, so a card
    // backgrounded with that variable draws its own text in its own colour.
    const card = rules['.st-emote-editor-card'] ?? '';
    const background = card.match(/(?:^|;)\s*background:\s*([^;]+)/)?.[1]?.trim();
    const colour = card.match(/(?:^|;)\s*color:\s*([^;]+)/)?.[1]?.trim();
    assert.ok(background, 'the card has no background of its own');
    assert.ok(colour, 'the card takes its text colour from the page');
    assert.notEqual(background, colour, 'the card is painted in its own text colour');

    // The 投放方式 select, sized for a column. The panel's rule is a width
    // because the select sits in a *row* there, and a flex basis in the dialog's
    // column is a height.
    assert.match(
        rules['.st-emote-sticker-placement'] ?? '',
        /flex:\s*0 1 9em/,
        'the panel no longer sizes the select as a row',
    );
    assert.match(
        rules['.st-emote-editor-body .st-emote-sticker-placement'] ?? '',
        /flex:\s*0 0 auto/,
        "the dialog's column does not undo that row sizing",
    );

    // And the two spacing numbers, declared where the layer can reach them: it
    // is a child of `body` and a stranger to `#st_emote_drawer`, so a variable
    // scoped to the drawer leaves every `gap` in the dialog at `normal`.
    assert.match(rules['body'] ?? '', /--st-emote-gap/, 'body declares neither spacing number');
    assert.match(rules['body'] ?? '', /--st-emote-space/, 'body declares neither spacing number');
    assert.equal(
        /--st-emote-gap/.test(rules['#st_emote_drawer'] ?? ''),
        false,
        'the spacing numbers are scoped to the drawer, which the layer is not inside',
    );
});

test('the 作用域 toggles and the batch bar share one row, inside an open pack', async () => {
    await withPanelMounted({}, ({ document }) => {
        // Not there at all while the pack is closed: a row of three checkboxes per
        // collapsed pack is forty rows of checkboxes in a library of forty.
        assert.equal(packByName(document, 'daily').querySelector('.st-emote-pack-controls'), null);

        expandPack(document, 'daily');
        const row = packByName(document, 'daily').querySelector('.st-emote-pack-controls');
        assert.ok(row, 'the pack has no shared controls row');
        // The 作用域 half is always there; the batch half only in 批量 mode, and
        // then as a sibling rather than a row of its own.
        assert.equal(row.querySelector('.st-emote-scopes').parentElement, row);
        assert.equal(row.querySelectorAll('input[type=checkbox]').length, 3);
        assert.equal(row.querySelector('.st-emote-selection'), null);

        packByName(document, 'daily').querySelector('.st-emote-batch').click();
        const withBatch = packByName(document, 'daily').querySelector('.st-emote-pack-controls');
        assert.deepEqual(
            [...withBatch.children].map((child) => child.className),
            ['st-emote-scopes', 'st-emote-selection'],
        );
        assert.ok(withBatch.querySelector('input[type=checkbox]'));
    });
});

test('a pack is a header and a body, and a closed pack costs one row', async () => {
    // The whole reduction in one assertion.
    await withPanelMounted({}, ({ document }) => {
        const pack = packByName(document, 'daily');
        assert.deepEqual([...pack.children].map((child) => child.className), [
            'st-emote-pack-toggle',
            'st-emote-pack-body',
        ]);
        expandPack(document, 'daily');
        // The actions are in the body, not in the header: the header is the
        // identity of the pack plus the switch, and that is all it is.
        assert.equal(
            packByName(document, 'daily').querySelector('.st-emote-actions')
                .closest('.st-emote-pack-body') !== null,
            true,
        );
    });
});

test('every action button in the panel carries the one shared action-button class', async () => {
    // Three areas build their own buttons — the pack header, a 表情 row and the
    // debug area — and one hook class is what keeps them looking like the same
    // kind of control. The stylesheet turns that class into the no-wrap rule, so a
    // button added without it would wrap into a tall block again.
    await withPanelMounted({}, ({ document }) => {
        const buttons = [...document.querySelectorAll('#st_emote_drawer .menu_button, .st-emote-editor .menu_button')];
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
    // **Three panel states, not one.** Several classes only exist in some states —
    // `st-emote-pack-missing` needs the server to report none of our files,
    // `st-emote-cell-picked` and `st-emote-delete-selected` need 批量 mode with
    // something ticked, `st-emote-input-bad` needs a refused size value, and every
    // class of the editor needs a cell clicked — so a single ordinary render would
    // check a third of the surface and pass anyway. The three states below are
    // chosen to reach all of them.
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
        expandPack(document, 'daily');
        collectClasses(document, used);
    });
    // The states the plain fixture never reaches.
    await withPanelMounted({ storedFiles: [] }, ({ document }) => {
        enterBatchMode(document, 'daily');
        for (const label of ['happy', 'sad']) {
            stickerCell(document, 'daily', label).click();
        }
        const size = document.querySelector('.st-emote-size');
        size.value = 'not a size';
        size.dispatchEvent(new globalThis.window.Event('change'));
        collectClasses(document, used);
    });
    // And the editor, which hangs off `document.body` rather than the drawer, so
    // a scan of the drawer alone would never see a single one of its classes.
    await withPanelMounted({
        arrange: (document) => {
            openEditor(document, 'daily', 'wave');
            return () => closeStickerEditor();
        },
    }, ({ document }) => {
        collectClasses(document, used);
    });

    const unknown = [...used]
        .filter((name) => !known.has(name) && !QUERY_HOOKS.includes(name))
        .sort();
    assert.deepEqual(unknown, []);
});

// ---------------------------------------------------------------------------
// The panel's information architecture (ticket 13).
//
// Ticket 10 made the panel fit a narrow column and ticket 11 gave its buttons
// glyphs and its explanations drawers. Both left the same thing unaddressed: the
// pack list — the reason a user opens this panel — sat below every setting, and
// forty controls of equal weight gave the eye nowhere to land.
//
// **What is asserted here is shape, not looks.** jsdom has no layout engine, so
// nothing below can say whether the result is *good*; what it can say is that the
// library comes first, that the read-outs report the 生效集 the rest of the
// extension uses, and that the one action which creates everything else is
// reachable and says what it is. The control-surface snapshot above is the other
// half: ticket 12 changed it, deliberately and on the record, so this ticket's
// own claim is the one that is unchanged.
// ---------------------------------------------------------------------------

test('the library is the first block, and the pack list is above every setting', async () => {
    // The one claim the whole ticket rests on. The panel is a data page with
    // settings attached, and this is what makes it one: asserted by document
    // order rather than by class, because a test that only checked the classes
    // would still pass if the blocks were reordered in the markup.
    await withPanelMounted({}, ({ document }) => {
        // Document order, read off one ordered list rather than off pairwise
        // comparisons: a test that only checked the classes would still pass if
        // the blocks were rearranged inside the markup.
        const order = [...document.getElementById('st_emote_drawer')
            .querySelectorAll('[id]')].map((element) => element.id);
        const at = (id) => order.indexOf(id);

        assert.ok(at('st_emote_search') < at('st_emote_packs'), 'the search box is not above the pack list');
        assert.ok(at('st_emote_new_pack') < at('st_emote_packs'), 'the create row is not above the pack list');
        assert.ok(at('st_emote_packs') < at('st_emote_enabled'), 'the 总开关 is above the pack list');
        assert.ok(at('st_emote_packs') < at('st_emote_placement'), 'the 投放方式 is above the pack list');
        assert.ok(at('st_emote_packs') < at('st_emote_preview'), 'the debug box is above the pack list');

        // And the first block is the library's, not a setting's: a user who opens
        // the panel lands on content, not on a switch.
        const first = document.querySelector('.inline-drawer-content > .st-emote-block');
        assert.equal(first.id, 'st_emote_block_library');
    });
});

test('the search box and the create row are one toolbar above the list', async () => {
    // Both act on the pack list and neither is a setting, so they belong in the
    // same block and the create row must be *named*: a placeholder is gone the
    // moment the field has content, which is exactly when the user is creating
    // the pack the field is for.
    await withPanelMounted({}, ({ document }) => {
        const library = document.getElementById('st_emote_block_library');
        for (const id of ['st_emote_search', 'st_emote_new_pack', 'st_emote_packs']) {
            assert.equal(
                document.getElementById(id).closest('.st-emote-block') === library,
                true,
                `#${id} is not in the library block`,
            );
        }

        // The visible name, and a real label association rather than a
        // placeholder standing in for one.
        const label = document.getElementById('st_emote_new_pack_label');
        assert.equal(label.getAttribute('for'), 'st_emote_new_pack');
        assert.match(label.textContent, /New pack name/);
        assert.equal(label.hidden, false, 'the create field has no visible name');
    });
});

test('the status line reports the 生效集, and follows the 总开关', async () => {
    // The numbers come from the same 生效集 the macro listing and the debug
    // preview read, so a status line that disagreed with the listing would be
    // worse than none. One pack is enabled in the fixture and it holds three
    // labelled stickers, which is also the only way the singular wording gets
    // exercised.
    await withPanelMounted({}, ({ document }) => {
        const counts = document.getElementById('st_emote_status_counts');
        const label = document.getElementById('st_emote_status_text');
        const strip = document.getElementById('st_emote_status');
        assert.equal(counts.textContent, '1 pack · 3 stickers');
        assert.match(label.textContent, /Active here/);
        assert.equal(strip.classList.contains('st-emote-status-off'), false);

        // Off: the counts are noise while nothing is being rendered, so the line
        // says the one thing that is true instead.
        const checkbox = document.getElementById('st_emote_enabled');
        checkbox.checked = false;
        checkbox.dispatchEvent(new globalThis.window.Event('change'));

        assert.match(label.textContent, /Rendering is off/);
        assert.equal(counts.textContent, '');
        assert.equal(strip.classList.contains('st-emote-status-off'), true);
    });
});

test('the drawer header carries nothing but the name', async () => {
    // A read-out in the header (how many packs are on, or just "off") was there so
    // the state would be legible while the panel is collapsed. The status line
    // inside the panel says the same thing, and a row of numbers beside the name
    // in a list of extension drawers is noise rather than information.
    await withPanelMounted({}, ({ document }) => {
        const header = document.querySelector('#st_emote_drawer > .inline-drawer-toggle');
        assert.equal(header.querySelector('b').textContent, 'st-emote');
        // The title and the client's own chevron, and nothing in between that
        // says anything. Asserted as a class list rather than as a count, so a
        // second read-out cannot be slipped in beside the name.
        assert.deepEqual(
            [...header.children].map((child) => [child.tagName.toLowerCase(), child.className]),
            [
                ['b', ''],
                ['div', 'inline-drawer-icon fa-solid fa-circle-chevron-down down'],
            ],
        );
        assert.equal(header.textContent, 'st-emote');
    });
});

test('the status line follows a 作用域 toggle, which does not rebuild the list', async () => {
    // The staleness this catches is the kind nothing else notices: the three
    // scope boxes keep their own state rather than triggering a repaint, so a
    // read-out that only followed a repaint would go stale on exactly the action
    // a user takes to change what is enabled.
    await withPanelMounted({}, ({ document }) => {
        const counts = document.getElementById('st_emote_status_counts');
        assert.equal(counts.textContent, '1 pack · 3 stickers');

        expandPack(document, 'zeta');
        const box = packByName(document, 'zeta').querySelector('.st-emote-scopes input');
        assert.equal(box.checked, false);
        box.checked = true;
        box.dispatchEvent(new globalThis.window.Event('change'));
        assert.equal(counts.textContent, '2 packs · 4 stickers');

        box.checked = false;
        box.dispatchEvent(new globalThis.window.Event('change'));
        assert.equal(counts.textContent, '1 pack · 3 stickers');
        // And the box that was clicked is still the one on screen, which is the
        // half of this that only holds while the list is not rebuilt.
        assert.equal(box.checked, false);
        assert.equal(box.isConnected, true);
    });
});

test('a 冲突 in the 生效集 is on screen, and only when there is one', async () => {
    // The most common shape of "I turned it on, I uploaded it, and nothing
    // rendered": two enabled packs that both define `happy`, so the bare label is
    // ambiguous and counts as a 未命中. The header sentence is the catalog's own,
    // which is why the panel never has to word it.
    const twoPacks = {
        packs: [
            { name: 'a', stickers: [{ id: 'a1', label: 'happy', description: '', image: '' }] },
            { name: 'b', stickers: [{ id: 'b1', label: 'Happy', description: '', image: '' }] },
        ],
        enabledPackNames: ['a', 'b'],
    };
    await withPanelMounted({ settings: twoPacks }, ({ document }) => {
        const warning = document.getElementById('st_emote_conflicts');
        assert.equal(warning.hidden, false);
        // The singular wording, because there is exactly one — which is the only
        // way that half of the catalog gets looked at.
        assert.match(warning.textContent, /Label conflict in the effective set \(1\)/);
    });
    // One pack on: nothing collides, so the line is gone rather than blank.
    await withPanelMounted({ settings: { packs: twoPacks.packs, enabledPackNames: ['a'] } }, ({ document }) => {
        assert.equal(document.getElementById('st_emote_conflicts').hidden, true);
    });
});

test('a block title is bold and set at the panel\'s own size', async () => {
    // A block heading is set at full strength or not at all. The first attempt
    // here was deliberately quiet — `0.78em`, upper-case, `opacity: 0.6`, on the
    // reasoning that a block heading should stay under the client's own
    // collapsible headers. Beside another extension's section headings it read as
    // a caption on nothing: smaller than a field label and much quieter than the
    // thing it introduced.
    //
    // jsdom has no layout engine and no cascade, so the only half of this that is
    // checkable here is that the rule *says* what it should. The size and the
    // weight are one declaration and cannot disagree with each other in a
    // screenshot without this catching it first.
    const rules = readStyleSheet();
    const title = rules['.st-emote-block-title'] ?? '';
    assert.match(title, /font-weight:\s*(700|bold)/, 'the block title is not bold');
    assert.match(title, /font-size:\s*1em/, 'the block title is not at the panel\'s own size');
    // The quiet version's three tells, each of which reads as a caption.
    assert.doesNotMatch(title, /text-transform/, 'the block title is still upper-cased');
    assert.doesNotMatch(title, /opacity:\s*0\.[0-6]/, 'the block title is still dimmed');
});

test('every block has a title, and every title says something in both languages', async () => {
    // A block with no name is the thing this ticket set out to remove, and the
    // orphan-key test in `tests/i18n.test.js` cannot catch it: a key that is read
    // and then thrown away is still read. Both states, so a title that only
    // exists while the library is empty is caught too.
    const titles = ['block.library', 'block.rendering', 'block.appearance', 'block.tools'];
    for (const [label, options] of [['English', {}], ['Chinese', { locale: 'zh-cn' }]]) {
        for (const settings of [{ packs: [] }, {}]) {
            // eslint-disable-next-line no-await-in-loop
            await withPanelMounted({ ...options, settings }, ({ document }) => {
                const shown = [...document.querySelectorAll('.st-emote-block-title')]
                    .map((element) => element.textContent);
                assert.deepEqual(
                    shown,
                    titles.map((key) => t(key)),
                    `the ${label} panel's block titles are wrong`,
                );
                for (const text of shown) {
                    assert.notEqual(text.trim(), '');
                    assert.doesNotMatch(text, /^block\./, 'a block title fell back to its key');
                }
            });
        }
    }
});

test('the library counts its own packs, in the panel\'s language', async () => {
    for (const [label, probe, options] of [
        ['English', /3 packs/, {}],
        ['Chinese', /3 个表情包/, { locale: 'zh-cn' }],
    ]) {
        // eslint-disable-next-line no-await-in-loop
        await withPanelMounted(options, ({ document }) => {
            assert.match(
                document.getElementById('st_emote_library_note').textContent,
                probe,
                `the ${label} library count is wrong`,
            );
        });
    }
});

test('an empty library shows the four steps, and a library with packs does not', async () => {
    // Shown exactly when there is nothing else to read. The last step is the one
    // everybody misses — without `{{st-emote}}` in a preset the model is never
    // told which labels exist, so it never writes a token and the feature looks
    // broken — so it has to be in the card rather than in a tooltip.
    await withPanelMounted({ settings: { packs: [] } }, ({ document }) => {
        const card = document.getElementById('st_emote_start');
        assert.equal(card.hidden, false);
        const steps = [...card.querySelectorAll('li')].map((step) => step.textContent);
        assert.equal(steps.length, 4);
        assert.match(steps[3], /\{\{st-emote\}\}/);
        assert.match(document.getElementById('st_emote_start_title').textContent, /No packs yet/);
        // And the interface note rides along here rather than at the top of the
        // panel, where it was four lines in front of the first control.
        assert.match(document.getElementById('st_emote_start_hint').textContent, /buttons below are icons/);
    });

    await withPanelMounted({}, ({ document }) => {
        assert.equal(document.getElementById('st_emote_start').hidden, true);
    });
});

test('the first-run card is bilingual, in both states of the library', async () => {
    // The panel-language test above reads a panel with packs in it, so it never
    // sees these sentences rendered. The card is the whole first-run experience;
    // a half-translated one is the first thing a new user meets.
    for (const [label, pattern] of [
        ['English', /[A-Za-z]/],
        ['Chinese', /[一-鿿]/],
    ]) {
        // eslint-disable-next-line no-await-in-loop
        await withPanelMounted({ locale: label === 'Chinese' ? 'zh-cn' : 'en', settings: { packs: [] } }, ({ document }) => {
            const card = document.getElementById('st_emote_start');
            const spoken = [
                document.getElementById('st_emote_start_title').textContent,
                document.getElementById('st_emote_start_hint').textContent,
                document.getElementById('st_emote_library_title').textContent,
                document.getElementById('st_emote_status_text').textContent,
                ...[...card.querySelectorAll('li')].map((step) => step.textContent),
            ];
            for (const sentence of spoken) {
                assert.notEqual(sentence.trim(), '');
                assert.match(sentence, pattern, `the first-run panel says nothing in ${label}: "${sentence}"`);
            }
        });
    }
});

test('creating a pack puts it in front of the user, with its grid already open', async () => {
    // The list is sorted by name, so a new pack lands wherever its name sorts
    // rather than at the end where it was just added. "I pressed the button and
    // nothing happened" is the whole failure, and it is the reason the create row
    // reads as the panel's first action rather than its most puzzling one.
    //
    // **Opening it is part of the fix, not decoration.** A closed pack is one line
    // with nothing on it, so scrolling to it and stopping would land the user in
    // front of a header; the next thing they have to do is upload, and that
    // button is inside.
    await withPanelMounted({}, ({ document }) => {
        const name = document.getElementById('st_emote_new_pack');
        name.value = 'beagle';
        document.getElementById('st_emote_create_pack').click();

        assert.equal(name.value, '', 'the field kept the name');
        const created = packByName(document, 'beagle');
        assert.ok(created, 'the pack was not added to the list');
        // Sorted, not appended — so it is genuinely in the middle of the list and
        // genuinely out of sight without this.
        assert.notEqual(
            [...document.querySelectorAll('.st-emote-pack')].at(-1),
            created,
            'this pack happened to sort last, so the test proves nothing',
        );
        assert.equal(created.querySelector('.st-emote-pack-toggle').getAttribute('aria-expanded'), 'true');
        assert.equal(created.querySelector('.st-emote-pack-body').hidden, false);
        // Which is where the upload button is.
        assert.ok(created.querySelector('.st-emote-upload'));
        assert.equal(document.activeElement, created.querySelector('.st-emote-pack-name'));
    });
});

/**
 * Every `st-emote-*` class in force anywhere under the drawer or the editor.
 *
 * @param {Document} document
 * @param {Set<string>} into
 */
function collectClasses(document, into) {
    for (const element of document.querySelectorAll('#st_emote_drawer *, .st-emote-editor *')) {
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
    // 批量 is one button with two sentences: `pack.batchMode` while it is off and
    // `pack.batchModeDone` while it is on, and `aria-pressed` says which. Both
    // are this one handle, so the keys are listed rather than pinned to one.
    'st-emote-batch': { keys: ['pack.batchMode', 'pack.batchModeDone'] },
    // The count is whichever stickers *this* pack has ticked, so it differs
    // from pack to pack and is matched as a number rather than pinned. The
    // count itself is the subject of the batch-delete test above; what matters
    // here is that the sentence is still this key and not a new one.
    'st-emote-delete-selected': { key: 'pack.deleteSelected', count: /\d+/ },
    'st-emote-editor-close': { key: 'sticker.closeEditor' },
    'st-emote-replace': { key: 'sticker.replace' },
    'st-emote-sticker-delete': { key: 'sticker.delete' },
    '#st_emote_preview_run': { key: 'panel.previewRun' },
    '#st_emote_rerender': { key: 'panel.rerender' },
};

/**
 * Classes the panel applies to be *found* rather than to be styled: the
 * per-action query hooks a test clicks (`.st-emote-export`), `st-emote-badge-empty`
 * (the one state with nothing extra to say, so it needs no colour of its own), and
 * the containers that carry an id and no appearance of their own —
 * `st-emote-packs` (the list itself; its parts are styled one by one, and it is as
 * tall as the library is long), `st-emote-sizes` (filled by
 * `adapter/sizing-panel.js`) and the `st-emote-missing` block (also identified by
 * its id, and its visible parts are styled individually).
 *
 * `st-emote-packs` was styled for a while (ticket 13 made it a scroll box, so
 * that the settings below it stayed put) and is a query hook again since the
 * panel scrolls as one column.
 *
 * Every other `st-emote-*` class the panel applies must have a rule, which is what
 * the test above enforces — over two panel states, so the conditional ones count.
 */
const QUERY_HOOKS = [
    'st-emote-add-url',
    'st-emote-badge-empty',
    'st-emote-delete-selected',
    'st-emote-editor-close',
    'st-emote-export',
    'st-emote-missing',
    'st-emote-packs',
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
 *
 * **Ticket 12 moved the control set, and this is the diff.** The lines saying
 * `pack "…" / sticker "…"` are gone: those controls moved into the editor. What
 * arrived instead is one `st-emote-batch` per pack and the `selection bar`, and
 * what a closed pack costs is now one line — its 包名, and nothing else. Nothing
 * was renamed and nothing that could act on a 表情 left the panel; the fields for
 * a 表情 are in `EXPECTED_EDITOR_SURFACE` below, which is a snapshot of the same
 * list read with an editor open.
 *
 * **The state it is read in: one pack open, 批量 mode on, two stickers ticked.**
 * That is the state that shows the most of the panel at once, and every state
 * that adds a control — an open pack, 批量 mode, a tick — is in it. The editor is
 * the one exception, and it cannot be: 批量 mode turns a cell into a checkbox, so
 * a panel cannot be in both at once. Hence the second list.
 */
const EXPECTED_CONTROL_SURFACE = [
    'debug area :: div#st_emote_preview_run.menu_button "Render"',
    'debug area :: div#st_emote_rerender.menu_button "Re-render the current chat"',
    'debug area :: textarea#st_emote_preview.text_pole "Paste a message, e.g. She smiles. [[sticker:daily:happy]]"',
    'pack "blank" / header :: input[text].st-emote-pack-name.text_pole "blank"',
    'pack "daily" / actions :: div.menu_button.st-emote-add-url "Add image URL"',
    'pack "daily" / actions :: div.menu_button.st-emote-batch "Stop selecting stickers"',
    'pack "daily" / actions :: div.menu_button.st-emote-delete-pack "Delete pack"',
    'pack "daily" / actions :: div.menu_button.st-emote-export "Export .zip"',
    'pack "daily" / actions :: div.menu_button.st-emote-upload "Upload images"',
    'pack "daily" / actions :: input[file][image/png,image/jpeg,image/webp,image/gif multiple] (no caption)',
    'pack "daily" / header :: input[text].st-emote-pack-name.text_pole "daily"',
    'pack "daily" / selection bar :: div.menu_button.st-emote-delete-selected "Delete 2 selected"',
    'pack "daily" / selection bar :: input[checkbox] "Select all"',
    'pack "daily" / 作用域 :: input[checkbox] "Character"',
    'pack "daily" / 作用域 :: input[checkbox] "Chat"',
    'pack "daily" / 作用域 :: input[checkbox] "Global"',
    'pack "zeta" / header :: input[text].st-emote-pack-name.text_pole "zeta"',
    'settings :: div#st_emote_copy_regex.menu_button "Copy regex JSON"',
    'settings :: div#st_emote_create_pack.menu_button "Create pack"',
    'settings :: div#st_emote_import_pack.menu_button "Import pack (.zip)"',
    'settings :: input[checkbox]#st_emote_bracket_form "Bracket form: [[sticker:pack:label]]"',
    'settings :: input[checkbox]#st_emote_enabled "Master switch: render stickers"',
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
 * The same list with an editor open: a pack expanded, one sticker clicked, and
 * its 标签, 描述, 投放方式 override, replace, delete and close on screen.
 *
 * **A second list rather than a second section of the first**, because the two
 * states are mutually exclusive — 批量 mode turns the cell into a checkbox — and
 * one list assembled from both would describe a panel no user has ever seen.
 * Read the two together and they answer "can I still do everything I could before
 * ticket 12": yes, one sticker at a time.
 */
const EXPECTED_EDITOR_SURFACE = [
    'debug area :: div#st_emote_preview_run.menu_button "Render"',
    'debug area :: div#st_emote_rerender.menu_button "Re-render the current chat"',
    'debug area :: textarea#st_emote_preview.text_pole "Paste a message, e.g. She smiles. [[sticker:daily:happy]]"',
    'pack "blank" / header :: input[text].st-emote-pack-name.text_pole "blank"',
    'pack "daily" / actions :: div.menu_button.st-emote-add-url "Add image URL"',
    'pack "daily" / actions :: div.menu_button.st-emote-batch "Select stickers"',
    'pack "daily" / actions :: div.menu_button.st-emote-delete-pack "Delete pack"',
    'pack "daily" / actions :: div.menu_button.st-emote-export "Export .zip"',
    'pack "daily" / actions :: div.menu_button.st-emote-upload "Upload images"',
    'pack "daily" / actions :: input[file][image/png,image/jpeg,image/webp,image/gif multiple] (no caption)',
    'pack "daily" / header :: input[text].st-emote-pack-name.text_pole "daily"',
    'pack "daily" / 作用域 :: input[checkbox] "Character"',
    'pack "daily" / 作用域 :: input[checkbox] "Chat"',
    'pack "daily" / 作用域 :: input[checkbox] "Global"',
    'pack "zeta" / header :: input[text].st-emote-pack-name.text_pole "zeta"',
    'settings :: div#st_emote_copy_regex.menu_button "Copy regex JSON"',
    'settings :: div#st_emote_create_pack.menu_button "Create pack"',
    'settings :: div#st_emote_import_pack.menu_button "Import pack (.zip)"',
    'settings :: input[checkbox]#st_emote_bracket_form "Bracket form: [[sticker:pack:label]]"',
    'settings :: input[checkbox]#st_emote_enabled "Master switch: render stickers"',
    'settings :: input[checkbox]#st_emote_render_user "Render stickers in user messages"',
    'settings :: input[checkbox]#st_emote_tag_form "HTML tag form: the tag name below, wrapping pack:label"',
    'settings :: input[file][.zip,application/zip single] (no caption)',
    'settings :: input[text]#st_emote_new_pack.text_pole "New pack name"',
    'settings :: input[text]#st_emote_search.text_pole "Search labels and descriptions"',
    'settings :: input[text]#st_emote_tag_name.text_pole "HTML tag form:"',
    'settings :: select#st_emote_placement.text_pole[in-place="In place" | after-block="After the block" | message-end="End of message"] "Placement"',
    'sticker editor "happy" :: div.menu_button.st-emote-editor-close "Close"',
    'sticker editor "happy" :: div.menu_button.st-emote-replace "Replace"',
    'sticker editor "happy" :: div.menu_button.st-emote-sticker-delete "Delete"',
    'sticker editor "happy" :: input[file][image/png,image/jpeg,image/webp,image/gif single] (no caption)',
    'sticker editor "happy" :: input[text].st-emote-description.text_pole "—"',
    'sticker editor "happy" :: input[text].st-emote-label.text_pole "Label"',
    'sticker editor "happy" :: select.st-emote-sticker-placement.text_pole[="Follow the global setting" | in-place="In place" | after-block="After the block" | message-end="End of message"] "Placement override for this sticker"',
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
    // The editor first: it hangs off `document.body`, so it is not inside any
    // pack, and its dialog label is the one fact that says which sticker it is
    // about. `aria-label` rather than a `data-` of our own, because the dialog
    // already has to carry that sentence for a screen reader.
    const editor = element.closest('.st-emote-editor');
    if (editor) {
        return `sticker editor "${editor.getAttribute('aria-label') ?? '?'}"`;
    }
    const pack = element.closest('.st-emote-pack');
    if (pack) {
        const name = pack.querySelector('.st-emote-pack-name')?.value ?? '?';
        if (element.closest('.st-emote-scopes')) {
            return `pack "${name}" / 作用域`;
        }
        if (element.closest('.st-emote-selection')) {
            return `pack "${name}" / selection bar`;
        }
        if (element.closest('.st-emote-actions')) {
            return `pack "${name}" / actions`;
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
 * Every element on the panel a user can operate, wherever it lives.
 *
 * **The editor is in this list, not left out of it.** A control surface that only
 * covered the drawer would report "the panel has no way to rename a 标签" the
 * moment those fields moved into a layer over it — which is exactly the kind of
 * change a snapshot is supposed to make visible rather than absorb.
 */
const PANEL_CONTROLS = [
    '#st_emote_drawer input',
    '#st_emote_drawer select',
    '#st_emote_drawer textarea',
    '#st_emote_drawer .menu_button',
    '.st-emote-editor input',
    '.st-emote-editor select',
    '.st-emote-editor .menu_button',
].join(', ');

/**
 * The whole panel's control surface as sorted lines. Every element a user can
 * operate is in: inputs, selects, the debug box, the client's `.menu_button`
 * which is a `<div>` this extension paints rather than a real `<button>`, and
 * the editor layer that hangs off `document.body`.
 *
 * @param {Document} document
 * @returns {string[]}
 */
function controlSurface(document) {
    return [...document.querySelectorAll(PANEL_CONTROLS)].map((element) => {
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
 * Five, not one, and for the same reason the class-coverage test above uses
 * three: several buttons exist only in some states. `deleteSelected` needs a
 * ticked sticker in 批量 mode; `export` and `deletePack` need an open pack;
 * `replace` and `deleteSticker` need an open editor; `createMissingPacks` needs a
 * character card naming a pack that is not installed. A single ordinary render
 * would check a third of the icon table and pass anyway, and the orphan half of
 * the test above would then be asserting against a partial `drawn` set.
 *
 * @returns {{options: object}[]}
 */
function iconButtonStates() {
    return [
        { options: {} },
        {
            // One pack open: the two actions that live inside a pack's body, and
            // the 批量 switch on its way in and on its way out.
            options: { arrange: (document) => {
                expandPack(document, 'daily');
                packByName(document, 'daily').querySelector('.st-emote-batch').click();
            } },
        },
        {
            // And with something ticked, which is the only way the batch delete is
            // ever drawn.
            options: { arrange: (document) => {
                enterBatchMode(document, 'daily');
                stickerCell(document, 'daily', 'happy').click();
            } },
        },
        {
            // The editor, which hangs off `document.body`: the replace, the delete
            // and the close button exist nowhere else.
            options: { arrange: (document) => {
                openEditor(document, 'daily', 'happy');
                return () => closeStickerEditor();
            } },
        },
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
 * Open a pack's grid by clicking its header — the same click a user makes, so a
 * test that skipped this would be testing a state no user is ever in.
 *
 * @param {Document} document
 * @param {string} packName
 * @returns {Element} The pack's body, which is where the grid went.
 */
function expandPack(document, packName) {
    const pack = packByName(document, packName);
    const toggle = pack.querySelector('.st-emote-pack-toggle');
    if (toggle.getAttribute('aria-expanded') !== 'true') {
        toggle.click();
    }
    return pack.querySelector('.st-emote-pack-body');
}

/**
 * One grid cell, by the 标签 the cell says out loud.
 *
 * @param {Document} document
 * @param {string} packName
 * @param {string} label
 * @returns {Element}
 */
function stickerCell(document, packName, label) {
    return [...packByName(document, packName).querySelectorAll('.st-emote-cell')]
        .find((cell) => cell.dataset.label === label) ?? null;
}

/**
 * Open one sticker's editor: click its cell, which is the only way in.
 *
 * @param {Document} document
 * @param {string} packName
 * @param {string} label
 * @returns {Element} The editor layer.
 */
function openEditor(document, packName, label) {
    expandPack(document, packName);
    stickerCell(document, packName, label).click();
    return document.querySelector('.st-emote-editor');
}

/**
 * Enter one pack's 批量 mode, which is also the only way the batch bar and the
 * "delete selected" button are ever on screen.
 *
 * @param {Document} document
 * @param {string} packName
 */
function enterBatchMode(document, packName) {
    expandPack(document, packName);
    packByName(document, packName).querySelector('.st-emote-batch').click();
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
