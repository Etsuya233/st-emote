import test from 'node:test';
import assert from 'node:assert/strict';

import {
    IMAGE_FOLDER,
    MANIFEST_FILE,
    MANIFEST_FORMAT,
    MANIFEST_VERSION,
    archiveImagePath,
    buildManifest,
    isSafeArchivePath,
    parseManifest,
    planImport,
} from '../core/manifest.js';

let counter = 0;
const newId = (prefix) => `${prefix}_${(counter += 1)}`;
const ids = () => {
    counter = 0;
};

const json = (value) => JSON.stringify(value);
const parse = (value) => parseManifest(typeof value === 'string' ? value : json(value));

const pack = {
    name: 'daily',
    stickers: [
        {
            id: 's1',
            label: 'happy',
            description: 'a wide grin',
            image: 'user/images/st-emote/st-emote-s1.png',
            placement: 'message-end',
        },
        {
            id: 's2',
            label: 'wave',
            description: '',
            image: 'https://example.com/wave.gif',
            placement: '',
        },
    ],
};

test('buildManifest names the format, version, pack and every sticker', () => {
    const manifest = buildManifest(pack);
    assert.equal(manifest.format, MANIFEST_FORMAT);
    assert.equal(manifest.version, MANIFEST_VERSION);
    assert.equal(manifest.name, 'daily');
    assert.equal(manifest.stickers.length, 2);
});

test('buildManifest records the label, description, image source and placement override', () => {
    const [local, external] = buildManifest(pack).stickers;

    assert.equal(local.label, 'happy');
    assert.equal(local.description, 'a wide grin');
    assert.equal(local.placement, 'message-end');
    assert.equal(local.url, undefined);
    assert.match(local.file, new RegExp(`^${IMAGE_FOLDER}/001-happy\\.png$`));

    assert.equal(external.label, 'wave');
    assert.equal(external.url, 'https://example.com/wave.gif');
    assert.equal(external.file, undefined);
    // No override means no key, rather than an empty string that would have to
    // be told apart from "follow the global setting" on the way back in.
    assert.equal('placement' in external, false);
});

test('buildManifest keeps a sticker that has neither a label nor a picture', () => {
    const manifest = buildManifest({ name: 'empty', stickers: [{ id: 's', label: '', description: '', image: '' }] });
    assert.deepEqual(manifest.stickers, [{ label: '', description: '' }]);
});

test('buildManifest output round-trips through parseManifest', () => {
    const result = parse(buildManifest(pack));
    assert.equal(result.ok, true);
    assert.equal(result.manifest.name, 'daily');
    assert.equal(result.manifest.stickers[0].label, 'happy');
    assert.equal(result.manifest.stickers[0].file, `${IMAGE_FOLDER}/001-happy.png`);
    assert.equal(result.manifest.stickers[0].placement, 'message-end');
    assert.equal(result.manifest.stickers[1].url, 'https://example.com/wave.gif');
});

test('the manifest lives at a fixed name in the archive', () => {
    assert.equal(MANIFEST_FILE, 'st-emote.json');
});

test('parseManifest refuses text that is not JSON', () => {
    assert.deepEqual(parse('not json at all'), { ok: false, reason: 'not-json' });
    assert.deepEqual(parse(''), { ok: false, reason: 'not-json' });
});

test('parseManifest refuses something that is not one of our packs', () => {
    assert.deepEqual(parse({ format: 'something-else', version: 1, name: 'x', stickers: [] }), {
        ok: false,
        reason: 'not-a-pack',
    });
    assert.deepEqual(parse('[]'), { ok: false, reason: 'not-a-pack' });
    assert.deepEqual(parse('null'), { ok: false, reason: 'not-a-pack' });
});

test('parseManifest refuses a version it does not know', () => {
    assert.deepEqual(parse({ format: MANIFEST_FORMAT, version: 99, name: 'x', stickers: [] }), {
        ok: false,
        reason: 'unsupported-version',
    });
});

test('parseManifest refuses an invalid pack name', () => {
    assert.deepEqual(parse({ format: MANIFEST_FORMAT, version: 1, name: 'a:b', stickers: [] }), {
        ok: false,
        reason: 'invalid-name',
    });
    assert.deepEqual(parse({ format: MANIFEST_FORMAT, version: 1, name: '  ', stickers: [] }), {
        ok: false,
        reason: 'invalid-name',
    });
});

test('parseManifest refuses a sticker list that is not a list', () => {
    assert.deepEqual(parse({ format: MANIFEST_FORMAT, version: 1, name: 'x', stickers: {} }), {
        ok: false,
        reason: 'invalid-stickers',
    });
});

test('parseManifest applies the sticker field rules', () => {
    const base = { format: MANIFEST_FORMAT, version: 1, name: 'x' };
    const withSticker = (sticker) => parse({ ...base, stickers: [sticker] });

    assert.deepEqual(withSticker({ label: 'a[b' }), { ok: false, reason: 'invalid-label' });
    assert.deepEqual(withSticker({ label: 'a\nb' }), { ok: false, reason: 'invalid-label' });
    assert.deepEqual(withSticker({ label: 'a', description: 'a\nb' }), {
        ok: false,
        reason: 'invalid-description',
    });
    assert.deepEqual(withSticker({ label: 'a', placement: 'sideways' }), {
        ok: false,
        reason: 'invalid-placement',
    });
    assert.deepEqual(withSticker('nope'), { ok: false, reason: 'invalid-sticker' });
});

