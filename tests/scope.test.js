import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildEffectiveSet,
    buildScopedEffectiveSet,
    mergeEnabledPackNames,
    renamePackInScope,
    scopeHasPack,
    setPackInScope,
} from '../core/effective-set.js';

test('the three scopes merge into one ordered union', () => {
    assert.deepEqual(
        mergeEnabledPackNames(['a'], ['b', 'c'], ['d']),
        ['a', 'b', 'c', 'd'],
    );
});

test('the union dedupes by pack name, case-insensitively, keeping the first spelling', () => {
    assert.deepEqual(
        mergeEnabledPackNames(['Daily'], ['daily', 'roleplay'], ['ROLEPLAY', 'chat']),
        ['Daily', 'roleplay', 'chat'],
    );
});

test('the union tolerates missing and malformed scope lists', () => {
    assert.deepEqual(mergeEnabledPackNames(['a'], undefined, null, ['  '], ['b']), ['a', 'b']);
    assert.deepEqual(mergeEnabledPackNames(), []);
});

test('scopeHasPack compares pack names case-insensitively', () => {
    assert.equal(scopeHasPack(['Daily'], 'daily'), true);
    assert.equal(scopeHasPack(['Daily'], 'ghost'), false);
    assert.equal(scopeHasPack(null, 'daily'), false);
});

test('setPackInScope adds and removes a pack while keeping its spelling', () => {
    assert.deepEqual(setPackInScope(['a'], 'B', true), ['a', 'B']);
    assert.deepEqual(setPackInScope(['a', 'b'], 'A', false), ['b']);
});

test('setPackInScope does not duplicate an already-enabled pack', () => {
    assert.deepEqual(setPackInScope(['Daily'], 'daily', true), ['Daily']);
    assert.deepEqual(setPackInScope(['Daily'], 'daily', false), []);
});

test('renamePackInScope remaps the enabled reference in place', () => {
    assert.deepEqual(renamePackInScope(['daily', 'roleplay'], 'Daily', 'everyday'), ['everyday', 'roleplay']);
    assert.deepEqual(renamePackInScope(['roleplay'], 'daily', 'everyday'), ['roleplay']);
});

test('the union of the three scopes feeds the effective set without duplicates', () => {
    const packs = [
        { name: 'daily', stickers: [{ label: 'happy', image: 'user/images/st-emote/a.png' }] },
        { name: 'roleplay', stickers: [{ label: 'sad', image: 'user/images/st-emote/b.png' }] },
        { name: 'chatty', stickers: [{ label: 'wave', image: 'user/images/st-emote/c.png' }] },
    ];
    const names = mergeEnabledPackNames(['daily'], ['Daily', 'roleplay'], ['chatty']);
    const set = buildEffectiveSet(packs, names);
    assert.deepEqual(set.packs.map((pack) => pack.name), ['daily', 'roleplay', 'chatty']);
    assert.deepEqual(set.lookup(null, 'sad'), { hit: false, reason: 'ambiguous-bare-label' });
    assert.equal(set.lookup('daily', 'happy').hit, true);
});

test('a single pack enabled by two scopes still allows a bare label', () => {
    const packs = [{ name: 'daily', stickers: [{ label: 'happy', image: 'user/images/st-emote/a.png' }] }];
    const names = mergeEnabledPackNames(['daily'], [], ['DAILY']);
    const set = buildEffectiveSet(packs, names);
    assert.equal(set.packs.length, 1);
    assert.equal(set.lookup(null, 'happy').hit, true);
});

test('buildScopedEffectiveSet owns the three-scope union rule', () => {
    const packs = [
        { name: 'daily', stickers: [{ label: 'happy', image: 'user/images/st-emote/a.png' }] },
        { name: 'roleplay', stickers: [{ label: 'sad', image: 'user/images/st-emote/b.png' }] },
    ];
    const set = buildScopedEffectiveSet(packs, {
        global: ['daily'],
        character: ['daily'],
        chat: ['roleplay'],
    });
    assert.deepEqual(set.packs.map((pack) => pack.name), ['daily', 'roleplay']);
    assert.equal(set.lookup('roleplay', 'sad').hit, true);
});
