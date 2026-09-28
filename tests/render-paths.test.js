/**
 * The two render paths, checked against one contract.
 *
 * The claim under test is the one ADR-0002 makes: whatever the client version,
 * the user ends up looking at the same DOM. So both paths are driven over the
 * same input, both results are turned into a final DOM, and both are asserted
 * with the *same* helper and the *same* expectations — no path gets its own
 * looser assertion, and nothing here asserts how a path did its work.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEffectiveSet } from '../core/effective-set.js';
import { PLACED_ATTRIBUTE, PLACEMENT_ATTRIBUTE } from '../core/placement.js';
import { STICKER_CLASS, renderHtml } from '../core/render.js';
import { parsePathResult } from './contract/render-contract.js';
import { assertRendersAs, sticker } from './contract/render-contract.js';

const packs = [
    {
        name: 'daily',
        stickers: [
            { label: 'happy', image: 'user/images/st-emote/happy.png' },
            { label: 'sad', image: 'user/images/st-emote/sad.png' },
            { label: 'big', image: 'user/images/st-emote/big.png', placement: 'after-block' },
            { label: 'missing', image: '' },
        ],
    },
    { name: 'roleplay', stickers: [{ label: 'happy', image: 'user/images/st-emote/other.png' }] },
];

const set = buildEffectiveSet(packs, ['daily']);
const ambiguousSet = buildEffectiveSet(packs, ['daily', 'roleplay']);

/** The hook path, as the client runs it: un-prefixed class, string out. */
function viaHook(html, options = {}, effective = set) {
    return parsePathResult(
        renderHtml(html, effective, { ...options, className: 'st-emote' }).html,
        { sanitizedByClient: true },
    );
}

/** The DOM path, as the client runs it: final class name written directly. */
function viaDom(html, options = {}, effective = set) {
    return parsePathResult(renderHtml(html, effective, options).html);
}

/**
 * Assert one expectation holds for both paths. This is the whole ticket in one
 * function: same input, same expected DOM, both paths.
 */
function assertBothPaths(html, expected, options = {}, effective = set) {
    assertRendersAs(assert, viaHook(html, options, effective), expected);
    assertRendersAs(assert, viaDom(html, options, effective), expected);
}

test('in-place renders identically on both paths', () => {
    assertBothPaths(
        '<p>She grins. [[sticker:daily:happy]]</p>',
        {
            stickers: [sticker({
                src: 'user/images/st-emote/happy.png',
                pack: 'daily',
                label: 'happy',
                token: '[[sticker:daily:happy]]',
            })],
            text: 'She grins. [[sticker:daily:happy]]',
        },
    );
});

test('the class list is identical on both paths, block modifier included', () => {
    for (const placement of ['in-place', 'after-block', 'message-end']) {
        assertBothPaths(
            '<p>a [[sticker:daily:happy]]</p>\n<p>b [[sticker:daily:sad]]</p>',
            {
                stickers: [
                    sticker({ src: 'user/images/st-emote/happy.png', pack: 'daily', label: 'happy', token: '[[sticker:daily:happy]]', placement, depth: placement === 'in-place' ? 1 : 0, placed: placement !== 'in-place' }),
                    sticker({ src: 'user/images/st-emote/sad.png', pack: 'daily', label: 'sad', token: '[[sticker:daily:sad]]', placement, depth: placement === 'in-place' ? 1 : 0, placed: placement !== 'in-place' }),
                ],
            },
            { placement },
        );
    }
});

test('the data-* identifiers are the same on both paths', () => {
    for (const run of [viaHook, viaDom]) {
        const image = run('<p>[[sticker:daily:happy]]</p>').querySelector(`img.${STICKER_CLASS}`);
        assert.equal(image.getAttribute('data-st-emote-pack'), 'daily');
        assert.equal(image.getAttribute('data-st-emote-label'), 'happy');
        assert.equal(image.getAttribute(PLACEMENT_ATTRIBUTE), 'in-place');
        assert.deepEqual(
            [...image.attributes].map((attribute) => attribute.name).filter((name) => name.startsWith('data-')).sort(),
            ['data-st-emote-label', 'data-st-emote-pack', 'data-st-emote-placement', 'data-st-emote-token'],
        );
    }
});

test('a block image carries the base class and the marker, so both paths agree', () => {
    for (const run of [viaHook, viaDom]) {
        const image = run('<p>[[sticker:daily:happy]]</p>', { placement: 'after-block' })
            .querySelector(`img.${STICKER_CLASS}`);
        assert.deepEqual([...image.classList], [STICKER_CLASS, `${STICKER_CLASS}-block`]);
        assert.equal(image.getAttribute(PLACED_ATTRIBUTE), '1');
    }
});

test('the size style is the same on both paths', () => {
    for (const options of [
        {},
        { placement: 'after-block' },
        { sizes: { inline: { maxHeight: '5em', fit: 'cover' }, block: { maxWidth: '60%' } }, placement: 'after-block' },
    ]) {
        assert.equal(
            viaHook('<p>[[sticker:daily:happy]]</p>', options).querySelector(`img.${STICKER_CLASS}`).getAttribute('style'),
            viaDom('<p>[[sticker:daily:happy]]</p>', options).querySelector(`img.${STICKER_CLASS}`).getAttribute('style'),
        );
    }
});

