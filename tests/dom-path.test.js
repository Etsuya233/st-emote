/**
 * The DOM path's lifecycle, driven end to end against a real DOM.
 *
 * Four claims are checked here, and none of them is about how the path is
 * written — only about what the chat looks like afterwards:
 *
 * - the path is idempotent, so re-render / Show more / swipe / edit leave no
 *   duplicate and no stale image;
 * - disabling puts the original markers back;
 * - the path is only installed on a client that has no official hook;
 * - both paths emit the same final DOM, which `render-paths.test.js` pins.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    installDomRendering,
    installStickerImageGuard,
    processAllMessages,
    renderMessageElement,
    rerenderChat,
} from '../adapter/rendering.js';
import { resumeRendering, restoreMessageText, stopRendering } from '../adapter/restore.js';
import { STICKER_CLASS } from '../core/render.js';
import { assertRendersAs, sticker } from './contract/render-contract.js';
import { EVENT_TYPES, defaultPacks, message, withChat, withSettings } from './contract/st-dom.js';

const HAPPY = sticker({
    src: 'user/images/st-emote/happy.png',
    pack: 'daily',
    label: 'happy',
    token: '[[sticker:daily:happy]]',
});

/** Restore the module-level flag a disable test flipped. */
function reenable(t) {
    t.after(() => resumeRendering());
}

test('the DOM path renders a message in place', async () => {
    await withChat(message({ mesid: 0, html: '<p>She grins. [[sticker:daily:happy]]</p>' }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks());
        installDomRendering(context);
        renderMessageElement(context, document.querySelector('.mes'));
        assertRendersAs(assert, document.querySelector('.mes_text'), {
            stickers: [HAPPY],
            text: 'She grins. [[sticker:daily:happy]]',
        });
    });
});

test('re-rendering the same message twice inserts nothing twice', async () => {
    await withChat(message({ mesid: 0, html: '<p>[[sticker:daily:happy]]</p>' }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks());
        installDomRendering(context);
        const element = document.querySelector('.mes');
        renderMessageElement(context, element);
        renderMessageElement(context, element);
        renderMessageElement(context, element);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);
    });
});

test('消息末尾 moves every image to the end of the message, not to its own block', async () => {
    // The two placements differ in *which* place they choose; the block boundary
    // only says where within an 块后 the image goes. Deciding on the boundary
    // alone answers "after this paragraph" for a token inside one, which silently
    // turns 消息末尾 into 块后.
    const html = '<p>one [[sticker:daily:happy]]</p>\n<p>two [[sticker:daily:sad]]</p>';
    await withChat(message({ mesid: 0, html }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks({ placement: 'message-end' }));
        installDomRendering(context);
        processAllMessages(context);

        const textElement = document.querySelector('.mes_text');
        const images = [...textElement.querySelectorAll(`img.${STICKER_CLASS}`)];
        assert.equal(images.length, 2);
        // Both are the message's last children, in the order they were written.
        assert.deepEqual(
            [...textElement.children].slice(-2),
            images,
        );
        assert.equal(textElement.querySelectorAll('p img').length, 0);
        assert.deepEqual(images.map((image) => image.getAttribute('alt')), ['happy', 'sad']);
    });
});

test('after-block still lands each image at its own block boundary', async () => {
    const html = '<p>one [[sticker:daily:happy]]</p>\n<p>two [[sticker:daily:sad]]</p>';
    await withChat(message({ mesid: 0, html }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks({ placement: 'after-block' }));
        installDomRendering(context);
        processAllMessages(context);

        const textElement = document.querySelector('.mes_text');
        // Each image is a sibling of its own block rather than a child, and the
        // blocks keep their order, so the children alternate paragraph, image.
        assert.deepEqual(
            [...textElement.children].map((node) => node.tagName),
            ['P', 'IMG', 'P', 'IMG'],
        );
        assert.deepEqual(
            [...textElement.querySelectorAll(':scope > img')].map((image) => image.getAttribute('alt')),
            ['happy', 'sad'],
        );
    });
});

