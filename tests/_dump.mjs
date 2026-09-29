import { STORAGE_KEY } from '../adapter/settings.js';
import { fakeFetch, withPanel } from './contract/st-dom.js';

const CATALOGUE = {
    version: 1,
    packs: [
        {
            name: 'zeta',
            stickers: [
                { id: 'z1', label: 'zappy', description: 'a big zap', image: 'user/images/st-emote/st-emote-z1.png' },
            ],
        },
        {
            name: 'daily',
            stickers: [
                { id: 'd1', label: 'happy', description: 'a wide grin', image: 'user/images/st-emote/st-emote-d1.png' },
                { id: 'd2', label: 'sad', description: 'a frown', image: 'user/images/st-emote/st-emote-d2.png' },
                { id: 'd3', label: 'wave', description: 'from a link', image: 'https://example.com/w.gif' },
            ],
        },
        { name: 'blank', stickers: [] },
    ],
    enabledPackNames: ['daily'],
};

function regionOf(el) {
    const pack = el.closest('.st-emote-pack');
    if (pack) {
        const name = pack.querySelector('.st-emote-pack-name')?.value ?? '?';
        const row = el.closest('.st-emote-sticker');
        if (row) {
            const label = row.querySelector('.st-emote-label')?.value;
            return label === undefined
                ? `pack "${name}" / sticker with no label input`
                : `pack "${name}" / sticker "${label}"`;
        }
        if (el.closest('.st-emote-selection')) return `pack "${name}" / selection bar`;
        if (el.closest('.st-emote-scopes')) return `pack "${name}" / 作用域`;
        return `pack "${name}" / header`;
    }
    const set = el.closest('.st-emote-size-set');
    if (set) {
        return `尺寸集 "${set.querySelector('.st-emote-size-set-title').textContent}"`;
    }
    if (el.closest('.st-emote-debug')) return 'debug area';
    return 'settings';
}

function captionOf(el) {
    if (el.classList.contains('menu_button')) {
        return `"${el.textContent}"`;
    }
    const label = el.closest('label');
    if (label) {
        const span = label.querySelector(':scope > span');
        if (span) return `"${span.textContent.trim()}"`;
        const text = [...label.childNodes]
            .filter((node) => node.nodeType === 3)
            .map((node) => node.textContent)
            .join('')
            .trim();
        if (text !== '') return `"${text}"`;
    }
    for (const attribute of ['title', 'placeholder']) {
        const value = el.getAttribute(attribute);
        if (value) return `"${value}"`;
    }
    if (el.value !== '') return `"${el.value}"`;
    return '(no caption)';
}

function detailsOf(el) {
    if (el.getAttribute('type') === 'file') {
        const flags = [el.accept, el.multiple ? 'multiple' : 'single'].filter(Boolean).join(' ');
        return `[${flags}]`;
    }
    if (el.tagName === 'SELECT') {
        const options = [...el.options]
            .map((option) => `${option.value}="${option.textContent}"`)
            .join(' | ');
        return `[${options}]`;
    }
    return '';
}

function controlLine(el) {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') ?? '';
    const classes = [...el.classList].sort();
    const head = `${tag}${type ? `[${type}]` : ''}${el.id ? `#${el.id}` : ''}`
        + `${classes.length ? `.${classes.join('.')}` : ''}`;
    return `${regionOf(el)} :: ${head}${detailsOf(el)} ${captionOf(el)}`;
}

function panelControlSet(document) {
    return [...document.querySelectorAll(
        '#st_emote_drawer input, #st_emote_drawer select, #st_emote_drawer textarea, #st_emote_drawer .menu_button',
    )].map(controlLine).sort();
}

await withPanel(async (harness) => {
    harness.extensionSettings[STORAGE_KEY] = structuredClone(CATALOGUE);
    globalThis.fetch = fakeFetch({
        list: { body: ['st-emote-d1.png', 'st-emote-d2.png', 'st-emote-z1.png'] },
        upload: { body: { path: 'x.png' } },
        remove: { status: 200 },
    });
    globalThis.window.toastr = { success() {}, warning() {}, error() {} };
    const { mountSettingsPanel } = await import('../adapter/ui.js');
    mountSettingsPanel(harness);
    await new Promise((r) => setTimeout(r, 0));
    const lines = panelControlSet(harness.document);
    console.log(lines.map((l) => `    '${l.replace(/'/g, "\\'")}',`).join('\n'));
    console.log('TOTAL', lines.length);
}, {});
