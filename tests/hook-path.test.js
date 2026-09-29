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

/**
 * The client's own re-render, modelled the way a 1.19+ client behaves: re-run the
 * message through the formatting pipeline — which is where our hook lives —
 * sanitize the result, and replace the message body.
 *
 * Modelling it this way rather than as a plain assignment is the point: it is what
 * turns "a re-render brings the stickers back on the hook path" into a testable
 * claim instead of an assumption. The `st-dom` harness's stand-in is deliberately
 * simpler — it assigns the source text straight back — because most render tests
 * would rather not have a formatter in the way.
 *
 * @param {{callback: Function}} [registered] - The recorded hook, when the caller
 *   has one; defaults to the module's, for callers that only need the behaviour.
 * @returns {(messageId: number, message: {mes: string, is_user?: boolean}) => void}
 */
function restitchThroughTheHook(registered = { callback: hook }) {
    return (messageId, message) => {
        const element = document.querySelector(`.mes[mesid="${messageId}"]`);
        if (!element) {
            return;
        }
        const rendered = registered.callback(message.mes, {
            messageId,
            isUser: message.is_user === true,
        });
        // The sanitizer's `custom-` prefix — the one client behaviour the shared
        // contract models.
        element.querySelector('.mes_text').innerHTML = applySanitizerClassPrefix(
            parseHtml(rendered),
        ).innerHTML;
    };
}

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
        updateMessageBlock(messageId, message) {
            restitchThroughTheHook(registered)(messageId, message);
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
    // A caller that is not path-aware — a settings change, a re-render — must not
    // walk the chat *itself* on a client whose messages the hook already rendered.
    // The guard sits at the seam rather than being left to each caller to check.
    // (What the repaint does on this path is the next test; here we are only
    // asking that we did not reach for the DOM pass.)
    await withChat(message({ mesid: 0, html: '<p>[[sticker:daily:happy]]</p>' }), ({ document, ...rest }) => {
        const context = { ...rest, chat: [{ mes: '<p>[[sticker:daily:happy]]</p>' }] };
        assert.equal(renderMessageElement(context, document.querySelector('.mes')), 0);
        processAllMessages(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 0);
    });
});

test('a re-render really does repaint the chat on the hook path', async () => {
    // The regression: `rerenderChat` used to bail out unless the DOM pass was
    // installed, so on ≥1.19 it did nothing at all — while the panel's
    // re-render button and `/st-emote reload` both reported that they had
    // repainted the chat. Restitching is the repaint that works on both paths,
    // because it re-runs the client's pipeline and the hook is a stage of it.
    const source = '<p>a [[sticker:daily:happy]] b</p>';
    await withChat(message({ mesid: 0, html: source }), ({ document, ...rest }) => {
        // The one difference from the harness's context: this client's re-render
        // runs its own formatting pipeline, which is where the hook lives.
        const context = {
            ...rest,
            chat: [{ mes: source }],
            updateMessageBlock: restitchThroughTheHook(),
        };
        const textElement = document.querySelector('.mes_text');

        // Start from a chat the hook never ran over: the markers are still text.
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 0);

        const repainted = rerenderChat(context);

        assert.equal(repainted, 1, 'no message was handed back to the client');
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);
        assert.equal(textElement.textContent, 'a  b');

        // And it is idempotent, because the client rebuilds the body from source
        // text every time rather than from whatever we last wrote.
        rerenderChat(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);
    });
});

test('a re-render on a disabled extension leaves the markers as they are', async (t) => {
    t.after(resumeRendering);
    const source = '<p>a [[sticker:daily:happy]] b</p>';
    await withChat(message({ mesid: 0, html: source }), ({ document, ...rest }) => {
        const context = { ...rest, chat: [{ mes: source }] };
        stopRendering(context);
        assert.equal(rerenderChat(context), 0);
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
        + ' style="max-height: 3em; object-fit: contain; margin: 0 0.15em" data-st-emote-pack="daily"'
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

test('the hook honours a 标记 form that is switched off, leaving the text as written', () => {
    // A disabled form is not grammar, so the hook passes the message through
    // rather than matching a token it will never render. Each form on its own
    // first, then both, because "the other one still works" and "neither does"
    // are separate claims.
    const source = '<p>[[sticker:daily:happy]] and <sticker>daily:sad</sticker></p>';
    const settings = client.context.extensionSettings['st-emote'];
    const saved = { bracketForm: settings.bracketForm, tagForm: settings.tagForm };
    try {
        settings.bracketForm = false;
        assert.match(hook(source, { messageId: 0 }), /<img /, 'the tag form still renders');
        settings.tagForm = false;
        assert.equal(hook(source, { messageId: 0 }), source);
        settings.bracketForm = true;
        assert.match(hook(source, { messageId: 0 }), /<img /, 'the bracket form still renders');
        assert.match(hook(source, { messageId: 0 }), /data-st-emote-label="happy"/);
    } finally {
        Object.assign(settings, saved);
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

test('the hook leaves a 旁白 line alone, finding it in the chat', () => {
    // A narrator line is neither a user nor a system message, so the hook
    // context's flags do not exclude it and the chat has to be consulted. Without
    // that lookup this is the one 处理范围 case where the two paths disagree, and
    // it disagrees on ≥1.19 only.
    const source = '<p>[[sticker:daily:happy]]</p>';
    client.context.chat = [{ mes: source, extra: { type: 'narrator' } }];
    assert.equal(hook(source, { messageId: 0, isUser: false, isSystem: false }), source);

    // A different `extra.type` is not a narrator line, and is rendered.
    client.context.chat = [{ mes: source, extra: { type: 'something-else' } }];
    assert.match(hook(source, { messageId: 0 }), /<img /);

    // A streaming preview has no entry in the chat at all, so it cannot be one.
    client.context.chat = [];
    assert.match(hook(source, { messageId: -1 }), /<img /);
    client.context.chat = [];
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
