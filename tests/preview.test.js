/**
 * 试渲染: the debug area, at the seam where it is actually testable.
 *
 * The debug box is a textarea and a `<div>`, so the only thing worth pinning
 * down is the pair around it: given pasted text and an effective set, what comes
 * out, and what does the one summary line say. Both are pure, so both are
 * asserted here rather than by driving a panel and reading its innerHTML.
 *
 * **The assertions are about final structure, not attributes.** A preview built
 * on the wrong half of the core would still emit
 * `data-st-emote-placement="after-block"` on an image sitting in the middle of a
 * sentence — the attribute is easy, the *position* is what a user is looking at.
 * So these read where the image ended up, the same way the shared render contract
 * reads what the two paths produce.
 *
 * The converter the adapter supplies is exercised through the **identity** in the
 * placement tests: "if the paste is already a message body, the preview renders
 * it exactly as the chat would" is a claim about this module and needs no markdown
 * engine to state. That the adapter really does supply the client's converter is
 * a separate, adapter-side claim (`tests/panel.test.js`).
 *
 * What is deliberately **not** asserted here is that the chat is left alone —
 * that is a property of the adapter (the preview never calls the client's
 * re-render, never writes to `chat` and never saves settings) and there is no
 * live chat in this suite to leave alone.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEffectiveSet } from '../core/effective-set.js';
import { escapeText } from '../core/escape.js';
import { CATALOGS } from '../core/i18n.js';
import { buildPreview, formatPreview } from '../core/preview.js';
import { STICKER_CLASS } from '../core/render.js';
import { withLocale } from './contract/locale.js';

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

/** The paste is already the message body the client would have produced. */
const asBody = (body) => body;

/**
 * The image tags in a rendered preview, in document order.
 *
 * @param {string} html
 * @returns {string[]}
 */
function images(html) {
    return [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);
}

test('a pasted message comes back as the same HTML the chat would show', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    const preview = buildPreview('She smiles. [[sticker:daily:happy]]', set);

    assert.equal(preview.tokenCount, 1);
    assert.deepEqual(preview.misses, []);
    assert.equal(preview.invalidSizes.length, 0);
    assert.equal(preview.html, 'She smiles. '
        + '<img class="' + STICKER_CLASS + '" src="user/images/st-emote/happy.png" alt="happy"'
        + ' style="max-height: 3em; object-fit: contain" data-st-emote-pack="daily"'
        + ' data-st-emote-label="happy" data-st-emote-token="[[sticker:daily:happy]]"'
        + ' data-st-emote-placement="in-place">');
});

test('the preview takes the final class, because no sanitizer runs over it', () => {
    // The hook path writes the un-prefixed name and lets the client's sanitizer
    // add `custom-`. The preview is inserted into the panel as-is, so taking that
    // path's name would render a correctly-sized but entirely unstyled image.
    const preview = buildPreview('[[sticker:daily:happy]]', buildEffectiveSet(packs, ['daily']));
    assert.match(preview.html, new RegExp(`class="${STICKER_CLASS}"`));
    assert.doesNotMatch(preview.html, /class="st-emote"/);
});

test('消息末尾 puts the image at the end, not where the token was', () => {
    // The sticker carries its own 投放方式 override, so the preview has to honour
    // it — and has to *move* the image, not just record the intent. This is the
    // first thing `renderText` could not do.
    const preview = buildPreview('a [[sticker:daily:sad]] b', buildEffectiveSet(packs, ['daily']));

    assert.equal(images(preview.html).length, 1);
    // Everything the user typed survives, and the image follows all of it — the
    // assertion that used to fail is what a token rewriter would produce: the
    // image sitting between "a" and "b", where the model wrote it.
    assert.equal(preview.html.slice(0, preview.html.indexOf('<img')), 'a  b');
    assert.match(preview.html, /data-st-emote-placement="message-end" data-st-emote-placed="1">$/);
});

test('the converter the adapter supplies is what the renderer is given', () => {
    // The seam: whatever turns the paste into a message body, that is what goes
    // through `renderHtml`. A test that only passed plain text would not notice
    // the preview going back to being a token rewriter with a different signature.
    const set = buildEffectiveSet(packs, ['daily']);
    const preview = buildPreview('ignored', set, {}, (text) => `<p>${text}</p>`);
    assert.equal(preview.html, '<p>ignored</p>');

    // Which means a body with block structure in it relocates into that structure.
    const relocated = buildPreview(
        'a [[sticker:daily:happy]]',
        set,
        { placement: 'after-block' },
        (text) => `<p>${text}</p><p>b</p>`,
    );
    assert.match(
        relocated.html,
        /^<p>a <\/p><img class="custom-st-emote custom-st-emote-block"[^>]*data-st-emote-placed="1"><p>b<\/p>$/,
    );
});

