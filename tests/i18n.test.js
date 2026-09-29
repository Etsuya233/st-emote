/**
 * The message catalog, tested as a catalog.
 *
 * The catalogs are pure data and the lookup is a pure function, which is what
 * makes "the panel is bilingual" something a test can hold down rather than
 * something a reviewer has to read twice. What matters is not that any one
 * sentence reads well — that is a translator's job — but that the two locales
 * cover the same keys, that a missing translation degrades to the English
 * source rather than to a blank, and that the pieces with a value in them
 * (counts, names) put the value where that language wants it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CATALOGS, DEFAULT_LOCALE, resolveLocale, t, tKeys } from '../core/i18n.js';
import { withLocale } from './contract/locale.js';

test('every locale covers exactly the keys the English source defines', () => {
    const english = tKeys(DEFAULT_LOCALE).sort();
    assert.ok(english.length > 50, `the catalog looks unfinished: ${english.length} keys`);
    for (const locale of Object.keys(CATALOGS)) {
        if (locale === DEFAULT_LOCALE) {
            continue;
        }
        assert.deepEqual(tKeys(locale).sort(), english, locale);
    }
});

test('no catalog defines a key the English source does not', () => {
    const english = new Set(tKeys(DEFAULT_LOCALE));
    for (const locale of Object.keys(CATALOGS)) {
        for (const key of tKeys(locale)) {
            assert.equal(english.has(key), true, `${locale} defines an unknown key ${key}`);
        }
    }
});

test('a locale with no catalog falls back to the English source', () => {
    withLocale('fr-fr', () => {
        assert.equal(t('panel.createPack'), CATALOGS.en['panel.createPack']);
    });
});

test('the locale the adapter publishes is the one t reads', () => {
    // `t` has no locale argument: the language is the ambient value the adapter
    // publishes, and a test that wants the other catalog publishes it the same way.
    assert.equal(t('panel.createPack'), 'Create pack');
    withLocale('zh-cn', () => {
        assert.equal(t('panel.createPack'), '新建表情包');
    });
    assert.equal(t('panel.createPack'), 'Create pack');
});

test('an unknown key comes back as itself rather than as nothing', () => {
    withLocale('zh-cn', () => {
        assert.equal(t('panel.nothingUsesThis'), 'panel.nothingUsesThis');
    });
});

test('the shipped locale reads as Chinese and the source as English', () => {
    assert.equal(t('panel.createPack'), 'Create pack');
    withLocale('zh-cn', () => {
        assert.equal(t('panel.createPack'), '新建表情包');
    });
});

test('a Chinese client locale resolves to the Chinese catalog', () => {
    for (const locale of ['zh-cn', 'zh', 'ZH-CN', 'zh_CN', 'zh-hans', 'zh-Hans-CN', 'zh-cn-x-foo']) {
        assert.equal(resolveLocale(locale), 'zh-cn', locale);
    }
    for (const locale of ['en', 'en-us', 'ja-jp', 'de-de', '', null, undefined]) {
        assert.equal(resolveLocale(locale), 'en', String(locale));
    }
});

test('a Chinese variant this catalog does not serve reads as English', () => {
    // The catalog is Simplified. Handing a Traditional user the Simplified text
    // would be worse than handing them English they can read.
    assert.equal(resolveLocale('zh-tw'), 'en');
    assert.equal(resolveLocale('zh-hant'), 'en');
    assert.equal(resolveLocale('zh-hk'), 'en');
});

test('a value is substituted where the sentence puts it', () => {
    withLocale('en', () => assert.match(t('panel.noStickerMatches', { query: 'zzz' }), /zzz/));
    withLocale('zh-cn', () => assert.match(t('panel.noStickerMatches', { query: 'zzz' }), /zzz/));
});

test('a value nobody supplied is left as the placeholder, so the gap is visible', () => {
    assert.match(t('panel.noStickerMatches', {}), /\{query\}/);
});

test('a count picks the singular wording when there is exactly one', () => {
    withLocale('en', () => {
        assert.equal(t('pack.stickerCount', { count: 1 }), '1 sticker');
        assert.equal(t('pack.stickerCount', { count: 3 }), '3 stickers');
    });
    // Chinese has no plural, so both spellings are the same sentence.
    withLocale('zh-cn', () => {
        assert.equal(t('pack.stickerCount', { count: 1 }), '1 个表情');
        assert.equal(t('pack.stickerCount', { count: 3 }), '3 个表情');
    });
});

test('a count with no singular wording keeps its own', () => {
    // The rule is "try `.one` first", not "every counted key must have one" —
    // otherwise a key like the missing-packs header would be forced into a
    // plural it does not have.
    assert.equal(t('panel.missingPackHeader', { count: 1 }),
        "Missing packs referenced by this chat's characters (1)");
    assert.match(t('panel.missingPackHeader', { count: 2 }), /2/);
    assert.equal(CATALOGS.en['panel.missingPackHeader.one'], undefined);
});

test('no catalog value is empty or a bare placeholder', () => {
    for (const locale of Object.keys(CATALOGS)) {
        for (const key of tKeys(locale)) {
            const value = CATALOGS[locale][key];
            assert.equal(typeof value, 'string', `${locale}.${key}`);
            assert.notEqual(value.trim(), '', `${locale}.${key}`);
        }
    }
});

test('no catalog value carries markup', () => {
    // The panel assembles some sentences into `innerHTML`, so a catalog value
    // that grew a tag would be a catalog that grew a rule. Values are plain text
    // and the few inline `<code>` spans are built as their own elements beside
    // the text — see the module note in `core/i18n.js`.
    for (const locale of Object.keys(CATALOGS)) {
        for (const key of tKeys(locale)) {
            assert.doesNotMatch(CATALOGS[locale][key], /<[a-z/]/i, `${locale}.${key}`);
        }
    }
});

test('every miss reason has a sentence, because the debug area names them', () => {
    // The keys are the `Miss['reason']` values, so a new reason added to
    // `core/render.js` shows up here as a missing sentence rather than as a
    // label in the panel reading like a variable name.
    const reasons = [
        'pack-not-found',
        'pack-not-enabled',
        'label-not-found',
        'ambiguous-bare-label',
        'image-missing',
        'external-link-failed',
    ];
    for (const locale of Object.keys(CATALOGS)) {
        for (const reason of reasons) {
            const key = `miss.reason.${reason}`;
            assert.ok(tKeys(locale).includes(key), `${locale} has no sentence for ${reason}`);
        }
    }
});

test('an interpolated value is substituted, and the lookup does not escape it', () => {
    // The panel applies every sentence with `textContent`, so the lookup has no
    // escaping step and none is wanted here: escaping at the lookup would make
    // the same sentence read as `&lt;img` in a toast.
    const values = { name: '<img src=x onerror=alert(1)>' };
    assert.match(t('pack.nameTaken', values), /<img/);
    withLocale('zh-cn', () => assert.match(t('pack.nameTaken', values), /<img/));
});

test('the catalog carries no value nobody can reach', () => {
    // A key defined in both catalogs and read by nothing is a sentence that will
    // never be corrected, because the failure it was written for is one nobody
    // can see happening. The list is the set of keys the code actually looks up;
    // a key added to a catalog has to be added here too, or this fails.
    const used = new Set([
        'panel.intro', 'panel.introTokenCaption', 'panel.tokenExample', 'panel.iconHint',
        'panel.renderUser', 'panel.enabled', 'panel.enabledHint', 'form.label',
        'form.bracket', 'form.tag', 'form.bothOff',
        'panel.tagName', 'panel.sizeHint', 'panel.newPackName',
        'panel.createPack', 'panel.missingPackHeader', 'panel.createMissingPacks',
        'panel.missingPacksCreated', 'panel.noPacks', 'panel.noStickerMatches',
        'panel.searchPlaceholder', 'panel.importPack', 'panel.transferHint',
        'panel.macroTitle', 'panel.regexTitle', 'panel.transferTitle', 'panel.debugTitle',
        'panel.macroHint', 'panel.macroExample', 'panel.regexHint', 'panel.copyRegex',
        'panel.regexCopied', 'panel.regexCopyFailed', 'panel.debugHint',
        'panel.previewPlaceholder', 'panel.previewRun', 'panel.previewEmpty',
        'panel.previewMisses', 'panel.rerender', 'panel.rerendered',
        'pack.uploadImages', 'pack.addImageUrl', 'pack.exportZip', 'pack.deletePack',
        'pack.stickerCount', 'pack.stateEmpty', 'pack.stateEmptyTitle',
        'pack.stateImagesMissing', 'pack.stateImagesMissingTitle', 'pack.coverRepoint',
        'pack.selectAllTitle', 'pack.selectAll', 'pack.selectMatches',
        'pack.selectedCount', 'pack.deleteSelected', 'pack.searchDeleteHint',
        'pack.renamed', 'pack.nameTaken',
        'sticker.selectForDelete', 'sticker.labelPlaceholder', 'sticker.unlabeled',
        'sticker.external', 'sticker.externalTitle', 'sticker.replace', 'sticker.delete',
        'sticker.renamed', 'sticker.labelTaken',
        'scope.global', 'scope.character', 'scope.chat',
        'placement.in-place', 'placement.after-block', 'placement.message-end',
        'placement.follow', 'placement.override', 'placement.label',
        'size.inline', 'size.block', 'size.minWidth', 'size.minHeight', 'size.maxWidth',
        'size.maxHeight', 'size.fit', 'size.fitDefault', 'size.marginX', 'size.marginY',
        'size.invalidHint', 'size.customized', 'size.invalidMark',
        'constraint.packName', 'constraint.label', 'constraint.description',
        'constraint.htmlTag', 'constraint.reason.empty', 'constraint.reason.too-long',
        'constraint.reason.forbidden-character', 'constraint.reason.newline',
        'constraint.reason.colon', 'constraint.reason.invalid',
        'constraint.reason.reserved', 'constraint.reason.unknown',
        'upload.tooLarge', 'upload.unsupportedFormat', 'upload.failed', 'upload.done',
        'upload.tooTall', 'url.prompt', 'url.empty', 'url.malformed', 'url.added',
        'image.replaced', 'image.set', 'image.replaceFailed',
        'delete.sticker', 'delete.stickerUnnamed', 'delete.selected', 'delete.pack',
        'delete.packDone', 'export.done', 'export.failed', 'export.imageMissing',
        'import.readFailed', 'import.done', 'import.reason.unknown',
        'listing.empty', 'conflict.header', 'conflict.none', 'conflict.row',
        'conflict.logLine', 'command.repainted', 'command.enabled', 'command.disabled',
        'command.unknownScope', 'command.unknownPack', 'command.noCharacter',
        'command.packArgument', 'command.scopeArgument', 'command.needPack',
        'command.needAction', 'command.turnedOn', 'command.turnedOff',
        'command.conflictsShown', 'command.returns', 'command.help',
        'macro.missing', 'macro.description', 'macro.returns', 'macro.modeDescription',
    ]);
    // Keys assembled from another value's name, so they cannot be listed here.
    for (const reason of [
        'pack-not-found', 'pack-not-enabled', 'label-not-found', 'ambiguous-bare-label',
        'image-missing', 'external-link-failed',
    ]) {
        used.add(`miss.reason.${reason}`);
    }
    for (const reason of [
        'not-a-zip', 'no-manifest', 'not-a-pack', 'unsupported-version', 'name-taken',
        'missing-image', 'unsupported-format', 'image-too-large', 'not-json',
        'invalid-name', 'invalid-stickers', 'invalid-sticker', 'duplicate-label',
        'invalid-label', 'invalid-description', 'invalid-placement', 'invalid-image',
        'unsafe-file', 'invalid-url',
    ]) {
        used.add(`import.reason.${reason}`);
    }
    // And the singular variants, which `t` reaches by appending `.one`.
    for (const key of [...used]) {
        if (CATALOGS.en[`${key}.one`] !== undefined) {
            used.add(`${key}.one`);
        }
    }

    const orphans = tKeys(DEFAULT_LOCALE).filter((key) => !used.has(key));
    assert.deepEqual(orphans, [], 'catalogued but never read');
});

