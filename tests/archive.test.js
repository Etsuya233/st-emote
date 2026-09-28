/**
 * Export and import, driven through a real zip.
 *
 * The manifest rules are tested in `tests/manifest.test.js` against plain data.
 * What this suite adds is the half that only exists in a browser: that the
 * archive a pack is written into can be read back by the code that imports it.
 * Both halves go through the same JSZip module the client ships, so a difference
 * in what is written and what is read is caught here rather than by a user with
 * two browsers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPackArchive, loadJsZip, readPackArchive } from '../adapter/archive.js';
import { MANIFEST_FILE, parseManifest } from '../core/manifest.js';
import { withJsZip } from './contract/st-dom.js';

const MANIFEST_TEXT = JSON.stringify({
    format: 'st-emote-pack',
    version: 1,
    name: 'daily',
    stickers: [
        { label: 'happy', description: 'a grin', file: 'images/001-happy.png', placement: 'message-end' },
        { label: 'wave', description: '', url: 'https://example.com/wave.gif' },
    ],
});

/**
 * A stored image path, with the prefix every uploaded file carries.
 *
 * @param {string} name
 * @returns {string}
 */
const local = (name) => `user/images/st-emote/st-emote-${name}`;

const pack = {
    name: 'daily',
    stickers: [
        { id: 'd1', label: 'happy', description: 'a grin', image: local('d1.png'), placement: 'message-end' },
        { id: 'd2', label: 'wave', description: '', image: 'https://example.com/wave.gif', placement: '' },
    ],
};

test('the zip library the client ships is what the adapter loads', async (t) => {
    await withJsZip(t, async () => {
        const JSZip = await loadJsZip();
        assert.equal(typeof JSZip, 'function');
    });
});

test('a pack exports to a zip holding the manifest and the local images', async (t) => {
    await withJsZip(t, async () => {
        const savedFetch = globalThis.fetch;
        // The export reads the stored image back through the origin it is served
        // from, so the stub only has to answer that one request.
        globalThis.fetch = async (url) => ({
            ok: true,
            status: 200,
            arrayBuffer: async () => new TextEncoder().encode(`bytes of ${url}`).buffer,
        });
        try {
            const { blob, fileName, count } = await buildPackArchive(pack);
            assert.equal(fileName, 'daily.zip');
            // Only the local image has bytes; the 外链 is carried by its address.
            assert.equal(count, 1);

            const zip = await globalThis.JSZip.loadAsync(await asBytes(blob));
            // `images/` is the folder entry JSZip adds for a nested path.
            assert.deepEqual(
                Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort(),
                ['images/001-happy.png', MANIFEST_FILE],
            );
            const manifest = parseManifest(await zip.file(MANIFEST_FILE).async('string'));
            assert.equal(manifest.ok, true);
            assert.equal(manifest.manifest.stickers[0].placement, 'message-end');
            assert.equal(
                await zip.file('images/001-happy.png').async('string'),
                `bytes of ${local('d1.png')}`,
            );
        } finally {
            globalThis.fetch = savedFetch;
        }
    });
});

test('an archive this extension wrote is read back into the same manifest', async (t) => {
    await withJsZip(t, async () => {
        const savedFetch = globalThis.fetch;
        globalThis.fetch = async () => ({
            ok: true,
            status: 200,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        });
        try {
            const { blob } = await buildPackArchive(pack);
            const read = await readPackArchive(await asBytes(blob));
            assert.equal(read.ok, true);
            assert.equal(read.manifest.name, 'daily');
            assert.deepEqual(read.manifest.stickers.map((s) => s.label), ['happy', 'wave']);
            assert.equal(read.manifest.stickers[0].placement, 'message-end');
            assert.equal(read.manifest.stickers[0].file, 'images/001-happy.png');
            assert.equal(read.manifest.stickers[1].url, 'https://example.com/wave.gif');
            // The bytes really are in there, ready to be uploaded.
            assert.deepEqual([...read.images.get('images/001-happy.png')], [1, 2, 3]);
        } finally {
            globalThis.fetch = savedFetch;
        }
    });
});

test('a zip with no manifest is refused by name', async (t) => {
    await withJsZip(t, async () => {
        const zip = new globalThis.JSZip();
        zip.file('readme.txt', 'just a zip');
        const blob = await zip.generateAsync({ type: 'blob' });
        assert.deepEqual(await readPackArchive(await asBytes(blob)), { ok: false, reason: 'no-manifest' });
    });
});

test('something that is not a zip at all is refused', async (t) => {
    await withJsZip(t, async () => {
        const result = await readPackArchive(new TextEncoder().encode('not a zip'));
        assert.deepEqual(result, { ok: false, reason: 'not-a-zip' });
    });
});

test('a zip whose manifest names a file it does not contain is refused', async (t) => {
    await withJsZip(t, async () => {
        const zip = new globalThis.JSZip();
        zip.file(MANIFEST_FILE, MANIFEST_TEXT);
        const blob = await zip.generateAsync({ type: 'blob' });
        assert.deepEqual(await readPackArchive(await asBytes(blob)), { ok: false, reason: 'missing-image' });
    });
});

test('a zip whose manifest is not ours is refused before its files are read', async (t) => {
    await withJsZip(t, async () => {
        const zip = new globalThis.JSZip();
        zip.file(MANIFEST_FILE, JSON.stringify({ hello: 'world' }));
        zip.file('images/001-happy.png', 'bytes');
        const blob = await zip.generateAsync({ type: 'blob' });
        assert.deepEqual(await readPackArchive(await asBytes(blob)), { ok: false, reason: 'not-a-pack' });
    });
});

/**
 * The bytes of a zip.
 *
 * A browser hands JSZip a `Blob` and it reads it directly; under node it needs
 * the bytes. Only the test needs this — the adapter always deals in what the
 * file dialog gives it.
 *
 * @param {Blob} blob
 * @returns {Promise<Uint8Array>}
 */
function asBytes(blob) {
    return blob.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}
