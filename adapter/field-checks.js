/**
 * The sentences a refused field gets, and the uniqueness checks that refuse one.
 *
 * **Both halves live here because two modules refuse fields.** The pack list
 * refuses a 表情包 name and a 标记 tag; the sticker editor (`sticker-editor.js`)
 * refuses a 标签 and a 描述. A check that lives in whichever module happens to
 * call it is a check the other caller has to grow its own copy of, and the two
 * copies then answer the same mistake in two different ways — which is exactly
 * what a user sees when a field behaves differently depending on which screen it
 * is on.
 *
 * The rules themselves are the core's (`core/constraints.js`); this is the half
 * that turns a refusal into a sentence and the half that adds uniqueness on top
 * of the core's per-record rules.
 *
 * Every word here comes from `core/i18n.js`. There is no English literal in this
 * file to translate later, for the same reason `adapter/ui.js` has none.
 */

import {
    findPackByName,
    findStickerByLabel,
    validateLabel,
    validatePackName,
} from '../core/constraints.js';
import { t } from '../core/i18n.js';

/**
 * The sentence for a refused field, with the field named and the reason given.
 *
 * The reason keys are the same ones `core/constraints.js` produces, so a new rule
 * cannot be added there and left without a sentence here.
 *
 * @param {'packName'|'label'|'description'|'htmlTag'} field
 * @param {string} reason
 * @returns {string}
 */
export function constraintMessage(field, reason) {
    return `${t(`constraint.${field}`)} ${t(`constraint.reason.${reason}`)}.`;
}

/**
 * Validate a new pack name and its app-wide uniqueness.
 *
 * @param {import('./settings.js').Settings} settings
 * @param {unknown} value
 * @param {object} [except] - The pack being renamed, which may keep its own name.
 * @returns {{ok: true, value: string} | {ok: false, message: string}}
 */
export function checkPackName(settings, value, except) {
    const result = validatePackName(value);
    if (!result.ok) {
        return { ok: false, message: constraintMessage('packName', result.reason) };
    }
    if (findPackByName(settings.packs, result.value, { except })) {
        return { ok: false, message: t('pack.nameTaken', { name: result.value }) };
    }
    return { ok: true, value: result.value };
}

/**
 * Validate a 标签 and its uniqueness inside one pack.
 *
 * @param {import('./settings.js').PackRecord} pack
 * @param {unknown} value
 * @param {object} [except] - The sticker being renamed, which may keep its label.
 * @returns {{ok: true, value: string} | {ok: false, message: string}}
 */
export function checkLabel(pack, value, except) {
    const result = validateLabel(value);
    if (!result.ok) {
        return { ok: false, message: constraintMessage('label', result.reason) };
    }
    if (findStickerByLabel(pack.stickers, result.value, { except })) {
        return { ok: false, message: t('sticker.labelTaken', { name: result.value }) };
    }
    return { ok: true, value: result.value };
}
