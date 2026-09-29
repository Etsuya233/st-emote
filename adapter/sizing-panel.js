/**
 * The 投放方式 and 尺寸 controls, as DOM.
 *
 * Split out of the settings panel because it is the one part of it that answers
 * a different question: the pack list is about *which* stickers exist, this is
 * about *how big and where* a rendered one lands. The rules are unchanged and
 * still live in `core/placement.js` and `core/size.js`; what lives here is the
 * controls, their labels, and the one hint that goes wrong when a hand-typed
 * size is not a size.
 *
 * The two 尺寸集 are enumerated from `SIZE_SETS` and the fields from
 * `SIZE_PANEL_FIELDS` — every stored field, which is `SIZE_FIELDS` plus the two
 * 间隙 fields that collapse into one declaration — and their labels are catalog
 * keys keyed by those same values, so a value added to the core appears here
 * without anyone editing this file.
 *
 * Every word on screen comes from `core/i18n.js`; there is no label table of
 * English sentences here to keep in step with a second language.
 */

import { t } from '../core/i18n.js';
import { PLACEMENTS } from '../core/placement.js';
import {
    FIT_MODES,
    SIZE_PANEL_FIELDS,
    SIZE_SETS,
    defaultSizeValue,
    validateFitMode,
    validateSizeValue,
} from '../core/size.js';
import { logInfo } from './log.js';
import { ensureSettings } from './settings.js';

/**
 * The 投放方式 and 尺寸 labels, as catalog keys rather than sentences.
 *
 * Keyed by the values `core/placement.js` and `core/size.js` already use, so a
 * placement or a size field added to the core appears here with a label
 * attached and nothing in this file edited — and a key with no label shows up as
 * itself, which is a missing sentence someone can see.
 */
const PLACEMENT_LABEL_KEYS = {
    'in-place': 'placement.in-place',
    'after-block': 'placement.after-block',
    'message-end': 'placement.message-end',
};

const SIZE_SET_TITLE_KEYS = {
    inline: 'size.inline',
    block: 'size.block',
};

const SIZE_FIELD_LABEL_KEYS = {
    minWidth: 'size.minWidth',
    minHeight: 'size.minHeight',
    maxWidth: 'size.maxWidth',
    maxHeight: 'size.maxHeight',
    fit: 'size.fit',
    marginX: 'size.marginX',
    marginY: 'size.marginY',
};

/**
 * @param {any} context
 * @param {() => void} onChange - Called after any change, to save and repaint.
 */
export function mountSizingSection(context, root, onChange) {
    const settings = ensureSettings(context);
    const select = root.querySelector('#st_emote_placement');
    for (const placement of PLACEMENTS) {
        select.append(option(placement, t(PLACEMENT_LABEL_KEYS[placement])));
    }
    select.value = settings.placement;
    select.addEventListener('change', () => {
        ensureSettings(context).placement = select.value;
        onChange();
    });

    const sizes = root.querySelector('#st_emote_sizes');
    for (const sizeSet of SIZE_SETS) {
        sizes.append(buildSizeSet(context, sizeSet, settings, onChange));
    }
}

/**
 * The per-sticker 投放方式 override. An empty value means the sticker follows
 * the global setting; anything else also switches it to the other size set.
 *
 * @param {any} context
 * @param {import('./settings.js').StickerRecord} sticker
 * @param {() => void} onChange
 * @returns {Element}
 */
export function buildStickerPlacementSelect(context, sticker, onChange) {
    const select = document.createElement('select');
    select.className = 'text_pole st-emote-sticker-placement';
    select.title = t('placement.override');
    select.append(option('', t('placement.follow')));
    for (const placement of PLACEMENTS) {
        select.append(option(placement, t(PLACEMENT_LABEL_KEYS[placement])));
    }
    select.value = sticker.placement ?? '';
    select.addEventListener('change', () => {
        sticker.placement = select.value;
        onChange();
    });
    return select;
}

