/**
 * The two render paths, driven through the real adapters and judged by one
 * contract.
 *
 * The claim under test is the one ADR-0002 makes: whatever the client version,
 * the user ends up looking at the same DOM. So both *adapter* paths are driven
 * over the same input — the official-hook path through a recording
 * `messageFormatter`, the DOM path through a real jsdom chat — and both results
 * go through the same `assertRendersAs` with the same expectations.
 *
 * Driving the adapters rather than `core/render.js` is the whole point. The pure
 * core is shared by construction, so comparing it against itself would prove
 * nothing; what can differ is everything the adapters add — where the class name
 * comes from, how 处理范围 is decided, how 投放方式 is applied, and whether the
 * result survives being moved through a DOM.
 *
 * One client behaviour is modelled rather than run: the sanitizer's `custom-`
 * prefix, which is the step that makes the two class names agree. It is labelled
 * as a model at the point of use, and it still needs a look on a real 1.19+.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { installHookRendering } from '../adapter/hook.js';
import { installDomRendering, processAllMessages } from '../adapter/rendering.js';
import { applySanitizerClassPrefix, assertRendersAs, parseHtml, sticker } from './contract/render-contract.js';
import {
    EVENT_TYPES,
    createEventBus,
    defaultPacks,
    message,
    withChat,
    withSettings,
} from './contract/st-dom.js';

const PACKS = {
    packs: [
        {
            name: 'daily',
            stickers: [
                { label: 'happy', image: 'user/images/st-emote/happy.png' },
                { label: 'sad', image: 'user/images/st-emote/sad.png' },
                { label: 'big', image: 'user/images/st-emote/big.png', placement: 'after-block' },
                { label: 'gone', image: '' },
            ],
        },
        { name: 'roleplay', stickers: [{ label: 'happy', image: 'user/images/st-emote/other.png' }] },
    ],
    enabledPackNames: ['daily'],
};

/**
 * Raw sticker specs. Kept separate from the expected *views* so that changing a
 * placement re-derives the class list, the size style and the placed marker
 * together, instead of leaving three of them describing the old placement.
 */
const HAPPY = {
    src: 'user/images/st-emote/happy.png',
    pack: 'daily',
    label: 'happy',
    token: '[[sticker:daily:happy]]',
};
const SAD = {
    src: 'user/images/st-emote/sad.png',
    pack: 'daily',
    label: 'sad',
    token: '[[sticker:daily:sad]]',
};
const BIG = {
    src: 'user/images/st-emote/big.png',
    pack: 'daily',
    label: 'big',
    token: '[[sticker:daily:big]]',
    placement: 'after-block',
};

/**
 * The expected view of one sticker. `depth` defaults to what the 投放方式 implies:
 * 原地 sits inside the block it was written in, 块后 and 消息末尾 sit beside it.
 *
 * @param {object} spec
 * @param {{depth?: number, placement?: string, style?: string}} [overrides]
 */
function view(spec, { depth, placement, style } = {}) {
    const merged = { ...spec, ...(placement ? { placement } : {}), ...(style ? { style } : {}) };
    const resolved = merged.placement ?? 'in-place';
    return sticker({ ...merged, depth: depth ?? (resolved === 'in-place' ? 1 : 0) });
}

/**
 * The official-hook path, as a 1.19+ client runs it: a recording formatter and
 * the hook it registered.
 */
function createHookClient() {
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
                this.hook = callback;
                this.options = options;
            },
        },
    };
    withSettings(context, PACKS);
    assert.equal(installHookRendering(context), true, 'the recording formatter should accept the hook');
    return context;
}

const hookClient = createHookClient();

/**
 * Assert one expectation holds for both adapters.
 *
 * This is the ticket in one function: same input, same expected DOM, both paths.
 *
 * @param {{name: string, source: string, expected: object, settings?: object,
 *   facts?: object, narrator?: boolean, chatEntry?: object, characters?: object[]}} spec
 */
