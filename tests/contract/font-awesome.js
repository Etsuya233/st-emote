/**
 * The Font Awesome names this panel is allowed to use, as recorded evidence.
 *
 * **Why this file exists.** Font Awesome resolves a glyph by class name and
 * draws *nothing* for a name it does not have: no error, no fallback, no broken
 * image, nothing in the DOM that says the name was wrong. A button whose icon is
 * Pro-only therefore looks exactly like a button whose icon is fine, and every
 * other test in this suite reports it as a pass. The only thing that catches it
 * is checking the name against the real font, and the real font lives in a
 * SillyTavern checkout — machine-local, not part of this repository, and not
 * something `npm test` may depend on.
 *
 * **What was checked, and how.** For each name below: the client stylesheet
 * (`public/css/fontawesome.min.css`) maps it to a codepoint, and the client's
 * **free solid webfont** (`public/webfonts/fa-solid-900.ttf`) contains that
 * codepoint. Both halves are needed. The stylesheet alone is not enough — the
 * one the client serves also carries class names whose glyphs ship only with a
 * Pro licence, and a name that resolves there still renders as a blank. The
 * font's `cmap` table is the half that decides what is actually drawable.
 *
 * **The version is recorded because the free set grows.** A name added in a
 * later Font Awesome release would be missing here and fail this suite, which
 * is the right way round: it fails and asks for the record to be regenerated,
 * rather than passing on a client that is older than the name.
 *
 * Regenerating is one command against a checkout — see `common_dev.md`. It is a
 * deliberate act, because every name in the new record has been checked against
 * a font again rather than assumed.
 */

/** The Font Awesome Free release these names were read out of. */
export const RECORDED_FONT_AWESOME_VERSION = '6.5.2';

/**
 * Every icon name the panel may use, with the codepoint each one resolved to.
 *
 * Keyed by the semantic name in `ACTION_ICONS`, so a test can say "this button
 * is allowed to draw this" without a second table of strings to keep in step.
 * `fa-solid` is the family and is not here: it selects the font rather than a
 * glyph, and the font is the free one by construction.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const FREE_ICON_CODEPOINTS = {
    // ── the panel's own actions ────────────────────────────────────────────
    createPack: 0x0002b, // fa-plus
    importPack: 0x0f56f, // fa-file-import
    copyRegex: 0x0f0c5, // fa-copy
    createMissingPacks: 0x0f65e, // fa-folder-plus
    // ── the tools ──────────────────────────────────────────────────────────
    previewRun: 0x0f04b, // fa-play
    rerender: 0x0f2f9, // fa-rotate-right
    // ── one pack in the list ───────────────────────────────────────────────
    uploadImages: 0x0f093, // fa-upload
    addImageUrl: 0x0f0c1, // fa-link
    exportZip: 0x0f1c6, // fa-file-zipper
    deletePack: 0x0f2ed, // fa-trash-can
    deleteSelected: 0x0f829, // fa-trash-arrow-up
    // ── one 表情 in a pack ──────────────────────────────────────────────────
    replaceImage: 0x0f1c5, // fa-file-image
    deleteSticker: 0x0f1f8, // fa-trash
    // ── the client's own collapsible headers ───────────────────────────────
    sectionChevronDown: 0x0f13a, // fa-circle-chevron-down
    sectionChevronUp: 0x0f139, // fa-circle-chevron-up
};

/**
 * The class names of the glyphs above, in the panel's own order — the two
 * halves of the same fact, and a test compares them so a class string typed into
 * `ACTION_ICONS` by hand has to agree with the recorded evidence.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const FREE_ICON_CLASSES = {
    createPack: 'fa-plus',
    importPack: 'fa-file-import',
    copyRegex: 'fa-copy',
    createMissingPacks: 'fa-folder-plus',
    previewRun: 'fa-play',
    rerender: 'fa-rotate-right',
    uploadImages: 'fa-upload',
    addImageUrl: 'fa-link',
    exportZip: 'fa-file-zipper',
    deletePack: 'fa-trash-can',
    deleteSelected: 'fa-trash-arrow-up',
    replaceImage: 'fa-file-image',
    deleteSticker: 'fa-trash',
    sectionChevronDown: 'fa-circle-chevron-down',
    sectionChevronUp: 'fa-circle-chevron-up',
};
