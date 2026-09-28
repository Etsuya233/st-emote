/**
 * A jsdom stand-in for the parts of SillyTavern a render path touches.
 *
 * The paths are thin by design — they read the context, call the pure core and
 * move nodes — so a real DOM plus a plain object is enough to drive them. The
 * alternative, a hand-written fake DOM, would have been a second implementation
 * of the browser's own behaviour, and every bug it hid would be a bug the test
 * suite reported as a pass.
 *
 * What is faked is only the client's surface: `getContext`, the event bus and
 * `updateMessageBlock`. The last one matters most — the real one re-runs the
 * client's own formatting and replaces the message body wholesale, and that
 * wholesale replacement is exactly what makes the DOM path idempotent, so the
 * fake has to reproduce it faithfully.
 */

import { JSDOM } from 'jsdom';

import { STORAGE_KEY } from '../../adapter/settings.js';

/** Globals the adapter reads as ambient browser state. */
const BROWSER_GLOBALS = [
    'document', 'window', 'NodeFilter', 'Node', 'HTMLImageElement', 'Event', 'CustomEvent', 'FileReader',
];

/**
 * Build a page with a chat, and install the browser globals for the duration of
 * `body`.
 *
 * @param {string} bodyHtml - The initial contents of `#chat`.
 * @param {(harness: object) => void|Promise<void>} body
 */
export async function withChat(bodyHtml, body) {
    const dom = new JSDOM(`<!doctype html><html><body><div id="chat">${bodyHtml}</div></body></html>`);
    const { window } = dom;
    const saved = BROWSER_GLOBALS.map((name) => [name, globalThis[name]]);
    for (const name of BROWSER_GLOBALS) {
        globalThis[name] = window[name];
    }
    try {
        await body({ window, document: window.document, ...createContext(window.document) });
    } finally {
        for (const [name, value] of saved) {
            globalThis[name] = value;
        }
        window.close();
    }
}

/**
 * The same page, but with the container the extension settings panel mounts
 * into. The panel is the one part of the adapter that is pure DOM, so a jsdom
 * page is the only honest way to drive it — a fake element tree would be a
 * second implementation of the browser again.
 *
 * @param {(harness: object) => void|Promise<void>} body
 */
export async function withPanel(body) {
    return withChat('', async (harness) => {
        const container = harness.document.createElement('div');
        container.id = 'extensions_settings';
        harness.document.body.append(container);
        await body({ ...harness, panel: container });
    });
}

/**
 * Run `body` with a JSZip installed as the global the adapter's lazy import
 * produces.
 *
 * The **runtime** has no dependency of its own: `adapter/archive.js` loads
 * `/lib/jszip.min.js` out of the client. The tests get the same library from the
 * `jszip` **devDependency** instead, so the archive guarantee is exercised on
 * every machine rather than only where a SillyTavern checkout happens to sit
 * next to the repo. It is the same library and the same API; only the delivery
 * differs, and the delivery is not what these tests are about.
 *
 * There is deliberately no skip path here. A silently skipped export/import
 * suite is a green `npm test` that proves nothing about the one feature the
 * ticket exists to add.
 *
 * @param {import('node:test').TestContext} t
 * @param {(JSZip: any) => void|Promise<void>} body
 */
export async function withJsZip(t, body) {
    const previous = globalThis.JSZip;
    const { default: JSZip } = await import('jszip');
    globalThis.JSZip = JSZip;
    try {
        await body(JSZip);
    } finally {
        globalThis.JSZip = previous;
    }
}

/**
 * A stand-in for the client's own `fetch`, driven by a routing table. Only the
 * three image endpoints this extension calls are routed; anything else fails
 * loudly rather than resolving to nothing, so a new call site cannot pass
 * unnoticed.
 *
 * @param {{upload?: Function, list?: Function, remove?: Function}} routes
 * @returns {Function} A `fetch` replacement, plus a `calls` array on it.
 */