test('parseManifest accepts a sticker with no image at all', () => {
    const result = parse({
        format: MANIFEST_FORMAT,
        version: 1,
        name: 'x',
        stickers: [{ label: 'unlabelled', description: '' }],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.manifest.stickers[0], { label: 'unlabelled', description: '', placement: '' });
});

test('parseManifest refuses a sticker naming two image sources', () => {
    assert.deepEqual(
        parse({
            format: MANIFEST_FORMAT,
            version: 1,
            name: 'x',
            stickers: [{ label: 'a', file: `${IMAGE_FOLDER}/1.png`, url: 'https://example.com/a.png' }],
        }),
        { ok: false, reason: 'invalid-image' },
    );
});

test('parseManifest refuses a sticker whose url is not a web address', () => {
    assert.deepEqual(
        parse({
            format: MANIFEST_FORMAT,
            version: 1,
            name: 'x',
            stickers: [{ label: 'a', url: 'javascript:alert(1)' }],
        }),
        { ok: false, reason: 'invalid-url' },
    );
    assert.deepEqual(
        parse({ format: MANIFEST_FORMAT, version: 1, name: 'x', stickers: [{ label: 'a', url: 'nope' }] }),
        { ok: false, reason: 'invalid-url' },
    );
});

test('parseManifest refuses two stickers with the same label', () => {
    const result = parse({
        format: MANIFEST_FORMAT,
        version: 1,
        name: 'x',
        stickers: [{ label: 'Happy' }, { label: ' happy ' }],
    });
    assert.deepEqual(result, { ok: false, reason: 'duplicate-label' });
});

test('isSafeArchivePath keeps a foreign file name inside the archive', () => {
    assert.equal(isSafeArchivePath('images/001-happy.png'), true);
    assert.equal(isSafeArchivePath('images/sub/1.png'), true);
    assert.equal(isSafeArchivePath('images/../../etc/passwd'), false);
    assert.equal(isSafeArchivePath('/etc/passwd'), false);
    assert.equal(isSafeArchivePath('C:/windows/win.ini'), false);
    assert.equal(isSafeArchivePath('images\\1.png'), false);
    assert.equal(isSafeArchivePath(''), false);
});

test('parseManifest refuses a file name that climbs out of the archive', () => {
    assert.deepEqual(
        parse({
            format: MANIFEST_FORMAT,
            version: 1,
            name: 'x',
            stickers: [{ label: 'a', file: '../../settings.json' }],
        }),
        { ok: false, reason: 'unsafe-file' },
    );
});

test('archiveImagePath numbers the files, names them after the label and keeps the format', () => {
    assert.equal(
        archiveImagePath({ label: 'Big Smile', image: 'user/images/st-emote/x.webp' }, 4),
        `${IMAGE_FOLDER}/005-big-smile.webp`,
    );
    assert.equal(archiveImagePath({ label: '', image: 'user/images/st-emote/x.gif' }, 0), `${IMAGE_FOLDER}/001-sticker.gif`);
    assert.equal(archiveImagePath({ label: 'a/b', image: 'user/images/st-emote/x.png' }, 9), `${IMAGE_FOLDER}/010-a-b.png`);
});

test('planImport gives every sticker its own id, so no two can share an image file', () => {
    ids();
    const manifest = {
        format: 'st-emote-pack',
        version: 1,
        name: 'two',
        stickers: [
            { label: 'a', description: '', file: 'images/001-a.png' },
            { label: 'b', description: '', file: 'images/002-b.png' },
        ],
    };
    const result = planImport(manifest, [], newId);
    const stickerIds = result.pack.stickers.map((sticker) => sticker.id);
    assert.equal(new Set(stickerIds).size, 2);
    // One upload per sticker, each named after its own id: a file name in the
    // archive is a label for a person reading it, never a shared target.
    assert.deepEqual(result.uploads.map((upload) => upload.sticker.id), stickerIds);
});

test('planImport refuses a pack whose name is already taken, in any spelling', () => {
    ids();
    const result = planImport(parse(buildManifest(pack)).manifest, [{ name: 'Daily', stickers: [] }], newId);
    assert.deepEqual(result, { ok: false, reason: 'name-taken' });
});

test('planImport builds a pack with fresh ids and lists the uploads it still needs', () => {
    ids();
    const result = planImport(parse(buildManifest(pack)).manifest, [], newId);

    assert.equal(result.ok, true);
    assert.equal(result.pack.name, 'daily');
    assert.deepEqual(result.pack.stickers.map((sticker) => sticker.label), ['happy', 'wave']);
    assert.deepEqual(result.pack.stickers.map((sticker) => sticker.id), ['sticker_1', 'sticker_2']);
    // Nothing is stored until the caller uploads, so the local image is empty
    // until then; the external one is final already.
    assert.equal(result.pack.stickers[0].image, '');
    assert.equal(result.pack.stickers[0].placement, 'message-end');
    assert.equal(result.pack.stickers[1].image, 'https://example.com/wave.gif');
    assert.equal(result.pack.stickers[1].placement, '');

    assert.equal(result.uploads.length, 1);
    assert.equal(result.uploads[0].path, `${IMAGE_FOLDER}/001-happy.png`);
    assert.equal(result.uploads[0].format, 'png');
    assert.equal(result.uploads[0].sticker, result.pack.stickers[0]);
});
