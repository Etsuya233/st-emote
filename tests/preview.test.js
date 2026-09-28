/**
 * 试渲染: the debug area, at the seam where it is actually testable.
 *
 * The debug box is a textarea and a `<div>`, so the only thing worth pinning
 * down is the pair around it: given pasted text and an effective set, what HTML
 * comes out, and what does the one summary line say. Both are pure, so both are
 * asserted here rather than by driving a panel and reading its innerHTML.
 *
 * What is deliberately **not** asserted here is that the chat is left alone —
 * that is a property of the adapter (the preview never calls the client's
 * re-render, never writes to `chat` and never saves settings) and there is no
 * live chat in this suite to leave alone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEffectiveSet } from '../core/effective-set.js';
import { CATALOGS } from '../core/i18n.js';
import { buildPreview, formatPreview } from '../core/preview.js';
import { STICKER_CLASS } from '../core/render.js';

const packs = [
    {
        name: 'daily',
        stickers: [
            { label: 'happy', image: 'user/images/st-emote/happy.png' },
            { label: 'sad', image: 'user/images/st-emote/sad.png', placement: 'message-end' },
            { label: 'nopic', image: '' },
        ],
    },
    { name: 'empty', stickers: [] },
];

test('a pasted message comes back as the same HTML the chat would show', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    const preview = buildPreview('She smiles. [[sticker:daily:happy]]', set);

    assert.equal(preview.tokenCount, 1);
    assert.deepEqual(preview.misses, []);
    assert.equal(preview.invalidSizes.length, 0);
    assert.match(preview.html, /She smiles\./);
    assert.match(preview.html, new RegExp(`<img class="${STICKER_CLASS}"`));
    assert.match(preview.html, /data-st-emote-label="happy"/);
});

test('the preview obeys the settings it is handed, placement included', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    // `happy` carries no per-sticker override, so the global 投放方式 decides —
    // which is exactly the case a pasted sample is there to check.
    const preview = buildPreview('Hmm. [[sticker:daily:happy]]', set, {
        placement: 'after-block',
    });

    // The rule is the core's, not the panel's: the preview resolves 投放方式 and
    // 尺寸 exactly as a message would, which is the whole point of being able to
    // tune them against a sample.
    assert.match(preview.html, /data-st-emote-placement="after-block"/);
    assert.match(preview.html, new RegExp(`class="${STICKER_CLASS} ${STICKER_CLASS}-block"`));
});

test('a per-sticker 投放方式 override wins over the global one, as in a chat', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    const preview = buildPreview('[[sticker:daily:sad]]', set, { placement: 'in-place' });

    assert.match(preview.html, /data-st-emote-placement="message-end"/);
});

test('a miss is reported and the marker disappears from the rendered HTML', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    const preview = buildPreview('[[sticker:daily:nope]]', set);

    assert.deepEqual(preview.misses.map((miss) => miss.reason), ['label-not-found']);
    assert.equal(preview.html, '');
});

test('a sticker with no image is a miss, and says so', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    const preview = buildPreview('[[sticker:daily:nopic]]', set);

    assert.deepEqual(preview.misses.map((miss) => miss.reason), ['image-missing']);
});

test('a bare label is ambiguous against two enabled packs, and says that', () => {
    const withSecond = [...packs, { name: 'roleplay', stickers: [{ label: 'shrug', image: 'x.png' }] }];
    const preview = buildPreview('[[sticker:happy]]', buildEffectiveSet(withSecond, ['daily', 'roleplay']));

    assert.deepEqual(preview.misses.map((miss) => miss.reason), ['ambiguous-bare-label']);
});

test('non-token text is escaped, so pasted markup cannot become an element', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    const preview = buildPreview('<b>bold</b> & [[sticker:daily:happy]]', set);

    assert.equal(preview.html.includes('<b>'), false);
    assert.match(preview.html, /&lt;b&gt;bold&lt;\/b&gt; &/);
});

test('text with no token in it says so instead of reporting a miss', () => {
    const preview = buildPreview('just a sentence', buildEffectiveSet(packs, ['daily']));

    assert.equal(preview.tokenCount, 0);
    assert.equal(preview.misses.length, 0);
    assert.equal(formatPreview(preview, 'en'), CATALOGS.en['panel.previewEmpty']);
});

test('a preview where everything rendered needs no summary line', () => {
    const preview = buildPreview('[[sticker:daily:happy]]', buildEffectiveSet(packs, ['daily']));
    assert.equal(formatPreview(preview, 'en'), '');
});

test('the summary names each distinct reason once, in the panel\'s language', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    const preview = buildPreview(
        '[[sticker:daily:nope]] and [[sticker:daily:nope]] and [[sticker:other:happy]]',
        set,
    );

    const english = formatPreview(preview, 'en');
    assert.match(english, /Not rendered/);
    assert.match(english, /no sticker of that label/);
    assert.match(english, /no pack of that name/);
    // Two tokens missed for the same reason, and the reason is said once.
    assert.equal(english.match(/no sticker of that label/g).length, 1);

    const chinese = formatPreview(preview, 'zh-cn');
    assert.match(chinese, /未命中/);
    assert.notEqual(chinese, english);
});

test('a miss reason the catalog has no sentence for falls back to its own name', () => {
    // The keys under `miss.reason.` are the `Miss['reason']` values, and the
    // parity test only holds the two locales against each other. A new reason
    // reaching the panel with no sentence must be visible, not silently blank.
    const preview = {
        tokenCount: 1,
        html: '',
        misses: [{ reason: 'a-reason-nobody-translated' }],
        invalidSizes: [],
    };
    assert.match(formatPreview(preview, 'en'), /a-reason-nobody-translated/);
});
