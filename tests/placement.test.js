import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_PLACEMENT,
    PLACED_ATTRIBUTE,
    PLACEMENTS,
    blockBoundaryMode,
    isBlockPlacement,
    nearestBlockAncestor,
    resolvePlacement,
    sizeSetForPlacement,
    validatePlacement,
} from '../core/placement.js';
import { buildEffectiveSet } from '../core/effective-set.js';
import {
    STICKER_BLOCK_CLASS,
    STICKER_CLASS,
    relocatePlacedImages,
    renderHtml,
} from '../core/render.js';

const packs = [
    {
        name: 'daily',
        stickers: [
            { label: 'happy', image: 'user/images/st-emote/happy.png' },
            { label: 'sad', image: 'user/images/st-emote/sad.png' },
            { label: 'big', image: 'user/images/st-emote/big.png', placement: 'after-block' },
        ],
    },
];

const set = buildEffectiveSet(packs, ['daily']);

/**
 * The `<img …>` a placed sticker is expected to produce, including the marker
 * that says relocation already happened.
 */
function blockImage(file, label, placement) {
    return `<img class="${STICKER_BLOCK_CLASS}" src="user/images/st-emote/${file}"`
        + ` alt="${label}" style="max-width: 100%; object-fit: contain"`
        + ` data-st-emote-pack="daily" data-st-emote-label="${label}"`
        + ` data-st-emote-placement="${placement}" ${PLACED_ATTRIBUTE}="1">`;
}

test('validatePlacement accepts the three placements and empty, rejects the rest', () => {
    for (const placement of PLACEMENTS) {
        assert.deepEqual(validatePlacement(placement), { ok: true, value: placement });
    }
    assert.deepEqual(validatePlacement(''), { ok: true, value: '' });
    assert.deepEqual(validatePlacement('  after-block  '), { ok: true, value: 'after-block' });
    assert.deepEqual(validatePlacement('end'), { ok: false, reason: 'invalid' });
    assert.deepEqual(validatePlacement(null), { ok: true, value: '' });
});

test('resolvePlacement falls back from the sticker to the global default', () => {
    assert.equal(resolvePlacement('after-block', 'in-place'), 'after-block');
    assert.equal(resolvePlacement('', 'message-end'), 'message-end');
    assert.equal(resolvePlacement(null, null), DEFAULT_PLACEMENT);
    assert.equal(resolvePlacement('nonsense', 'message-end'), 'message-end');
});

test('sizeSetForPlacement switches the size set with the placement', () => {
    assert.equal(sizeSetForPlacement('in-place'), 'inline');
    assert.equal(sizeSetForPlacement('after-block'), 'block');
    assert.equal(sizeSetForPlacement('message-end'), 'block');
});

test('isBlockPlacement agrees with the size set about what counts as a block', () => {
    assert.equal(isBlockPlacement('in-place'), false);
    assert.equal(isBlockPlacement('after-block'), true);
    assert.equal(isBlockPlacement('message-end'), true);
    assert.equal(isBlockPlacement(''), false);
});

test('nearestBlockAncestor picks the closest block, and not a line break', () => {
    assert.equal(nearestBlockAncestor(['p', 'blockquote']), 'p');
    assert.equal(nearestBlockAncestor(['br', 'p']), 'p');
    assert.equal(nearestBlockAncestor(['span', 'em']), null);
    assert.equal(nearestBlockAncestor(['TD']), 'td');
    assert.equal(nearestBlockAncestor([]), null);
});

test('blockBoundaryMode keeps a table cell intact and ends a message without a block', () => {
    assert.equal(blockBoundaryMode('p'), 'after');
    assert.equal(blockBoundaryMode('li'), 'after');
    assert.equal(blockBoundaryMode('td'), 'inside');
    assert.equal(blockBoundaryMode('th'), 'inside');
    assert.equal(blockBoundaryMode(null), 'message-end');
});

test('in-place is the default and keeps the image inside the text', () => {
    const { html } = renderHtml('<p>hi [[sticker:daily:happy]]</p>', set);
    assert.equal(html.startsWith('<p>hi <img '), true);
    assert.equal(html.endsWith('</p>'), true);
    assert.match(html, new RegExp(`class="${STICKER_CLASS}"`));
    assert.doesNotMatch(html, new RegExp(STICKER_BLOCK_CLASS));
    assert.match(html, /data-st-emote-placement="in-place"/);
});

