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

import { buildPreview, formatPreview } from '../core/preview.js';
import { logInfo } from './log.js';
import { currentLocale, tr } from './locale.js';
import { effectiveSetForMessage, logRenderResult, renderOptions } from './render-common.js';
import { rerenderChat } from './rendering.js';
import { toast } from './dialogs.js';

/**
 * Mount the debug area's markup into the panel and wire its two controls.
 *
 * The markup is a fixed skeleton with no user data in it, so `innerHTML` is the
 * right tool for it; everything the user types goes in through `textContent` and
 * the preview's own HTML comes out of the core already escaped.
 *
 * @param {any} context
 * @param {HTMLElement} root - The drawer the panel mounted.
 */
export function mountDebugSection(context, root) {
    const section = document.createElement('div');
    section.className = 'st-emote-debug';
    section.innerHTML = [
        '<div class="st-emote-hint"></div>',
        '<textarea class="text_pole" id="st_emote_preview" rows="4"></textarea>',
        '<div class="st-emote-debug-actions">',
        '<div class="menu_button" id="st_emote_preview_run"></div>',
        '<div class="menu_button" id="st_emote_rerender"></div>',
        '</div>',
        '<div class="st-emote-preview-note" id="st_emote_preview_note"></div>',
        '<div class="st-emote-preview" id="st_emote_preview_out"></div>',
    ].join('');

    section.querySelector('.st-emote-hint').textContent = tr(context, 'panel.debugHint');
    const input = section.querySelector('#st_emote_preview');
    input.placeholder = tr(context, 'panel.previewPlaceholder');
    const runButton = section.querySelector('#st_emote_preview_run');
    runButton.textContent = tr(context, 'panel.previewRun');
    section.querySelector('#st_emote_rerender').textContent = tr(context, 'panel.rerender');

    const note = section.querySelector('#st_emote_preview_note');
    const output = section.querySelector('#st_emote_preview_out');

    runButton.addEventListener('click', () => {
        const preview = buildPreview(
            input.value,
            // `-1` is the same message id a streaming preview carries, and it
            // resolves to the selected character's 作用域 — which is what the
            // macro listing and the panel's chat checkboxes are describing, so
            // the preview and the listing agree about what is available.
            effectiveSetForMessage(context, -1),
            renderOptions(context),
        );
        // The same logging the two render paths do, so a miss in the preview and
        // a miss in the chat are indistinguishable in the console.
        logRenderResult(preview);
        output.innerHTML = preview.html;
        // An untouched box says nothing, rather than complaining that there is
        // nothing in it: the user has not asked a question yet.
        note.textContent = input.value.trim() === '' ? '' : formatPreview(preview, currentLocale(context));
    });

    section.querySelector('#st_emote_rerender').addEventListener('click', () => {
        rerenderChat(context);
        toast('success', tr(context, 'panel.rerendered'));
        logInfo('re-rendered the current chat on request');
    });

    return section;
}
