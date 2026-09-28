/**
 * 表情库的读法: how the pack list is ordered and titled, what a pack looks like
 * when it is empty or when its images have not followed it, how the search box
 * narrows things down, and when a rename has invalidated the tokens already
 * written in chats.
 *
 * All of it is presentation and comparison over the same records the renderer
 * uses, with no knowledge of the DOM — which is what makes "a pack with no
 * stickers is fine, it just reads as 空" a rule that can be tested rather than a
 * branch somewhere in a click handler.
 */

import { localImageOf } from './catalogue.js';
import { normalizeLabel, normalizePackName } from './normalize.js';

/** How a pack presents itself in the list. */
export const PACK_STATES = {
    /** Has stickers and all of their local images are present. */
    ok: 'ok',
    /** No stickers at all. Allowed, and shown as 空. */
    empty: 'empty',
    /** Has stickers, but at least one local image file is not on this server. */
    imagesMissing: 'images-missing',
};

/**
 * The pack list order: by name, compared the way a reader compares names rather
 * than the way a string sorts. `Intl.Collator` is what puts `daily` next to
 * `Daily` and keeps accented names with their own letters instead of after `z`.
 * The sort is stable, so two packs that compare equal keep their stored order.
 *
 * @param {object[]} packs
 * @returns {object[]} A new array; the input is not touched.
 */
export function sortPacks(packs) {
    const collator = new Intl.Collator();
    return [...(Array.isArray(packs) ? packs : [])].sort(
        (a, b) => collator.compare(String(a?.name ?? ''), String(b?.name ?? '')),
    );
}

/**
 * The cover image of a pack: the thumbnail of its **first** sticker, which is
 * the first sticker as stored — the same order the panel lists them in, so the
 * cover always matches what the user sees at the top of the pack. The first
 * sticker that actually has a picture is used, so one sticker still waiting for
 * an upload does not leave the whole pack without a cover.
 *
 * @param {{stickers?: object[]}} pack
 * @returns {string} The image reference, or '' when the pack has none.
 */
export function packCoverImage(pack) {
    for (const sticker of Array.isArray(pack?.stickers) ? pack.stickers : []) {
        const image = String(sticker?.image ?? '');
        if (image !== '') {
            return image;
        }
    }
    return '';
}

/**
 * Whether one sticker's image is missing on this server.
 *
 * Only a local file can be checked. A 外链 is reported as present: whether an
 * external address still resolves is not knowable without a network round trip,
 * and the render path already treats a link that fails to load as a 未命中.
 *
 * @param {{image?: string}} sticker
 * @param {(image: string) => boolean} imageExists
 * @returns {boolean}
 */
export function isStickerImageMissing(sticker, imageExists) {
    const image = localImageOf(sticker);
    if (image === '') {
        return false;
    }
    return typeof imageExists === 'function' ? !imageExists(image) : false;
}

/**
 * How one pack presents itself. A pack with no stickers is legal and reads as
 * 空 — that is the state a character card's "missing pack" placeholder is
 * created in. A pack whose images did not travel with the settings reads as
 * `images-missing`, which the panel greys out; it stays enableable all the
 * same, because the user is expected to point the stickers at pictures again.
 *
 * @param {{stickers?: object[]}} pack
 * @param {(image: string) => boolean} [imageExists] - Whether a local image
 *   file is present on this server. Omitted when the caller has no listing, in
 *   which case no pack is reported as missing.
 * @returns {string} One of `PACK_STATES`.
 */
export function packState(pack, imageExists) {
    const stickers = Array.isArray(pack?.stickers) ? pack.stickers : [];
    if (stickers.length === 0) {
        return PACK_STATES.empty;
    }
    if (stickers.some((sticker) => isStickerImageMissing(sticker, imageExists))) {
        return PACK_STATES.imagesMissing;
    }
    return PACK_STATES.ok;
}

/**
 * Fold a string for searching: lower case, with every run of whitespace turned
 * into a single space and trimmed, so a search for `big  smile` finds
 * `Big Smile`. The same folding the label comparison already uses, which is why
 * it is spelled the same way.
 *
 * @param {unknown} text
 * @returns {string}
 */
export function searchText(text) {
    return normalizeLabel(text);
}

/**
 * Whether one sticker matches a search query, by label **or** by description —
 * the description is the longer text, so it is what makes two similar-looking
 * stickers tellable apart, and searching only the label would waste it.
 *
 * An empty query matches everything, so the panel can hand the result straight
 * to its renderer without special-casing "no search yet".
 *
 * @param {{label?: string, description?: string}} sticker
 * @param {unknown} query
 * @returns {boolean}
 */
export function matchesQuery(sticker, query) {
    const needle = searchText(query);
    if (needle === '') {
        return true;
    }
    return searchText(sticker?.label).includes(needle)
        || searchText(sticker?.description).includes(needle);
}

/**
 * @typedef {{pack: object, stickers: object[]}} LibraryEntry
 */

/**
 * Narrow a pack list to the stickers matching a query.
 *
 * A pack survives a *search* when at least one of its stickers matches, and it
 * comes back carrying only the matching stickers — so the panel shows what was
 * found rather than the whole pack with most of it greyed. **Without a query
 * every pack survives, an empty one included**: a pack with no stickers is a
 * legal thing to have (it is what a card's "missing pack" placeholder looks
 * like), and the list has to be able to show it as 空.
 *
 * The **pack record is the caller's own object, not a copy**, while the sticker
 * list is a filtered view. That asymmetry is the point: the panel renders the
 * stickers it was handed and edits the pack it was handed, and a filtered copy
 * of the pack would quietly send every edit to a record nothing else can see.
 *
 * @param {object[]} packs
 * @param {unknown} query
 * @returns {LibraryEntry[]}
 */
export function searchLibrary(packs, query) {
    const list = Array.isArray(packs) ? packs : [];
    const searching = searchText(query) !== '';
    const entries = [];
    for (const pack of list) {
        const stickers = Array.isArray(pack?.stickers) ? pack.stickers : [];
        const matching = searching
            ? stickers.filter((sticker) => matchesQuery(sticker, query))
            : [...stickers];
        if (matching.length > 0 || !searching) {
            entries.push({ pack, stickers: matching });
        }
    }
    return entries;
}

/**
 * Whether a rename invalidates the tokens already written in chats.
 *
 * The answer is "yes unless the new name means exactly what the old one did" —
 * so a change of case or of surrounding whitespace, which normalises away, does
 * not cost the user a search-and-replace across their chats. Anything that
 * changes the normalised form does, including a rename to a *different* name
 * that some token happens to spell.
 *
 * @param {unknown} previous
 * @param {unknown} next
 * @param {(value: unknown) => string} [normalize] - The comparison form; the
 *   label one by default, the pack-name one for pack renames.
 * @returns {boolean}
 */
export function renameBreaksTokens(previous, next, normalize = normalizeLabel) {
    return normalize(previous) !== normalize(next);
}

/**
 * `renameBreaksTokens` for a pack name.
 *
 * @param {unknown} previous
 * @param {unknown} next
 * @returns {boolean}
 */
export function packRenameBreaksTokens(previous, next) {
    return renameBreaksTokens(previous, next, normalizePackName);
}
