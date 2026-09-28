/**
 * 图片规则: which files may become a sticker image, how large they may be,
 * when the panel suggests a smaller one, and what counts as a 外链.
 *
 * Everything here is a rule rather than a step, so it lives in the pure core and
 * is decided without a browser or a SillyTavern server. The adapter only moves
 * bytes once this module has said yes.
 *
 * Two things in this file exist because of ADR-0003. Images are written into
 * another feature's directory (there is no extension-owned one), so every file
 * carries a filename prefix — and therefore every deletion can be restricted to
 * files this extension is known to have written.
 */

/** Sub-folder inside `user/images/` where uploaded sticker files are written. */
export const IMAGE_SUBFOLDER = 'st-emote';

/** Client-relative directory the extension's image files live in. */
export const IMAGE_DIR = `user/images/${IMAGE_SUBFOLDER}`;

/** Every uploaded file is named with this prefix, so ownership is decidable. */
export const IMAGE_FILE_PREFIX = 'st-emote-';

/**
 * Accepted extensions, mapped to the format the upload endpoint takes. `jpeg`
 * folds into `jpg`: it is the same format, and the endpoint only knows one
 * spelling of it.
 */
export const IMAGE_FORMATS = {
    png: 'png',
    jpg: 'jpg',
    jpeg: 'jpg',
    webp: 'webp',
    gif: 'gif',
};

/**
 * Largest accepted file. A bigger one is rejected outright rather than resized:
 * the spec asks for an explicit refusal with a reason, and it asks for no
 * automatic compression.
 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Height suggested at upload time. A suggestion and never a rejection — the
 * user is told, and the image goes in as it is.
 */
export const SUGGESTED_MAX_HEIGHT_PX = 512;

/**
 * The format an upload endpoint should be given for a file name, or null when
 * the extension is not one of the four accepted image formats.
 *
 * @param {unknown} source - A file name, or anything with a `name` (a `File`).
 * @returns {string|null}
 */
export function imageFormatOf(source) {
    const name = String(
        (typeof source === 'string' ? source : source?.name) ?? '',
    );
    const dot = name.lastIndexOf('.');
    if (dot === -1) {
        return null;
    }
    const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
    if (slash > dot) {
        return null;
    }
    return IMAGE_FORMATS[name.slice(dot + 1).toLowerCase()] ?? null;
}

/**
 * @typedef {{ok: true, format: string} | {ok: false, reason: 'unsupported-format'|'too-large'}} ImageAcceptance
 */

/**
 * Decide whether a picked file may be uploaded, and with which format. Both
 * refusal reasons are enumerated so the panel can explain the specific one
 * rather than saying "upload failed".
 *
 * @param {unknown} file - A `File`, or anything with `name` and `size`.
 * @returns {ImageAcceptance}
 */
export function acceptImageFile(file) {
    const format = imageFormatOf(file);
    if (!format) {
        return { ok: false, reason: 'unsupported-format' };
    }
    const size = Number(file?.size);
    // A missing or unusable size is not a reason to refuse: the browser reports
    // a real number for a real file, and refusing on a `NaN` would only ever
    // happen for something the user cannot pick from the file dialog anyway.
    if (Number.isFinite(size) && size > MAX_IMAGE_BYTES) {
        return { ok: false, reason: 'too-large' };
    }
    return { ok: true, format };
}

/**
 * Whether an image is taller than the suggested height, and so deserves the
 * "建议高度 ≤ 512px" note. Anything unknown counts as within the suggestion:
 * the note is a courtesy, not a gate.
 *
 * @param {unknown} height - Pixel height, as the browser reported it.
 * @returns {boolean}
 */
export function exceedsSuggestedHeight(height) {
    const pixels = Number(height);
    return Number.isFinite(pixels) && pixels > SUGGESTED_MAX_HEIGHT_PX;
}

/**
 * Whether a stored image value points outside this installation. Only an
 * absolute http(s) URL qualifies: a client-relative path such as
 * `user/images/st-emote/x.png` is a local file, and a `data:` URL is not a
 * network image address the user pasted.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isExternalImageUrl(value) {
    const text = String(value ?? '').trim();
    return /^https?:\/\//i.test(text);
}

/**
 * @typedef {{ok: true, value: string} | {ok: false, reason: 'empty'|'malformed'|'unsupported-scheme'}} UrlValidation
 */

/**
 * Validate a pasted image address. Returns the canonical spelling so the panel
 * and the renderer agree on one string for one sticker.
 *
 * @param {unknown} value
 * @returns {UrlValidation}
 */
export function validateExternalImageUrl(value) {
    const text = String(value ?? '').trim();
    if (text === '') {
        return { ok: false, reason: 'empty' };
    }
    let url;
    try {
        url = new URL(text);
    } catch {
        return { ok: false, reason: 'malformed' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { ok: false, reason: 'unsupported-scheme' };
    }
    if (url.hostname === '') {
        return { ok: false, reason: 'malformed' };
    }
    return { ok: true, value: url.href };
}

/**
 * Whether a stored image path is a file this extension wrote: inside its own
 * sub-folder of `user/images/`, and carrying the prefix every upload is named
 * with. Deletions are gated on this, because the directory is shared with other
 * features (ADR-0003).
 *
 * @param {unknown} path
 * @returns {boolean}
 */
export function isOwnImagePath(path) {
    const text = String(path ?? '').replace(/\\/g, '/');
    if (!text.startsWith(`${IMAGE_DIR}/`)) {
        return false;
    }
    return ownImageFileName(text).startsWith(IMAGE_FILE_PREFIX);
}

/**
 * The bare file name of a stored image path, or '' when there is none. The
 * comparison against the server's file listing is done on the name alone,
 * because the listing knows the folder already.
 *
 * @param {unknown} path
 * @returns {string}
 */
export function ownImageFileName(path) {
    const text = String(path ?? '').replace(/\\/g, '/');
    const slash = text.lastIndexOf('/');
    return slash === -1 ? '' : text.slice(slash + 1);
}