async function assertBothPaths(spec) {
    const { name, source, expected, settings = {}, facts = {}, narrator = false } = spec;
    const messageRecord = { mes: source, ...spec.chatEntry };
    if (narrator) {
        messageRecord.extra = { type: 'narrator' };
    }
    const hookFacts = {
        messageId: 0,
        isUser: false,
        isSystem: false,
        isReasoning: false,
        ...facts,
    };

    // --- the official-hook path -------------------------------------------
    withSettings(hookClient, { ...PACKS, ...settings });
    hookClient.chat = [messageRecord];
    hookClient.characters = spec.characters ?? [];
    const hookDom = parseSanitizedByClient(hookClient.messageFormatter.hook(source, hookFacts));

    // --- the DOM path ------------------------------------------------------
    let domDom = null;
    await withChat(message({ mesid: 0, html: source }), ({ document, ...rest }) => {
        const element = document.querySelector('.mes');
        if (facts.isUser) {
            element.setAttribute('is_user', 'true');
        }
        if (facts.isSystem) {
            element.setAttribute('is_system', 'true');
        }
        if (narrator) {
            // The client copies `extra.type` onto the element; the DOM path reads
            // it from there rather than from the chat.
            element.setAttribute('type', 'narrator');
        }
        const context = withSettings(rest, { ...PACKS, ...settings });
        context.chat = [messageRecord];
        context.characters = spec.characters ?? [];
        installDomRendering(context);
        processAllMessages(context);
        domDom = document.querySelector('.mes_text');
    });

    assertRendersAs(assert, hookDom, expected, `hook path: ${name}`);
    assertRendersAs(assert, domDom, expected, `dom path: ${name}`);
}

/**
 * What the client does to the hook's output before it reaches the screen.
 *
 * A MODEL, not the client: the sanitizer rewrites every class in message content
 * to a `custom-`-prefixed name. That is the whole of the difference between the
 * two paths' class attributes and the one behaviour worth simulating — anything
 * more and the test would be asserting against the model rather than against the
 * code.
 *
 * @param {string} html
 * @returns {Element}
 */
function parseSanitizedByClient(html) {
    return applySanitizerClassPrefix(parseHtml(html));
}

test('in-place renders the same through both adapters', async () => {
    await assertBothPaths({
        name: 'in-place',
        source: '<p>She grins. [[sticker:daily:happy]]</p>',
        expected: { stickers: [view(HAPPY)], text: 'She grins. [[sticker:daily:happy]]' },
    });
});

test('块后 and 消息末尾 land in the same place on both adapters', async () => {
    // The two placements put the same images in the same *kinds* of place but not
    // the same one: 块后 sends each image to its own paragraph's boundary, so the
    // markers interleave with the text, while 消息末尾 collects them at the end.
    const source = '<p>one [[sticker:daily:happy]]</p>\n<p>two [[sticker:daily:sad]]</p>';
    await assertBothPaths({
        name: 'after-block',
        source,
        settings: { placement: 'after-block' },
        expected: {
            stickers: [view(HAPPY, { placement: 'after-block' }), view(SAD, { placement: 'after-block' })],
            text: 'one [[sticker:daily:happy]]\ntwo [[sticker:daily:sad]]',
        },
    });
    await assertBothPaths({
        name: 'message-end',
        source,
        settings: { placement: 'message-end' },
        expected: {
            stickers: [view(HAPPY, { placement: 'message-end' }), view(SAD, { placement: 'message-end' })],
            text: 'one \ntwo [[sticker:daily:happy]][[sticker:daily:sad]]',
        },
    });
});

test('a per-sticker 投放方式 override behaves the same on both adapters', async () => {
    await assertBothPaths({
        name: 'per-sticker override',
        source: '<p>a [[sticker:daily:happy]] b [[sticker:daily:big]] c</p>',
        expected: {
            stickers: [view(HAPPY), view(BIG)],
            // The overridden one left the paragraph; the 原地 one stayed in it.
            text: 'a [[sticker:daily:happy]] b  c[[sticker:daily:big]]',
        },
    });
});

