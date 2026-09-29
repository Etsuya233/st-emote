/**
 * The panel's action buttons: a glyph, and the sentence that button used to
 * carry as its text.
 *
 * **Icons cost the label, so the label moves rather than goes.** Every
 * icon-only button here takes a localized sentence and puts it in *both* the
 * `title` (the hover tooltip) and the `aria-label` (what a screen reader
 * announces). A catalog key is not deleted by this — the sentence a button used
 * to paint is the sentence its tooltip now paints, in both languages.
 *
 * **The class strings live in one table and nowhere else.** Font Awesome looks
 * its glyphs up by name and a name it does not have renders as *nothing*: no
 * error, no fallback, just a gap where the button's meaning was. A name that is
 * in Font Awesome Pro but not in the free set is exactly that failure, so the
 * table is the one place a new action's name gets checked, and
 * `tests/panel.test.js` holds two lines over it — every entry is drawn by some
 * button (an entry nothing draws is a dead name waiting for a button that no
 * longer exists) and every glyph on the panel comes from this table (a class
 * typed inline somewhere else is a name nobody checked).
 *
 * The names below were read out of the Font Awesome Free stylesheet the client
 * ships (`public/css/fontawesome.min.css`, 6.5.2), not from memory.
 */

/**
 * Every action in the panel, as a semantic name and the classes that draw it.
 *
 * Deliberately **not** one icon per sentence: `删除表情包` and `删除选中的` are both
 * a bin, so they are told apart by the bin rather than by the wording — a
 * toolbar of fourteen different glyphs is harder to scan than a toolbar of four
 * shapes used consistently.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const ACTION_ICONS = {
    // ── the panel's own actions ────────────────────────────────────────────
    createPack: 'fa-solid fa-plus',
    importPack: 'fa-solid fa-file-import',
    copyRegex: 'fa-solid fa-copy',
    createMissingPacks: 'fa-solid fa-folder-plus',
    // ── the tools ──────────────────────────────────────────────────────────
    previewRun: 'fa-solid fa-play',
    rerender: 'fa-solid fa-rotate-right',
    // ── one pack in the list ───────────────────────────────────────────────
    uploadImages: 'fa-solid fa-upload',
    addImageUrl: 'fa-solid fa-link',
    exportZip: 'fa-solid fa-file-zipper',
    deletePack: 'fa-solid fa-trash-can',
    deleteSelected: 'fa-solid fa-trash-arrow-up',
    // ── one 表情 in a pack ──────────────────────────────────────────────────
    replaceImage: 'fa-solid fa-file-image',
    deleteSticker: 'fa-solid fa-trash',
};

/**
 * The glyph itself, for a caller that wants an icon somewhere other than on a
 * button.
 *
 * `aria-hidden` because the sentence belongs to the control the glyph sits in,
 * and a screen reader reading the glyph's own name would say the action twice.
 *
 * @param {string} icon - A key of `ACTION_ICONS`.
 * @returns {HTMLElement}
 */
function actionIcon(icon) {
    const glyph = document.createElement('i');
    // An unknown key leaves the key itself in the class list, which is loud
    // rather than silent: `tests/panel.test.js` checks every glyph on the panel
    // against this table, and a name Font Awesome has never heard of is exactly
    // the failure this module exists to prevent.
    glyph.className = `${ACTION_ICONS[icon]} st-emote-icon`;
    glyph.setAttribute('aria-hidden', 'true');
    return glyph;
}

/**
 * A small labelled button, the shape almost every action in a pack row uses.
 *
 * `st-emote-button` goes on every one of them and is the single rule that keeps
 * the panel's buttons alike; `st-emote-icon-button` is the second half, the one
 * that sizes and centres a glyph. One hook means the pack header, a sticker row
 * and the debug area cannot drift apart, and a button added later is covered
 * without being told about it.
 *
 * @param {string} icon - A key of `ACTION_ICONS`.
 * @param {string} label - The localized sentence, used as the tooltip and the
 *   screen-reader name.
 * @param {string} [className] - The caller's own query hook, e.g.
 *   `st-emote-export`.
 * @returns {HTMLDivElement}
 */
export function iconButton(icon, label, className = '') {
    const button = document.createElement('div');
    button.className = `menu_button st-emote-button st-emote-icon-button ${className}`.trim();
    return applyIcon(button, icon, label);
}

/**
 * The same treatment for a button the panel's fixed skeleton already put on the
 * page. The three top-level actions keep their ids — a listener finds them by
 * id, and so does the control-surface test — so they cannot simply be built
 * here instead.
 *
 * @param {Element} button
 * @param {string} icon - A key of `ACTION_ICONS`.
 * @param {string} label - The localized sentence.
 * @returns {Element} The same button.
 */
export function iconize(button, icon, label) {
    button.classList.add('st-emote-icon-button');
    return applyIcon(button, icon, label);
}

/**
 * A button that opens a file dialog and hands the chosen files to `onFiles`.
 *
 * @param {string} icon - A key of `ACTION_ICONS`.
 * @param {string} label - The localized sentence.
 * @param {{accept?: string, multiple?: boolean, className?: string}} options
 * @param {(files: File[]) => void|Promise<void>} onFiles
 * @returns {Element}
 */
export function filePickerButton(icon, label, options, onFiles) {
    const button = iconButton(icon, label, options.className);
    const input = document.createElement('input');
    input.type = 'file';
    if (options.accept) {
        input.accept = options.accept;
    }
    input.multiple = options.multiple === true;
    input.style.display = 'none';
    input.addEventListener('change', async () => {
        const files = Array.from(input.files ?? []);
        // Cleared before the work starts, so picking the same file twice in a
        // row still fires a change event.
        input.value = '';
        if (files.length > 0) {
            await onFiles(files);
        }
    });
    button.addEventListener('click', () => input.click());

    const wrapper = document.createElement('span');
    wrapper.className = 'st-emote-action';
    wrapper.append(button, input);
    return wrapper;
}

/**
 * @param {Element} button
 * @param {string} icon
 * @param {string} label
 * @returns {Element}
 */
function applyIcon(button, icon, label) {
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(actionIcon(icon));
    return button;
}
