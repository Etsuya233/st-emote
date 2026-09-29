/**
 * The sticker editor: one 表情's fields, in a layer over the panel.
 *
 * **Why this is not `callGenericPopup`.** `adapter/dialogs.js` already uses the
 * client's popup for the two things it can take — a confirmation and a line of
 * text — and it takes them as `POPUP_TYPE.CONFIRM` / `INPUT`, which render a
 * plain message and a plain field. This dialog needs a 标签 field, a 描述 field, a
 * 投放方式 select and three buttons in one box, and none of that goes through a
 * message string. So the layer is built here, once, and every future field a
 * sticker grows is another line in `buildEditorBody` rather than another attempt
 * to make a text popup carry a form.
 *
 * **It hangs off `document.body`, not off the panel.** The panel lives inside
 * the client's `.drawer-content`, which scrolls under a `max-height` and carries
 * a `backdrop-filter` — and a `backdrop-filter` makes that element the
 * containing block for fixed descendants, so a layer mounted there is laid out
 * against the drawer and clipped by it. A dialog half off the screen is worse
 * than no dialog. The layer is `position: fixed` and full viewport, with the
 * card centred inside it and `width: min(22em, 100%)`, so it fits a 300px
 * sidebar as well as a wide window. The second price of being a child of `body`
 * is that it competes in the root stacking context with `#top-settings-holder` —
 * the extensions drawer hangs off that, and it is `z-index: 3005`, 4005 while a
 * drawer is open — so the layer's `z-index` has to be above that. `style.css`
 * says where the number comes from.
 *
 * **Only one is open at a time, and the panel list never knows about it.** The
 * list is rebuilt from scratch on every change (`renderPackList`), so an editor
 * that lived inside a row would be destroyed by a rename in another row. Being
 * outside the list also means collapsing a pack does not throw away what the user
 * is typing — which is the one thing a dialog closing on its own always gets
 * wrong.
 */

import { iconButton } from './buttons.js';
import { validateDescription } from '../core/constraints.js';
import { acceptedImageTypes, isExternalImageUrl } from '../core/image-rules.js';
import { t } from '../core/i18n.js';
import { renameBreaksTokens } from '../core/library.js';
import { normalizeLabel } from '../core/normalize.js';
import { toast } from './dialogs.js';
import { checkLabel, constraintMessage } from './field-checks.js';
import { buildStickerPlacementSelect } from './sizing-panel.js';

/** The file dialog's filter, derived from the rules rather than written out. */
const ACCEPTED_MIME = acceptedImageTypes();

/**
 * The dialog currently on screen, if any. Module state so a second click on a
 * cell replaces the open editor instead of stacking a second copy of the same
 * form on top of the first.
 *
 * @type {(() => void)|null}
 */
let closeCurrent = null;

/**
 * Close whatever editor is open, whatever opened it.
 *
 * Exported rather than left to the DOM because a second click on a cell has to
 * *move* the editor rather than stack another copy, and because a test needs to
 * put the page back the way it found it without reaching into the DOM for the
 * layer.
 */
export function closeStickerEditor() {
    if (closeCurrent !== null) {
        closeCurrent();
    }
}

/**
 * Open the editor for one 表情.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {import('./settings.js').StickerRecord} sticker
 * @param {object} actions
 * @param {() => void} actions.refresh - Repaint the pack list under the layer.
 * @param {(file: File) => void|Promise<void>} actions.replace - Point this
 *   sticker at a new image, keeping its 标签 and 描述.
 * @param {() => void|Promise<void>} actions.remove - Delete this sticker, after
 *   asking. The layer closes itself first, because the thing it is about no longer
 *   exists.
 * @param {boolean} [actions.searching] - True while a search is narrowing the
 *   list, which is the one state where the delete button is withheld.
 */
export function openStickerEditor(context, pack, sticker, actions) {
    closeStickerEditor();

    const layer = document.createElement('div');
    layer.className = 'st-emote-editor';
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-modal', 'true');
    // The dialog's name is the sticker itself, so a screen reader announces
    // which of thirty stickers just opened rather than "dialog".
    layer.setAttribute(
        'aria-label',
        normalizeLabel(sticker.label) ? sticker.label : t('sticker.unlabeled'),
    );

    const backdrop = document.createElement('div');
    backdrop.className = 'st-emote-editor-backdrop';

    const card = document.createElement('div');
    card.className = 'st-emote-editor-card';

    const head = document.createElement('div');
    head.className = 'st-emote-editor-head';
    head.append(buildEditorPreview(sticker), buildEditorHeading(sticker));

    const closeButton = iconButton('closeEditor', t('sticker.closeEditor'), 'st-emote-editor-close');
    closeButton.addEventListener('click', () => close());
    head.append(closeButton);

    card.append(head, buildEditorBody(context, pack, sticker, actions));
    layer.append(backdrop, card);

    const onKeyDown = (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    };
    // On the layer rather than on `document`, so Esc inside the panel's own
    // fields does not close the dialog, and so the listener goes away with it.
    layer.addEventListener('keydown', onKeyDown);
    backdrop.addEventListener('click', () => close());

    document.body.append(layer);
    layer.querySelector('.st-emote-label')?.focus();

    let closed = false;
    function close() {
        if (closed) {
            return;
        }
        closed = true;
        closeCurrent = null;
        // A repaint only means something while the layer is still on the page.
        // Skipping it once the layer is gone is what stops a stale editor from
        // repainting whatever panel happens to be mounted now — which is exactly
        // the shape of a stale `close()` reaching a new context.
        const onScreen = layer.isConnected;
        layer.remove();
        if (onScreen) {
            actions.refresh();
        }
    }
    closeCurrent = close;
}

