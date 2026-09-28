import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEffectiveSet } from '../core/effective-set.js';
import { STICKER_CLASS, renderHtml, renderText } from '../core/render.js';

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
    assert.doesNotMatch(html, /\[\[sticker:/);
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

test('an unknown label disappears and is reported', () => {
    const { html, misses } = renderHtml('<p>a [[sticker:daily:angry]] b</p>', setWith(['daily']));
    assert.equal(html, '<p>a  b</p>');
    assert.deepEqual(misses, [
        { reason: 'label-not-found', raw: '[[sticker:daily:angry]]', packName: 'daily', label: 'angry' },
    ]);
});

test('a token for a disabled pack disappears and is reported', () => {
    const { html, misses } = renderHtml('[[sticker:roleplay:happy]]', setWith(['daily']));
    assert.equal(html, '');
    assert.equal(misses[0].reason, 'pack-not-enabled');
});

test('a bare label disappears when several packs are enabled', () => {
    const { html, misses } = renderHtml('[[sticker:happy]]', setWith(['daily', 'roleplay']));
    assert.equal(html, '');
    assert.equal(misses[0].reason, 'ambiguous-bare-label');
});

test('a sticker without an image disappears and is reported', () => {
    const { html, misses } = renderHtml('[[sticker:daily:no image]]', setWith(['daily']));
    assert.equal(html, '');
    assert.equal(misses[0].reason, 'image-missing');
});

test('tokens inside a code element are untouched', () => {
    const source = '<p>see <code>[[sticker:daily:happy]]</code> here</p>';
    const { html, misses } = renderHtml(source, setWith(['daily']));
    assert.equal(html, source);
    assert.equal(misses.length, 0);
});

test('tokens inside a pre block are untouched', () => {
    const source = '<pre><code>[[sticker:daily:happy]]</code></pre>';
    const { html } = renderHtml(source, setWith(['daily']));
    assert.equal(html, source);
});

test('tokens after a code block are still rendered', () => {
    const source = '<code>[[sticker:daily:happy]]</code> [[sticker:daily:happy]]';
    const { html } = renderHtml(source, setWith(['daily']));
    assert.equal(html, `<code>[[sticker:daily:happy]]</code> <img class="${STICKER_CLASS}" src="user/images/st-emote/happy.png" alt="happy" data-st-emote-pack="daily" data-st-emote-label="happy">`);
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

test('renderText removes a missed token', () => {
    const { html, misses } = renderText('x [[sticker:nope]] y', setWith(['daily']));
    assert.equal(html, 'x  y');
    assert.equal(misses.length, 1);
});

test('renderHtml replaces the raw HTML-tag form', () => {
    const { html, misses } = renderHtml('<p><sticker>daily:happy</sticker></p>', setWith(['daily']));
    assert.equal(misses.length, 0);
    assert.match(html, new RegExp(`<img class="${STICKER_CLASS}"`));
    assert.doesNotMatch(html, /<sticker>/);
});

test('renderHtml replaces the escaped HTML-tag form', () => {
    const source = '<p>&lt;sticker&gt;daily:happy&lt;/sticker&gt;</p>';
    const { html, misses } = renderHtml(source, setWith(['daily']));
    assert.equal(misses.length, 0);
    assert.match(html, new RegExp(`<img class="${STICKER_CLASS}"`));
    assert.doesNotMatch(html, /&lt;sticker&gt;/);
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

test('renderText keeps a missed HTML-tag token removed', () => {
    const { html, misses } = renderText('x <sticker>angry</sticker> y', setWith(['daily']));
    assert.equal(html, 'x  y');
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
