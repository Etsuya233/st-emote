/**
 * 冲突: the label collisions the 查冲突 command reports.
 *
 * The definition is `CONTEXT.md`'s, not this file's: a 冲突 is a **normalized**
 * label defined by two or more **enabled** packs in the 生效集. Three clauses
 * and each one is load-bearing, so each has a test:
 *
 * - normalized, or `Happy` and `happy ` in two packs would read as two labels
 *   and the ambiguity the definition exists to name would be invisible;
 * - two or more *packs*, or a pack's own stickers would report against itself;
 * - in the 生效集, or a pack the user has switched off would keep warning about
 *   tokens that do resolve today.
 *
 * The report is also part of this: 查冲突 has to name the packs, so the shape
 * carries them rather than only counting them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEffectiveSet } from '../core/effective-set.js';
import { findConflicts, formatConflicts } from '../core/conflict.js';

const packs = [
    {
        name: 'daily',
        stickers: [
            { label: 'happy', image: 'user/images/st-emote/happy.png' },
            { label: 'Sad  Face', image: 'user/images/st-emote/sad.png' },
            { label: 'wave', image: 'user/images/st-emote/wave.png' },
        ],
    },
    {
        name: 'roleplay',
        stickers: [
            { label: 'Happy', image: 'user/images/st-emote/happy2.png' },
            { label: 'shrug', image: 'user/images/st-emote/shrug.png' },
        ],
    },
    {
        name: 'unused',
        stickers: [
            { label: 'wave', image: 'user/images/st-emote/wave2.png' },
            { label: 'grin', image: 'user/images/st-emote/grin.png' },
        ],
    },
];

test('a label two enabled packs both define is a 冲突, naming both packs', () => {
    const set = buildEffectiveSet(packs, ['daily', 'roleplay']);
    const conflicts = findConflicts(set);

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].label, 'happy');
    assert.deepEqual(conflicts[0].packs, [
        { name: 'daily', label: 'happy' },
        { name: 'roleplay', label: 'Happy' },
    ]);
});

test('a label only one enabled pack defines is not a 冲突', () => {
    const set = buildEffectiveSet(packs, ['daily', 'roleplay']);
    const labels = findConflicts(set).map((conflict) => conflict.label);
    // `shrug` is one pack's alone, and `Sad  Face` has no second spelling
    // anywhere. Neither is worth reporting.
    assert.equal(labels.includes('shrug'), false);
    assert.equal(labels.includes('sad face'), false);
});

test('a label defined by three packs is one 冲突 that names all three', () => {
    // Three spellings that all normalize to `hi there`: case is folded away and
    // the run of inner spaces collapses to one.
    const many = [
        { name: 'a', stickers: [{ label: 'hi there' }] },
        { name: 'b', stickers: [{ label: 'Hi There' }] },
        { name: 'c', stickers: [{ label: 'HI  THERE' }] },
    ];
    const set = buildEffectiveSet(many, ['a', 'b', 'c']);
    const conflicts = findConflicts(set);

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].label, 'hi there');
    assert.deepEqual(conflicts[0].packs.map((pack) => pack.name), ['a', 'b', 'c']);
    // Each pack's own spelling comes back with it: the point of the report is
    // telling the user which spelling to change.
    assert.deepEqual(
        conflicts[0].packs.map((pack) => pack.label),
        ['hi there', 'Hi There', 'HI  THERE'],
    );
});

test('a label that only normalizes *near* the others is a different label', () => {
    // `h i` collapses its inner whitespace to a single space and stays `h i`;
    // it never becomes `hi`. Reporting these two together would be the worse
    // kind of wrong: it would name a collision that cannot happen, and a bare
    // `[[sticker:h i]]` resolves to exactly one sticker today.
    const near = [
        { name: 'a', stickers: [{ label: 'hi' }] },
        { name: 'b', stickers: [{ label: 'h i' }] },
    ];
    assert.deepEqual(findConflicts(buildEffectiveSet(near, ['a', 'b'])), []);
});

test('a label two packs define only when both are enabled', () => {
    // `unused` also defines `wave`. Enabling it is what makes that a 冲突.
    assert.deepEqual(findConflicts(buildEffectiveSet(packs, ['daily', 'roleplay']))
        .map((conflict) => conflict.label), ['happy']);
    assert.deepEqual(findConflicts(buildEffectiveSet(packs, ['daily', 'roleplay', 'unused']))
        .map((conflict) => conflict.label), ['happy', 'wave']);
    // And dropping `roleplay` takes the `happy` one away again.
    assert.deepEqual(findConflicts(buildEffectiveSet(packs, ['daily', 'unused']))
        .map((conflict) => conflict.label), ['wave']);
});

test('conflicts come out in the effective set\'s order, so the report is stable', () => {
    // Enabled as roleplay, daily, unused — the report follows the set, not the
    // catalogue and not the label text: `happy` is first *defined* by roleplay,
    // `wave` by daily, so that is the order the panel's own list is in too.
    const set = buildEffectiveSet(packs, ['roleplay', 'daily', 'unused']);
    assert.deepEqual(findConflicts(set).map((conflict) => conflict.label), ['happy', 'wave']);
    // And the same packs in another order report in that order, not this one.
    const reversed = buildEffectiveSet(packs, ['unused', 'daily', 'roleplay']);
    assert.deepEqual(
        findConflicts(reversed).map((conflict) => conflict.label),
        ['wave', 'happy'],
    );
});

test('one pack spelling a label two ways is not a 冲突', () => {
    // The definition counts packs, not stickers: a single pack can never make a
    // bare token ambiguous, so reporting it would point the user at a problem
    // that does not exist.
    const twice = [
        { name: 'a', stickers: [{ label: 'hi' }, { label: 'HI' }] },
        { name: 'b', stickers: [{ label: 'shrug' }] },
    ];
    assert.deepEqual(findConflicts(buildEffectiveSet(twice, ['a', 'b'])), []);
});

test('an effective set with no repeated label has no 冲突 at all', () => {
    const set = buildEffectiveSet(packs, ['roleplay']);
    assert.deepEqual(findConflicts(set), []);
    assert.deepEqual(findConflicts(buildEffectiveSet(packs, [])), []);
});

test('an unlabeled sticker never counts towards a 冲突', () => {
    // The 生效集 already drops these, so a second pack with an empty label must
    // not read as "two packs define the empty label".
    const blanks = [
        { name: 'a', stickers: [{ label: '' }, { label: ' ' }] },
        { name: 'b', stickers: [{ label: '' }] },
    ];
    assert.deepEqual(findConflicts(buildEffectiveSet(blanks, ['a', 'b'])), []);
});

test('the report names the packs behind each label, in the panel\'s language', () => {
    const set = buildEffectiveSet(packs, ['daily', 'roleplay', 'unused']);
    const report = formatConflicts(set, 'en');

    // A header with the count, so "two of them" is answerable without counting
    // rows, and one row per label naming the packs behind it.
    assert.match(report, /conflicts in the effective set \(2\)/);
    assert.match(report, /happy .*daily/);
    assert.match(report, /roleplay \("Happy"\)/);
    assert.match(report, /wave .*unused/);
    // The spelling that differs from the normalized label comes with the name,
    // because reporting only `happy` would not tell the user which one to change.
    assert.match(report, /wave — defined by daily, unused/);

    const chinese = formatConflicts(set, 'zh-cn');
    assert.match(chinese, /生效集里的标签冲突（2）/);
    assert.match(chinese, /daily/);
    assert.match(chinese, /roleplay \("Happy"\)/);
    assert.notEqual(chinese, report);
});

test('a clean 生效集 reports that there is nothing wrong, not an empty list', () => {
    assert.equal(
        formatConflicts(buildEffectiveSet(packs, ['daily']), 'en'),
        'No label is defined by more than one enabled pack.',
    );
    assert.match(
        formatConflicts(buildEffectiveSet(packs, ['daily']), 'zh-cn'),
        /没有哪个标签/,
    );
});