test('several block images after one block stack the same on both adapters', async () => {
    await assertBothPaths({
        name: 'stacked blocks',
        source: '<p>[[sticker:daily:happy]] [[sticker:daily:sad]]</p>',
        settings: { placement: 'after-block' },
        expected: {
            stickers: [view(HAPPY, { placement: 'after-block' }), view(SAD, { placement: 'after-block' })],
            text: ' [[sticker:daily:happy]][[sticker:daily:sad]]',
        },
    });
});

test('both 尺寸集 produce the same size style on both adapters', async () => {
    await assertBothPaths({
        name: 'block size set',
        source: '<p>[[sticker:daily:happy]]</p>',
        settings: { placement: 'after-block', sizes: { block: { maxWidth: '60%', fit: 'cover' } } },
        expected: {
            stickers: [view(HAPPY, { placement: 'after-block', style: 'max-width: 60%; object-fit: cover' })],
        },
    });
    await assertBothPaths({
        name: 'inline size set',
        source: '<p>[[sticker:daily:happy]]</p>',
        settings: { sizes: { inline: { minWidth: '2em', maxHeight: '5em' } } },
        expected: {
            stickers: [view(HAPPY, { style: 'min-width: 2em; max-height: 5em; object-fit: contain' })],
        },
    });
});

test('both token forms render the same on both adapters', async () => {
    await assertBothPaths({
        name: 'tag form',
        source: '<p><sticker>daily:happy</sticker></p>',
        expected: { stickers: [view({ ...HAPPY, token: '<sticker>daily:happy</sticker>' })] },
    });
    await assertBothPaths({
        name: 'escaped tag form',
        source: '<p>&lt;sticker&gt;daily:happy&lt;/sticker&gt;</p>',
        expected: { stickers: [view({ ...HAPPY, token: '<sticker>daily:happy</sticker>' })] },
    });
});

test('a bare label resolves the same on both adapters', async () => {
    await assertBothPaths({
        name: 'bare label',
        source: '<p>[[sticker:happy]]</p>',
        expected: { stickers: [view({ ...HAPPY, token: '[[sticker:happy]]' })] },
    });
});

test('a repeated token gives one image per occurrence on both adapters', async () => {
    await assertBothPaths({
        name: 'repeated token',
        source: '<p>[[sticker:daily:happy]] and [[sticker:daily:happy]]</p>',
        expected: { stickers: [view(HAPPY), view(HAPPY)], text: '[[sticker:daily:happy]] and [[sticker:daily:happy]]' },
    });
});

test('a token in a code block stays text on both adapters', async () => {
    await assertBothPaths({
        name: 'code block',
        source: '<p>see <code>[[sticker:daily:happy]]</code> here</p>',
        expected: { stickers: [], text: 'see [[sticker:daily:happy]] here' },
    });
});

test('every kind of 未命中 disappears the same way on both adapters', async () => {
    const cases = [
        { name: 'label not found', source: '<p>a [[sticker:daily:angry]] b</p>' },
        { name: 'pack not enabled', source: '<p>a [[sticker:roleplay:happy]] b</p>' },
        { name: 'image missing', source: '<p>a [[sticker:daily:gone]] b</p>' },
        { name: 'pack not found', source: '<p>a [[sticker:ghost:happy]] b</p>' },
        {
            name: 'ambiguous bare label',
            source: '<p>a [[sticker:happy]] b</p>',
            settings: { enabledPackNames: ['daily', 'roleplay'] },
        },
        {
            name: 'empty effective set',
            source: '<p>a [[sticker:daily:happy]] b</p>',
            settings: { enabledPackNames: [] },
        },
    ];
    for (const entry of cases) {
        await assertBothPaths({ ...entry, expected: { stickers: [], text: 'a  b' } });
    }
});

test('messages outside 处理范围 are skipped identically on both adapters', async () => {
    const cases = [
        { name: 'user message', facts: { isUser: true } },
        { name: 'system message', facts: { isSystem: true } },
    ];
    for (const { name, facts } of cases) {
        await assertBothPaths({
            name,
            source: '<p>[[sticker:daily:happy]]</p>',
            facts,
            expected: { stickers: [], text: '[[sticker:daily:happy]]' },
        });
    }
});

