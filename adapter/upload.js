import { IMAGE_SUBFOLDER } from './settings.js';

/** Accepted extensions, mapped to the format accepted by the upload endpoint. */
const ALLOWED_FORMATS = {
    png: 'png',
    jpg: 'jpg',
    jpeg: 'jpg',
    webp: 'webp',
    gif: 'gif',
};

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * @param {File} file
 * @returns {string|null} Format accepted by the upload endpoint, or null.
 */
export function imageFormatOf(file) {
    const name = String(file?.name ?? '');
    const dot = name.lastIndexOf('.');
    if (dot === -1) {
        return null;
    }
    const extension = name.slice(dot + 1).toLowerCase();
    return ALLOWED_FORMATS[extension] ?? null;
}

/**
 * Upload one image through SillyTavern's own image endpoint and return the
 * stored client-relative path.
 *
 * @param {{getRequestHeaders: () => Record<string, string>}} context
 * @param {File} file
 * @param {string} stickerId
 * @returns {Promise<string>}
 */
export async function uploadStickerImage(context, file, stickerId) {
    const format = imageFormatOf(file);
    if (!format) {
        throw new Error(`unsupported image format: ${file.name}`);
    }
    if (file.size > MAX_IMAGE_BYTES) {
        throw new Error(`image exceeds 5MB: ${file.name}`);
    }

    const base64 = await readAsBase64(file);
    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({
            image: base64,
            format,
            ch_name: IMAGE_SUBFOLDER,
            filename: `st-emote-${stickerId}`,
        }),
    });

    if (!response.ok) {
        throw new Error(`upload failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!data || typeof data.path !== 'string' || data.path === '') {
        throw new Error('upload returned no path');
    }
    return data.path;
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