test('a per-sticker 投放方式 override lands identically on both paths', () => {
    assertBothPaths(
        '<p>a [[sticker:daily:happy]] b [[sticker:daily:big]] c</p>',
        {
            stickers: [
                sticker({ src: 'user/images/st-emote/happy.png', pack: 'daily', label: 'happy', token: '[[sticker:daily:happy]]' }),
                sticker({ src: 'user/images/st-emote/big.png', pack: 'daily', label: 'big', token: '[[sticker:daily:big]]', placement: 'after-block' }),
            ],
        },
    );
});

test('several block images after one block render identically, each its own block', () => {
    assertBothPaths(
        '<p>[[sticker:daily:happy]] [[sticker:daily:sad]]</p>',
        {
            stickers: [
                sticker({ src: 'user/images/st-emote/happy.png', pack: 'daily', label: 'happy', token: '[[sticker:daily:happy]]', placement: 'after-block' }),
                sticker({ src: 'user/images/st-emote/sad.png', pack: 'daily', label: 'sad', token: '[[sticker:daily:sad]]', placement: 'after-block' }),
            ],
        },
        { placement: 'after-block' },
    );
});

test('the HTML-tag form renders identically on both paths', () => {
    assertBothPaths(
        '<p><sticker>daily:happy</sticker></p>',
        {
            stickers: [sticker({
                src: 'user/images/st-emote/happy.png',
                pack: 'daily',
                label: 'happy',
                token: '<sticker>daily:happy</sticker>',
            })],
        },
    );
});

test('the escaped HTML-tag form renders identically on both paths', () => {
    assertBothPaths(
        '<p>&lt;sticker&gt;daily:happy&lt;/sticker&gt;</p>',
        {
            stickers: [sticker({
                src: 'user/images/st-emote/happy.png',
                pack: 'daily',
                label: 'happy',
                token: '<sticker>daily:happy</sticker>',
            })],
        },
    );
});

test('a token in a code block stays text on both paths', () => {
    assertBothPaths(
        '<p>see <code>[[sticker:daily:happy]]</code> here</p>',
        { stickers: [], text: 'see [[sticker:daily:happy]] here' },
    );
});

test('a bare label resolves on one path exactly as on the other', () => {
    assertBothPaths(
        '<p>[[sticker:happy]]</p>',
        {
            stickers: [sticker({
                src: 'user/images/st-emote/happy.png',
                pack: 'daily',
                label: 'happy',
                token: '[[sticker:happy]]',
            })],
        },
    );
});

test('every kind of miss disappears identically on both paths', () => {
    const cases = [
        { html: '<p>a [[sticker:daily:angry]] b</p>', set },
        { html: '<p>[[sticker:roleplay:happy]]</p>', set },
        { html: '<p>[[sticker:daily:missing]]</p>', set },
        { html: '<p>[[sticker:happy]]</p>', set: ambiguousSet },
        { html: '<p>[[sticker:nope:happy]]</p>', set },
        { html: '<p>[[sticker:daily:happy]]</p>', set: buildEffectiveSet(packs, []) },
    ];
    for (const { html, set: effective } of cases) {
        // The text the user is left reading: the token is gone, nothing else is.
        const text = html.replace(/<[^>]*>/g, '').replace(/\[\[[^\]]*\]\]/g, '');
        assertBothPaths(html, { stickers: [], text }, {}, effective);
    }
});

test('a repeated token renders one image per occurrence on both paths', () => {
    assertBothPaths(
        '<p>[[sticker:daily:happy]] and [[sticker:daily:happy]]</p>',
        {
            stickers: [
                sticker({ src: 'user/images/st-emote/happy.png', pack: 'daily', label: 'happy', token: '[[sticker:daily:happy]]' }),
                sticker({ src: 'user/images/st-emote/happy.png', pack: 'daily', label: 'happy', token: '[[sticker:daily:happy]]' }),
            ],
        },
    );
});

test('realistic showdown output renders identically on both paths', () => {
    const source = '<p>She grins.<br>[[sticker:daily:happy]]</p>\n'
        + '<blockquote><p>Quote &amp; [[sticker:daily:sad]]</p></blockquote>\n'
        + '<ul><li>Item [[sticker:daily:happy]]</li></ul>\n'
        + '<pre><code>[[sticker:daily:happy]]</code></pre>';
    const block = { placement: 'after-block' };
    assertBothPaths(source, {
        stickers: [
            sticker({ src: 'user/images/st-emote/happy.png', pack: 'daily', label: 'happy', token: '[[sticker:daily:happy]]', depth: 0, ...block }),
            // Inside the blockquote's own paragraph, which is its block.
            sticker({ src: 'user/images/st-emote/sad.png', pack: 'daily', label: 'sad', token: '[[sticker:daily:sad]]', depth: 1, ...block }),
            sticker({ src: 'user/images/st-emote/happy.png', pack: 'daily', label: 'happy', token: '[[sticker:daily:happy]]', depth: 1, ...block }),
        ],
    }, { placement: 'after-block' });
});

test('a message with no token is left alone by both paths', () => {
    assertBothPaths('<p>Nothing here.</p>', { stickers: [], text: 'Nothing here.' });
});
