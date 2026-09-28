/**
 * The one place this extension writes to the browser console.
 *
 * The spec draws a hard line here: 未命中, 冲突 and hand-typed sizes that were
 * treated as unset go to the console under one prefix, and there is **no log
 * panel in the UI**. Keeping the prefix in its own module — rather than in
 * `render-common.js`, which is about rendering — is what lets the upload, archive
 * and slash-command layers log through the same door as the two render paths,
 * instead of growing a second copy of the literal.
 *
 * **Nothing outside this module touches the console or the prefix.** A caller
 * wants a line written, so it calls `logInfo` / `logError`; the literal lives
 * here and is not re-exported, which is what makes "one exit" a property of the
 * file tree rather than a habit everyone has to remember.
 *
 * `logInfo` rather than `logWarn` or `logError` for the ordinary outcomes: a
 * 未命中 is a fact about the model's output, not a malfunction, and a panel of red
 * console lines would train the user to ignore the ones that do matter.
 * `logError` is for the failures that are ours: a request the client refused, an
 * upload that threw, a path we could not install.
 *
 * **What is in the catalog and what is not.** The *UI* has no English left in it
 * — see `core/i18n.js`. The console is deliberately different: its mechanical
 * lines ("which field held that value", "which file could not be deleted", "which
 * HTTP status") are a diagnostic record meant to be read with the reason enum
 * beside them and grepped, and translating them would make a log search
 * language-dependent without telling anyone anything new. What *is* catalogued is
 * the console text that explains a fact about the user's own data — a 冲突 and the
 * pack spellings behind it — plus the miss-reason names the debug box shows. The
 * line is: mechanical diagnostics stay English, explanations of the user's data
 * follow the language.
 */

export const LOG_PREFIX = '[st-emote]';

/**
 * Write one line to the console behind the shared prefix, at the ordinary level.
 *
 * @param {...unknown} parts - Message first, then anything `console.info` takes.
 */
export function logInfo(...parts) {
    console.info(LOG_PREFIX, ...parts);
}

/**
 * Write one failure to the console behind the same shared prefix.
 *
 * Kept beside `logInfo` rather than next to each call site so that "everything
 * this extension logs carries one prefix" stays true without every file having to
 * remember to concatenate the literal.
 *
 * @param {...unknown} parts - Message first, then anything `console.error` takes.
 */
export function logError(...parts) {
    console.error(LOG_PREFIX, ...parts);
}
