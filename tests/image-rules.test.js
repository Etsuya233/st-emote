import test from 'node:test';
import assert from 'node:assert/strict';

import {
    IMAGE_FILE_PREFIX,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_LABEL,
    SUGGESTED_MAX_HEIGHT_PX,
    acceptImageFile,
    acceptedImageTypes,
    exceedsSuggestedHeight,
    imageFormatOf,
    isExternalImageUrl,
    isOwnImagePath,
    ownImageFileName,
    validateExternalImageUrl,
} from '../core/image-rules.js';

const file = (name, size = 1024) => ({ name, size });

test('imageFormatOf accepts the four image formats and folds jpeg into jpg', () => {
    assert.equal(imageFormatOf('a.png'), 'png');
    assert.equal(imageFormatOf('a.jpg'), 'jpg');
    assert.equal(imageFormatOf('a.JPEG'), 'jpg');
    assert.equal(imageFormatOf('a.webp'), 'webp');
    assert.equal(imageFormatOf('a.gif'), 'gif');
    assert.equal(imageFormatOf({ name: 'a.Gif' }), 'gif');
});

test('imageFormatOf rejects anything else, including no extension at all', () => {
    for (const name of ['a.svg', 'a.bmp', 'a.mp4', 'a.png.txt', 'a', 'a.', 'dir.png/a']) {
        assert.equal(imageFormatOf(name), null, name);
    }
});

test('acceptImageFile passes an image inside the size limit', () => {
    assert.deepEqual(acceptImageFile(file('a.png', MAX_IMAGE_BYTES)), { ok: true, format: 'png' });
});

test('acceptImageFile refuses an unsupported format before looking at the size', () => {
    assert.deepEqual(acceptImageFile(file('a.svg', 1)), { ok: false, reason: 'unsupported-format' });
    assert.deepEqual(acceptImageFile(file('a.svg', MAX_IMAGE_BYTES + 1)), {
        ok: false,
        reason: 'unsupported-format',
    });
});

test('acceptImageFile refuses a file over 5MB and accepts exactly 5MB', () => {
    assert.deepEqual(acceptImageFile(file('a.gif', MAX_IMAGE_BYTES + 1)), {
        ok: false,
        reason: 'too-large',
    });
    assert.equal(acceptImageFile(file('a.gif', MAX_IMAGE_BYTES)).ok, true);
});

test('the picker’s accept list is derived from the accepted formats', () => {
    // One list, so the file dialog cannot offer a file the rules would refuse.
    const types = acceptedImageTypes().split(',');
    assert.deepEqual(types.sort(), ['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
    // `jpeg` and `jpg` are the same type, so the type list is shorter than the
    // extension list and must not repeat itself.
    assert.equal(new Set(types).size, types.length);
});

test('the size the user is shown comes from the size the rules enforce', () => {
    assert.equal(MAX_IMAGE_LABEL, `${MAX_IMAGE_BYTES / (1024 * 1024)}MB`);
});

test('exceedsSuggestedHeight flags only images taller than the suggestion', () => {
    assert.equal(exceedsSuggestedHeight(SUGGESTED_MAX_HEIGHT_PX), false);
    assert.equal(exceedsSuggestedHeight(SUGGESTED_MAX_HEIGHT_PX + 1), true);
    assert.equal(exceedsSuggestedHeight(undefined), false);
    assert.equal(exceedsSuggestedHeight(0), false);
});

test('isExternalImageUrl tells a pasted address from a stored local path', () => {
    assert.equal(isExternalImageUrl('https://example.com/a.png'), true);
    assert.equal(isExternalImageUrl('  http://example.com/a.png  '), true);
    assert.equal(isExternalImageUrl('user/images/st-emote/st-emote-1.png'), false);
    assert.equal(isExternalImageUrl('data:image/png;base64,AAA'), false);
    assert.equal(isExternalImageUrl(''), false);
    assert.equal(isExternalImageUrl(undefined), false);
});

test('validateExternalImageUrl accepts http and https and canonicalises them', () => {
    assert.deepEqual(validateExternalImageUrl(' https://example.com/a.png '), {
        ok: true,
        value: 'https://example.com/a.png',
    });
    assert.equal(validateExternalImageUrl('http://example.com/a.png').ok, true);
});

test('validateExternalImageUrl refuses empty, malformed and non-http addresses', () => {
    assert.deepEqual(validateExternalImageUrl('   '), { ok: false, reason: 'empty' });
    assert.deepEqual(validateExternalImageUrl('not a url'), { ok: false, reason: 'malformed' });
    assert.deepEqual(validateExternalImageUrl('ftp://example.com/a.png'), {
        ok: false,
        reason: 'unsupported-scheme',
    });
    assert.deepEqual(validateExternalImageUrl('data:image/png;base64,AAA'), {
        ok: false,
        reason: 'unsupported-scheme',
    });
    assert.deepEqual(validateExternalImageUrl('javascript:alert(1)'), {
        ok: false,
        reason: 'unsupported-scheme',
    });
});

test('isOwnImagePath only accepts files this extension wrote', () => {
    assert.equal(isOwnImagePath('user/images/st-emote/st-emote-abc.png'), true);
    assert.equal(isOwnImagePath('user\\images\\st-emote\\st-emote-abc.png'), true);
    assert.equal(isOwnImagePath('user/images/st-emote/not-ours.png'), false);
    assert.equal(isOwnImagePath('user/images/backgrounds/st-emote-abc.png'), false);
    assert.equal(isOwnImagePath('user/images/st-emote/../../secrets.png'), false);
    assert.equal(isOwnImagePath(''), false);
    assert.equal(isOwnImagePath('https://example.com/a.png'), false);
    assert.equal(IMAGE_FILE_PREFIX, 'st-emote-');
});

test('ownImageFileName strips the directory, in either separator', () => {
    assert.equal(ownImageFileName('user/images/st-emote/a.png'), 'a.png');
    assert.equal(ownImageFileName('a.png'), '');
    assert.equal(ownImageFileName(''), '');
});
