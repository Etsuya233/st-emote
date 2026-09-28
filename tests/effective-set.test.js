import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEffectiveSet } from '../core/effective-set.js';

const packs = [
    {
        name: 'daily',
        stickers: [
            { label: 'happy', image: 'user/images/st-emote/a.png' },
            { label: 'Sad Face', image: 'user/images/st-emote/b.png' },
            { label: '', image: 'user/images/st-emote/c.png' },
            { label: '   ', image: 'user/images/st-emote/e.png' },
        ],
    },
    {
        name: 'roleplay',
        stickers: [{ label: 'happy', image: 'user/images/st-emote/d.png' }],
    },
];

test('qualified token hits an enabled pack', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    const result = set.lookup('daily', 'happy');
    assert.equal(result.hit, true);
    assert.equal(result.pack.name, 'daily');
    assert.equal(result.sticker.label, 'happy');
});

test('pack name and label comparison are case-insensitive', () => {
    const set = buildEffectiveSet(packs, ['Daily']);
    const result = set.lookup('DAILY', '  HAPPY ');
    assert.equal(result.hit, true);
});

test('label comparison collapses inner whitespace', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    assert.equal(set.lookup('daily', 'sad   face').hit, true);
});

test('a pack that exists but is not enabled is a miss', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    assert.deepEqual(set.lookup('roleplay', 'happy'), { hit: false, reason: 'pack-not-enabled' });
});

test('an unknown pack is a miss', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    assert.deepEqual(set.lookup('ghost', 'happy'), { hit: false, reason: 'pack-not-found' });
});

test('an unknown label is a miss', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    assert.deepEqual(set.lookup('daily', 'angry'), { hit: false, reason: 'label-not-found' });
});

test('a sticker without a label never matches', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    assert.deepEqual(set.lookup('daily', ''), { hit: false, reason: 'label-not-found' });
    assert.deepEqual(set.lookup('daily', '   '), { hit: false, reason: 'label-not-found' });
});

test('a sticker without a label is not part of the effective set', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    const labels = set.packs[0].stickers.map((sticker) => sticker.label);
    assert.deepEqual(labels, ['happy', 'Sad Face']);
});

test('a bare label resolves when exactly one pack is enabled', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    const result = set.lookup(null, 'happy');
    assert.equal(result.hit, true);
    assert.equal(result.pack.name, 'daily');
});

test('a bare label is ambiguous when several packs are enabled', () => {
    const set = buildEffectiveSet(packs, ['daily', 'roleplay']);
    assert.deepEqual(set.lookup(null, 'happy'), { hit: false, reason: 'ambiguous-bare-label' });
});

test('a bare label misses when nothing is enabled', () => {
    const set = buildEffectiveSet(packs, []);
    assert.deepEqual(set.lookup(null, 'happy'), { hit: false, reason: 'pack-not-enabled' });
});

test('enabled names pointing at missing packs are ignored', () => {
    const set = buildEffectiveSet(packs, ['ghost']);
    assert.equal(set.packs.length, 0);
    assert.deepEqual(set.lookup(null, 'happy'), { hit: false, reason: 'pack-not-enabled' });
});

test('duplicate enabled names do not break the single-pack shortcut', () => {
    const set = buildEffectiveSet(packs, ['daily', 'DAILY']);
    assert.equal(set.packs.length, 1);
    assert.equal(set.lookup(null, 'happy').hit, true);
});
