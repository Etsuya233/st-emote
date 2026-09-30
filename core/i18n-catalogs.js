/**
 * 界面文案 (the message catalogs): every string the panel shows, and every
 * string a console line uses to explain something about the user's own data,
 * in the languages this extension ships.
 *
 * **Data only.** This file is the sentences; `core/i18n.js` is the lookup that
 * picks between them. Split because they are different kinds of thing — five
 * hundred lines of prose and a hundred lines of BCP-47 reasoning — and because
 * adding a key means editing a file whose whole content is keys, which is a
 * different mistake to make from editing a file that is mostly an algorithm.
 *
 * Two rules hold for every value here, and `tests/i18n.test.js` checks both:
 *
 * - **The key sets must match.** A key added to one catalog and not the other
 *   is a build failure, which is the only way a stale translation gets noticed
 *   before a user does.
 * - **A value is plain text.** Never markup. Every surface that shows one uses
 *   `textContent`, so a pack name or a search query interpolated into a
 *   sentence cannot become an element; the panel's few inline `<code>` spans
 *   are built as their own elements beside the text.
 *
 * `{name}` marks a value interpolated at use time. A value the caller did not
 * supply stays as the placeholder rather than becoming the word "undefined": a
 * visible gap is easier to notice and to report than a sentence that quietly
 * reads wrong.
 *
 * Keys are namespaced by who uses them, and a few are named after the values
 * they are keyed by: `placement.in-place` is the label for the `in-place`
 * 投放方式, `miss.reason.<reason>` is the sentence for one 未命中 reason, and
 * `import.reason.<reason>` for one import refusal. That is what makes a new
 * value in one of those cores show up here as a missing sentence, rather than
 * as a panel label that reads like a variable name.
 */

/** The locale every other catalog is measured against, and the fallback. */
export const DEFAULT_LOCALE = 'en';

/** The locales this extension ships, other than the source. */
export const SHIPPED_LOCALES = ['zh-cn'];