export function fakeFetch(routes = {}) {
    const calls = [];
    const fetch = async (url, init = {}) => {
        const body = init.body ? JSON.parse(init.body) : {};
        calls.push({ url, body });
        const route = url.endsWith('/upload')
            ? routes.upload
            : url.endsWith('/list')
                ? routes.list
                : url.endsWith('/delete')
                    ? routes.remove
                    : null;
        const result = typeof route === 'function' ? await route(body) : route;
        if (result === undefined) {
            throw new Error(`fakeFetch has no route for ${url}`);
        }
        if (result instanceof Error) {
            throw result;
        }
        return {
            ok: result.status === undefined || (result.status >= 200 && result.status < 300),
            status: result.status ?? 200,
            json: async () => result.body,
        };
    };
    fetch.calls = calls;
    return fetch;
}

/**
 * A recording stand-in for the client's event bus, so a test can fire one of its
 * events and can also see which ones a render path subscribed to.
 *
 * @returns {{on: Function, emit: Function, listenerCount: Function}}
 */
export function createEventBus() {
    const listeners = new Map();
    return {
        /**
         * @param {string} type
         * @param {Function} listener
         */
        on(type, listener) {
            if (!listeners.has(type)) {
                listeners.set(type, []);
            }
            listeners.get(type).push(listener);
        },
        /**
         * Fire one of the client's events, the way `eventSource.emit` does.
         *
         * @param {string} type
         * @param {...any} args
         */
        emit(type, ...args) {
            for (const listener of listeners.get(type) ?? []) {
                listener(...args);
            }
        },
        /** @param {string} type */
        listenerCount(type) {
            return (listeners.get(type) ?? []).length;
        },
    };
}

/** The event names the render paths subscribe to. */
export const EVENT_TYPES = {
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    MESSAGE_UPDATED: 'message_updated',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_SWIPED: 'message_swiped',
    CHAT_CHANGED: 'chat_id_changed',
    MORE_MESSAGES_LOADED: 'more_messages_loaded',
};

/**
 * A context object shaped like the one `SillyTavern.getContext()` returns.
 *
 * @param {Document} document
 */
function createContext(document) {
    return {
        extensionSettings: {},
        characters: [],
        chat: [],
        chatMetadata: {},
        eventTypes: EVENT_TYPES,
        eventSource: createEventBus(),
        getRequestHeaders: () => ({ 'x-csrf-token': 'test' }),
        saveSettingsDebounced: () => {},
        updateChatMetadata() {},
        saveMetadata() {},
        /**
         * The client's own re-render: run the message text through formatting
         * and replace the body with the result, exactly as the real
         * `updateMessageBlock` does. `format` stands in for the client's
         * formatter, so a test can model either path's contribution to it.
         *
         * @param {number} messageId
         * @param {{mes: string}} message
         */
        updateMessageBlock(messageId, message) {
            const element = document.querySelector(`.mes[mesid="${messageId}"]`);
            element.querySelector('.mes_text').innerHTML = this.format(message.mes, messageId);
        },
        /**
         * @param {string} mes
         * @returns {string}
         */
        format(mes) {
            return mes;
        },
    };
}

/**
 * Write extension settings into a context.
 *
 * @param {any} context
 * @param {object} settings
 * @returns {any} context
 */
export function withSettings(context, settings) {
    context.extensionSettings[STORAGE_KEY] = { version: 1, ...settings };
    return context;
}

/**
 * The default catalogue used across the DOM-path tests: one pack, one enabled
 * globally, three stickers covering the placements.
 *
 * @param {object} [overrides]
 * @returns {object}
 */
export function defaultPacks(overrides = {}) {
    return {
        packs: [
            {
                name: 'daily',
                stickers: [
                    { label: 'happy', image: 'user/images/st-emote/happy.png' },
                    { label: 'sad', image: 'user/images/st-emote/sad.png' },
                    { label: 'big', image: 'user/images/st-emote/big.png', placement: 'after-block' },
                ],
            },
        ],
        enabledPackNames: ['daily'],
        ...overrides,
    };
}

/**
 * Build the message markup SillyTavern produces for one message, with the
 * attributes the DOM path reads its 处理范围 facts from.
 *
 * @param {{mesid?: number, html: string, isUser?: boolean, isSystem?: boolean, type?: string}} spec
 * @returns {string}
 */
export function message(spec) {
    const attributes = [
        `mesid="${spec.mesid ?? 0}"`,
        `is_user="${spec.isUser === true}"`,
        `is_system="${spec.isSystem === true}"`,
        `type="${spec.type ?? ''}"`,
    ].join(' ');
    return `<div class="mes" ${attributes}><div class="mes_text">${spec.html}</div></div>`;
}
