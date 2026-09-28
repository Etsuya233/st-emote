/**
 * What happens on a client that has the official hook (1.19.0+).
 *
 * The behavioural claim of ADR-0002 is checked in `render-paths.test.js`, which
 * compares what the two paths produce. What is left — and what this file
 * checks — is that a client with the hook gets the hook path and *only* the hook
 * path: no DOM post-processing, no event subscriptions, no second render.
 *
 * The client installs once per page load, and so does this file: the hook is
 * installed in `before` and then driven repeatedly, which is both what the
 * client does and a check that installing twice would be visible if it were
 * possible.
 *
 * These live in their own file because the guard being tested is module-level
 * state ("this client installed the DOM path"). `node --test` gives each file a
 * fresh process, which is the only honest way to observe a client that never
 * installed it.
 */

import test, { before } from 'node:test';
import assert from 'node:assert/strict';

import { installRendering } from '../adapter/render-path.js';
import { processAllMessages, renderMessageElement, rerenderChat } from '../adapter/rendering.js';
import { isRenderingEnabled, resumeRendering, stopRendering } from '../adapter/restore.js';
import { STICKER_CLASS } from '../core/render.js';
import { applySanitizerClassPrefix, parseHtml } from './contract/render-contract.js';
import {
    EVENT_TYPES,
    createEventBus,
    defaultPacks,
    message,
    withChat,
    withSettings,
} from './contract/st-dom.js';

/** A context shaped like a 1.19+ client's, with a recording formatter. */
function createHookClient() {
    const registered = [];
    const context = {
        extensionSettings: {},
        characters: [],
        chat: [],
        chatMetadata: {},
        eventTypes: EVENT_TYPES,
        eventSource: createEventBus(),
        messageFormatter: {
            stage: { AFTER_MARKDOWN: 'after_markdown' },
            order: { EARLY: -10 },
            addHook(callback, options) {
                registered.push({ callback, options });
            },
        },
    };
    withSettings(context, defaultPacks());
    return { context, registered };
}

const client = createHookClient();
/** The one hook the client registered, driven by the tests below. */
let hook = null;

before(() => {
    assert.equal(installRendering(client.context), 'hook');
    assert.equal(client.registered.length, 1);
    hook = client.registered[0].callback;
});

test('the hook is registered for afterMarkdown, early', () => {
    assert.deepEqual(client.registered[0].options, {
        stage: 'after_markdown',
        order: -10,
    });
});

test('installing again does not register a second hook', () => {
    assert.equal(installRendering(client.context), 'hook');
    assert.equal(client.registered.length, 1);
});

test('the DOM post-processing never runs for a client that only has the hook', async () => {
    // A caller that is not path-aware — a settings change, a re-enable — must not
    // walk the chat on a client whose messages the hook already rendered. The
    // guard sits at the seam rather than being left to each caller to check.
    await withChat(message({ mesid: 0, html: '<p>[[sticker:daily:happy]]</p>' }), ({ document, ...rest }) => {
        const context = { ...rest, chat: [{ mes: '<p>[[sticker:daily:happy]]</p>' }] };
        assert.equal(renderMessageElement(context, document.querySelector('.mes')), 0);
        processAllMessages(context);
        rerenderChat(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 0);
    });
});

test('no chat event is subscribed on a client that only has the hook', () => {
    for (const event of [
        'character_message_rendered',
        'message_updated',
        'message_edited',
        'message_swiped',
        'chat_id_changed',
        'more_messages_loaded',
    ]) {
        assert.equal(client.context.eventSource.listenerCount(event), 0, event);
    }
});

test('the hook renders a message the way the DOM path would', () => {
    assert.equal(
        hook('<p>She grins. [[sticker:daily:happy]]</p>', { messageId: 0 }),
        '<p>She grins. <img class="st-emote" src="user/images/st-emote/happy.png" alt="happy"'
        + ' style="max-height: 3em; object-fit: contain" data-st-emote-pack="daily"'
        + ' data-st-emote-label="happy" data-st-emote-token="[[sticker:daily:happy]]"'
        + ' data-st-emote-placement="in-place"></p>',
    );
});

test('the hook applies 块后 in the string, so the DOM never has to', () => {
    client.context.extensionSettings['st-emote'] = defaultPacks({ placement: 'after-block' });
    try {
        assert.match(
            hook('<p>a [[sticker:daily:happy]]</p>\n<p>b</p>', { messageId: 0 }),
            /^<p>a <\/p><img class="st-emote st-emote-block"[^>]*data-st-emote-placed="1">\n<p>b<\/p>$/,
        );
    } finally {
        client.context.extensionSettings['st-emote'] = defaultPacks();
    }
});

test('the hook leaves a message outside 处理范围 exactly as it was', () => {
    const source = '<p>[[sticker:daily:happy]]</p>';
    for (const facts of [
        { isUser: true, isSystem: false, isReasoning: false },
        { isUser: false, isSystem: true, isReasoning: false },
        { isUser: false, isSystem: false, isReasoning: true },
    ]) {
        assert.equal(hook(source, { messageId: 0, ...facts }), source);
    }
});

test('disabling makes the hook a pass-through, so later messages come back raw', async (t) => {
    // The hook stays registered on a disabled extension, so the flag is the only
    // thing standing between "disabled" and "still rendering". Without it the
    // panel could switch the extension off and the next message would bring the
    // stickers right back.
    t.after(resumeRendering);
    assert.equal(isRenderingEnabled(), true);
    assert.match(hook('<p>[[sticker:daily:happy]]</p>', { messageId: 0 }), /<img /);

    await withChat('', () => {
        stopRendering(client.context);
    });

    const source = '<p>[[sticker:daily:happy]]</p>';
    assert.equal(hook(source, { messageId: 0 }), source);
});

test('disabling a hook client also puts the already-rendered chat back', async (t) => {
    t.after(resumeRendering);
    const source = '<p>a [[sticker:daily:happy]] b</p>';
    await withChat(message({ mesid: 0, html: source }), ({ document }) => {
        // What the client does with the hook's output: sanitize, then place it.
        document.querySelector('.mes_text').innerHTML = applySanitizerClassPrefix(
            parseHtml(hook(source, { messageId: 0 })),
        ).innerHTML;
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);

        stopRendering({ chat: [{ mes: source }] });
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 0);
        assert.equal(document.querySelector('.mes_text').textContent, 'a [[sticker:daily:happy]] b');
    });
});
