/**
 * 表情包导出 / 导入的文件格式。
 *
 * A pack is exported as one zip holding the image files and a single manifest
 * describing them. The manifest is the contract between two installs, so it is
 * validated here rather than in the adapter: an archive from someone else is
 * untrusted input, and the rules that decide whether it may be imported
 * (well-formed, named uniquely, in range of what a sticker may hold) are the
 * ones that have to hold everywhere.
 *
 * The archive itself is built and read in the adapter, because that is the step
 * that needs JSZip and the browser. This module decides what goes in it.
 */

import {
    findPackByName,
    findStickerByLabel,
    validateDescription,
    validateLabel,
    validatePackName,
} from './constraints.js';
import { validateExternalImageUrl, imageFormatOf, isExternalImageUrl } from './image-rules.js';
import { validatePlacement } from './placement.js';

/** Marker identifying our own archive, so a foreign zip is refused by name. */
export const MANIFEST_FORMAT = 'st-emote-pack';

/** Schema version. Bumped only for a change that old readers cannot survive. */
export const MANIFEST_VERSION = 1;

/** Name of the manifest inside the archive. */
export const MANIFEST_FILE = 'st-emote.json';

/** Folder inside the archive that the image files live in. */
export const IMAGE_FOLDER = 'images';

/**
 * The archive path of one sticker's image, derived from its label so a person
 * opening the zip can tell the files apart. The label is only a convenience
 * here — it may be empty, may be in any script, and may collide — so the index
 * leads and the name is sanitised down to something a zip can hold safely.
 *
 * @param {{label?: string, image?: string}} sticker
 * @param {number} index
 * @returns {string}
 */
export function archiveImagePath(sticker, index) {
    const format = imageFormatOf(sticker?.image) ?? 'png';
    const label = String(sticker?.label ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_-]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24);
    const name = label === '' ? 'sticker' : label;
    return `${IMAGE_FOLDER}/${String(index + 1).padStart(3, '0')}-${name}.${format}`;
}

/**
 * Build the manifest for one pack. Every sticker is described, whether or not
 * it has an image yet: a sticker with no label and no picture still carries
 * itself across, so an unfinished pack survives a round trip intact.
 *
 * @param {{name: string, stickers: object[]}} pack
 * @returns {{format: string, version: number, name: string, stickers: object[]}}
 */
export function buildManifest(pack) {
    const stickers = (Array.isArray(pack?.stickers) ? pack.stickers : []).map((sticker, index) => {
        const entry = {
            label: String(sticker?.label ?? ''),
            description: String(sticker?.description ?? ''),
        };
        const image = String(sticker?.image ?? '');
        if (isExternalImageUrl(image)) {
            entry.url = image;
        } else if (image !== '') {
            entry.file = archiveImagePath(sticker, index);
        }
        if (validatePlacement(sticker?.placement).value) {
            entry.placement = sticker.placement;
        }
        return entry;
    });

    return {
        format: MANIFEST_FORMAT,
        version: MANIFEST_VERSION,
        name: String(pack?.name ?? ''),
        stickers,
    };
}

/**
 * @typedef {{ok: true, manifest: object}|{ok: false, reason: string}} ManifestParse
 */

/**
 * Parse and validate a manifest read out of an archive. Nothing partially
 * valid comes back: one bad sticker rejects the whole manifest, because
 * importing half a pack would leave the user with a pack they did not choose.
 *
 * @param {unknown} text - The manifest file's contents.
 * @returns {ManifestParse}
 */
export function parseManifest(text) {
    let raw;
    try {
        raw = JSON.parse(String(text ?? ''));
    } catch {
        return { ok: false, reason: 'not-json' };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, reason: 'not-a-pack' };
    }
    if (raw.format !== MANIFEST_FORMAT) {
        return { ok: false, reason: 'not-a-pack' };
    }
    if (raw.version !== MANIFEST_VERSION) {
        return { ok: false, reason: 'unsupported-version' };
    }

    const name = validatePackName(raw.name);
    if (!name.ok) {
        return { ok: false, reason: 'invalid-name' };
    }
    if (!Array.isArray(raw.stickers)) {
        return { ok: false, reason: 'invalid-stickers' };
    }

    const stickers = [];
    for (const entry of raw.stickers) {
        const sticker = parseSticker(entry);
        if (!sticker.ok) {
            return sticker;
        }
        if (findStickerByLabel(stickers, sticker.value.label)) {
            return { ok: false, reason: 'duplicate-label' };
        }
        stickers.push(sticker.value);
    }

    return {
        ok: true,
        manifest: {
            format: MANIFEST_FORMAT,
            version: MANIFEST_VERSION,
            name: name.value,
            stickers,
        },
    };
}