/**
 * The larger picture at the top of the dialog.
 *
 * **A missing image is drawn as an empty dashed box rather than hidden.** The
 * reason the user opened the editor is very often that a sticker is not drawing,
 * and a dialog that quietly omits the picture is a dialog that answers a
 * different question than the one being asked.
 *
 * @param {import('./settings.js').StickerRecord} sticker
 * @returns {Element}
 */
function buildEditorPreview(sticker) {
    const frame = document.createElement('div');
    frame.className = 'st-emote-editor-preview';
    if (sticker.image === '') {
        frame.classList.add('st-emote-editor-preview-empty');
        return frame;
    }
    const picture = document.createElement('img');
    picture.className = 'st-emote-editor-image';
    picture.alt = '';
    picture.src = sticker.image;
    picture.addEventListener('error', () => {
        frame.classList.add('st-emote-editor-preview-empty');
        picture.remove();
    });
    frame.append(picture);
    return frame;
}

/**
 * The sticker's 标签 as the dialog's own title, with the two facts that used to
 * be badges beside it.
 *
 * The badges are text here and corner marks in the grid, for the same reason the
 * label is a heading here and a caption there: this is the one screen where there
 * is room to say a word, and the grid is the one screen where there is not.
 *
 * @param {import('./settings.js').StickerRecord} sticker
 * @returns {Element}
 */
function buildEditorHeading(sticker) {
    const heading = document.createElement('div');
    heading.className = 'st-emote-editor-heading';

    const name = document.createElement('div');
    name.className = 'st-emote-editor-name';
    name.textContent = normalizeLabel(sticker.label) ? sticker.label : t('sticker.unlabeled');
    heading.append(name);

    if (isExternalImageUrl(sticker.image)) {
        heading.append(editorBadge(t('sticker.external'), 'st-emote-badge-external', t('sticker.externalTitle')));
    }
    if (sticker.image === '') {
        heading.append(editorBadge(t('sticker.unlabeled')));
    }
    return heading;
}

/**
 * The fields and the actions: everything one sticker is, in one box.
 *
 * **The order is the one the panel has always used** — 标签, 描述, 投放方式,
 * 替换, 删除 — because a reflow that silently reorders what Tab reaches is the
 * kind of thing nobody notices until it annoys them daily. Moving the 标签 out of
 * the list and into a dialog changes where it is, not what order it is in.
 *
 * @param {any} context
 * @param {import('./settings.js').PackRecord} pack
 * @param {import('./settings.js').StickerRecord} sticker
 * @param {{refresh: () => void, replace: Function, remove: Function}} actions
 * @returns {Element}
 */
function buildEditorBody(context, pack, sticker, actions) {
    const body = document.createElement('div');
    body.className = 'st-emote-editor-body';

    const label = document.createElement('input');
    label.type = 'text';
    label.className = 'text_pole st-emote-label';
    label.placeholder = t('sticker.labelPlaceholder');
    label.value = sticker.label;
    label.addEventListener('change', () => {
        const previousLabel = sticker.label;
        const check = checkLabel(pack, label.value, sticker);
        if (!check.ok) {
            toast('warning', check.message);
            label.value = sticker.label;
            return;
        }
        sticker.label = check.value;
        actions.refresh();
        // The same warning a pack rename gets, and gated on the same predicate: a
        // change that normalises away costs no tokens, a real one invalidates every
        // token already written in a chat.
        if (renameBreaksTokens(previousLabel, check.value)) {
            toast('warning', t('sticker.renamed', { name: check.value }));
        }
    });
    body.append(label);

    const description = document.createElement('input');
    description.type = 'text';
    description.className = 'text_pole st-emote-description';
    // The spec's "an empty description shows as an em dash", and an em dash reads
    // the same in every language this catalog ships.
    description.placeholder = '—';
    description.value = sticker.description ?? '';
    description.addEventListener('change', () => {
        const result = validateDescription(description.value);
        if (!result.ok) {
            toast('warning', constraintMessage('description', result.reason));
            description.value = sticker.description ?? '';
            return;
        }
        sticker.description = result.value;
        actions.refresh();
    });
    body.append(description);

    body.append(buildStickerPlacementSelect(context, sticker, () => actions.refresh()));

    const row = document.createElement('div');
    row.className = 'st-emote-actions';
    row.append(replacePicker(sticker, actions));
    if (actions.searching !== true) {
        const remove = iconButton('deleteSticker', t('sticker.delete'), 'st-emote-sticker-delete');
        remove.addEventListener('click', async () => {
            await actions.remove();
        });
        row.append(remove);
    }
    body.append(row);

    return body;
}

/**
 * The "replace the picture" control, which is a button that opens a file dialog
 * rather than a `<input type=file>` a user clicks directly.
 *
 * @param {import('./settings.js').StickerRecord} sticker
 * @param {{replace: Function}} actions
 * @returns {Element}
 */
function replacePicker(sticker, actions) {
    const wrapper = document.createElement('span');
    wrapper.className = 'st-emote-action';

    const button = iconButton('replaceImage', t('sticker.replace'), 'st-emote-replace');
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = ACCEPTED_MIME;
    picker.style.display = 'none';
    picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        // Cleared before the work starts, so picking the same file twice in a row
        // still fires a change event.
        picker.value = '';
        if (file) {
            await actions.replace(file);
        }
    });
    button.addEventListener('click', () => picker.click());
    wrapper.append(button, picker);
    return wrapper;
}

/**
 * @param {string} text
 * @param {string} [className]
 * @param {string} [title]
 * @returns {Element}
 */
function editorBadge(text, className = '', title = '') {
    const element = document.createElement('span');
    element.className = `st-emote-badge ${className}`.trim();
    element.textContent = text;
    if (title !== '') {
        element.title = title;
    }
    return element;
}
