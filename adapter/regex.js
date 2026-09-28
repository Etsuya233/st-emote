import { DEFAULT_STICKER_TAG, validateStickerTag } from '../core/constraints.js';

/**
 * Build the JSON for a prompt-only regex that removes sticker tokens from the
 * context sent to the model without touching what the user sees. The user
 * imports it into the Regex extension by hand; we never inject it ourselves.
 *
 * `promptOnly` keeps it off the display, `placement: [2]` scopes it to AI
 * output, and `runOnEdit` re-runs it when a message is edited. Both token forms
 * are matched, in their raw and entity-escaped spellings.
 *
 * @param {unknown} tagName - The configured HTML-tag form name.
 * @returns {string} Pretty-printed JSON, ready to copy.
 */
export function clearContextRegexJson(tagName) {
    const result = validateStickerTag(tagName);
    const tag = String(result.ok ? result.value : DEFAULT_STICKER_TAG)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = [
        String.raw`\[\[sticker:[^\[\]\n]*\]\]`,
        `<${tag}>[^<\\n]*?</${tag}>`,
        `&lt;${tag}&gt;[^<\\n]*?&lt;/${tag}&gt;`,
    ].join('|');
    const script = {
        id: '',
        scriptName: 'st-emote: clear tokens from context only',
        findRegex: `/${pattern}/gi`,
        replaceString: '',
        trimStrings: [],
        placement: [2],
        disabled: false,
        markdownOnly: false,
        promptOnly: true,
        runOnEdit: true,
        substituteRegex: 0,
        minDepth: null,
        maxDepth: null,
    };
    return JSON.stringify(script, null, 4);
}