/**
 * One 尺寸集: its hand-typed bounds plus its fill mode.
 *
 * @param {any} context
 * @param {import('../core/size.js').SizeSetKey} sizeSet
 * @param {import('./settings.js').Settings} settings
 * @param {() => void} onChange
 * @returns {Element}
 */
function buildSizeSet(context, sizeSet, settings, onChange) {
    const group = document.createElement('div');
    group.className = 'st-emote-size-set';

    const title = document.createElement('div');
    title.className = 'st-emote-size-set-title';
    title.textContent = t(SIZE_SET_TITLE_KEYS[sizeSet]);
    group.append(title);

    const fields = document.createElement('div');
    fields.className = 'st-emote-size-fields';
    group.append(fields);

    const invalidHint = t('size.invalidHint');
    for (const field of SIZE_PANEL_FIELDS) {
        if (field === 'fit') {
            fields.append(buildFitField(context, settings.sizes[sizeSet].fit, (fit) => {
                ensureSettings(context).sizes[sizeSet].fit = fit;
                onChange();
            }));
            continue;
        }
        const { wrapper, input, hint } = buildSizeInput(
            t(SIZE_FIELD_LABEL_KEYS[field]),
            defaultSizeValue(sizeSet, field) || '—',
        );
        input.value = settings.sizes[sizeSet][field];
        input.addEventListener('change', () => {
            const result = validateSizeValue(input.value);
            // Stored verbatim, valid or not: an unusable value is treated as
            // unset while rendering, and the user keeps what they typed.
            ensureSettings(context).sizes[sizeSet][field] = input.value;
            if (result.ok) {
                showFieldHint(input, hint, '');
            } else {
                showFieldHint(input, hint, invalidHint);
                // The same console trail a render pass leaves, so a size that
                // never reached the chat can be found next to the misses.
                logInfo(`${sizeSet} ${field} "${input.value}" is not a size; using the default instead`);
            }
            onChange();
        });
        // A value that was left invalid stays visible as such across a reload.
        if (!validateSizeValue(input.value).ok) {
            showFieldHint(input, hint, invalidHint);
        }
        fields.append(wrapper);
    }

    return group;
}

/**
 * The fill-mode control: a `<select>`, because the three modes are a closed set
 * rather than something to hand-type.
 *
 * @param {import('../core/size.js').SizeSet} stored
 * @param {(fit: string) => void} onChange
 * @returns {Element}
 */
function buildFitField(context, stored, onChange) {
    const wrapper = document.createElement('label');
    wrapper.className = 'st-emote-field';

    const caption = document.createElement('span');
    caption.textContent = t(SIZE_FIELD_LABEL_KEYS.fit);

    const select = document.createElement('select');
    select.className = 'text_pole';
    select.append(option('', t('size.fitDefault')));
    for (const mode of FIT_MODES) {
        select.append(option(mode, mode));
    }
    const check = validateFitMode(stored.fit);
    select.value = check.ok ? check.value : '';
    select.addEventListener('change', () => onChange(select.value));

    wrapper.append(caption, select);
    return wrapper;
}

/**
 * One hand-typed size field with its own hint.
 *
 * @param {string} label
 * @param {string} placeholder
 * @returns {{wrapper: Element, input: HTMLInputElement, hint: Element}}
 */
function buildSizeInput(label, placeholder) {
    const wrapper = document.createElement('label');
    wrapper.className = 'st-emote-field';

    const caption = document.createElement('span');
    caption.textContent = label;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text_pole st-emote-size';
    input.placeholder = placeholder;

    const hint = document.createElement('span');
    hint.className = 'st-emote-field-hint';

    wrapper.append(caption, input, hint);
    return { wrapper, input, hint };
}

/**
 * @param {string} value
 * @param {string} label
 * @returns {HTMLOptionElement}
 */
function option(value, label) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
}

/**
 * @param {string} hint - Empty hides the hint and clears the invalid state.
 */
function showFieldHint(input, hintElement, hint) {
    hintElement.textContent = hint;
    hintElement.classList.toggle('st-emote-hint-bad', hint !== '');
    input.classList.toggle('st-emote-input-bad', hint !== '');
}
