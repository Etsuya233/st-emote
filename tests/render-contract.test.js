/**
 * The half of the contract that is pure: what a sticker image is made of, what
 * marker it stands for, and which messages are in scope. Both render paths are
 * built on these, so pinning them here pins the part the two paths cannot
 * disagree about.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEffectiveSet } from '../core/effective-set.js';
import { PLACED_ATTRIBUTE, PLACEMENT_ATTRIBUTE } from '../core/placement.js';
import { shouldRenderMessage } from '../core/processing-scope.js';
import {
    SANITIZER_CLASS_PREFIX,
    STICKER_CLASS,
    STICKER_HOOK_CLASS,
    TOKEN_ATTRIBUTE,
    renderHtml,
    supportsMessageFormatter,
} from '../core/render.js';
import { tokenText } from '../core/token.js';
import { stickerClassList } from './contract/render-contract.js';

const packs = [
    {
        name: 'daily',
        stickers: [
            { label: 'happy', image: 'user/images/st-emote/happy.png' },
            { label: 'no image', image: '' },
            { label: 'big', image: 'user/images/st-emote/big.png', placement: 'after-block' },
        ],
    },
];

const set = buildEffectiveSet(packs, ['daily']);

test('the DOM class name is the hook class name plus the sanitizer prefix', () => {
    // The two paths converge on one name in one stylesheet (ADR-0002). Deriving
    // the DOM name from the hook name is what stops the pair drifting: a change
    // to the base class cannot leave `custom-` behind on one path only.
    assert.equal(STICKER_HOOK_CLASS, 'st-emote');
    assert.equal(SANITIZER_CLASS_PREFIX, 'custom-');
    assert.equal(STICKER_CLASS, `${SANITIZER_CLASS_PREFIX}${STICKER_HOOK_CLASS}`);
    assert.equal(STICKER_CLASS, 'custom-st-emote');
    assert.deepEqual(
        stickerClassList(`<img class="${STICKER_HOOK_CLASS} ${STICKER_HOOK_CLASS}-block" src="x">`),
        ['st-emote', 'st-emote-block'],
    );
});

test('supportsMessageFormatter is feature detection on addHook alone', () => {
    assert.equal(supportsMessageFormatter({ addHook() {} }), true);
    assert.equal(supportsMessageFormatter({ addHook: 'nope' }), false);
    assert.equal(supportsMessageFormatter({}), false);
    assert.equal(supportsMessageFormatter(null), false);
    assert.equal(supportsMessageFormatter(undefined), false);
});

test('tokenText rebuilds the marker in the form the model wrote it', () => {
    assert.equal(
        tokenText({ raw: '[[sticker:daily:happy]]', packName: 'daily', label: 'happy' }),
        '[[sticker:daily:happy]]',
    );
    assert.equal(
        tokenText({ raw: '[[sticker:happy]]', packName: null, label: 'happy' }),
        '[[sticker:happy]]',
    );
    assert.equal(
        tokenText({ raw: '<sticker>daily:happy</sticker>', packName: 'daily', label: 'happy' }),
        '<sticker>daily:happy</sticker>',
    );
    // The escaped landing form rebuilds as the tag, not as its entity soup.
    assert.equal(
        tokenText({ raw: '&lt;sticker&gt;daily:happy&lt;/sticker&gt;', packName: 'daily', label: 'happy' }),
        '<sticker>daily:happy</sticker>',
    );
    assert.equal(
        tokenText({ raw: '<my-sticker>daily:happy</my-sticker>', packName: 'daily', label: 'happy' }, { tagName: 'my-sticker' }),
        '<my-sticker>daily:happy</my-sticker>',
    );
});

test('tokenText uses the trimmed body, not the raw match, so odd spacing is normalised', () => {
    assert.equal(
        tokenText({ raw: '[[sticker: daily :  happy ]]', packName: 'daily', label: 'happy' }),
        '[[sticker:daily:happy]]',
    );
});

test('shouldRenderMessage leaves system, narrator and reasoning messages alone', () => {
    assert.equal(shouldRenderMessage({ isSystem: true }), false);
    assert.equal(shouldRenderMessage({ isNarrator: true }), false);
    assert.equal(shouldRenderMessage({ isReasoning: true }), false);
    // Even with user messages switched on.
    assert.equal(shouldRenderMessage({ isSystem: true }, { renderUserMessages: true }), false);
});

test('shouldRenderMessage skips user messages unless they are switched on', () => {
    assert.equal(shouldRenderMessage({ isUser: true }), false);
    assert.equal(shouldRenderMessage({ isUser: true }, { renderUserMessages: false }), false);
    assert.equal(shouldRenderMessage({ isUser: true }, { renderUserMessages: true }), true);
    assert.equal(shouldRenderMessage({}), true);
    assert.equal(shouldRenderMessage({}, { renderUserMessages: true }), true);
});

test('both paths record the marker they replaced, so it can be put back', () => {
    const dom = renderHtml('a [[sticker:daily:happy]] b', set).html;
    const hook = renderHtml('a [[sticker:daily:happy]] b', set, { className: STICKER_HOOK_CLASS }).html;
    for (const html of [dom, hook]) {
        const marker = new RegExp(`${TOKEN_ATTRIBUTE}="([^"]*)"`).exec(html)?.[1];
        assert.equal(marker, '[[sticker:daily:happy]]');
    }
});

test('the recorded marker follows the form the token was written in', () => {
    const { html } = renderHtml('<sticker>daily:happy</sticker>', set);
    assert.match(html, new RegExp(`${TOKEN_ATTRIBUTE}="&lt;sticker&gt;daily:happy&lt;/sticker&gt;"`));
});

test('the hook path emits the bare class and never the sanitizer prefix', () => {
    const { html } = renderHtml('[[sticker:daily:happy]]', set, { className: STICKER_HOOK_CLASS });
    assert.match(html, new RegExp(`class="${STICKER_HOOK_CLASS}"`));
    assert.doesNotMatch(html, new RegExp('class="custom-'));
    assert.match(html, new RegExp(`${TOKEN_ATTRIBUTE}="\\[\\[sticker:daily:happy\\]\\]"`));
    assert.match(html, new RegExp(`${PLACEMENT_ATTRIBUTE}="in-place"`));
    assert.doesNotMatch(html, new RegExp(PLACED_ATTRIBUTE));
});
