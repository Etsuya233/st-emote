/**
 * The one place this extension writes to the browser console.
 *
 * The spec draws a hard line here: 未命中, 冲突 and hand-typed sizes that were
 * treated as unset go to the console under one prefix, and there is **no log
 * panel in the UI**. Keeping the prefix in its own module — rather than in
 * `render-common.js`, which is about rendering — is what lets the upload,
 * archive and slash-command layers log through the same door as the two render
 * paths, instead of growing a second copy of the literal.
 *
 * `info` rather than `warn` or `error` for the ordinary outcomes: a 未命中 is a
 * fact about the model's output, not a malfunction, and a panel of red console
 * lines would train the user to ignore the ones that do matter.
 */

export const LOG_PREFIX = '[st-emote]';

/**
 * Write one line to the console behind the shared prefix.
 *
 * @param {...unknown} parts - Message first, then anything `console.info` takes.
 */
export function logInfo(...parts) {
    console.info(LOG_PREFIX, ...parts);
}
