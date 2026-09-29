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
    assert.deepEqual(tokenPrefixes({ tagName: 'my-sticker' }),
        ['[[sticker:', '<my-sticker>', '&lt;my-sticker&gt;']);
    assert.deepEqual(tokenPrefixes({ tagName: 'div' }),
        ['[[sticker:', '<sticker>', '&lt;sticker&gt;']);
});

test('tokenPrefixes drops the markers of a 标记 form that is switched off', () => {
    // The pre-filter and the scanner have to answer the same question, or the
    // DOM path walks text nodes the scanner would find nothing in.
    assert.deepEqual(tokenPrefixes({ bracketForm: false }),
        ['<sticker>', '&lt;sticker&gt;']);
    assert.deepEqual(tokenPrefixes({ tagForm: false }),
        ['[[sticker:']);
    assert.deepEqual(tokenPrefixes({ tagName: 'emo', bracketForm: false, tagForm: false }), []);
});

test('a 标记 form that is switched off is not a token at all', () => {
    // Not a miss: a miss is a marker that *did* match and resolved to nothing.
    // A disabled form is not grammar, so the text is left exactly as written and
    // nothing is reported — the same thing a sentence containing brackets does.
    const text = 'a [[sticker:daily:happy]] b <sticker>daily:sad</sticker>';
    assert.deepEqual(findTokens(text, { bracketForm: false }).map((token) => token.raw),
        ['<sticker>daily:sad</sticker>']);
    assert.deepEqual(findTokens(text, { tagForm: false }).map((token) => token.raw),
        ['[[sticker:daily:happy]]']);
    assert.deepEqual(findTokens(text, { bracketForm: false, tagForm: false }), []);
});

test('both 标记 forms on by default, so a caller with no settings gets both', () => {
    // The same "unset means the default" rule the hand-typed size fields follow:
    // an absent switch is not a switch someone turned off.
    assert.deepEqual(findTokens('[[sticker:a:b]] <sticker>a:b</sticker>').length, 2);
    assert.deepEqual(findTokens('[[sticker:a:b]] <sticker>a:b</sticker>',
        { bracketForm: true, tagForm: true }).length, 2);
});

test('normalizeLabel trims, collapses whitespace and lowercases', () => {
    assert.equal(normalizeLabel('  Happy   Face '), 'happy face');
    assert.equal(normalizeLabel(null), '');
});

test('normalizePackName trims and lowercases', () => {
    assert.equal(normalizePackName('  Daily  '), 'daily');
    assert.equal(normalizePackName(undefined), '');
});