/**
 * @param {unknown} entry
 * @returns {{ok: true, value: object}|{ok: false, reason: string}}
 */
function parseSticker(entry) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return { ok: false, reason: 'invalid-sticker' };
    }

    const label = validateLabel(entry.label);
    if (!label.ok) {
        return { ok: false, reason: 'invalid-label' };
    }
    const description = validateDescription(entry.description);
    if (!description.ok) {
        return { ok: false, reason: 'invalid-description' };
    }
    const placement = validatePlacement(entry.placement);
    if (!placement.ok) {
        return { ok: false, reason: 'invalid-placement' };
    }

    // At most one source for the picture. A sticker with neither is legal and
    // imports as a sticker that still needs its image, which is exactly the
    // state a cross-device import can legitimately land in.
    const hasFile = entry.file !== undefined && entry.file !== null;
    const hasUrl = entry.url !== undefined && entry.url !== null;
    if (hasFile && hasUrl) {
        return { ok: false, reason: 'invalid-image' };
    }

    const sticker = {
        label: label.value,
        description: description.value,
        placement: placement.value,
    };

    if (hasFile) {
        const file = String(entry.file);
        if (!isSafeArchivePath(file)) {
            return { ok: false, reason: 'unsafe-file' };
        }
        sticker.file = file;
    }
    if (hasUrl) {
        const url = validateExternalImageUrl(entry.url);
        if (!url.ok) {
            return { ok: false, reason: 'invalid-url' };
        }
        sticker.url = url.value;
    }

    return { ok: true, value: sticker };
}

/**
 * Whether a file named by a manifest may be read out of the archive. The name
 * comes from someone else, so it may not climb out of the image folder, name an
 * absolute path, or be empty.
 *
 * @param {string} file
 * @returns {boolean}
 */
export function isSafeArchivePath(file) {
    const text = String(file ?? '');
    if (text === '' || text.includes('\\') || text.startsWith('/')) {
        return false;
    }
    if (/^[a-zA-Z]:/.test(text)) {
        return false;
    }
    const parts = text.split('/');
    return parts.every((part) => part !== '' && part !== '.' && part !== '..');
}

/**
 * @typedef {{ok: true, pack: object, uploads: {sticker: object, path: string, format: string}[]}
 *   | {ok: false, reason: 'name-taken'}} ImportPlan
 */

/**
 * Turn a parsed manifest into a pack ready to be added to the catalogue, and
 * report which image files the caller still has to upload.
 *
 * A name collision is refused outright. Renaming on import would mean inventing
 * a qualifier the model then has to be told about, and overwriting would throw
 * away a pack the user already has; both are worse than saying no.
 *
 * The new pack's stickers start with an empty `image`: the caller fills it in
 * from `uploads` once the bytes are stored, and a sticker with nothing to
 * upload (a 外链, or one that was never given a picture) already carries its
 * final value.
 *
 * @param {object} manifest - A manifest accepted by `parseManifest`.
 * @param {object[]} packs - The current catalogue, for the name check.
 * @param {(prefix: string) => string} newId - Id factory, so the core does not
 *   depend on the adapter's generator.
 * @returns {ImportPlan}
 */
export function planImport(manifest, packs, newId) {
    const name = String(manifest?.name ?? '').trim();
    if (findPackByName(packs, name)) {
        return { ok: false, reason: 'name-taken' };
    }

    /** @type {{sticker: object, path: string, format: string}[]} */
    const uploads = [];
    const stickers = (Array.isArray(manifest?.stickers) ? manifest.stickers : []).map((entry) => {
        const sticker = {
            id: newId('sticker'),
            label: entry.label,
            description: entry.description,
            image: entry.url ?? '',
            placement: entry.placement ?? '',
        };
        if (entry.file) {
            // The format comes from the file name inside the archive, which is
            // the only place it is recorded; the sticker gets the path the
            // upload endpoint returns later.
            const format = imageFormatOf(entry.file);
            if (format) {
                uploads.push({ sticker, path: entry.file, format });
            }
        }
        return sticker;
    });

    return { ok: true, pack: { name, stickers }, uploads };
}
