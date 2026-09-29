import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEffectiveSet } from '../core/effective-set.js';
import { renderHtml, renderText } from '../core/render.js';
import {
    SIZE_FIELDS,
    SIZE_MARGIN_FIELDS,
    SIZE_PANEL_FIELDS,
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
        marginX: '',
        marginY: '',
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

test('an unset inline size falls back to max-height 3em and a 0.15em gap', () => {
    assert.deepEqual(evaluateSize('inline', null), {
        sizeSet: 'inline',
        style: 'max-height: 3em; object-fit: contain; margin: 0 0.15em',
        invalid: [],
    });
});

test('an unset block size falls back to max-width 100% and a 0.25em vertical gap', () => {
    assert.equal(
        evaluateSize('block', undefined).style,
        'max-width: 100%; object-fit: contain; margin: 0.25em 0',
    );
});

test('a 1024px image does not break the layout with no configuration at all', () => {
    const { html } = renderHtml('<p>[[sticker:daily:happy]]</p>', set);
    assert.match(html, /style="max-height: 3em; object-fit: contain; margin: 0 0\.15em"/);
    const block = renderHtml('<p>[[sticker:daily:happy]]</p>', set, { placement: 'after-block' });
    assert.match(block.html, /style="max-width: 100%; object-fit: contain; margin: 0\.25em 0"/);
});

test('configured values are handed to CSS verbatim, per size set', () => {
    const sizes = {
        inline: {
            minWidth: '1em', minHeight: '1em', maxWidth: '100%', maxHeight: '3em',
            fit: 'cover', marginX: '0.1em', marginY: '0',
        },
        block: {
            minWidth: '120px', minHeight: '80px', maxWidth: '640px', maxHeight: '50%',
            fit: 'fill', marginX: '0', marginY: '8px',
        },
    };
    assert.equal(
        evaluateSize('inline', sizes).style,
        'min-width: 1em; min-height: 1em; max-width: 100%; max-height: 3em; object-fit: cover;'
        + ' margin: 0 0.1em',
    );
    assert.equal(
        evaluateSize('block', sizes).style,
        'min-width: 120px; min-height: 80px; max-width: 640px; max-height: 50%; object-fit: fill;'
        + ' margin: 8px 0',
    );
});

test('an invalid value is treated as unset and the field default applies', () => {
    const result = evaluateSize('inline', { inline: { maxHeight: '3rem?', maxWidth: '50%' } });
    assert.equal(result.style, 'max-width: 50%; max-height: 3em; object-fit: contain; margin: 0 0.15em');
    assert.deepEqual(result.invalid, [{ field: 'maxHeight', value: '3rem?' }]);
});

test('an invalid fill mode is treated as unset', () => {
    const result = evaluateSize('inline', { inline: { fit: 'squish' } });
    assert.equal(result.style, 'max-height: 3em; object-fit: contain; margin: 0 0.15em');
    assert.deepEqual(result.invalid, [{ field: 'fit', value: 'squish' }]);
});

test('an unknown size set falls back to inline', () => {
    assert.equal(evaluateSize('sideways', { block: { maxWidth: '50%' } }).sizeSet, 'inline');
});

test('SIZE_FIELDS is the one-to-one map, and the panel list adds the 间隙 fields', () => {
    assert.deepEqual(SIZE_FIELDS, ['minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'fit']);
    // The 间隙 fields are stored and bound to inputs like any other, but they
    // collapse into one declaration, so they are not in the one-to-one map.
    assert.deepEqual(SIZE_MARGIN_FIELDS, ['marginX', 'marginY']);
    assert.deepEqual(SIZE_PANEL_FIELDS, [...SIZE_FIELDS, ...SIZE_MARGIN_FIELDS]);
    // The stored shape is the panel list, so no field can exist without a control.
    assert.deepEqual(Object.keys(ensureSizeSet(null)), SIZE_PANEL_FIELDS);
});

test('defaultSizeValue reports the field default the panel shows as a placeholder', () => {
    assert.equal(defaultSizeValue('inline', 'maxHeight'), '3em');
    assert.equal(defaultSizeValue('inline', 'maxWidth'), '');
    assert.equal(defaultSizeValue('block', 'maxWidth'), '100%');
    assert.equal(defaultSizeValue('block', 'maxHeight'), '');
    assert.equal(defaultSizeValue('sideways', 'maxHeight'), '3em');
});

test('the two 间隙 fields have their own defaults, so neither placeholder lies', () => {
    // This is the bug the re-keying of `SIZE_DEFAULTS` by stored field name
    // exists to prevent: with both fields mapping to one CSS property, both
    // inputs would have shown the same default.
    assert.equal(defaultSizeValue('inline', 'marginX'), '0.15em');
    assert.equal(defaultSizeValue('inline', 'marginY'), '0');
    assert.equal(defaultSizeValue('block', 'marginX'), '0');
    assert.equal(defaultSizeValue('block', 'marginY'), '0.25em');
    // A field that has no default says so rather than borrowing a neighbour's.
    assert.equal(defaultSizeValue('inline', 'fit'), '');
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
            style: 'max-height: 2.5em; object-fit: cover; margin: 0 0.15em',
        })} b`,
    );
});

test('one 间隙 field on its own moves only its own axis', () => {
    // Each of the two fields is independent, so a user who only wants breathing
    // room between images in a sentence does not also change the vertical rhythm.
    const onlyX = evaluateSize('inline', { inline: { marginX: '0.4em' } });
    assert.equal(onlyX.style, 'max-height: 3em; object-fit: contain; margin: 0 0.4em');

    const onlyY = evaluateSize('block', { block: { marginY: '10px' } });
    assert.equal(onlyY.style, 'max-width: 100%; object-fit: contain; margin: 10px 0');
});

test('a 间隙 of zero is a value, not an absence', () => {
    // `0` is how a user says "flush against", so it has to be distinguishable
    // from leaving the field empty — and it is, because the bare number is the
    // one form the validator accepts without a unit.
    assert.deepEqual(validateSizeValue('0'), { ok: true, value: '0' });
    assert.equal(
        evaluateSize('inline', { inline: { marginX: '0' } }).style,
        'max-height: 3em; object-fit: contain; margin: 0 0',
    );
});

test('an invalid 间隙 is treated as unset, exactly like a size', () => {
    const result = evaluateSize('inline', { inline: { marginX: '2', marginY: '3rem' } });
    assert.equal(result.style, 'max-height: 3em; object-fit: contain; margin: 0 0.15em');
    assert.deepEqual(result.invalid, [
        { field: 'marginX', value: '2' },
        { field: 'marginY', value: '3rem' },
    ]);
});

test('the 间隙 travels with the image, not with the marker a miss leaves', () => {
    // A 未命中 leaves its marker behind as plain text, and text carries no
    // inline style — so the declaration appears exactly once, on the `<img>`.
    // This is the assertion that keeps the two tickets from drifting into each
    // other: a miss used to be deleted outright, and this test was written
    // against that. It now pins the newer behaviour instead.
    const { html, misses } = renderText(
        'a [[sticker:daily:nope]] b [[sticker:daily:happy]]',
        set,
        { sizes: { inline: { marginX: '0.5em' } } },
    );
    assert.equal(misses.length, 1);
    assert.equal(html.match(/margin:/g).length, 1);
    assert.match(html, /^a \[\[sticker:daily:nope\]\] b <img [^>]*style="max-height: 3em; object-fit: contain; margin: 0 0\.5em"/);
});

test('each 尺寸集 gaps in its own direction', () => {
    // The reason the defaults differ: 原地 images sit in a text line and need
    // horizontal space, while stacked blocks need vertical space between them.
    // Neither default is a fallback for the other, so both are pinned.
    assert.equal(
        evaluateSize('inline', { inline: { marginX: '', marginY: '' } }).style,
        'max-height: 3em; object-fit: contain; margin: 0 0.15em',
    );
    assert.equal(
        evaluateSize('block', { block: { marginX: '', marginY: '' } }).style,
        'max-width: 100%; object-fit: contain; margin: 0.25em 0',
    );
});

test('SIZE_SETS is the two 尺寸集 the panel shows, in order', () => {
    assert.deepEqual(SIZE_SETS, ['inline', 'block']);
    assert.deepEqual(Object.keys(ensureSizeSets(null)), SIZE_SETS);
});
