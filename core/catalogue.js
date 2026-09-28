/**
 * 表情包与表情的生命周期操作: replace an image, delete one or many stickers,
 * delete a whole pack.
 *
 * These are pure data edits, and the only thing about them that is a *rule*
 * rather than bookkeeping is which image files may be deleted. Images live in a
 * directory shared with other features (ADR-0003), so every path handed back for
 * deletion is filtered through `isOwnImagePath` — the caller cannot forget that
 * check, and cannot accidentally be talked into skipping it.
 *
 * The adapter's only remaining job is to call the delete endpoint for each
 * returned path.
 */

import { isExternalImageUrl, isOwnImagePath } from './image-rules.js';

/**
 * The image a sticker owns locally, or '' when it has none or is a 外链. A
 * replacement may only overwrite a local image; an external one is replaced by
 * giving the sticker a different address, never by writing over a URL.
 *
 * @param {{image?: string}|null|undefined} sticker
 * @returns {string}
 */
export function localImageOf(sticker) {
    const image = String(sticker?.image ?? '');
    if (image === '' || isExternalImageUrl(image)) {
        return '';
    }
    return image;
}

/**
 * Point a sticker at a new image, keeping its 标签 and 描述. Only the image is
 * touched, so replacing the picture of a mis-picked file never costs the label
 * the model already uses.
 *
 * The previous file comes back so the caller can delete it — **except when it is
 * the file that was just written**. SillyTavern's upload endpoint strips the
 * extension off the requested name and re-appends the format's, so replacing a
 * png with another png lands on the same path, and deleting "the old file" would
 * delete the new image and leave the sticker pointing at nothing. The guard is
 * here rather than at the call site because "never delete the image you just
 * stored" is a rule about the pair of operations, and it is the one place both
 * halves are visible.
 *
 * @param {{image?: string}} sticker
 * @param {string} nextImage
 * @returns {string} The previous local file, safe to delete. Empty when there
 *   was nothing to delete: a new sticker, a 外链, or the same file.
 */
export function replaceStickerImage(sticker, nextImage) {
    const previous = localImageOf(sticker);
    sticker.image = String(nextImage ?? '');
    return previous === sticker.image ? '' : previous;
}

/**
 * Every image file a set of stickers owns, deduplicated, filtered down to the
 * files this extension wrote. Deduplicated because two stickers may only ever
 * hold the same path if something is already wrong, and deleting a file twice
 * is an error the server would answer with a 404.
 *
 * @param {Iterable<{image?: string}>} stickers
 * @returns {string[]}
 */
export function ownImageFilesOf(stickers) {
    const files = [];
    const seen = new Set();
    for (const sticker of stickers ?? []) {
        const image = localImageOf(sticker);
        if (image === '' || !isOwnImagePath(image) || seen.has(image)) {
            continue;
        }
        seen.add(image);
        files.push(image);
    }
    return files;
}

/**
 * @typedef {{stickers: object[], files: string[]}} RemovalResult
 */

/**
 * Delete stickers from a pack, by object identity — the panel already holds the
 * records, and identity cannot be confused the way a re-read label can. Every
 * image they owned comes back so the caller can delete the files.
 *
 * @param {{stickers: object[]}} pack
 * @param {Iterable<object>} targets
 * @returns {RemovalResult}
 */
export function removeStickers(pack, targets) {
    const doomed = new Set(targets ?? []);
    const stickers = Array.isArray(pack?.stickers) ? pack.stickers : [];
    const removed = stickers.filter((sticker) => doomed.has(sticker));
    pack.stickers = stickers.filter((sticker) => !doomed.has(sticker));
    return { stickers: removed, files: ownImageFilesOf(removed) };
}

/**
 * Take a pack out of the catalogue and report the image files that went with
 * it. Removing a pack is the one deletion that takes the pack's name out of
 * every scope too, so nothing is left pointing at a pack that no longer exists.
 *
 * The scope lists are handed in rather than reached for, because the global,
 * character and chat scopes are stored in three different places by the client
 * and only the adapter knows how to write two of them.
 *
 * @param {{packs: object[], enabledPackNames: string[]}} settings
 * @param {{name: string, stickers: object[]}} pack
 * @param {{global?: string[], character?: string[], chat?: string[]}} [scopes]
 * @returns {{pack: object, files: string[], global: string[], character: string[], chat: string[]}}
 */
export function removePack(settings, pack, scopes = {}) {
    const name = pack?.name;
    const packs = Array.isArray(settings?.packs) ? settings.packs : [];
    settings.packs = packs.filter((item) => item !== pack);
    settings.enabledPackNames = withoutPack(
        Array.isArray(settings?.enabledPackNames) ? settings.enabledPackNames : [],
        name,
    );
    return {
        pack,
        files: ownImageFilesOf(pack?.stickers ?? []),
        global: settings.enabledPackNames,
        character: withoutPack(scopes.character, name),
        chat: withoutPack(scopes.chat, name),
    };
}

/**
 * Put an imported pack into the catalogue. Imported packs start **disabled**,
 * and the only way this module can express that is by touching nothing: no
 * scope is read or written here, so the pack cannot sneak into the global scope
 * (or any other) by being added to the catalogue.
 *
 * @param {{packs: object[]}} settings
 * @param {{name: string, stickers: object[]}} pack
 * @returns {object} The pack, now in `settings.packs`.
 */
export function addImportedPack(settings, pack) {
    if (!Array.isArray(settings?.packs)) {
        settings.packs = [];
    }
    settings.packs.push(pack);
    return pack;
}

/**
 * @param {string[]|null|undefined} names
 * @param {unknown} packName
 * @returns {string[]}
 */
function withoutPack(names, packName) {
    const key = String(packName ?? '').trim().toLowerCase();
    return (Array.isArray(names) ? names : [])
        .filter((name) => String(name ?? '').trim().toLowerCase() !== key);
}