test('块后 moves the image past the block it was written in', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    const preview = buildPreview(
        '<p>a [[sticker:daily:happy]]</p>\n<p>b</p>',
        set,
        { placement: 'after-block' },
        asBody,
    );

    // Just past the paragraph it was written in, and before the next one — which
    // is what the chat shows, and the thing a preview that stopped after the
    // token rewrite would get wrong.
    assert.match(
        preview.html,
        /^<p>a <\/p><img class="custom-st-emote custom-st-emote-block"[^>]*data-st-emote-placed="1">\n<p>b<\/p>$/,
    );
});

test('a token inside a code block is left alone, as in a chat', () => {
    const set = buildEffectiveSet(packs, ['daily']);

    // A fenced block, which is what a paste becomes once the client's converter
    // has run over it.
    const fenced = buildPreview(
        '<pre><code>[[sticker:daily:happy]]</code></pre>',
        set,
        {},
        asBody,
    );
    assert.equal(images(fenced.html).length, 0);
    assert.match(fenced.html, /\[\[sticker:daily:happy\]\]/);

    // And the same token outside one still renders, so the skip is scoped.
    const mixed = buildPreview(
        '<pre>[[sticker:daily:happy]]</pre> [[sticker:daily:happy]]',
        set,
        {},
        asBody,
    );
    assert.equal(images(mixed.html).length, 1);
});

test('with no converter the paste is plain text, and says so only in the doc', () => {
    // The default is `escapeText`, and this pins what that costs: the token still
    // renders and the paste still cannot inject markup, but a paste is not
    // markdown, so block structure and fences are not reproduced. The panel's
    // hint tells the user which of the two they are looking at.
    const set = buildEffectiveSet(packs, ['daily']);
    const preview = buildPreview('**bold** [[sticker:daily:happy]]', set);

    assert.equal(images(preview.html).length, 1);
    assert.equal(preview.html.includes('<strong>'), false);
    assert.equal(preview.html.startsWith(escapeText('**bold** ')), true);
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

test('the raw HTML-tag form still matches after the paste is escaped', () => {
    // The default bridge to the HTML renderer is `escapeText`, which turns
    // `<sticker>…</sticker>` into its entity form. That is the *second* form
    // `findTokens` looks for, so the token still resolves.
    const set = buildEffectiveSet(packs, ['daily']);
    const preview = buildPreview('<sticker>daily:happy</sticker>', set);

    assert.equal(preview.tokenCount, 1);
    assert.equal(images(preview.html).length, 1);
    assert.match(preview.html, /data-st-emote-label="happy"/);
});

test('pasted markup is escaped, so it can never become an element', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    const preview = buildPreview('<b>bold</b> & [[sticker:daily:happy]]', set);

    assert.equal(preview.html.includes('<b>'), false);
    assert.match(preview.html, /&lt;b&gt;bold&lt;\/b&gt; &/);
});

test('text with no token in it says so instead of reporting a miss', () => {
    const preview = buildPreview('just a sentence', buildEffectiveSet(packs, ['daily']));

    assert.equal(preview.tokenCount, 0);
    assert.equal(preview.misses.length, 0);
    assert.equal(withLocale('en', () => formatPreview(preview)), CATALOGS.en['panel.previewEmpty']);
});

test('a preview where everything rendered needs no summary line', () => {
    const preview = buildPreview('[[sticker:daily:happy]]', buildEffectiveSet(packs, ['daily']));
    assert.equal(withLocale('en', () => formatPreview(preview)), '');
});

test('the summary names each distinct reason once, in the panel\'s language', () => {
    const set = buildEffectiveSet(packs, ['daily']);
    const preview = buildPreview(
        '[[sticker:daily:nope]] and [[sticker:daily:nope]] and [[sticker:other:happy]]',
        set,
    );

    const english = withLocale('en', () => formatPreview(preview));
    assert.match(english, /Not rendered/);
    assert.match(english, /no sticker of that label/);
    assert.match(english, /no pack of that name/);
    // Two tokens missed for the same reason, and the reason is said once.
    assert.equal(english.match(/no sticker of that label/g).length, 1);

    const chinese = withLocale('zh-cn', () => formatPreview(preview));
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
    assert.match(withLocale('en', () => formatPreview(preview)), /a-reason-nobody-translated/);
});
