import { DEFAULT_STICKER_TAG, validateStickerTag } from '../core/constraints.js';

/**
 * Build the JSON for a prompt-only regex that removes sticker tokens from the
 * context sent to the model without touching what the user sees. The user
 * imports it into the Regex extension by hand; we never inject it ourselves.
 *
 * `promptOnly` keeps it off the display, `placement: [2]` scopes it to AI
 * output, and `runOnEdit` re-runs it when a message is edited. Each token form
 * is matched in its raw and entity-escaped spellings.
 *
 * **Only the forms that are switched on are matched.** A 标记 form that is off
 * does nothing in a chat, so clearing it out of the context would be the worst
 * of both: the user writes `<sticker>…</sticker>`, sees it do nothing, and finds
 * it gone from the prompt as well. A "disabled but still stripped" form is a
 * setting that lies twice, so this takes the switches as arguments and the panel
 * regenerates the JSON whenever either one changes.
 *
 * @param {unknown} tagName - The configured HTML-tag form name.
 * @param {{bracketForm?: boolean, tagForm?: boolean}} [forms] - Which 标记
 *   forms are on. Absent means both, which is the shape a caller with no
 *   settings has.
 * @returns {string} Pretty-printed JSON, ready to copy.
 */
export function clearContextRegexJson(tagName, forms = {}) {
    const result = validateStickerTag(tagName);
    const tag = String(result.ok ? result.value : DEFAULT_STICKER_TAG)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [];
    if (forms.bracketForm !== false) {
        patterns.push(String.raw`\[\[sticker:[^\[\]\n]*\]\]`);
    }
    if (forms.tagForm !== false) {
        patterns.push(`<${tag}>[^<\\n]*?</${tag}>`, `&lt;${tag}&gt;[^<\\n]*?&lt;/${tag}&gt;`);
    }
    // Both forms off is a legal state the panel warns about, and the script is
    // still offered — it simply has nothing to match. An empty alternative
    // would match the empty string at every position, which is the worst
    // possible thing to hand a user's prompt, so the pattern is one that cannot
    // match at all.
    const pattern = patterns.length > 0 ? patterns.join('|') : '(?!)';
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
