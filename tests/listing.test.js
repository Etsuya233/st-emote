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

test('the default listing qualifies every row with its pack name', () => {
    const set = buildEffectiveSet(packs, ['daily', 'roleplay']);
    assert.equal(
        buildListing(set),
        'daily:Happy\ndaily:Sad Face\nroleplay:happy',
    );
});

test('the full listing matches the default listing', () => {
    const set = buildEffectiveSet(packs, ['daily', 'roleplay']);
    assert.equal(buildListing(set, { mode: 'full' }), buildListing(set));
});

test('the simple listing prints bare labels and keeps conflicts as duplicates', () => {
    const set = buildEffectiveSet(packs, ['daily', 'roleplay']);
    assert.equal(buildListing(set, { mode: 'simple' }), 'Happy\nSad Face\nhappy');
});

test('an unknown mode falls back to the full listing', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    assert.equal(buildListing(set, { mode: 'nonsense' }), 'daily:Happy\ndaily:Sad Face');
});

test('the listing never contains a description', () => {
    const set = buildEffectiveSet(packs, ['daily', 'roleplay']);
    const listing = buildListing(set, { mode: 'simple' });
    assert.equal(listing.includes('grin'), false);
    assert.equal(listing.includes('teary'), false);
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
        'happy\nHappy\nSad Face',
    );
});
