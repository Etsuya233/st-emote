import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEffectiveSet } from '../core/effective-set.js';
import { PLACED_ATTRIBUTE, PLACEMENT_ATTRIBUTE } from '../core/placement.js';
import { STICKER_CLASS, renderHtml, renderText } from '../core/render.js';
import { messageText, parseHtml, stickerMarkup } from './contract/render-contract.js';

const packs = [
    {
        name: 'daily',
        stickers: [
            { label: 'happy', image: 'user/images/st-emote/happy.png' },
            { label: 'no image', image: '' },
        ],
    },
    {
        name: 'roleplay',
        stickers: [{ label: 'happy', image: 'user/images/st-emote/other.png' }],
    },
];

function setWith(enabledPackNames) {
    return buildEffectiveSet(packs, enabledPackNames);
}

test('renderHtml replaces a qualified token with an image', () => {
    const { html, misses } = renderHtml('<p>hi [[sticker:daily:happy]]</p>', setWith(['daily']));
    assert.equal(misses.length, 0);
    assert.match(html, new RegExp(`<img class="${STICKER_CLASS}"`));
    assert.match(html, /src="user\/images\/st-emote\/happy\.png"/);
    assert.match(html, /data-st-emote-pack="daily"/);
    assert.match(html, /data-st-emote-label="happy"/);
    // The token is no longer on screen; the image carries it as an attribute.
    assert.doesNotMatch(messageText(html), /\[\[sticker:/);
});

test('renderHtml resolves a bare label when one pack is enabled', () => {
    const { html } = renderHtml('<p>[[sticker:happy]]</p>', setWith(['daily']));
    assert.match(html, /src="user\/images\/st-emote\/happy\.png"/);
});

test('renderHtml leaves surrounding text intact', () => {
    const { html } = renderHtml('before [[sticker:daily:happy]] after', setWith(['daily']));
    assert.equal(html.startsWith('before <img'), true);
    assert.equal(html.endsWith(' after'), true);
});

test('renderHtml inserts the image once per occurrence', () => {
    const { html } = renderHtml('[[sticker:daily:happy]] and [[sticker:daily:happy]]', setWith(['daily']));
    assert.equal(html.match(/<img /g).length, 2);
});

test('renderHtml inserts one image per repeated HTML-tag token', () => {
    const source = '<sticker>daily:happy</sticker><sticker>daily:happy</sticker>';
    const { html } = renderHtml(source, setWith(['daily']));
    assert.equal(html.match(/<img /g).length, 2);
});

test('an unknown label keeps its marker and is reported', () => {
    const { html, misses } = renderHtml('<p>a [[sticker:daily:angry]] b</p>', setWith(['daily']));
    assert.equal(html, '<p>a [[sticker:daily:angry]] b</p>');
    assert.deepEqual(misses, [
        { reason: 'label-not-found', raw: '[[sticker:daily:angry]]', packName: 'daily', label: 'angry' },
    ]);
});

test('a token for a disabled pack keeps its marker and is reported', () => {
    const { html, misses } = renderHtml('[[sticker:roleplay:happy]]', setWith(['daily']));
    assert.equal(html, '[[sticker:roleplay:happy]]');
    assert.equal(misses[0].reason, 'pack-not-enabled');
});

test('a bare label keeps its marker when several packs are enabled', () => {
    const { html, misses } = renderHtml('[[sticker:happy]]', setWith(['daily', 'roleplay']));
    assert.equal(html, '[[sticker:happy]]');
    assert.equal(misses[0].reason, 'ambiguous-bare-label');
});

test('a sticker without an image keeps its marker and is reported', () => {
    const { html, misses } = renderHtml('[[sticker:daily:no image]]', setWith(['daily']));
    assert.equal(html, '[[sticker:daily:no image]]');
    assert.equal(misses[0].reason, 'image-missing');
});

test('tokens inside a code element are untouched', () => {
    const source = '<p>see <code>[[sticker:daily:happy]]</code> here</p>';
    const { html, misses } = renderHtml(source, setWith(['daily']));
    assert.equal(html, source);
    assert.equal(misses.length, 0);
});

test('a missed token inside a code element still renders nothing', () => {
    // The code-block skip is decided by the tag walk, not by whether a token
    // would have hit, so a miss in there is still plain untouched text: no
    // image, and — the point of it — no 未命中 either.
    const source = '<p>see <code>[[sticker:daily:angry]]</code> here</p>';
    const { html, misses } = renderHtml(source, setWith(['daily']));
    assert.equal(html, source);
    assert.equal(misses.length, 0);
    assert.equal(messageText(html), 'see [[sticker:daily:angry]] here');
});

test('tokens inside a pre block are untouched', () => {
    const source = '<pre><code>[[sticker:daily:happy]]</code></pre>';
    const { html } = renderHtml(source, setWith(['daily']));
    assert.equal(html, source);
});

test('tokens after a code block are still rendered', () => {
    const source = '<code>[[sticker:daily:happy]]</code> [[sticker:daily:happy]]';
    const { html } = renderHtml(source, setWith(['daily']));
    assert.equal(
        html,
        `<code>[[sticker:daily:happy]]</code> ${stickerMarkup({
            src: 'user/images/st-emote/happy.png',
            pack: 'daily',
            label: 'happy',
        })}`,
    );
});

test('attribute values are escaped', () => {
    const es = buildEffectiveSet(
        [
            {
                name: 'we&ird',
                stickers: [{ label: 'a"b&c', image: 'user/images/st-emote/a&b.png' }],
            },
        ],
        ['we&ird'],
    );
    const { html } = renderHtml('[[sticker:we&ird:a"b&c]]', es);
    assert.match(html, /src="user\/images\/st-emote\/a&amp;b\.png"/);
    assert.match(html, /alt="a&quot;b&amp;c"/);
    assert.match(html, /data-st-emote-pack="we&amp;ird"/);
});

test('renderHtml keeps already-encoded entities as written', () => {
    const { html } = renderHtml('<p>a &amp; b [[sticker:daily:happy]]</p>', setWith(['daily']));
    assert.equal(html.startsWith('<p>a &amp; b <img'), true);
});

test('renderText escapes plain text that is not a token', () => {
    const { html, misses } = renderText('1 < 2 & "three"', setWith(['daily']));
    assert.equal(html, '1 &lt; 2 &amp; "three"');
    assert.equal(misses.length, 0);
});

test('renderText replaces a token and escapes the rest', () => {
    const { html } = renderText('a & b [[sticker:happy]] c', setWith(['daily']));
    assert.equal(html.startsWith('a &amp; b <img'), true);
    assert.equal(html.endsWith(' c'), true);
});

test('renderText keeps a missed token, escaped like the text around it', () => {
    const { html, misses } = renderText('x [[sticker:nope]] y', setWith(['daily']));
    assert.equal(html, 'x [[sticker:nope]] y');
    assert.equal(misses.length, 1);
});

test('renderHtml replaces the raw HTML-tag form', () => {
    const { html, misses } = renderHtml('<p><sticker>daily:happy</sticker></p>', setWith(['daily']));
    assert.equal(misses.length, 0);
    assert.match(html, new RegExp(`<img class="${STICKER_CLASS}"`));
    assert.doesNotMatch(messageText(html), /<sticker>/);
});

test('renderHtml replaces the escaped HTML-tag form', () => {
    const source = '<p>&lt;sticker&gt;daily:happy&lt;/sticker&gt;</p>';
    const { html, misses } = renderHtml(source, setWith(['daily']));
    assert.equal(misses.length, 0);
    assert.match(html, new RegExp(`<img class="${STICKER_CLASS}"`));
    assert.doesNotMatch(messageText(html), /sticker/);
});

test('renderHtml honours a custom HTML-tag name', () => {
    const options = { tagName: 'my-sticker' };
    const { html } = renderHtml('<my-sticker>daily:happy</my-sticker>', setWith(['daily']), options);
    assert.match(html, /<img /);
    assert.equal(renderHtml('<sticker>daily:happy</sticker>', setWith(['daily']), options).html, '<sticker>daily:happy</sticker>');
});

test('renderHtml leaves a non-configured tag alone', () => {
    const source = '<p>a <figure>daily:happy</figure> b</p>';
    const { html, misses } = renderHtml(source, setWith(['daily']));
    assert.equal(html, source);
    assert.equal(misses.length, 0);
});

test('renderHtml leaves HTML-tag tokens inside code untouched', () => {
    const source = '<p><code><sticker>daily:happy</sticker></code></p>';
    const { html, misses } = renderHtml(source, setWith(['daily']));
    assert.equal(html, source);
    assert.equal(misses.length, 0);
});

test('renderHtml leaves code-spanning raw tags and still renders after', () => {
    const source = '<code>&lt;sticker&gt;daily:happy&lt;/sticker&gt;</code> <sticker>daily:happy</sticker>';
    const { html } = renderHtml(source, setWith(['daily']));
    assert.match(html, /^<code>&lt;sticker&gt;daily:happy&lt;\/sticker&gt;<\/code> <img /);
});

test('renderText replaces the HTML-tag form and escapes the rest', () => {
    const { html, misses } = renderText('a & b <sticker>happy</sticker> c', setWith(['daily']));
    assert.equal(misses.length, 0);
    assert.equal(html.startsWith('a &amp; b <img'), true);
    assert.equal(html.endsWith(' c'), true);
});

test('renderText honours a custom HTML-tag name', () => {
    const { html } = renderText('<x-sticker>happy</x-sticker>', setWith(['daily']), { tagName: 'x-sticker' });
    assert.match(html, /^<img /);
});

test('renderText escapes a missed HTML-tag token back to the form the user wrote', () => {
    const { html, misses } = renderText('x <sticker>angry</sticker> y', setWith(['daily']));
    assert.equal(html, 'x &lt;sticker&gt;angry&lt;/sticker&gt; y');
    assert.equal(misses[0].reason, 'label-not-found');
    // A miss is ordinary text, so it reads back as the text it stands for.
    assert.equal(messageText(html), 'x <sticker>angry</sticker> y');
});

test('a missed HTML-tag token is a text node on the HTML path, not a live element', () => {
    // The hook path emits the un-escaped form into markup the client has
    // explicitly allowed through DOMPurify, so an unescaped miss would survive
    // sanitization as a real element: the brackets would vanish and the miss
    // would be half invisible. The final DOM is where that shows.
    const { html } = renderHtml('<p>a <sticker>daily:angry</sticker> b</p>', setWith(['daily']));
    const root = parseHtml(html);
    const paragraph = root.querySelector('.mes_text p');

    assert.equal(root.querySelector('sticker'), null);
    assert.equal(paragraph.childElementCount, 0);
    assert.equal(paragraph.textContent, 'a <sticker>daily:angry</sticker> b');
    assert.equal(messageText(html), 'a <sticker>daily:angry</sticker> b');
});

test('a missed escaped HTML-tag token round-trips instead of double-escaping', () => {
    const source = '<p>&lt;sticker&gt;daily:angry&lt;/sticker&gt;</p>';
    const { html, misses } = renderHtml(source, setWith(['daily']));
    assert.equal(html, source);
    assert.equal(misses[0].reason, 'label-not-found');
});

test('renders tokens in realistic showdown output', () => {
    const source = '<p>She grins.<br>[[sticker:daily:happy]]</p>\n'
        + '<blockquote><p>Quote &amp; [[sticker:daily:happy]]</p></blockquote>\n'
        + '<ul><li>Item [[sticker:daily:happy]]</li></ul>\n'
        + '<pre><code>[[sticker:daily:happy]]</code></pre>';
    const { html, misses } = renderHtml(source, setWith(['daily']));
    assert.equal(misses.length, 0);
    assert.equal(html.match(/<img /g).length, 3);
    assert.match(html, /<pre><code>\[\[sticker:daily:happy\]\]<\/code><\/pre>/);
});

test('after-block moves every image out of its own block in realistic showdown output', () => {
    const source = '<p>She grins.<br>[[sticker:daily:happy]]</p>\n'
        + '<blockquote><p>Quote &amp; [[sticker:daily:happy]]</p></blockquote>\n'
        + '<ul><li>Item [[sticker:daily:happy]]</li></ul>\n'
        + '<pre><code>[[sticker:daily:happy]]</code></pre>';
    const { html, misses } = renderHtml(source, setWith(['daily']), { placement: 'after-block' });
    assert.equal(misses.length, 0);
    // One per rendered token; the one inside the code block is still text.
    assert.equal(html.match(/<img /g).length, 3);
    assert.match(html, /^<p>She grins\.<br><\/p><img [^>]*>\n/);
    assert.match(html, /<blockquote><p>Quote &amp; <\/p><img [^>]*><\/blockquote>/);
    assert.match(html, /<ul><li>Item <\/li><img [^>]*><\/ul>/);
    assert.match(html, /<pre><code>\[\[sticker:daily:happy\]\]<\/code><\/pre>$/);
});

test('an in-place sticker next to an after-block one lands in the same message', () => {
    const packs = [
        {
            name: 'daily',
            stickers: [
                { label: 'inline one', image: 'user/images/st-emote/a.png' },
                { label: 'block one', image: 'user/images/st-emote/b.png', placement: 'after-block' },
            ],
        },
    ];
    const set = buildEffectiveSet(packs, ['daily']);
    const { html } = renderHtml(
        '<p>first [[sticker:daily:inline one]] then [[sticker:daily:block one]]</p>\n<p>next</p>',
        set,
    );
    assert.equal(html.match(/<img /g).length, 2);
    assert.match(html, new RegExp(`^<p>first <img [^>]*${PLACEMENT_ATTRIBUTE}="in-place"> then </p>`));
    assert.match(html, new RegExp(
        `</p><img [^>]*${PLACEMENT_ATTRIBUTE}="after-block" ${PLACED_ATTRIBUTE}="1">\\n<p>next</p>$`,
    ));
});