test('a relocated image is not dragged somewhere else by a second pass', async () => {
    const html = '<p>first [[sticker:daily:big]]</p>\n<p>second</p>';
    await withChat(message({ mesid: 0, html }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks());
        installDomRendering(context);
        const element = document.querySelector('.mes');
        renderMessageElement(context, element);
        const afterFirst = document.querySelector('.mes_text').innerHTML;
        renderMessageElement(context, element);
        assert.equal(document.querySelector('.mes_text').innerHTML, afterFirst);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);
    });
});

test('Show more loads earlier messages without disturbing the ones already rendered', async () => {
    const first = message({ mesid: 0, html: '<p>[[sticker:daily:happy]]</p>' });
    const older = message({ mesid: 1, html: '<p>[[sticker:daily:sad]]</p>' });
    await withChat(first, ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks());
        installDomRendering(context);
        processAllMessages(context);
        const before = document.querySelector('.mes_text').innerHTML;

        // What the client does for "Show more messages": append the older ones,
        // then announce it.
        document.getElementById('chat').insertAdjacentHTML('beforeend', older);
        context.eventSource.emit(EVENT_TYPES.MORE_MESSAGES_LOADED);

        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 2);
        assert.equal(document.querySelectorAll('.mes')[0].querySelector('.mes_text').innerHTML, before);
    });
});

test('a swipe re-renders the message from its new text with no stale image', async () => {
    const context0 = { mes: '<p>[[sticker:daily:happy]]</p>' };
    await withChat(message({ mesid: 0, html: context0.mes }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks());
        context.chat = [{ ...context0 }];
        installDomRendering(context);
        processAllMessages(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);

        // A swipe gives the message a different text; the client re-renders the
        // block from it before the event fires.
        const swiped = { mes: '<p>[[sticker:daily:sad]]</p>' };
        context.chat[0] = swiped;
        context.updateMessageBlock(0, swiped);
        context.eventSource.emit(EVENT_TYPES.MESSAGE_SWIPED, 0);

        const images = [...document.querySelectorAll(`img.${STICKER_CLASS}`)];
        assert.equal(images.length, 1);
        assert.equal(images[0].getAttribute('data-st-emote-label'), 'sad');
    });
});

test('editing a message leaves no stale image from the text it replaced', async () => {
    await withChat(message({ mesid: 0, html: '<p>[[sticker:daily:happy]]</p>' }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks());
        context.chat = [{ mes: '<p>[[sticker:daily:happy]]</p>' }];
        installDomRendering(context);
        processAllMessages(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);

        const edited = { mes: '<p>[[sticker:daily:sad]]</p>' };
        context.chat[0] = edited;
        context.updateMessageBlock(0, edited);
        context.eventSource.emit(EVENT_TYPES.MESSAGE_EDITED, 0);

        const images = [...document.querySelectorAll(`img.${STICKER_CLASS}`)];
        assert.equal(images.length, 1);
        assert.equal(images[0].getAttribute('data-st-emote-label'), 'sad');
    });
});

test('a settings change re-renders the chat from source and repaints placement', async () => {
    const source = '<p>[[sticker:daily:happy]]</p>';
    await withChat(message({ mesid: 0, html: source }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks());
        context.chat = [{ mes: source }];
        installDomRendering(context);
        processAllMessages(context);
        assert.deepEqual(
            [...document.querySelectorAll(`img.${STICKER_CLASS}`)].map((image) => image.getAttribute('data-st-emote-placement')),
            ['in-place'],
        );

        // The panel writes the new 投放方式 and asks for a re-render.
        const settings = withSettings(context, defaultPacks({ placement: 'after-block' }));
        rerenderChat(settings);

        const image = document.querySelector(`img.${STICKER_CLASS}`);
        assert.equal(image.getAttribute('data-st-emote-placement'), 'after-block');
        assert.deepEqual([...image.classList], [STICKER_CLASS, `${STICKER_CLASS}-block`]);
    });
});

test('a message outside 处理范围 is left as the client rendered it', async () => {
    const html = '<p>[[sticker:daily:happy]]</p>';
    const cases = [
        { label: 'user message', spec: { isUser: true } },
        { label: 'system message', spec: { isSystem: true } },
        { label: 'narrator line', spec: { isSystem: true, type: 'narrator' } },
    ];
    for (const { label, spec } of cases) {
        await withChat(message({ mesid: 0, html, ...spec }), ({ document, ...rest }) => {
            const context = withSettings(rest, defaultPacks());
            renderMessageElement(context, document.querySelector('.mes'));
            assert.equal(document.querySelector(`img.${STICKER_CLASS}`), null, label);
            assert.equal(document.querySelector('.mes_text').textContent, '[[sticker:daily:happy]]', label);
        });
    }
});

