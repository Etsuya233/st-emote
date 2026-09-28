import test from 'node:test';
import assert from 'node:assert/strict';

import { findTokens, parseTokenBody } from '../core/token.js';
import { normalizeLabel, normalizePackName } from '../core/normalize.js';

test('parseTokenBody reads a bare label', () => {
    assert.deepEqual(parseTokenBody('happy'), { packName: null, label: 'happy' });
});

test('parseTokenBody splits a qualified token at the first colon', () => {
    assert.deepEqual(parseTokenBody('daily:happy'), { packName: 'daily', label: 'happy' });
});

test('parseTokenBody keeps later colons in the label', () => {
    assert.deepEqual(parseTokenBody('daily:a:b'), { packName: 'daily', label: 'a:b' });
});

test('parseTokenBody trims both sides', () => {
    assert.deepEqual(parseTokenBody('  daily  :  happy  '), { packName: 'daily', label: 'happy' });
});

test('findTokens finds both forms and reports positions', () => {
    const text = 'hi [[sticker:daily:happy]] and [[sticker:sad]]';
    const tokens = findTokens(text);
    assert.equal(tokens.length, 2);
    assert.deepEqual(
        tokens.map((token) => ({ packName: token.packName, label: token.label, raw: token.raw })),
        [
            { packName: 'daily', label: 'happy', raw: '[[sticker:daily:happy]]' },
            { packName: null, label: 'sad', raw: '[[sticker:sad]]' },
        ],
    );
    assert.equal(text.slice(tokens[0].index, tokens[0].index + tokens[0].length), tokens[0].raw);
});

test('findTokens does not match across a newline', () => {
    assert.equal(findTokens('[[sticker:daily:\nhappy]]').length, 0);
});

test('findTokens ignores tokens with an empty label', () => {
    assert.equal(findTokens('[[sticker:daily:]]').length, 0);
    assert.equal(findTokens('[[sticker:]]').length, 0);
});

test('normalizeLabel trims, collapses whitespace and lowercases', () => {
    assert.equal(normalizeLabel('  Happy   Face '), 'happy face');
    assert.equal(normalizeLabel(null), '');
});

test('normalizePackName trims and lowercases', () => {
    assert.equal(normalizePackName('  Daily  '), 'daily');
    assert.equal(normalizePackName(undefined), '');
});
