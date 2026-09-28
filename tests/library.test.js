import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PACK_STATES,
    isStickerImageMissing,
    matchesQuery,
    packCoverImage,
    packRenameBreaksTokens,
    packState,
    renameBreaksTokens,
    searchLibrary,
    sortPacks,
} from '../core/library.js';

const local = (name) => `user/images/st-emote/${name}`;

test('sortPacks orders by name, next to its own case, and leaves the input alone', () => {
    const packs = [{ name: 'zeta' }, { name: 'Alpha' }, { name: 'daily' }];
    const sorted = sortPacks(packs);
    assert.deepEqual(sorted.map((pack) => pack.name), ['Alpha', 'daily', 'zeta']);
    assert.deepEqual(packs.map((pack) => pack.name), ['zeta', 'Alpha', 'daily']);
});

test('sortPacks keeps two packs that compare equal in their stored order', () => {
    const first = { name: 'daily' };
    const second = { name: 'Daily' };
    assert.deepEqual(sortPacks([first, second]), [first, second]);
});

test('packCoverImage is the first sticker that has a picture', () => {
    assert.equal(
        packCoverImage({ stickers: [{ image: local('a.png') }, { image: local('b.png') }] }),
        local('a.png'),
    );
    assert.equal(
        packCoverImage({ stickers: [{ image: '' }, { image: local('b.png') }] }),
        local('b.png'),
    );
    assert.equal(packCoverImage({ stickers: [] }), '');
    assert.equal(packCoverImage({}), '');
});

test('packState reads a pack with no stickers as empty', () => {
    assert.equal(packState({ stickers: [] }), PACK_STATES.empty);
    assert.equal(packState({}), PACK_STATES.empty);
});

test('packState reads a pack whose local image is absent on this server as images-missing', () => {
    const pack = { stickers: [{ image: local('a.png') }, { image: 'https://example.com/b.png' }] };
    assert.equal(packState(pack, () => true), PACK_STATES.ok);
    assert.equal(packState(pack, (image) => image !== local('a.png')), PACK_STATES.imagesMissing);
});

test('packState never calls a 外链 missing', () => {
    const pack = { stickers: [{ image: 'https://example.com/a.png' }] };
    assert.equal(packState(pack, () => false), PACK_STATES.ok);
    assert.equal(isStickerImageMissing({ image: 'https://example.com/a.png' }, () => false), false);
});

test('packState reads a pack with no images at all as ordinary, not missing', () => {
    assert.equal(packState({ stickers: [{ image: '' }, { image: '' }] }, () => false), PACK_STATES.ok);
});

test('packState assumes every image is present when the caller has no listing', () => {
    const pack = { stickers: [{ image: local('a.png') }] };
    assert.equal(packState(pack), PACK_STATES.ok);
});

test('matchesQuery searches the label and the description, ignoring case and spacing', () => {
    const sticker = { label: 'Big Smile', description: 'a  wide   GRIN' };
    assert.equal(matchesQuery(sticker, 'big smile'), true);
    assert.equal(matchesQuery(sticker, '  BIG   SMILE '), true);
    assert.equal(matchesQuery(sticker, 'grin'), true);
    assert.equal(matchesQuery(sticker, 'wide'), true);
    assert.equal(matchesQuery(sticker, 'frown'), false);
    assert.equal(matchesQuery(sticker, ''), true);
    assert.equal(matchesQuery(sticker, '   '), true);
});

test('searchLibrary keeps only the packs and stickers that match', () => {
    const packs = [
        { name: 'daily', stickers: [{ label: 'smile', description: '' }, { label: 'frown', description: '' }] },
        { name: 'memes', stickers: [{ label: 'dog', description: 'a happy dog' }] },
        { name: 'empty', stickers: [] },
    ];

    assert.deepEqual(searchLibrary(packs, 'smile').map((entry) => entry.pack.name), ['daily']);
    assert.deepEqual(searchLibrary(packs, 'smile')[0].stickers.map((s) => s.label), ['smile']);
    assert.deepEqual(searchLibrary(packs, 'happy').map((entry) => entry.pack.name), ['memes']);
    assert.deepEqual(searchLibrary(packs, 'nothing here'), []);
});

test('the pack record handed back is the caller’s own, not a copy', () => {
    // The panel edits the pack it was handed. A filtered copy would swallow
    // every edit, so identity here is the whole point of the split.
    const pack = { name: 'daily', stickers: [{ label: 'smile' }, { label: 'frown' }] };
    const entry = searchLibrary([pack], 'smile')[0];
    assert.equal(entry.pack, pack);
    assert.notEqual(entry.stickers, pack.stickers);
    assert.deepEqual(pack.stickers.map((sticker) => sticker.label), ['smile', 'frown']);
});

test('an empty search returns every pack, an empty one included', () => {
    const packs = [{ name: 'daily', stickers: [{ label: 'a' }, { label: 'b' }] }, { name: 'empty', stickers: [] }];
    const result = searchLibrary(packs, '');
    assert.deepEqual(result.map((entry) => entry.pack.name), ['daily', 'empty']);
    assert.deepEqual(result[0].stickers.map((sticker) => sticker.label), ['a', 'b']);
    assert.deepEqual(result[1].stickers, []);
    assert.equal(result[0].pack, packs[0]);
});

test('renameBreaksTokens says yes for a real change and no for a spelling-only one', () => {
    assert.equal(renameBreaksTokens('happy', 'sad'), true);
    assert.equal(renameBreaksTokens('happy', ''), true);
    assert.equal(renameBreaksTokens('', 'happy'), true);
    assert.equal(renameBreaksTokens('happy', 'Happy'), false);
    assert.equal(renameBreaksTokens('happy', '  happy  '), false);
    assert.equal(renameBreaksTokens('happy', 'happy'), false);
});

test('packRenameBreaksTokens compares pack names the way they are looked up', () => {
    assert.equal(packRenameBreaksTokens('daily', 'Daily'), false);
    assert.equal(packRenameBreaksTokens('daily', 'daily '), false);
    assert.equal(packRenameBreaksTokens('daily', 'work'), true);
});