/**
 * The script each shipped catalog is written in, for the locale ids that do not
 * name one themselves.
 *
 * `getCurrentLocale()` reports a **region** (`zh-cn`), but a browser may hand out
 * a **script** (`zh-hans`), and a catalog written in Simplified Chinese serves
 * both. Naming the script is what lets `zh-hans` reach it while `zh-tw` — a
 * variant this catalog does not serve — correctly falls back to English rather
 * than to the wrong Chinese.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const CATALOG_SCRIPTS = {
    'zh-cn': 'hans',
};

const EN = {
    // ── the panel's own words ──────────────────────────────────────────────
    'panel.intro':
        'Upload images into a pack, give each one a label, and enable the pack '
        + 'wherever you want its stickers to render.',
    'panel.introTokenCaption': 'A token looks like',
    'panel.tokenExample': '[[sticker:pack:label]]',

    // The four block titles. The panel is a data page with settings attached,
    // so the library comes first and the settings are the three blocks below
    // it — and each one is named, because forty controls separated by a 6px
    // difference in spacing and a hairline the client's own theme colour draws
    // almost invisibly give the eye nowhere to land.
    'block.library': 'Packs',
    'block.rendering': 'Rendering',
    'block.appearance': 'Appearance',
    'block.tools': 'Setup and tools',

    // The status line: what the current 作用域 actually make available, in the
    // same 生效集 the macro listing and the debug preview read. Its counts are
    // separate sentences rather than two values inside one, because `t` picks a
    // singular wording from a single `count` and two counts in one sentence
    // would agree with neither.
    'panel.packCount': '{count} packs',
    'panel.packCount.one': '{count} pack',
    'panel.statusLabel': 'Active here',
    // Shown in place of the counts while the 总开关 is off, because a count of
    // what would be available is noise while nothing is being rendered.
    'panel.statusOff':
        'Rendering is off — every sticker on screen is back to its marker',

    // The first-run card, shown only while the library is empty. Four steps, and
    // the last one is the step everybody misses: without the macro in a preset
    // the model is never told which labels exist, so it never writes a token.
    'panel.startStep1': 'Name a pack, then press +.',
    'panel.startStep2':
        'Upload images into it and give each one a label — a token names the label.',
    'panel.startStep3': 'Turn the pack on in Global, Character or Chat.',
    'panel.startStep4':
        'Put {{st-emote}} in a preset so the model knows what it may use.',
    // The panel's buttons are glyphs rather than words (ticket 11), which is a
    // trade the user is entitled to be told about in one place rather than
    // discovering one button at a time.
    'panel.iconHint':
        'The buttons below are icons: hover one to see what it does, and the same '
        + 'sentence is what a screen reader announces. The sections that hold an '
        + 'explanation or a sample start closed — open one when you need it.',
    'panel.renderUser': 'Render stickers in user messages',
    // "at all" read as a hedge on the 總開關 rather than as the thing it is: the
    // one control the whole extension answers to, and the one whose state decides
    // whether anything below it is doing anything.
    'panel.enabled': 'Master switch: render stickers',
    'panel.enabledHint':
        'Turning this off puts every sticker already on screen back to its marker, and the '
        + '{{st-emote}} listing macro expands to nothing — with rendering off, a listing '
        + 'would only invite the model to write tokens that never appear.',
    'panel.tagName': 'HTML tag form',
    'panel.sizeHint':
        'Where a sticker shows up and how big it is. Write sizes as a number with em, px or %; '
        + '1em is the current chat text height. An empty field falls back to its default. '
        + 'A % is only promised on a width: a percentage height depends on the parent having a height of its own.',
    'panel.newPackName': 'New pack name',
    'panel.createPack': 'Create pack',
    'panel.missingPackHeader': 'Missing packs referenced by this chat\'s characters ({count})',
    'panel.createMissingPacks': 'Create missing packs',
    'panel.missingPacksCreated': 'Created {count} empty pack(s). Add images to them.',
    'panel.noPacks': 'No packs yet. Create one to upload images.',
    'panel.noStickerMatches': 'No sticker matches "{query}".',
    'panel.searchPlaceholder': 'Search labels and descriptions',
    'panel.importPack': 'Import pack (.zip)',
    'panel.transferHint':
        'Move a whole pack around: export writes one zip with the images and their '
        + 'labels, descriptions and placement overrides; import takes such a zip back. '
        + 'An imported pack is not enabled anywhere until you say so.',
    // The four titles below are the only new sentences in this catalog that are
    // not a button label: a collapsible section needs a heading, and the keys
    // above it are the sections' *hints* — paragraphs meant to be read with the
    // thing they explain, not titles for a closed bar.
    'panel.macroTitle': 'Listing macro',
    'panel.regexTitle': 'Context-clearing regex',
    'panel.transferTitle': 'Import and export a pack',
    'panel.debugTitle': 'Try rendering / re-render',
    'panel.macroHint': 'Write one of these in your own preset to get the sticker listing:',
    'panel.macroExample':
        '{{st-emote}}       one "pack:label (description)" per line\n'
        + '{{st-emote::full}}     same as {{st-emote}}\n'
        + '{{st-emote::simple}}   one "pack:label" per line, no description',
    'panel.regexHint':
        'Clear tokens from the context only (the chat still shows the images). '
        + 'Copy this JSON and import it into the Regex extension with "Import To: Global".',
    'panel.copyRegex': 'Copy regex JSON',
    'panel.regexCopied': 'Regex JSON copied.',
    'panel.regexCopyFailed': 'Could not copy to the clipboard; select the text manually.',

    // ── the debug area ─────────────────────────────────────────────────────
    'panel.debugHint':
        'Paste a message here to see how it renders with the settings above, without '
        + 'touching the chat. The text is taken as plain text: a markdown code fence is '
        + 'shown as you typed it, while a literal code or preformatted element in the '
        + 'paste is skipped, as in a chat. Misses and size values that were ignored go '
        + 'to the browser console, prefixed with [st-emote].',
    'panel.previewPlaceholder': 'Paste a message, e.g. She smiles. [[sticker:daily:happy]]',
    'panel.previewRun': 'Render',
    'panel.previewEmpty': 'Nothing to render: the text has no sticker token in it.',
    'panel.previewMisses': 'Not rendered: {reasons}',
    'panel.rerender': 'Re-render the current chat',
    'panel.rerendered': 'Re-rendered the current chat.',

    // ── one pack in the list ───────────────────────────────────────────────
    'pack.uploadImages': 'Upload images',
    'pack.addImageUrl': 'Add image URL',
    'pack.exportZip': 'Export .zip',
    'pack.deletePack': 'Delete pack',
    'pack.stickerCount': '{count} stickers',
    'pack.stickerCount.one': '{count} sticker',
    'pack.stateEmpty': 'empty',
    'pack.stateEmptyTitle':
        'This pack has no stickers yet. It can be enabled, but no token will resolve to it.',
    'pack.stateImagesMissing': 'images not synced',
    'pack.stateImagesMissingTitle':
        'The image files are not on this server. The pack still works — re-point the '
        + 'stickers at your own copies of the images.',
    'pack.coverRepoint': 'Images are not on this server — click to re-point the first missing sticker',
    'pack.selectAllTitle': 'Select every sticker in this pack',
    'pack.selectAll': 'Select all',
    'pack.selectMatches': 'Select the matches',
    'pack.selectedCount': '{count} selected',
    'pack.selectedCount.one': '{count} selected',
    'pack.deleteSelected': 'Delete {count} selected',
    'pack.searchDeleteHint': 'Clear the search to delete selected stickers.',
    'pack.renamed': 'Renamed to "{name}". Tokens using the old name no longer match.',
    'pack.nameTaken': 'A pack named "{name}" already exists.',
    // The pack header doubles as the accordion switch (ticket 12), so the header
    // has to say which way the click goes — one sentence per direction rather
    // than a neutral "stickers", because the row it sits in is already full.
    'pack.expand': 'Show this pack\'s stickers',
    'pack.collapse': 'Hide this pack\'s stickers',
    // Batch is a *mode*, so the button names the state it switches into and the
    // state it switches out of. One glyph either way; `aria-pressed` says which.
    'pack.batchMode': 'Select stickers',
    'pack.batchModeDone': 'Stop selecting stickers',

    // ── one sticker in a pack ──────────────────────────────────────────────
    'sticker.selectForDelete': 'Select for a batch delete',
    'sticker.labelPlaceholder': 'Label',
    'sticker.unlabeled': 'no label yet',
    'sticker.external': 'external',
    'sticker.externalTitle': 'The image comes from a URL and is not stored here.',
    'sticker.replace': 'Replace',
    'sticker.delete': 'Delete',
    'sticker.renamed': 'Label is now "{name}". Tokens using the old label no longer match.',
    'sticker.labelTaken': 'This pack already has a sticker labelled "{name}".',
    // The grid cell is the whole default surface of one sticker, so it carries
    // two sentences: what it is (the 标签 and the 描述, in the cell's `title`)
    // and what clicking it does. Both reach the surface, so a cell is not an
    // unlabelled square to a screen reader.
    'sticker.cellCaption': '{name} — click to edit',
    'sticker.cellCaptionUnlabeled': 'No label yet — click to edit',
    'sticker.cellTitle': '{name}: {description}',
    'sticker.cellTitleNoDescription': '{name}',
    'sticker.cellTitleUnlabeled': 'No label yet: {description}',
    // The editor is the one place a sticker's fields exist, so it needs a way out
    // that is not Esc alone.
    'sticker.closeEditor': 'Close',

    // ── 作用域 ─────────────────────────────────────────────────────────────
    'scope.global': 'Global',
    'scope.character': 'Character',
    'scope.chat': 'Chat',

    // ── 投放方式 ───────────────────────────────────────────────────────────
    'placement.in-place': 'In place',
    'placement.after-block': 'After the block',
    'placement.message-end': 'End of message',
    'placement.follow': 'Follow the global setting',
    'placement.override': 'Placement override for this sticker',
    'placement.label': 'Placement',

    // ── 尺寸集 ─────────────────────────────────────────────────────────────
    'size.inline': 'Inline size (in place)',
    'size.block': 'Block size (after the block / end of message)',
    'size.minWidth': 'Min width',
    'size.minHeight': 'Min height',
    'size.maxWidth': 'Max width',
    'size.maxHeight': 'Max height',
    'size.fit': 'Fill',
    'size.fitDefault': 'default',
    'size.marginX': 'Gap between stickers (left/right)',
    'size.marginY': 'Gap between stickers (top/bottom)',
    'size.invalidHint': 'needs a number with em, px or %',
    // The same mark, said to a fill mode. It needs its own sentence because the
    // one above is a rule about lengths: shown next to `cover` it would be advice
    // about a number the user never typed.
    'size.invalidFitHint': 'is not one of cover, contain or fill',
    // Marks a 尺寸集 in a collapsed panel, where its seven fields cannot be
    // seen. The one for a value that is not a size is a bare glyph with the
    // field's own hint as its tooltip: the section opens itself in that case, so
    // the hint on the offending input is on screen, and a sentence in the header
    // saying so was a page of panel to say what the open drawer already shows.
    'size.customized': 'changed',
    'size.invalidMark': '!',

    // ── 标记形态 ───────────────────────────────────────────────────────────
    'form.label': 'Token forms',
    // The tag form's own name is deliberately not spelled out with angle
    // brackets: a catalog value is plain text and is applied with `textContent`,
    // so markup in one would be shown as the markup rather than as the tag — and
    // the field below states the name the user configures anyway.
    'form.bracket': 'Bracket form: [[sticker:pack:label]]',
    'form.tag': 'HTML tag form: the tag name below, wrapping pack:label',
    'form.bothOff':
        'Both token forms are off, so no sticker can render at all. The macro and the '
        + 'context-clearing regex keep working; turn one form back on to render again.',

    // ── field validation ───────────────────────────────────────────────────
    'constraint.packName': 'Pack name',
    'constraint.label': 'Label',
    'constraint.description': 'Description',
    'constraint.htmlTag': 'HTML tag name',
    'constraint.reason.empty': 'cannot be empty',
    'constraint.reason.too-long': 'is too long',
    'constraint.reason.forbidden-character': 'cannot contain [ ] < or >',
    'constraint.reason.newline': 'must stay on a single line',
    'constraint.reason.colon': 'cannot contain ":"',
    'constraint.reason.invalid': 'must start with a letter and use only letters, digits and "-"',
    'constraint.reason.reserved': 'is a real HTML tag name',
    'constraint.reason.unknown': 'is not valid',

    // ── image rules ────────────────────────────────────────────────────────
    'upload.tooLarge': 'larger than {limit} — pick a smaller file (this extension does not compress images)',
    'upload.unsupportedFormat': 'not a png, jpg, webp or gif',
    'upload.failed': '{name} was not added: {reason}',
    'upload.done': 'Uploaded {count} image(s) into "{name}".',
    'upload.done.one': 'Uploaded {count} image into "{name}".',
    'upload.tooTall':
        'Taller than the suggested {limit}px: {names}. They still work; a smaller image just reads better inline.',
    'url.prompt': 'Image URL (http:// or https://):',
    'url.empty': 'No address given.',
    'url.malformed': 'That is not an http(s) image address.',
    'url.added': 'Added an external sticker to "{name}". Give it a label to use it.',
    'image.replaced': 'Image replaced; the label and description are unchanged.',
    'image.set': 'Image set.',
    'image.replaceFailed': 'The image was not replaced: {reason}',

    // ── deletions ──────────────────────────────────────────────────────────
    'delete.sticker': 'Delete {name} and its image file?',
    'delete.stickerUnnamed': 'Delete this sticker and its image file?',
    'delete.selected': 'Delete {count} sticker(s) and their image files?',
    'delete.selected.one': 'Delete {count} sticker and its image file?',
    'delete.pack':
        'Delete the pack "{name}"? That removes {count} sticker(s) and deletes their image '
        + 'files, and takes the pack out of every scope. Tokens naming it will stop matching.',
    'delete.pack.one': 'Delete the pack "{name}"? That removes {count} sticker and deletes its '
        + 'image file, and takes the pack out of every scope. Tokens naming it will stop matching.',
    'delete.packDone': 'Deleted "{name}".',

    // ── pack archives ──────────────────────────────────────────────────────
    'export.done': 'Exported "{name}" with {count} image(s).',
    'export.done.one': 'Exported "{name}" with {count} image.',
    'export.failed': 'Could not export "{name}": {reason}',
    'export.imageMissing': 'the image file {path} is not on this server',
    'import.readFailed': 'Could not read {name}: {reason}',
    'import.done':
        'Imported "{name}" with {count} sticker(s) ({stored} image(s) stored). '
        + 'It is not enabled anywhere yet.',
    'import.done.one': 'Imported "{name}" with {count} sticker ({stored} image(s) stored). '
        + 'It is not enabled anywhere yet.',
    'import.reason.not-a-zip': 'that file is not a readable zip archive',
    'import.reason.no-manifest': 'that zip has no {file} in it, so it is not a st-emote pack',
    'import.reason.not-a-pack': 'that zip was not made by st-emote',
    'import.reason.unsupported-version': 'that pack was made by a newer version of st-emote',
    'import.reason.name-taken': 'a pack with that name already exists; rename or delete it first',
    'import.reason.missing-image': 'that pack is incomplete: one of its image files is missing from the zip',
    'import.reason.unsupported-format': 'that pack holds an image that is not a png, jpg, webp or gif',
    'import.reason.image-too-large': 'that pack holds an image larger than {limit}',
    'import.reason.invalid-name': 'that pack has no usable name in it',
    'import.reason.not-json': 'that zip holds no readable {file}',
    'import.reason.invalid-stickers': 'that pack lists its stickers in a way this version cannot read',
    'import.reason.invalid-sticker': 'one of its stickers is not something this version can read',
    'import.reason.duplicate-label': 'two of its stickers share a label',
    'import.reason.invalid-label': 'one of its stickers has a label this version refuses',
    'import.reason.invalid-description': 'one of its stickers has a description this version refuses',
    'import.reason.invalid-placement': 'one of its stickers asks for a 投放方式 this version does not have',
    'import.reason.invalid-image': 'one of its stickers names both a file and an address',
    'import.reason.unsafe-file': 'one of its stickers names a file outside the pack',
    'import.reason.invalid-url': 'one of its stickers has an address this version refuses',
    'import.reason.unknown': 'that pack could not be read ({reason})',

    // ── the 清单 the macro expands to ──────────────────────────────────────
    'listing.empty': 'none',

    // ── 未命中, as the debug area names it ─────────────────────────────────
    // The keys are the `Miss['reason']` values from `core/render.js`, so a new
    // reason cannot reach the panel without a sentence to say it in.
    'miss.reason.pack-not-found': 'no pack of that name',
    'miss.reason.pack-not-enabled': 'that pack is not enabled here',
    'miss.reason.label-not-found': 'no sticker of that label',
    'miss.reason.ambiguous-bare-label': 'a bare label is ambiguous with this many packs enabled',
    'miss.reason.image-missing': 'the image is not on this server',
    'miss.reason.external-link-failed': 'the image address did not load',

    // ── 冲突 ───────────────────────────────────────────────────────────────
    'conflict.header': 'Label conflicts in the effective set ({count})',
    'conflict.header.one': 'Label conflict in the effective set ({count})',
    'conflict.none': 'No label is defined by more than one enabled pack.',
    'conflict.row': '{label} — defined by {packs}',
    'conflict.logLine': 'label conflict: "{label}" is defined by {packs}',

    // ── slash commands ─────────────────────────────────────────────────────
    'command.repainted':
        'Repainted the current chat: every message was re-rendered from its source text.',
    'command.enabled': 'Enabled "{name}" in the {scope} scope.',
    'command.disabled': 'Disabled "{name}" in the {scope} scope.',
    'command.unknownScope': 'Unknown scope "{scope}". Use one of: {scopes}.',
    'command.packArgument': 'the pack to turn on or off',
    'command.scopeArgument': 'which 作用域 to change: {scopes} (default global)',
    'command.unknownPack': 'There is no pack named "{name}".',
    'command.noCharacter': 'No character card is selected, so the character scope has nowhere to go.',
    'command.needPack': 'Name a pack, for example: {command} enable pack=daily scope=chat',
    'command.needAction': 'Say what to do: enable, disable, on, off, reload or conflicts.',
    'command.turnedOn':
        'st-emote is on again. Stickers already on screen are back, and {{st-emote}} expands.',
    'command.turnedOff':
        'st-emote is off. Stickers on screen go back to their markers, and {{st-emote}} '
        + 'expands to nothing until you turn it on again.',
    'command.conflictsShown': 'Conflicts: {count}. They are in the console too.',
    'command.returns': 'A confirmation sentence about what changed.',
    'command.help':
        'Turn sticker packs on or off in one scope, turn st-emote itself on or off, '
        + 'reload it, or list the label conflicts in the effective set.',

    // ── one-off notices ────────────────────────────────────────────────────
    'macro.missing': 'No macro API available; {{st-emote}} will not expand.',
    'macro.description': 'Lists the stickers available to the current scopes, one row per sticker.',
    'macro.returns':
        'One "pack:label (description)" row per sticker, with the parentheses '
        + 'omitted when there is no description. With "simple" it prints "pack:label" '
        + 'rows. An empty set prints the word for "none".',
    'macro.modeDescription':
        'Listing mode: "full" prints "pack:label (description)", "simple" prints '
        + '"pack:label".',
};
const ZH_CN = {
    // ── 面板 ───────────────────────────────────────────────────────────────
    'panel.intro':
        '把图片上传进一个表情包，给每张填一个标签，再在需要它生效的地方启用这个包。',
    'panel.introTokenCaption': '标记的样子：',
    'panel.tokenExample': '[[sticker:表情包名:标签]]',

    'block.library': '表情包',
    'block.rendering': '渲染',
    'block.appearance': '外观',
    'block.tools': '接入与工具',

    'panel.packCount': '{count} 个表情包',
    'panel.packCount.one': '{count} 个表情包',
    'panel.statusLabel': '当前生效',
    'panel.statusOff': '渲染已关闭：屏幕上的表情全部退回原始标记',

    'panel.startStep1': '起一个表情包名，按 + 新建。',
    'panel.startStep2': '往里上传图片，并给每张填一个标签——标记指名的就是标签。',
    'panel.startStep3': '在「全局 / 角色 / 聊天」里启用这个表情包。',
    'panel.startStep4': '在预设里写上 {{st-emote}}，模型才知道自己可以用哪些表情。',
    'panel.iconHint':
        '下面那些按钮是图标：悬停一个就知道它是做什么的，读屏念出的也是同一句话。'
        + '带说明或示例的区块默认收起——需要的时候再展开。',
    'panel.renderUser': '在用户消息里也渲染表情',
    'panel.enabled': '总开关：渲染表情',
    'panel.enabledHint':
        '关掉后，屏幕上已经渲染出来的表情立刻退回原始标记，{{st-emote}} 清单宏也展开成空——'
        + '渲染已经关了，还给模型一份清单，只会诱使它写一堆永远不会出现的标记。',
    'panel.tagName': 'HTML 标签形态',
    'panel.sizeHint':
        '表情图出现在哪里、显示多大。尺寸写数字加 em、px 或 %；1em 等于当前聊天的文字高度。'
        + '留空则用该项的默认值。% 只在宽度方向有保证：高度的百分比取决于父元素自身是否已有高度。',
    'panel.newPackName': '新表情包名',
    'panel.createPack': '新建表情包',
    'panel.missingPackHeader': '当前聊天涉及的角色卡引用了本地没有的表情包（{count}）',
    'panel.createMissingPacks': '创建缺失的表情包',
    'panel.missingPacksCreated': '已创建 {count} 个空表情包，请往里上传图片。',
    'panel.noPacks': '还没有表情包。新建一个就能上传图片。',
    'panel.noStickerMatches': '没有表情匹配「{query}」。',
    'panel.searchPlaceholder': '搜索标签与描述',
    'panel.importPack': '导入表情包（.zip）',
    'panel.transferHint':
        '整包搬移：导出会写出一个 zip，含图片以及它们的标签、描述与投放方式覆盖；'
        + '导入把这样的 zip 读回来。导入的包在你启用之前不进入任何作用域。',
    'panel.macroTitle': '清单宏',
    'panel.regexTitle': '只从上下文清掉标记的正则',
    'panel.transferTitle': '导入 / 导出一个表情包',
    'panel.debugTitle': '试渲染 / 重新渲染',
    'panel.macroHint': '在你自己的预设里写下面任意一个，就能拿到表情清单：',
    'panel.macroExample':
        '{{st-emote}}       每行一个「表情包名:标签 (描述)」\n'
        + '{{st-emote::full}}     与 {{st-emote}} 相同\n'
        + '{{st-emote::simple}}   每行一个「表情包名:标签」，不带描述',
    'panel.regexHint':
        '只把标记从上下文里清掉（聊天里仍然显示图片）。'
        + '复制这段 JSON，在正则扩展里以 "Import To: Global" 导入。',
    'panel.copyRegex': '复制正则 JSON',
    'panel.regexCopied': '正则 JSON 已复制。',
    'panel.regexCopyFailed': '无法写入剪贴板，请手动选中文本。',

    // ── 调试区 ─────────────────────────────────────────────────────────────
    'panel.debugHint':
        '把一段消息粘到这里，就能看到它按上面的设置渲染成什么样，不会动聊天记录。'
        + '文本按纯文本处理：markdown 的代码围栏会照你写的样子显示，而粘进来的一段代码或'
        + '预格式化元素会被跳过——和聊天里一样。未命中与被忽略的尺寸值会写进浏览器控制台，'
        + '统一带 [st-emote] 前缀。',
    'panel.previewPlaceholder': '粘一段消息，例如 她笑了。[[sticker:daily:happy]]',
    'panel.previewRun': '试渲染',
    'panel.previewEmpty': '没有可渲染的内容：这段文本里没有表情标记。',
    'panel.previewMisses': '未命中：{reasons}',
    'panel.rerender': '重新渲染当前聊天',
    'panel.rerendered': '已重新渲染当前聊天。',

    // ── 包列表里的一行 ─────────────────────────────────────────────────────
    'pack.uploadImages': '上传图片',
    'pack.addImageUrl': '添加图片地址',
    'pack.exportZip': '导出 .zip',
    'pack.deletePack': '删除表情包',
    'pack.stickerCount': '{count} 个表情',
    'pack.stickerCount.one': '{count} 个表情',
    'pack.stateEmpty': '空',
    'pack.stateEmptyTitle': '这个表情包还没有任何表情。可以启用，但不会有任何标记命中它。',
    'pack.stateImagesMissing': '图片未同步',
    'pack.stateImagesMissingTitle': '图片文件不在这台服务器上。表情包仍可用——把表情重新指向你自己的图片。',
    'pack.coverRepoint': '图片不在这台服务器上——点一下重新指定第一张缺图的表情',
    'pack.selectAllTitle': '选中这个表情包里的全部表情',
    'pack.selectAll': '全选',
    'pack.selectMatches': '选中匹配项',
    'pack.selectedCount': '已选 {count}',
    'pack.selectedCount.one': '已选 {count}',
    'pack.deleteSelected': '删除选中的 {count} 个',
    'pack.searchDeleteHint': '清空搜索后才能删除选中的表情。',
    'pack.renamed': '已改名为「{name}」。用旧名字写的标记不再匹配。',
    'pack.nameTaken': '已经有一个叫「{name}」的表情包了。',
    // 包头兼作手风琴开关（票 12），所以这一行得说清点击会往哪边走。
    'pack.expand': '展开这个表情包',
    'pack.collapse': '收起这个表情包',
    // 批量是一个模式，所以按钮分别说「进入」和「退出」。图标只有一个，
    // 当前状态由 `aria-pressed` 与高亮样式说。
    'pack.batchMode': '批量选择表情',
    'pack.batchModeDone': '结束批量选择',

    // ── 一行表情 ───────────────────────────────────────────────────────────
    'sticker.selectForDelete': '勾选以便批量删除',
    'sticker.labelPlaceholder': '标签',
    'sticker.unlabeled': '待填标签',
    'sticker.external': '外链',
    'sticker.externalTitle': '图片来自一个网址，没有存到本地。',
    'sticker.replace': '替换',
    'sticker.delete': '删除',
    'sticker.renamed': '标签已改为「{name}」。用旧标签写的标记不再匹配。',
    'sticker.labelTaken': '这个表情包里已经有一张标签为「{name}」的表情了。',
    // 一个格子就是一张表情的默认全部内容，所以它带两句话：它是什么（标签与
    // 描述，写在格子的 `title` 里）以及点它会做什么。
    'sticker.cellCaption': '{name}——点一下编辑',
    'sticker.cellCaptionUnlabeled': '待填标签——点一下编辑',
    'sticker.cellTitle': '{name}：{description}',
    'sticker.cellTitleNoDescription': '{name}',
    'sticker.cellTitleUnlabeled': '待填标签：{description}',
    'sticker.closeEditor': '关闭',

    // ── 作用域 ─────────────────────────────────────────────────────────────
    'scope.global': '全局',
    'scope.character': '角色',
    'scope.chat': '聊天',

    // ── 投放方式 ───────────────────────────────────────────────────────────
    'placement.in-place': '原地',
    'placement.after-block': '块后',
    'placement.message-end': '消息末尾',
    'placement.follow': '跟随全局设置',
    'placement.override': '这张表情的投放方式覆盖',
    'placement.label': '投放方式',

    // ── 尺寸集 ─────────────────────────────────────────────────────────────
    'size.inline': '原地尺寸（inline）',
    'size.block': '块级尺寸（块后 / 消息末尾）',
    'size.minWidth': '最小宽度',
    'size.minHeight': '最小高度',
    'size.maxWidth': '最大宽度',
    'size.maxHeight': '最大高度',
    'size.fit': '填充方式',
    'size.fitDefault': '默认',
    'size.marginX': '表情之间的空隙（左右）',
    'size.marginY': '表情之间的空隙（上下）',
    'size.invalidHint': '需要数字加 em、px 或 %',
    'size.invalidFitHint': '不是 cover、contain 或 fill 之一',
    'size.customized': '已改过',
    'size.invalidMark': '!',

    // ── 标记形态 ───────────────────────────────────────────────────────────
    'form.label': '标记形态',
    'form.bracket': '标记式：[[sticker:表情包名:标签]]',
    'form.tag': 'HTML 标签式：下面配置的标签名，包住「表情包名:标签」',
    'form.bothOff':
        '两种标记形态都关着，所以任何表情都不会渲染。宏与「只从上下文清掉标记」的正则仍然可用；'
        + '打开其中一种形态即可恢复渲染。',

    // ── 字段校验 ───────────────────────────────────────────────────────────
    'constraint.packName': '表情包名',
    'constraint.label': '标签',
    'constraint.description': '描述',
    'constraint.htmlTag': 'HTML 标签名',
    'constraint.reason.empty': '不能为空',
    'constraint.reason.too-long': '太长',
    'constraint.reason.forbidden-character': '不能包含 [ ] < 或 >',
    'constraint.reason.newline': '不能换行',
    'constraint.reason.colon': '不能包含「：」',
    'constraint.reason.invalid': '必须以字母开头，只能用字母、数字和「-」',
    'constraint.reason.reserved': '是真实的 HTML 标签名',
    'constraint.reason.unknown': '不合法',

    // ── 图片规则 ───────────────────────────────────────────────────────────
    'upload.tooLarge': '大于 {limit}——请换一张小一点的（本扩展不压缩图片）',
    'upload.unsupportedFormat': '不是 png、jpg、webp 或 gif',
    'upload.failed': '{name} 没有被加入：{reason}',
    'upload.done': '已把 {count} 张图片上传到「{name}」。',
    'upload.done.one': '已把 {count} 张图片上传到「{name}」。',
    'upload.tooTall': '比建议的 {limit}px 更高：{names}。它们仍然可用；小一点的图插在文字里更好看。',
    'url.prompt': '图片地址（http:// 或 https://）：',
    'url.empty': '没有填地址。',
    'url.malformed': '那不是一个 http(s) 图片地址。',
    'url.added': '已给「{name}」加了一张外链表情。填上标签才能使用。',
    'image.replaced': '图片已替换，标签与描述保持不变。',
    'image.set': '图片已设置。',
    'image.replaceFailed': '图片没有换掉：{reason}',

    // ── 删除 ───────────────────────────────────────────────────────────────
    'delete.sticker': '删除 {name} 和它的图片文件？',
    'delete.stickerUnnamed': '删除这张表情和它的图片文件？',
    'delete.selected': '删除选中的 {count} 个表情和它们的图片文件？',
    'delete.selected.one': '删除选中的 {count} 个表情和它的图片文件？',
    'delete.pack':
        '删除表情包「{name}」？这会移除 {count} 个表情、删掉它们的图片文件，'
        + '并把这个包从所有作用域里摘掉。指名它的标记将不再匹配。',
    'delete.pack.one':
        '删除表情包「{name}」？这会移除 {count} 个表情、删掉它的图片文件，'
        + '并把这个包从所有作用域里摘掉。指名它的标记将不再匹配。',
    'delete.packDone': '已删除「{name}」。',

    // ── 表情包压缩包 ───────────────────────────────────────────────────────
    'export.done': '已导出「{name}」，含 {count} 张图片。',
    'export.done.one': '已导出「{name}」，含 {count} 张图片。',
    'export.failed': '无法导出「{name}」：{reason}',
    'export.imageMissing': '图片文件 {path} 不在这台服务器上',
    'import.readFailed': '无法读取 {name}：{reason}',
    'import.done': '已导入「{name}」，含 {count} 个表情（存下 {stored} 张图片）。它还没有在任何地方启用。',
    'import.done.one': '已导入「{name}」，含 {count} 个表情（存下 {stored} 张图片）。它还没有在任何地方启用。',
    'import.reason.not-a-zip': '那个文件不是可读的 zip 压缩包',
    'import.reason.no-manifest': '那个 zip 里没有 {file}，所以它不是 st-emote 表情包',
    'import.reason.not-a-pack': '那个 zip 不是 st-emote 导出的',
    'import.reason.unsupported-version': '那个表情包来自更新版本的 st-emote',
    'import.reason.name-taken': '已经有同名的表情包了；请先改名或删掉它',
    'import.reason.missing-image': '那个表情包不完整：zip 里少了其中一个图片文件',
    'import.reason.unsupported-format': '那个表情包里有一张不是 png、jpg、webp 或 gif 的图片',
    'import.reason.image-too-large': '那个表情包里有一张大于 {limit} 的图片',
    'import.reason.invalid-name': '那个表情包里没有可用的名字',
    'import.reason.not-json': '那个 zip 里没有可读的 {file}',
    'import.reason.invalid-stickers': '那个表情包列表情的写法这一版读不了',
    'import.reason.invalid-sticker': '里面有一张表情是这一版读不了的',
    'import.reason.duplicate-label': '里面有两张表情用了同一个标签',
    'import.reason.invalid-label': '里面有一张表情的标签这一版不接受',
    'import.reason.invalid-description': '里面有一张表情的描述这一版不接受',
    'import.reason.invalid-placement': '里面有一张表情要的投放方式这一版没有',
    'import.reason.invalid-image': '里面有一张表情同时写了文件和地址',
    'import.reason.unsafe-file': '里面有一张表情的文件名指向包外面',
    'import.reason.invalid-url': '里面有一张表情的地址这一版不接受',
    'import.reason.unknown': '那个表情包读不出来（{reason}）',

    // ── 宏展开出的清单 ─────────────────────────────────────────────────────
    'listing.empty': '无',

    // ── 调试区里的未命中理由 ───────────────────────────────────────────────
    'miss.reason.pack-not-found': '没有叫这个的名字的表情包',
    'miss.reason.pack-not-enabled': '这个表情包在当前作用域里没有启用',
    'miss.reason.label-not-found': '没有这个标签的表情',
    'miss.reason.ambiguous-bare-label': '启用的表情包不止一个，裸标签有歧义',
    'miss.reason.image-missing': '图片不在这台服务器上',
    'miss.reason.external-link-failed': '图片地址打不开',

    // ── 冲突 ───────────────────────────────────────────────────────────────
    'conflict.header': '生效集里的标签冲突（{count}）',
    'conflict.header.one': '生效集里的标签冲突（{count}）',
    'conflict.none': '生效集里没有哪个标签被一个以上的表情包定义。',
    'conflict.row': '{label} —— 由 {packs} 定义',
    'conflict.logLine': '标签冲突：「{label}」由 {packs} 定义',

    // ── 斜杠命令 ───────────────────────────────────────────────────────────
    'command.repainted': '已重新渲染当前聊天：每条消息都从源文本重画了一遍。',
    'command.enabled': '已在{scope}作用域启用「{name}」。',
    'command.disabled': '已在{scope}作用域停用「{name}」。',
    'command.unknownScope': '不认识的 scope「{scope}」。可用：{scopes}。',
    'command.packArgument': '要启停的表情包',
    'command.scopeArgument': '改动哪个作用域：{scopes}（默认 global）',
    'command.unknownPack': '没有叫「{name}」的表情包。',
    'command.noCharacter': '当前没有选中角色卡，角色作用域无处可写。',
    'command.needPack': '请指明表情包名，例如：{command} enable pack=daily scope=chat',
    'command.needAction': '请说明要做什么：enable、disable、on、off、reload 或 conflicts。',
    'command.turnedOn': 'st-emote 已重新打开。屏幕上的表情回来了，{{st-emote}} 也会展开。',
    'command.turnedOff':
        'st-emote 已关闭。屏幕上的表情退回原始标记，{{st-emote}} 也展开成空，直到你重新打开为止。',
    'command.conflictsShown': '冲突 {count} 条，控制台里也有。',
    'command.returns': '一句说明改动了什么的话。',
    'command.help': '在某个作用域里启停表情包、开关 st-emote 本身、重载它，或列出生效集里的标签冲突。',

    // ── 一次性提示 ─────────────────────────────────────────────────────────
    'macro.missing': '没有可用的宏接口，{{st-emote}} 不会展开。',
    'macro.description': '列出当前作用域可用的表情，一行一个。',
    'macro.returns':
        '每行一个「表情包名:标签 (描述)」，描述为空时省略括号。用 "simple" 时只列「表情包名:标签」。'
        + '生效集为空时展开成「无」。',
    'macro.modeDescription': '清单档位："full" 列「表情包名:标签 (描述)」，"simple" 只列「表情包名:标签」。',
};

/**
 * Every locale this extension ships, keyed by locale id. The English source is
 * in here too, so a caller never has to know which one is the fallback.
 *
 * @type {Readonly<Record<string, Record<string, string>>>}
 */
export const CATALOGS = {
    en: EN,
    'zh-cn': ZH_CN,
};
