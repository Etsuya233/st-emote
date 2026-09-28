import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DESCRIPTION_MAX_CODEPOINTS,
    LABEL_MAX_CODEPOINTS,
    PACK_NAME_MAX_CODEPOINTS,
    findPackByName,
    findStickerByLabel,
    validateDescription,
    validateLabel,
    validatePackName,
    validateStickerTag,
} from '../core/constraints.js';

test('validateLabel accepts plain text, colons and emoji', () => {
    assert.deepEqual(validateLabel('happy'), { ok: true, value: 'happy' });
    assert.deepEqual(validateLabel('a:b'), { ok: true, value: 'a:b' });
    assert.deepEqual(validateLabel('😀 wow'), { ok: true, value: '😀 wow' });
});

test('validateLabel allows an empty label', () => {
    assert.deepEqual(validateLabel(''), { ok: true, value: '' });
});

test('validateLabel counts codepoints, not UTF-16 units', () => {
    const emoji = '😀'.repeat(LABEL_MAX_CODEPOINTS);
    assert.equal(validateLabel(emoji).ok, true);
    assert.deepEqual(validateLabel(`${emoji}😀`), { ok: false, reason: 'too-long' });
});

test('validateLabel rejects forbidden characters', () => {
    for (const char of ['[', ']', '<', '>']) {
        assert.deepEqual(validateLabel(`a${char}b`), { ok: false, reason: 'forbidden-character' });
    }
});

test('validateLabel rejects line breaks', () => {
    assert.deepEqual(validateLabel('a\nb'), { ok: false, reason: 'newline' });
});

test('validatePackName trims, requires a value and rejects colons', () => {
    assert.deepEqual(validatePackName('  daily  '), { ok: true, value: 'daily' });
    assert.deepEqual(validatePackName('   '), { ok: false, reason: 'empty' });
    assert.deepEqual(validatePackName('daily:extra'), { ok: false, reason: 'colon' });
});

test('validatePackName enforces the codepoint limit and forbidden characters', () => {
    assert.equal(validatePackName('x'.repeat(PACK_NAME_MAX_CODEPOINTS)).ok, true);
    assert.deepEqual(validatePackName('x'.repeat(PACK_NAME_MAX_CODEPOINTS + 1)), {
        ok: false,
        reason: 'too-long',
    });
    assert.deepEqual(validatePackName('a[b'), { ok: false, reason: 'forbidden-character' });
    assert.deepEqual(validatePackName('a<b'), { ok: false, reason: 'forbidden-character' });
});

test('validateDescription allows empty and rejects newlines and over-long text', () => {
    assert.deepEqual(validateDescription(''), { ok: true, value: '' });
    assert.deepEqual(validateDescription('a longer note'), { ok: true, value: 'a longer note' });
    assert.deepEqual(validateDescription('a\nb'), { ok: false, reason: 'newline' });
    assert.equal(validateDescription('x'.repeat(DESCRIPTION_MAX_CODEPOINTS)).ok, true);
    assert.deepEqual(validateDescription('x'.repeat(DESCRIPTION_MAX_CODEPOINTS + 1)), {
        ok: false,
        reason: 'too-long',
    });
});

test('validateDescription permits markup characters', () => {
    assert.deepEqual(validateDescription('a[b]<c>'), { ok: true, value: 'a[b]<c>' });
});

test('validateStickerTag accepts a custom name and rejects real HTML tags', () => {
    assert.deepEqual(validateStickerTag('sticker'), { ok: true, value: 'sticker' });
    assert.deepEqual(validateStickerTag('  my-sticker  '), { ok: true, value: 'my-sticker' });
    for (const name of ['p', 'div', 'span', 'br', 'img', 'code', 'pre', 'a', 'script']) {
        assert.deepEqual(validateStickerTag(name), { ok: false, reason: 'reserved' }, name);
    }
});

test('validateStickerTag rejects legacy and foreign element names', () => {
    for (const name of ['font', 'big', 'center', 'tt', 'marquee', 'strike', 'param', 'keygen', 'math', 'svg']) {
        assert.deepEqual(validateStickerTag(name), { ok: false, reason: 'reserved' }, name);
    }
});

test('validateStickerTag rejects empty and malformed names', () => {
    assert.deepEqual(validateStickerTag(''), { ok: false, reason: 'empty' });
    assert.deepEqual(validateStickerTag('1sticker'), { ok: false, reason: 'invalid' });
    assert.deepEqual(validateStickerTag('my sticker'), { ok: false, reason: 'invalid' });
});

test('findStickerByLabel compares normalized labels and can skip one sticker', () => {
    const first = { label: 'Happy' };
    const second = { label: 'sad' };
    const stickers = [first, second];
    assert.equal(findStickerByLabel(stickers, '  happy '), first);
    assert.equal(findStickerByLabel(stickers, 'HAPPY', { except: first }), null);
    assert.equal(findStickerByLabel(stickers, 'ghost'), null);
    assert.equal(findStickerByLabel(stickers, ''), null);
});

test('findPackByName is case-insensitive and can skip one pack', () => {
    const daily = { name: 'Daily' };
    const other = { name: 'Roleplay' };
    const packs = [daily, other];
    assert.equal(findPackByName(packs, 'daily'), daily);
    assert.equal(findPackByName(packs, 'DAILY', { except: daily }), null);
    assert.equal(findPackByName(packs, 'ghost'), null);
});
