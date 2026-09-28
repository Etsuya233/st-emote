/**
 * 把一个表情包打包成一个 zip，以及把别人给的 zip 读回来。
 *
 * The archive format itself — what the manifest says, which files may be named,
 * whether a pack may be imported at all — is `core/manifest.js`. What is left
 * here is the part that genuinely needs the browser: turning a pack into zip
 * bytes, reading a zip back, and fetching the image files the manifest points
 * at.
 *
 * JSZip is the copy SillyTavern already ships at `/lib/jszip.min.js`, loaded
 * the same way the client loads it: a lazy dynamic import that installs the
 * global. That is deliberate — this extension adds no dependency of its own, and
 * a runtime npm install would be a new way for it to break on someone else's
 * setup.
 */

import { localImageOf } from '../core/catalogue.js';
import { MANIFEST_FILE, buildManifest, parseManifest } from '../core/manifest.js';

/** Where the client keeps the zip library. */
const JSZIP_URL = '/lib/jszip.min.js';

/**
 * Load the client's JSZip, once.
 *
 * @returns {Promise<any>} The JSZip constructor.
 */
export async function loadJsZip() {
    if (!globalThis.JSZip) {
        await import(/* @vite-ignore */ JSZIP_URL);
    }
    if (!globalThis.JSZip) {
        throw new Error('JSZip is not available; the client did not load /lib/jszip.min.js');
    }
    return globalThis.JSZip;
}

/**
 * Build the archive for one pack and return it as a Blob.
 *
 * Images are fetched through the same origin the extension is served from, so
 * the stored path is all that is needed to get the bytes back — no extra
 * bookkeeping, and a missing file surfaces as a rejected export rather than as
 * a zip with a hole in it.
 *
 * A 外链 has no bytes to put in the archive: the manifest records the address and
 * the import on the other side will use it directly, so a shared link keeps
 * working rather than being frozen into a copy of today's picture.
 *
 * @param {{name: string, stickers: object[]}} pack
 * @returns {Promise<{blob: Blob, fileName: string, count: number}>}
 */
export async function buildPackArchive(pack) {
    const JSZip = await loadJsZip();
    const zip = new JSZip();
    const manifest = buildManifest(pack);

    let count = 0;
    for (const [index, entry] of manifest.stickers.entries()) {
        if (!entry.file) {
            continue;
        }
        const bytes = await fetchImageBytes(localImageOf(pack.stickers[index]));
        zip.file(entry.file, bytes);
        count += 1;
    }

    // Written last so the manifest is the last thing to land in the archive, and
    // pretty-printed because a user opening the zip is the other reader of it.
    zip.file(MANIFEST_FILE, JSON.stringify(manifest, null, 2));

    const blob = await zip.generateAsync({
        type: 'blob',
        // Stored, not deflated: a png or a gif is already compressed, and
        // squeezing it again costs time and saves nothing.
        compression: 'STORE',
    });
    return { blob, fileName: `${manifest.name || 'pack'}.zip`, count };
}

/**
 * Read a pack archive.
 *
 * The manifest is validated before anything is pulled out of the archive, and
 * the image files are only read for entries a validated manifest asked for. A
 * zip is a container someone else built: its file names, its entry count and its
 * contents are all untrusted, so the manifest is the only thing that decides
 * what gets read.
 *
 * @param {Blob|File} file
 * @returns {Promise<{ok: true, manifest: object, images: Map<string, Uint8Array>}
 *   | {ok: false, reason: string}>}
 */
export async function readPackArchive(file) {
    const JSZip = await loadJsZip();

    let zip;
    try {
        zip = await JSZip.loadAsync(file);
    } catch (error) {
        console.info('[st-emote] that file is not a readable zip', error);
        return { ok: false, reason: 'not-a-zip' };
    }

    const manifestEntry = zip.file(MANIFEST_FILE);
    if (!manifestEntry) {
        return { ok: false, reason: 'no-manifest' };
    }

    const parsed = parseManifest(await manifestEntry.async('string'));
    if (!parsed.ok) {
        return { ok: false, reason: parsed.reason };
    }

    const images = new Map();
    for (const sticker of parsed.manifest.stickers) {
        if (!sticker.file || images.has(sticker.file)) {
            continue;
        }
        const entry = zip.file(sticker.file);
        if (!entry) {
            return { ok: false, reason: 'missing-image' };
        }
        images.set(sticker.file, await entry.async('uint8array'));
    }

    return { ok: true, manifest: parsed.manifest, images };
}

/**
 * Offer a blob to the user as a download.
 *
 * @param {Blob} blob
 * @param {string} fileName
 */
export function downloadBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    // The object URL is kept alive briefly: revoking it in the same tick
    // cancels the download in some browsers before it has started.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * @param {string} path
 * @returns {Promise<Uint8Array>}
 */
async function fetchImageBytes(path) {
    const response = await fetch(path);
    if (!response.ok) {
        throw new Error(`image file is not on this server: ${path}`);
    }
    return new Uint8Array(await response.arrayBuffer());
}