test('user messages render when the setting is switched on', async () => {
    const html = '<p>[[sticker:daily:happy]]</p>';
    await withChat(message({ mesid: 0, html, isUser: true }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks({ renderUserMessages: true }));
        renderMessageElement(context, document.querySelector('.mes'));
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);
    });
});

test('disabling puts the original marker back in the live DOM', async (t) => {
    reenable(t);
    const source = 'She grins. [[sticker:daily:happy]] Bye.';
    const html = `<p>${source}</p>`;
    await withChat(message({ mesid: 0, html }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks());
        context.chat = [{ mes: html }];
        installDomRendering(context);
        processAllMessages(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);

        stopRendering(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 0);
        assert.equal(document.querySelector('.mes_text').textContent, source);
    });
});

test('disabling puts a 块后 image back inside its paragraph, where the model wrote it', async (t) => {
    reenable(t);
    const source = '<p>a [[sticker:daily:big]] b</p>';
    await withChat(message({ mesid: 0, html: source }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks({ placement: 'after-block' }));
        context.chat = [{ mes: source }];
        installDomRendering(context);
        processAllMessages(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);
        // Relocated: the image no longer sits where it was written.
        assert.equal(document.querySelector('.mes p img'), null);

        stopRendering(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 0);
        assert.equal(document.querySelector('.mes_text').innerHTML, source);
    });
});

test('disabling a message with no source entry still puts its marker back', async (t) => {
    reenable(t);
    // No `chat` entry, so nothing can be restitched and the image has to be
    // swapped in place. The text comes back; the position is wherever the image
    // had been moved to, which nothing left in the DOM records.
    const source = '<p>a [[sticker:daily:big]] b</p>';
    await withChat(message({ mesid: 0, html: source }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks({ placement: 'after-block' }));
        installDomRendering(context);
        processAllMessages(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);

        assert.equal(stopRendering(context), 1);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 0);
        assert.equal(document.querySelector('.mes_text').textContent, 'a  b[[sticker:daily:big]]');
    });
});

test('disabling restores messages the chat does not know about, such as a streaming preview', async (t) => {
    reenable(t);
    const preview = message({ mesid: -1, html: '<p>[[sticker:daily:happy]]</p>' });
    await withChat(preview, ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks());
        installDomRendering(context);
        processAllMessages(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);

        // The message is on screen but has no entry in the chat, which is why the
        // undo walks the DOM rather than the chat.
        assert.deepEqual(context.chat, []);
        assert.equal(stopRendering(context), 1);
        assert.equal(document.querySelector('.mes_text').textContent, '[[sticker:daily:happy]]');
    });
});

test('disabling leaves an unrelated image in the message alone', async (t) => {
    reenable(t);
    const html = '<p>[[sticker:daily:happy]]</p><img src="user/images/other.png" alt="other">';
    await withChat(message({ mesid: 0, html }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks());
        installDomRendering(context);
        processAllMessages(context);
        stopRendering(context);
        const remaining = [...document.querySelectorAll('img')];
        assert.equal(remaining.length, 1);
        assert.equal(remaining[0].getAttribute('src'), 'user/images/other.png');
    });
});

test('restoring twice changes nothing the second time', async (t) => {
    reenable(t);
    await withChat(message({ mesid: 0, html: '<p>[[sticker:daily:happy]]</p>' }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks());
        installDomRendering(context);
        processAllMessages(context);
        stopRendering(context);
        assert.equal(restoreMessageText(context), 0);
    });
});

