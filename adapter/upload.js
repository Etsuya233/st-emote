/**
 * Talking to SillyTavern's own image endpoints, and nothing else.
 *
 * Which files may be uploaded, how large they may be and what a 外链 is are
 * rules, and they live in `core/image-rules.js`; this module only moves bytes
 * and reports what the server said. It also owns the one thing the server can
 * answer that the core cannot: which of our files are actually on this server,
 * which is how a pack whose images did not travel with the settings is spotted.
 */

import {
    IMAGE_FILE_PREFIX,
    IMAGE_SUBFOLDER,
    MAX_IMAGE_LABEL,
    acceptImageFile,
    ownImageFileName,
} from '../core/image-rules.js';
import { t } from '../core/i18n.js';
import { logInfo } from './log.js';
import { newId } from './settings.js';

/**
 * The reason an upload was refused, in words the panel can show as-is. The size
 * in the sentence is the core's `MAX_IMAGE_LABEL`, so the two cannot drift.
 *
 * Thrown as the message of the error the caller reports, which is why it takes
 * the locale rather than a context: this is reached before any panel is around.
 *
 * @param {string} reason - An `ImageAcceptance` reason.
 * @param {string} [locale] - SillyTavern's UI locale.
 * @returns {string}
 */
export function uploadRefusalMessage(reason, locale) {
    return t(reason === 'too-large' ? 'upload.tooLarge' : 'upload.unsupportedFormat', locale, {
        limit: MAX_IMAGE_LABEL,
    });
}

/**
 * Upload one image through SillyTavern's own image endpoint and return the
 * stored client-relative path.
 *
 * The file is refused here for the same reason the panel would have refused it,
 * rather than being sent and rejected: the acceptance rules are the core's, and
 * this is the second place they are asked, not a second copy of them.
 *
 * @param {any} context
 * @param {File|{name: string, size: number}} file
 * @param {string} stickerId
 * @param {string} [locale] - Only used to word a refusal.
 * @returns {Promise<string>}
 */
export async function uploadStickerImage(context, file, stickerId, locale) {
    const accepted = acceptImageFile(file);
    if (!accepted.ok) {
        throw new Error(uploadRefusalMessage(accepted.reason, locale));
    }
    return uploadImage(context, await readAsBase64(file), accepted.format, stickerId);
}

/**
 * The file name one upload is stored under.
 *
 * The random tail is what makes a **replace** safe. The endpoint strips the
 * extension off whatever name it is given and re-appends the format's, so a
 * name of `st-emote-<id>` alone would make a png→png replace land on the *same*
 * path: the old file would be overwritten rather than replaced, and there would
 * be no "old" file left to clean up. A fresh name per upload keeps the two
 * distinct, so the previous image is a real file that can really be deleted.
 *
 * The sticker id stays in the name because that is what makes the file
 * identifiable as ours (ADR-0003) and what keeps one sticker's image from being
 * reachable as another's.
 *
 * @param {string} stickerId
 * @returns {string}
 */
export function imageFileName(stickerId) {
    return `${IMAGE_FILE_PREFIX}${String(stickerId ?? '').replace(/[^\w-]/g, '')}`
        + `-${newId('img').replace(/^img_/, '')}`;
}

/**
 * Store already-encoded image bytes.
 *
 * The step an import takes: the bytes come out of a zip rather than off the
 * user's disk, but the endpoint cannot tell the difference, and the acceptance
 * rules have already been applied by whoever read the archive. Going through
 * one function means an imported image is stored under the same name, in the
 * same folder, as an uploaded one — which is what makes the two origins
 * indistinguishable to everything downstream, deletion included.
 *
 * @param {{getRequestHeaders: () => Record<string, string>}} context
 * @param {string} base64 - Base64 payload without the data-URL prefix.
 * @param {string} format - One of png / jpg / webp / gif.
 * @param {string} stickerId
 * @returns {Promise<string>}
 */
export async function uploadImage(context, base64, format, stickerId) {
    const data = await postJson(context, '/api/images/upload', {
        image: base64,
        format,
        ch_name: IMAGE_SUBFOLDER,
        filename: imageFileName(stickerId),
    });

    if (!data || typeof data.path !== 'string' || data.path === '') {
        throw new Error('upload returned no path');
    }
    return data.path;
}

/**
 * Delete one stored image.
 *
 * The server refuses anything outside `user/images/`, and answers 404 for a
 * file that is already gone — which is the normal state on a device where the
 * image never arrived, so a 404 is reported as "nothing to do" rather than as a
 * failure. The caller is expected to have filtered the path through
 * `isOwnImagePath` already; this is the second gate, not the only one.
 *
 * @param {{getRequestHeaders: () => Record<string, string>}} context
 * @param {string} path - Client-relative path of the file to remove.
 * @returns {Promise<'deleted'|'absent'>}
 */
export async function deleteStickerImage(context, path) {
    const response = await fetch('/api/images/delete', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({ path }),
    });
    if (response.status === 404) {
        return 'absent';
    }
    if (!response.ok) {
        throw new Error(`delete failed with status ${response.status}`);
    }
    return 'deleted';
}

/**
 * The names of the image files this extension owns on this server.
 *
 * One listing, compared by bare file name: the listing already names the
 * folder, and a sticker stores a path whose directory is fixed. Comparing whole
 * paths would break the moment the client spelled the directory differently.
 *
 * @param {{getRequestHeaders: () => Record<string, string>}} context
 * @returns {Promise<Set<string>|null>} The file names, or null when the server
 *   could not be asked — which reads as "no claim either way" rather than "every
 *   image is missing". An **empty set** is a real answer and means exactly that:
 *   the folder holds no files.
 */
export async function listOwnImageFiles(context) {
    try {
        const names = await postJson(context, '/api/images/list', {
            folder: IMAGE_SUBFOLDER,
            sortField: 'name',
            sortOrder: 'asc',
        });
        if (!Array.isArray(names)) {
            return new Set();
        }
        return new Set(names.filter((name) => typeof name === 'string'));
    } catch (error) {
        // Warned rather than thrown because the answer this function gives on
        // failure is "no claim either way" — a failure the user cannot see would
        // otherwise read as "every image on this server is missing".
        logInfo('could not list stored images; assuming none are missing', error);
        return null;
    }
}

/**
 * A predicate for `core/library.js`: does this local image exist on the server?
 *
 * @param {Set<string>|null} names - From `listOwnImageFiles`, or null when the
 *   listing was never taken or could not be read.
 * @returns {(image: string) => boolean}
 */
export function imageFileChecker(names) {
    if (!names) {
        // No listing means no claim either way. Reporting every pack as greyed
        // out because the server was unreachable would be worse than not
        // reporting the problem at all.
        return () => true;
    }
    return (image) => names.has(ownImageFileName(image));
}

/**
 * @param {{getRequestHeaders: () => Record<string, string>}} context
 * @param {string} url
 * @param {object} body
 * @returns {Promise<any>}
 */
async function postJson(context, url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify(body),
    });
    if (!response.ok) {
        throw new Error(`${url} failed with status ${response.status}`);
    }
    return response.json();
}

/**
 * @param {File} file
 * @returns {Promise<string>} Base64 payload without the data-URL prefix.
 */
function readAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result ?? '');
            const comma = result.indexOf(',');
            resolve(comma === -1 ? result : result.slice(comma + 1));
        };
        reader.onerror = () => reject(reader.error ?? new Error('failed to read file'));
        reader.readAsDataURL(file);
    });
}
