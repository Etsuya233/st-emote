import test from 'node:test';
import assert from 'node:assert/strict';

import {
    addImportedPack,
    localImageOf,
    ownImageFilesOf,
    removePack,
    removeStickers,
    replaceStickerImage,
} from '../core/catalogue.js';

const local = (name) => `user/images/st-emote/${name}`;

test('localImageOf tells a stored file from a 外链 and from nothing', () => {
    assert.equal(localImageOf({ image: local('st-emote-a.png') }), local('st-emote-a.png'));
    assert.equal(localImageOf({ image: 'https://example.com/a.png' }), '');
    assert.equal(localImageOf({ image: '' }), '');
    assert.equal(localImageOf({}), '');
    assert.equal(localImageOf(null), '');
});

test('replaceStickerImage swaps the image and keeps the label and description', () => {
    const sticker = { id: 's1', label: 'happy', description: 'a grin', image: local('st-emote-a.png') };
    const previous = replaceStickerImage(sticker, local('st-emote-b.png'));
    assert.equal(previous, local('st-emote-a.png'));
    assert.equal(sticker.image, local('st-emote-b.png'));
    assert.equal(sticker.label, 'happy');
    assert.equal(sticker.description, 'a grin');
    assert.equal(sticker.id, 's1');
});

test('replaceStickerImage has no previous file to delete for a new or external sticker', () => {
    assert.equal(replaceStickerImage({ image: '' }, local('st-emote-b.png')), '');
    assert.equal(
        replaceStickerImage({ image: 'https://example.com/a.png' }, local('st-emote-b.png')),
        '',
    );
});

test('ownImageFilesOf lists only the extension’s own files, without duplicates', () => {
    const stickers = [
        { image: local('st-emote-a.png') },
        { image: local('st-emote-a.png') },
        { image: local('st-emote-b.gif') },
        { image: 'user/images/backgrounds/st-emote-x.png' },
        { image: 'user/images/st-emote/other-feature.png' },
        { image: 'https://example.com/a.png' },
        { image: '' },
    ];
    assert.deepEqual(ownImageFilesOf(stickers), [local('st-emote-a.png'), local('st-emote-b.gif')]);
});

test('removeStickers deletes the chosen ones and reports their files', () => {
    const keep = { id: 'keep', image: local('st-emote-keep.png') };
    const a = { id: 'a', image: local('st-emote-a.png') };
    const b = { id: 'b', image: 'https://example.com/b.png' };
    const pack = { name: 'daily', stickers: [keep, a, b] };

    const result = removeStickers(pack, [a, b]);

    assert.deepEqual(pack.stickers, [keep]);
    assert.deepEqual(result.stickers, [a, b]);
    assert.deepEqual(result.files, [local('st-emote-a.png')]);
});

test('removeStickers with an empty selection is a no-op', () => {
    const sticker = { id: 'a', image: local('st-emote-a.png') };
    const pack = { name: 'daily', stickers: [sticker] };
    const result = removeStickers(pack, []);
    assert.deepEqual(pack.stickers, [sticker]);
    assert.deepEqual(result.files, []);
});

test('removePack takes the pack out of the catalogue and out of every scope', () => {
    const other = { name: 'other', stickers: [] };
    const settings = {
        packs: [other, { name: 'daily', stickers: [{ id: 'a', image: local('st-emote-a.png') }] }],
        enabledPackNames: ['daily', 'other'],
    };
    const pack = settings.packs[1];

    const result = removePack(settings, pack, {
        character: ['daily', 'other'],
        chat: ['other', 'Daily'],
    });

    assert.deepEqual(settings.packs, [other]);
    assert.deepEqual(settings.enabledPackNames, ['other']);
    assert.deepEqual(result.global, ['other']);
    assert.deepEqual(result.character, ['other']);
    assert.deepEqual(result.chat, ['other']);
    assert.deepEqual(result.files, [local('st-emote-a.png')]);
});

test('addImportedPack adds the pack and leaves every scope alone', () => {
    const settings = { packs: [], enabledPackNames: ['existing'] };
    const pack = { name: 'imported', stickers: [{ id: 's', label: 'a', description: '', image: '' }] };

    const added = addImportedPack(settings, pack);

    assert.equal(added, pack);
    assert.deepEqual(settings.packs, [pack]);
    assert.deepEqual(settings.enabledPackNames, ['existing']);
    assert.equal(settings.enabledPackNames.includes('imported'), false);
});
