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
import {
    MAX_IMAGE_BYTES,
    MAX_IMAGE_LABEL,
    imageFormatOf,
    isExternalImageUrl,
    validateExternalImageUrl,
} from './image-rules.js';
import { t } from './i18n.js';
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
 * @typedef {{path: string, image: string, sticker: object}} ExportImage
 */

/**
 * @typedef {{manifest: object, images: ExportImage[]}} ExportPlan
 */

/**
 * Work out what one pack's archive will contain: the 包清单, and for each entry
 * in it, which file on this machine holds the bytes.
 *
 * The two are produced in **one pass**, and the image list carries its own
 * sticker rather than an index. A caller that paired the two lists by position
 * would be one skipped sticker away from writing the wrong picture under the
 * wrong label — and a 外链 is exactly such a skip, since it has no file.
 *
 * @param {{name: string, stickers: object[]}} pack
 * @returns {ExportPlan}
 */
export function planPackExport(pack) {
    const stickers = Array.isArray(pack?.stickers) ? pack.stickers : [];
    const entries = [];
    const images = [];

    stickers.forEach((sticker, index) => {
        const entry = {
            label: String(sticker?.label ?? ''),
            description: String(sticker?.description ?? ''),
        };
        const image = String(sticker?.image ?? '');
        if (isExternalImageUrl(image)) {
            // A 外链 has no bytes to put in the archive: the address is what
            // travels, so a shared link keeps working instead of being frozen
            // into a copy of today's picture.
            entry.url = image;
        } else if (image !== '') {
            const path = archiveImagePath(sticker, index);
            entry.file = path;
            images.push({ path, image, sticker });
        }
        if (validatePlacement(sticker?.placement).value) {
            entry.placement = sticker.placement;
        }
        entries.push(entry);
    });

    return {
        manifest: {
            format: MANIFEST_FORMAT,
            version: MANIFEST_VERSION,
            name: String(pack?.name ?? ''),
            stickers: entries,
        },
        images,
    };
}

/**
 * Build the 包清单 for one pack. Every sticker is described, whether or not it
 * has an image yet: a sticker with no label and no picture still carries itself
 * across, so an unfinished pack survives a round trip intact.
 *
 * @param {{name: string, stickers: object[]}} pack
 * @returns {{format: string, version: number, name: string, stickers: object[]}}
 */
export function buildManifest(pack) {
    return planPackExport(pack).manifest;
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
 *   | {ok: false, reason: string}} ImportPlan
 */

/**
 * Every way an import can be refused, in the panel's words.
 *
 * The sentences are catalog entries keyed by the reason, so a refusal is as
 * bilingual as the rest of the panel and adding a reason to this module without
 * a sentence to say it in is visible rather than showing an English fallback in
 * a Chinese UI. They live beside the rules that produce them rather than in the
 * adapter, for the reason every other rule here does: a reason and the sentence
 * that explains it are one fact.
 *
 * @param {string} reason
 * @returns {string}
 */
export function importFailureMessage(reason) {
    return t(`import.reason.${reason}`, {
        file: MANIFEST_FILE,
        limit: MAX_IMAGE_LABEL,
        reason,
    });
}

/**
 * Turn a parsed manifest into a pack ready to be added to the catalogue, and
 * report which image files the caller still has to upload.
 *
 * A name collision is refused outright. Renaming on import would mean inventing
 * a qualifier the model then has to be told about, and overwriting would throw
 * away a pack the user already has; both are worse than saying no.
 *
 * **Every image in the archive goes through the same rules a picked file does.**
 * An import is a way for an arbitrary zip to put bytes into the image
 * directory, and an archive that skipped the format and size limits would be a
 * hole straight past the rules the upload path enforces. So the format is
 * checked against the accepted four, and the size against the ceiling, here —
 * and either failure refuses the **whole** pack. That is deliberate and it is
 * the same rule the rest of this module follows: a half-imported pack is a pack
 * the user did not choose and cannot easily undo, so nothing partial is ever
 * better than a refusal with a stated reason.
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
 * @param {ReadonlyMap<string, number>} [imageSizes] - Byte length of each
 *   archive file, read out of the zip by the caller. A file the caller could not
 *   read is a missing one, and a file with no recorded size is **not** trusted
 *   to be within the limit.
 * @returns {ImportPlan}
 */
export function planImport(manifest, packs, newId, imageSizes = new Map()) {
    const name = String(manifest?.name ?? '').trim();
    if (findPackByName(packs, name)) {
        return { ok: false, reason: 'name-taken' };
    }

    /** @type {{sticker: object, path: string, format: string}[]} */
    const uploads = [];
    for (const entry of Array.isArray(manifest?.stickers) ? manifest.stickers : []) {
        if (!entry.file) {
            continue;
        }
        // The format comes from the file name inside the archive, which is the
        // only place it is recorded. An unrecognised one is refused outright:
        // silently dropping the upload would leave a sticker with no image and
        // no explanation, which is the one outcome the whole design rules out.
        const format = imageFormatOf(entry.file);
        if (!format) {
            return { ok: false, reason: 'unsupported-format' };
        }
        const bytes = imageSizes.get(entry.file);
        if (bytes === undefined) {
            return { ok: false, reason: 'missing-image' };
        }
        if (bytes > MAX_IMAGE_BYTES) {
            return { ok: false, reason: 'image-too-large' };
        }
        uploads.push({ sticker: null, path: entry.file, format });
    }

    // The stickers are built only once every image has passed, so a refusal
    // above cannot leave half a pack behind for the caller to clean up.
    let cursor = 0;
    const stickers = (Array.isArray(manifest?.stickers) ? manifest.stickers : []).map((entry) => {
        const sticker = {
            id: newId('sticker'),
            label: entry.label,
            description: entry.description,
            image: entry.url ?? '',
            placement: entry.placement ?? '',
        };
        if (entry.file) {
            uploads[cursor].sticker = sticker;
            cursor += 1;
        }
        return sticker;
    });

    return { ok: true, pack: { name, stickers }, uploads };
}
