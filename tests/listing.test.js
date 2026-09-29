import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEffectiveSet } from '../core/effective-set.js';
import { buildListing } from '../core/listing.js';
import { withLocale } from './contract/locale.js';

const packs = [
    {
        name: 'daily',
        stickers: [
            { label: 'Happy', description: 'a wide grin', image: 'user/images/st-emote/a.png' },
            { label: 'Sad Face', description: 'teary', image: 'user/images/st-emote/b.png' },
            { label: '', description: 'not filled yet', image: 'user/images/st-emote/c.png' },
        ],
    },
    {
        name: 'roleplay',
        stickers: [{ label: 'happy', description: 'overlaps daily', image: 'user/images/st-emote/d.png' }],
    },
];

test('the default listing qualifies every row with its pack name and its description', () => {
    const set = buildEffectiveSet(packs, ['daily', 'roleplay']);
    assert.equal(
        buildListing(set),
        'daily:Happy (a wide grin)\ndaily:Sad Face (teary)\nroleplay:happy (overlaps daily)',
    );
});

test('the full listing matches the default listing', () => {
    const set = buildEffectiveSet(packs, ['daily', 'roleplay']);
    assert.equal(buildListing(set, { mode: 'full' }), buildListing(set));
});

test('the simple listing qualifies every row and never carries a description', () => {
    const set = buildEffectiveSet(packs, ['daily', 'roleplay']);
    const listing = buildListing(set, { mode: 'simple' });
    assert.equal(listing, 'daily:Happy\ndaily:Sad Face\nroleplay:happy');
    assert.equal(listing.includes('grin'), false);
    assert.equal(listing.includes('teary'), false);
    assert.equal(listing.includes('overlaps daily'), false);
});

test('a label two packs both define is two rows of different text, not a duplicate', () => {
    // `Happy` and `happy` normalize to the same label, which is a 冲突. The old
    // `simple` printed bare labels and so printed the same line twice; the pack
    // name in front is what tells the two rows apart now.
    const set = buildEffectiveSet(packs, ['daily', 'roleplay']);
    const rows = buildListing(set, { mode: 'simple' }).split('\n');
    assert.equal(rows.length, 3);
    assert.equal(new Set(rows).size, 3);
});

test('a sticker with no description prints the same row in both modes', () => {
    const withBlank = [
        {
            name: 'daily',
            stickers: [
                { label: 'happy', description: '', image: 'user/images/st-emote/a.png' },
                { label: 'sad', description: '   ', image: 'user/images/st-emote/b.png' },
            ],
        },
    ];
    const set = buildEffectiveSet(withBlank, ['daily']);
    assert.equal(buildListing(set, { mode: 'full' }), 'daily:happy\ndaily:sad');
    assert.equal(buildListing(set, { mode: 'full' }), buildListing(set, { mode: 'simple' }));
});

test('an unknown mode falls back to the full listing', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    assert.equal(
        buildListing(set, { mode: 'nonsense' }),
        'daily:Happy (a wide grin)\ndaily:Sad Face (teary)',
    );
});

test('the listing has exactly one row per labeled sticker', () => {
    // A description that carried a line break would put a row on screen that
    // names no sticker at all. `validateDescription` refuses one — that rule and
    // its test live in `core/constraints.js` and `tests/constraints.test.js`, so
    // this row count is a consequence of that rule rather than a proof of it.
    // The unlabeled sticker in `packs` is the one that must not get a row.
    const set = buildEffectiveSet(packs, ['daily', 'roleplay']);
    assert.equal(buildListing(set).split('\n').length, 3);
});

test('an empty effective set expands to the localized empty word', () => {
    const set = buildEffectiveSet(packs, []);
    assert.equal(buildListing(set), 'none');
    assert.equal(withLocale('zh-cn', () => buildListing(set)), '无');
    assert.equal(withLocale('zh', () => buildListing(set)), '无');
});

test('a pack whose stickers are all unlabeled is still empty', () => {
    const unlabeled = [{ name: 'empty', stickers: [{ label: '', image: 'user/images/st-emote/e.png' }] }];
    const set = buildEffectiveSet(unlabeled, ['empty']);
    assert.equal(buildListing(set), 'none');
});

test('rows follow the enabled order of the effective set', () => {
    const set = buildEffectiveSet(packs, ['roleplay', 'daily']);
    assert.equal(
        buildListing(set, { mode: 'simple' }),
        'roleplay:happy\ndaily:Happy\ndaily:Sad Face',
    );
});
