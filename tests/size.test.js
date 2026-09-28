import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEffectiveSet } from '../core/effective-set.js';
import { renderHtml, renderText } from '../core/render.js';
import {
    SIZE_FIELDS,
    SIZE_SETS,
    defaultSizeValue,
    ensureSizeSet,
    ensureSizeSets,
    evaluateSize,
    readSizeSet,
    validateFitMode,
    validateSizeValue,
} from '../core/size.js';
import { stickerMarkup } from './contract/render-contract.js';

const packs = [
    {
        name: 'daily',
        stickers: [{ label: 'happy', image: 'user/images/st-emote/happy.png' }],
    },
];
const set = buildEffectiveSet(packs, ['daily']);

test('validateSizeValue accepts em, px and percent', () => {
    for (const value of ['3em', '120px', '100%', '1.5em', '0.5%', '0', ' 42px ']) {
        assert.deepEqual(validateSizeValue(value), { ok: true, value: value.trim() }, value);
    }
});

test('validateSizeValue treats empty as unset', () => {
    assert.deepEqual(validateSizeValue(''), { ok: true, value: '' });
    assert.deepEqual(validateSizeValue('   '), { ok: true, value: '' });
    assert.deepEqual(validateSizeValue(null), { ok: true, value: '' });
});

test('validateSizeValue rejects anything that is not a number with em, px or %', () => {
    for (const value of ['abc', '12', '3rem?', '3rem', '-2em', '3em 4em', '3 em', '10px;', 'calc(3em)']) {
        assert.deepEqual(validateSizeValue(value), { ok: false, reason: 'invalid' }, value);
    }
});

test('validateFitMode accepts the three fill modes and empty', () => {
    for (const mode of ['cover', 'contain', 'fill']) {
        assert.deepEqual(validateFitMode(mode), { ok: true, value: mode });
    }
    assert.deepEqual(validateFitMode('CONTAIN'), { ok: true, value: 'contain' });
    assert.deepEqual(validateFitMode(''), { ok: true, value: '' });
    assert.deepEqual(validateFitMode('stretch'), { ok: false, reason: 'invalid' });
});

test('ensureSizeSet fills in every field so the panel always has an input', () => {
    assert.deepEqual(ensureSizeSet({ maxHeight: '4em' }), {
        minWidth: '',
        minHeight: '',
        maxWidth: '',
        maxHeight: '4em',
        fit: '',
    });
    assert.deepEqual(ensureSizeSet(null), ensureSizeSet({}));
    assert.deepEqual(ensureSizeSets({ inline: { fit: 'cover' } }).block, ensureSizeSet({}));
});

test('readSizeSet keeps valid values, drops invalid ones and reports them', () => {
    const { set: read, invalid } = readSizeSet({ maxHeight: '4em', maxWidth: 'wide', fit: 'cover' });
    assert.equal(read.maxHeight, '4em');
    assert.equal(read.fit, 'cover');
    assert.equal(read.maxWidth, '');
    assert.deepEqual(invalid, [{ field: 'maxWidth', value: 'wide' }]);
});

test('an unset inline size falls back to max-height 3em', () => {
    assert.deepEqual(evaluateSize('inline', null), {
        sizeSet: 'inline',
        style: 'max-height: 3em; object-fit: contain',
        invalid: [],
    });
});

test('an unset block size falls back to max-width 100%', () => {
    assert.equal(evaluateSize('block', undefined).style, 'max-width: 100%; object-fit: contain');
});

test('a 1024px image does not break the layout with no configuration at all', () => {
    const { html } = renderHtml('<p>[[sticker:daily:happy]]</p>', set);
    assert.match(html, /style="max-height: 3em; object-fit: contain"/);
    const block = renderHtml('<p>[[sticker:daily:happy]]</p>', set, { placement: 'after-block' });
    assert.match(block.html, /style="max-width: 100%; object-fit: contain"/);
});

test('configured values are handed to CSS verbatim, per size set', () => {
    const sizes = {
        inline: { minWidth: '1em', minHeight: '1em', maxWidth: '100%', maxHeight: '3em', fit: 'cover' },
        block: { minWidth: '120px', minHeight: '80px', maxWidth: '640px', maxHeight: '50%', fit: 'fill' },
    };
    assert.equal(
        evaluateSize('inline', sizes).style,
        'min-width: 1em; min-height: 1em; max-width: 100%; max-height: 3em; object-fit: cover',
    );
    assert.equal(
        evaluateSize('block', sizes).style,
        'min-width: 120px; min-height: 80px; max-width: 640px; max-height: 50%; object-fit: fill',
    );
});

test('an invalid value is treated as unset and the field default applies', () => {
    const result = evaluateSize('inline', { inline: { maxHeight: '3rem?', maxWidth: '50%' } });
    assert.equal(result.style, 'max-width: 50%; max-height: 3em; object-fit: contain');
    assert.deepEqual(result.invalid, [{ field: 'maxHeight', value: '3rem?' }]);
});

test('an invalid fill mode is treated as unset', () => {
    const result = evaluateSize('inline', { inline: { fit: 'squish' } });
    assert.equal(result.style, 'max-height: 3em; object-fit: contain');
    assert.deepEqual(result.invalid, [{ field: 'fit', value: 'squish' }]);
});

test('an unknown size set falls back to inline', () => {
    assert.equal(evaluateSize('sideways', { block: { maxWidth: '50%' } }).sizeSet, 'inline');
});

test('SIZE_FIELDS is the panel order and drives the stored shape', () => {
    assert.deepEqual(SIZE_FIELDS, ['minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'fit']);
    assert.deepEqual(Object.keys(ensureSizeSet(null)), SIZE_FIELDS);
});

test('defaultSizeValue reports the field default the panel shows as a placeholder', () => {
    assert.equal(defaultSizeValue('inline', 'maxHeight'), '3em');
    assert.equal(defaultSizeValue('inline', 'maxWidth'), '');
    assert.equal(defaultSizeValue('block', 'maxWidth'), '100%');
    assert.equal(defaultSizeValue('block', 'maxHeight'), '');
    assert.equal(defaultSizeValue('sideways', 'maxHeight'), '3em');
});

test('the invalid sizes of a render are reported back to the caller', () => {
    const { invalidSizes } = renderHtml('<p>[[sticker:daily:happy]]</p>', set, {
        sizes: { inline: { maxHeight: '3rem?' } },
    });
    assert.deepEqual(invalidSizes, [{ field: 'maxHeight', value: '3rem?' }]);
});

test('renderText reports invalid sizes too', () => {
    const { invalidSizes } = renderText('[[sticker:daily:happy]]', set, {
        sizes: { inline: { maxWidth: 'huge' } },
    });
    assert.deepEqual(invalidSizes, [{ field: 'maxWidth', value: 'huge' }]);
});

test('the rendered image carries the evaluated size and the in-place class', () => {
    const { html } = renderText('a [[sticker:daily:happy]] b', set, {
        sizes: { inline: { maxHeight: '2.5em', fit: 'cover' } },
    });
    assert.equal(
        html,
        `a ${stickerMarkup({
            src: 'user/images/st-emote/happy.png',
            pack: 'daily',
            label: 'happy',
            style: 'max-height: 2.5em; object-fit: cover',
        })} b`,
    );
});

test('SIZE_SETS is the two 尺寸集 the panel shows, in order', () => {
    assert.deepEqual(SIZE_SETS, ['inline', 'block']);
    assert.deepEqual(Object.keys(ensureSizeSets(null)), SIZE_SETS);
});