test('after-block lands between the paragraph and the next one', () => {
    const { html } = renderHtml(
        '<p>first [[sticker:daily:happy]]</p>\n<p>second</p>',
        set,
        { placement: 'after-block' },
    );
    assert.equal(
        html,
        `<p>first </p>${blockImage('happy.png', 'happy', 'after-block')}\n<p>second</p>`,
    );
});

test('after-block uses the closest block container, not the outermost one', () => {
    const { html } = renderHtml(
        '<blockquote><p>quoted [[sticker:daily:happy]]</p></blockquote>',
        set,
        { placement: 'after-block' },
    );
    assert.equal(
        html,
        `<blockquote><p>quoted </p>${blockImage('happy.png', 'happy', 'after-block')}</blockquote>`,
    );
});

test('after-block inside a list item lands after the item', () => {
    const { html } = renderHtml(
        '<ul><li>one [[sticker:daily:happy]]</li><li>two</li></ul>',
        set,
        { placement: 'after-block' },
    );
    assert.match(html, /<li>one <\/li><img [^>]*><li>two<\/li>/);
});

test('after-block inside a heading lands after the heading', () => {
    const { html } = renderHtml('<h2>title [[sticker:daily:happy]]</h2><p>body</p>', set, {
        placement: 'after-block',
    });
    assert.match(html, /^<h2>title <\/h2><img [^>]*><p>body<\/p>$/);
});

test('a line break is not a block, so after-block still uses the paragraph', () => {
    const { html } = renderHtml('<p>one<br>two [[sticker:daily:happy]]</p>', set, {
        placement: 'after-block',
    });
    assert.match(html, /^<p>one<br>two <\/p><img /);
});

test('after-block inside a table cell stays inside the cell', () => {
    const { html } = renderHtml(
        '<table><tbody><tr><td>cell [[sticker:daily:happy]]</td></tr></tbody></table>',
        set,
        { placement: 'after-block' },
    );
    assert.match(html, /<td>cell <img [^>]*><\/td>/);
});

test('after-block in bare text with no block ends the message', () => {
    const { html } = renderHtml('bare [[sticker:daily:happy]]', set, { placement: 'after-block' });
    assert.equal(html, `bare ${blockImage('happy.png', 'happy', 'after-block')}`);
});

test('message-end moves every image to the end of the message, in order', () => {
    const { html } = renderHtml(
        '<p>[[sticker:daily:happy]] one</p>\n<p>two [[sticker:daily:sad]]</p>',
        set,
        { placement: 'message-end' },
    );
    assert.equal(
        html,
        '<p> one</p>\n<p>two </p>'
        + blockImage('happy.png', 'happy', 'message-end')
        + blockImage('sad.png', 'sad', 'message-end'),
    );
});

test('a placed image is marked, so a second pass leaves it alone', () => {
    const once = renderHtml('<p>a [[sticker:daily:happy]]</p><p>b</p>', set, {
        placement: 'after-block',
    }).html;
    assert.equal(relocatePlacedImages(once), once);
});

test('several block images after one paragraph each become their own block', () => {
    const { html } = renderHtml('<p>[[sticker:daily:happy]] [[sticker:daily:sad]]</p>', set, {
        placement: 'after-block',
    });
    const images = html.match(/<img\b[^>]*>/g);
    assert.equal(images.length, 2);
    for (const image of images) {
        assert.match(image, new RegExp(`class="${STICKER_BLOCK_CLASS}"`));
    }
    assert.match(html, /^<p> <\/p><img [^>]*><img [^>]*>$/);
});

test('a sticker overrides the global placement and switches size set with it', () => {
    const { html } = renderHtml(
        '<p>a [[sticker:daily:happy]] b [[sticker:daily:big]] c</p>',
        set,
        { placement: 'in-place', sizes: { block: { maxWidth: '50%' } } },
    );
    assert.match(html, new RegExp(`class="${STICKER_CLASS}"[^>]*style="max-height: 3em; object-fit: contain"`));
    assert.match(html, new RegExp(`class="${STICKER_BLOCK_CLASS}"[^>]*style="max-width: 50%; object-fit: contain"`));
    // The overriding sticker left the paragraph; the in-place one stayed in it.
    assert.match(html, /^<p>a <img [^>]*> b {2}c<\/p><img /);
});

test('an unclosed block still gives after-block a boundary at the end of the message', () => {
    const { html } = renderHtml('<p>text [[sticker:daily:happy]]', set, { placement: 'after-block' });
    assert.match(html, /^<p>text <img /);
});