test('a disabled extension does not render again when a render event fires', async (t) => {
    // The event subscriptions outlive `onDisable`: the client does not reload, and
    // unsubscribing would mean remembering every listener. So the gate has to be
    // inside the DOM pass, not around the subscription — otherwise the next
    // message the client renders puts the stickers straight back into a chat the
    // user just turned them off in.
    reenable(t);
    const html = '<p>[[sticker:daily:happy]]</p>';
    await withChat(message({ mesid: 0, html }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks());
        context.chat = [{ mes: html }];
        installDomRendering(context);
        processAllMessages(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);

        stopRendering(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 0);

        // Every event the DOM path listens for, one after another.
        for (const event of Object.values(EVENT_TYPES)) {
            context.eventSource.emit(event, 0);
        }
        processAllMessages(context);
        rerenderChat(context);
        assert.equal(
            document.querySelectorAll(`img.${STICKER_CLASS}`).length,
            0,
            'a disabled extension must not render again',
        );
        assert.equal(document.querySelector('.mes_text').textContent, '[[sticker:daily:happy]]');
    });
});

test('a re-enabled extension renders again', async (t) => {
    reenable(t);
    const html = '<p>[[sticker:daily:happy]]</p>';
    await withChat(message({ mesid: 0, html }), ({ document, ...rest }) => {
        const context = withSettings(rest, defaultPacks());
        context.chat = [{ mes: html }];
        installDomRendering(context);
        processAllMessages(context);
        stopRendering(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 0);

        resumeRendering();
        processAllMessages(context);
        assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 1);
    });
});

test('a re-render follows the chat the client is showing, not the one captured at load', async () => {
    // `getContext()` hands out a fresh object and rebinds `chat` as the user moves
    // around, so a context captured when the extension loaded names the chat that
    // was open then. Re-rendering from that one would restitch the wrong messages
    // — or, on a settings change, paint the previous chat's stickers over the
    // current one.
    const oldHtml = '<p>[[sticker:daily:sad]]</p>';
    const newHtml = '<p>[[sticker:daily:happy]]</p>';
    await withChat(
        message({ mesid: 0, html: oldHtml }) + message({ mesid: 1, html: '<p>nothing</p>' }),
        ({ document, ...rest }) => {
            const context = withSettings(rest, defaultPacks());
            // The context the extension captured: pointed at the old chat.
            context.chat = [{ mes: oldHtml }, { mes: '<p>nothing</p>' }];
            installDomRendering(context);
            processAllMessages(context);
            assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`)[0].getAttribute('alt'), 'sad');

            // The user switches chats: the live context now names the new one.
            context.updateMessageBlock = function updateMessageBlock(messageId, chatMessage) {
                document.querySelector(`.mes[mesid="${messageId}"] .mes_text`).innerHTML = chatMessage.mes;
            };
            const liveContext = { ...context, chat: [{ mes: newHtml }, { mes: '<p>nothing</p>' }] };
            globalThis.SillyTavern = { getContext: () => liveContext };
            try {
                rerenderChat(context);
            } finally {
                delete globalThis.SillyTavern;
            }
            // Message 0 was restitched from the *new* chat's text, so it now shows
            // `happy`. Had the stale `chat` been used it would still show `sad`.
            assert.equal(
                document.querySelectorAll(`img.${STICKER_CLASS}`)[0].getAttribute('alt'),
                'happy',
            );
            // And message 1, which neither chat puts a token in, is untouched.
            assert.equal(document.querySelectorAll('.mes')[1].querySelector('.mes_text').innerHTML, '<p>nothing</p>');
        },
    );
});

test('a sticker image that fails to load is taken out of the chat', async () => {
    // A dead 外链 and a file that never arrived both arrive as an image that
    // fired `error`. Removing it is what makes a 未命中 actually look like one
    // instead of a broken-image icon sitting in the reply.
    await withChat(
        message({ mesid: 0, html: '<p>[[sticker:daily:happy]] and [[sticker:daily:sad]]</p>' }),
        ({ document, ...rest }) => {
            const context = withSettings(rest, defaultPacks());
            installDomRendering(context);
            // Normally installed by the path chooser, which both paths go
            // through; called directly here because that is what this suite does.
            installStickerImageGuard();
            renderMessageElement(context, document.querySelector('.mes'));
            assert.equal(document.querySelectorAll(`img.${STICKER_CLASS}`).length, 2);

            document.querySelectorAll(`img.${STICKER_CLASS}`)[0].dispatchEvent(
                new globalThis.Event('error', { bubbles: true }),
            );

            const images = document.querySelectorAll(`img.${STICKER_CLASS}`);
            assert.equal(images.length, 1);
            assert.equal(images[0].getAttribute('alt'), 'sad');
        },
    );
});
