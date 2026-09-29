/**
 * The debug area: paste a message, see it rendered, without touching the chat.
 *
 * This is the tool for the thing a settings panel otherwise makes hard — a
 * sticker that renders wrong, a size that is not doing what the field says, a
 * 生效集 that is not what the checkboxes suggest — and the whole reason it works
 * is that it changes nothing. It writes no message, saves no settings and never
 * asks the client to re-render a block; the preview is the pure core handed a
 * string (`core/preview.js`) and the panel does nothing but drop the HTML into a
 * box.
 *
 * The misses and the ignored size values go to the **console** behind the shared
 * prefix, like every other log this extension writes. The spec rules out a log
 * panel, and the one line under the preview is a summary of what did not render
 * rather than a place to read logs — a user who needs the detail opens the
 * console, which is where it was always going to be.
 */

import { escapeText } from '../core/escape.js';
import { t } from '../core/i18n.js';
import { buildPreview, formatPreview } from '../core/preview.js';
import { iconize } from './buttons.js';
import { collapsibleSection } from './collapsible.js';
import { toast } from './dialogs.js';
import { useClientLocale } from './locale.js';
import { logInfo } from './log.js';
import { effectiveSetForMessage, logRenderResult, renderOptions } from './render-common.js';
import { rerenderChat } from './rendering.js';

/**
 * How the client turns raw message text into the HTML the renderer sees, when it
 * is willing to say.
 *
 * SillyTavern runs every message through showdown before anything else looks at
 * it, and *that* step is what decides whether a token written inside a code fence
 * renders. The client exposes the very same library it built its own converter
 * from (`SillyTavern.libs.showdown`), so the preview can use it instead of
 * guessing — and add no dependency of its own, which is the rule `archive.js`
 * follows for JSZip.
 *
 * **The options are this extension's, not the client's.** The client configures
 * its own converter for its own purposes and does not publish that
 * configuration, so what follows is the smallest set that decides the cases the
 * spec's 解析边界 list actually names: fences, so a token inside one is skipped,
 * and tables, so a 块后 image lands inside its cell — which the spec calls out as
 * a deliberate deviation. Everything else is showdown's default. That makes the
 * preview *very nearly* what the chat produces rather than provably identical to
 * it, and the panel's hint says so instead of overclaiming.
 *
 * A client with no `showdown` on `libs` gets the plain-text floor instead, and
 * the console says which of the two is in play. `escapeText` is the right floor
 * and not merely a safe one: it is also what keeps the debug box safe, since the
 * preview's HTML is the one place this extension writes rendered markup into the
 * panel.
 *
 * @returns {(text: string) => string}
 */
function messageBodyPreparer() {
    const showdown = globalThis.SillyTavern?.libs?.showdown;
    if (typeof showdown?.Converter !== 'function') {
        logInfo('no markdown converter on the client; the debug box treats a paste as plain text');
        return escapeText;
    }
    const converter = new showdown.Converter({
        fencedCodeBlocks: true,
        tables: true,
        // No `simpleLineBreaks`: the client's messages are paragraphs, and a
        // single newline in a model's output is not a line break worth previewing
        // differently from the chat.
        simpleLineBreaks: false,
    });
    return (text) => converter.makeHtml(text);
}

/**
 * Mount the debug area's markup into the panel and wire its two controls.
 *
 * The markup is a fixed skeleton with no user data in it, so `innerHTML` is the
 * right tool for it; everything the user types goes in through `textContent` and
 * the preview's own HTML comes out of the core.
 *
 * @param {any} context
 * @param {HTMLElement} root - The drawer the panel mounted.
 */
export function mountDebugSection(context, root) {
    useClientLocale(context);
    // The whole tool is a collapsed section: it is something to reach for when
    // something renders wrong, not a set of settings, and left open it is four
    // rows of panel in the middle of the things a user came to change. Its two
    // controls are icons like every other action, and the preview box is where
    // the reason it is collapsed is paid off — the user opened it to look.
    const drawer = collapsibleSection({ title: t('panel.debugTitle'), className: 'st-emote-debug' });
    const section = document.createElement('div');
    section.className = 'st-emote-debug-body';
    section.innerHTML = [
        '<div class="st-emote-hint"></div>',
        '<textarea class="text_pole" id="st_emote_preview" rows="4"></textarea>',
        '<div class="st-emote-debug-actions">',
        '<div class="menu_button st-emote-button" id="st_emote_preview_run"></div>',
        '</div>',
        '<div class="st-emote-preview-note" id="st_emote_preview_note"></div>',
        '<div class="st-emote-preview" id="st_emote_preview_out"></div>',
        // **The re-render button is below the preview, on its own, under a
        // hairline** — because it is not part of the preview. `Render` reads the
        // box above it; `Re-render` repaints the whole chat, which is not on this
        // panel at all. Side by side in one button row the two read as one
        // action with two labels, and the one that repaints the user's chat is
        // the one that should never be the one you press by mistake.
        '<div class="st-emote-debug-repaint">',
        '<div class="menu_button st-emote-button" id="st_emote_rerender"></div>',
        '<span class="st-emote-debug-repaint-label" id="st_emote_rerender_label"></span>',
        '</div>',
    ].join('');

    section.querySelector('.st-emote-hint').textContent = t('panel.debugHint');
    const input = section.querySelector('#st_emote_preview');
    input.placeholder = t('panel.previewPlaceholder');
    // The caption is the button's own `title` sentence, shown rather than
    // hovered. A lone glyph in a lone row has nothing to be read against, and a
    // chat-wide repaint is the one control here worth naming outright.
    section.querySelector('#st_emote_rerender_label').textContent = t('panel.rerender');
    const runButton = iconize(
        section.querySelector('#st_emote_preview_run'),
        'previewRun',
        t('panel.previewRun'),
    );
    iconize(section.querySelector('#st_emote_rerender'), 'rerender', t('panel.rerender'));

    const note = section.querySelector('#st_emote_preview_note');
    const output = section.querySelector('#st_emote_preview_out');
    const toMessageBody = messageBodyPreparer();

    runButton.addEventListener('click', () => {
        const preview = buildPreview(
            input.value,
            // `-1` is the same message id a streaming preview carries, and it
            // resolves to the selected character's 作用域 — which is what the
            // macro listing and the panel's chat checkboxes are describing, so
            // the preview and the listing agree about what is available.
            effectiveSetForMessage(context, -1),
            renderOptions(context),
            toMessageBody,
        );
        // The same logging the two render paths do, so a miss in the preview and
        // a miss in the chat are indistinguishable in the console.
        logRenderResult(preview);
        output.innerHTML = preview.html;
        // An untouched box says nothing, rather than complaining that there is
        // nothing in it: the user has not asked a question yet.
        note.textContent = input.value.trim() === '' ? '' : formatPreview(preview);
    });

    section.querySelector('#st_emote_rerender').addEventListener('click', () => {
        const repainted = rerenderChat(context);
        toast('success', t('panel.rerendered'));
        logInfo(`repainted the current chat on request (${repainted} message(s))`);
    });

    drawer.content.append(section);
    return drawer.section;
}
