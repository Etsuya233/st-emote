import test from 'node:test';
import assert from 'node:assert/strict';

import { findTokens, parseTokenBody, tokenPrefixes } from '../core/token.js';
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

test('findTokens finds the HTML-tag form', () => {
    const tokens = findTokens('<sticker>daily:happy</sticker>');
    assert.equal(tokens.length, 1);
    assert.deepEqual(
        { packName: tokens[0].packName, label: tokens[0].label, raw: tokens[0].raw },
        { packName: 'daily', label: 'happy', raw: '<sticker>daily:happy</sticker>' },
    );
});

test('findTokens finds the escaped HTML-tag form', () => {
    const tokens = findTokens('&lt;sticker&gt;daily:happy&lt;/sticker&gt;');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].packName, 'daily');
    assert.equal(tokens[0].label, 'happy');
});

test('findTokens reads a bare label in the HTML-tag form', () => {
    const tokens = findTokens('<sticker>happy</sticker>');
    assert.deepEqual({ packName: tokens[0].packName, label: tokens[0].label }, { packName: null, label: 'happy' });
});

test('findTokens honours a custom HTML-tag name', () => {
    assert.equal(findTokens('<表情>daily:happy</表情>', { tagName: '表情' }).length, 0);
    const tokens = findTokens('<my-sticker>daily:happy</my-sticker>', { tagName: 'my-sticker' });
    assert.equal(tokens.length, 1);
    assert.equal(findTokens('<sticker>daily:happy</sticker>', { tagName: 'my-sticker' }).length, 0);
});

test('findTokens falls back to the default tag name for a reserved one', () => {
    const tokens = findTokens('<sticker>daily:happy</sticker>', { tagName: 'div' });
    assert.equal(tokens.length, 1);
});

test('findTokens ignores an empty HTML-tag token', () => {
    assert.equal(findTokens('<sticker></sticker>').length, 0);
    assert.equal(findTokens('<sticker>daily:</sticker>').length, 0);
});

test('findTokens does not match the HTML-tag form across a newline', () => {
    assert.equal(findTokens('<sticker>daily:\nhappy</sticker>').length, 0);
});

test('findTokens orders both forms by position', () => {
    const text = '<sticker>daily:happy</sticker> then [[sticker:daily:sad]]';
    const tokens = findTokens(text);
    assert.deepEqual(tokens.map((token) => token.label), ['happy', 'sad']);
    assert.equal(tokens[0].index < tokens[1].index, true);
});

test('tokenPrefixes reports the opening markers for the configured tag', () => {
    assert.deepEqual(tokenPrefixes('my-sticker'), ['[[sticker:', '<my-sticker>', '&lt;my-sticker&gt;']);
    assert.deepEqual(tokenPrefixes('div'), ['[[sticker:', '<sticker>', '&lt;sticker&gt;']);
});

test('normalizeLabel trims, collapses whitespace and lowercases', () => {
    assert.equal(normalizeLabel('  Happy   Face '), 'happy face');
    assert.equal(normalizeLabel(null), '');
});

test('normalizePackName trims and lowercases', () => {
    assert.equal(normalizePackName('  Daily  '), 'daily');
    assert.equal(normalizePackName(undefined), '');
});