test('a 旁白 line is left alone by both adapters, though they find it differently', async () => {
    // A narrator line is neither a user nor a system message, so the hook
    // context's flags do not exclude it — the hook path has to reach into the
    // chat, while the DOM path reads the `type` attribute the client copies
    // there. Both must leave the line as text.
    await assertBothPaths({
        name: 'narrator line',
        source: '<p>[[sticker:daily:happy]]</p>',
        narrator: true,
        expected: { stickers: [], text: '[[sticker:daily:happy]]' },
    });
});

test('user messages render on both adapters once the setting is on', async () => {
    await assertBothPaths({
        name: 'user message enabled',
        source: '<p>[[sticker:daily:happy]]</p>',
        facts: { isUser: true },
        settings: { renderUserMessages: true },
        expected: { stickers: [view(HAPPY)] },
    });
});

test('realistic showdown output renders the same on both adapters', async () => {
    await assertBothPaths({
        name: 'showdown output',
        source: '<p>She grins.<br>[[sticker:daily:happy]]</p>\n'
            + '<blockquote><p>Quote &amp; [[sticker:daily:sad]]</p></blockquote>\n'
            + '<ul><li>Item [[sticker:daily:happy]]</li></ul>\n'
            + '<pre><code>[[sticker:daily:happy]]</code></pre>',
        settings: { placement: 'after-block' },
        expected: {
            // One per rendered token: after its own paragraph, inside the
            // blockquote's own paragraph, and after the list item. The one in the
            // code block is still text.
            stickers: [
                view(HAPPY, { placement: 'after-block', depth: 0 }),
                view(SAD, { placement: 'after-block', depth: 1 }),
                view(HAPPY, { placement: 'after-block', depth: 1 }),
            ],
        },
    });
});

test('a message with no token is left alone by both adapters', async () => {
    await assertBothPaths({
        name: 'no token',
        source: '<p>Nothing here.</p>',
        expected: { stickers: [], text: 'Nothing here.' },
    });
});

test('a pack that stops being enabled loses its images on both adapters', async () => {
    // The DOM path needs the client's own re-render to get here, because a miss
    // removed the token from the DOM and nothing left to re-render; the hook path
    // gets it for free, since the client re-runs the hook whenever it formats.
    await assertBothPaths({
        name: 'pack enabled',
        source: '<p>[[sticker:daily:happy]]</p>',
        expected: { stickers: [view(HAPPY)] },
    });
    await assertBothPaths({
        name: 'pack disabled',
        source: '<p>[[sticker:daily:happy]]</p>',
        settings: { enabledPackNames: [] },
        // A 未命中 is removed, not left as text — which is the whole reason a
        // settings change has to re-render from source rather than reuse the DOM.
        expected: { stickers: [], text: '' },
    });
});

test('a group-chat message resolves the author 作用域 on both adapters', async () => {
    // The effective set is per message, and a group chat names the author on the
    // message. The DOM path reads the avatar off the element's `mesid`; the hook
    // path has to get the same avatar from the `messageId` in its context.
    const source = '<p>[[sticker:only-her:wave]]</p>';
    const packs = {
        packs: [
            { name: 'daily', stickers: [{ label: 'happy', image: 'user/images/st-emote/happy.png' }] },
            { name: 'only-her', stickers: [{ label: 'wave', image: 'user/images/st-emote/wave.png' }] },
        ],
        enabledPackNames: ['daily'],
    };
    await assertBothPaths({
        name: 'group chat',
        source,
        settings: packs,
        chatEntry: { original_avatar: 'her.png' },
        characters: [{
            avatar: 'her.png',
            data: { extensions: { 'st-emote': { enabledPackNames: ['only-her'] } } },
        }],
        expected: {
            stickers: [view({
                src: 'user/images/st-emote/wave.png',
                pack: 'only-her',
                label: 'wave',
                token: '[[sticker:only-her:wave]]',
            })],
        },
    });
});
