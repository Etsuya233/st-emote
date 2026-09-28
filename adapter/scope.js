import { mergeEnabledPackNames } from '../core/effective-set.js';
import { normalizePackName } from '../core/normalize.js';
import { STORAGE_KEY } from './settings.js';

/**
 * SillyTavern hands out a fresh context object on every call, and it reassigns
 * the bindings for the chat, the chat metadata and the character list as the
 * user moves around. A context captured at startup can therefore go stale, so
 * everything scope-related re-reads the live context.
 *
 * @param {any} context
 * @returns {any}
 */
export function liveContext(context) {
    return globalThis.SillyTavern?.getContext?.() ?? context;
}

/**
 * @param {any} value
 * @returns {string[]}
 */
function scopePackNames(value) {
    return mergeEnabledPackNames(value?.enabledPackNames);
}

/**
 * Shape one scope's storage payload.
 *
 * @param {string[]} names
 * @returns {{enabledPackNames: string[]}}
 */
function scopeRecord(names) {
    return { enabledPackNames: mergeEnabledPackNames(names) };
}

/**
 * The pack names the current chat enables (chat scope).
 *
 * @param {any} context
 * @returns {string[]}
 */
export function getChatScope(context) {
    return scopePackNames(liveContext(context)?.chatMetadata?.[STORAGE_KEY]);
}

/**
 * Persist the chat scope into the chat metadata.
 *
 * @param {any} context
 * @param {string[]} names
 */
export function setChatScope(context, names) {
    const live = liveContext(context);
    const current = live?.chatMetadata?.[STORAGE_KEY];
    live.updateChatMetadata({
        [STORAGE_KEY]: {
            ...(current && typeof current === 'object' ? current : {}),
            ...scopeRecord(names),
        },
    });
    live.saveMetadata();
}

/**
 * @param {any} character
 * @returns {string[]}
 */
export function getCharacterScope(character) {
    return scopePackNames(character?.data?.extensions?.[STORAGE_KEY]);
}

/**
 * The pack names one character card enables (role scope).
 *
 * @param {any} context
 * @param {string} avatar - Character avatar filename.
 * @returns {string[]}
 */
export function getCharacterScopeForAvatar(context, avatar) {
    const characters = liveContext(context)?.characters;
    const character = Array.isArray(characters)
        ? characters.find((item) => item?.avatar === avatar)
        : null;
    return getCharacterScope(character);
}

/**
 * The character card currently selected in the chat, or null.
 *
 * @param {any} context
 * @returns {any}
 */
export function getCurrentCharacter(context) {
    const live = liveContext(context);
    return live?.characters?.[live?.characterId] ?? null;
}

/**
 * The pack names the currently selected character card enables.
 *
 * @param {any} context
 * @returns {string[]}
 */
export function getCurrentCharacterScope(context) {
    return getCharacterScope(getCurrentCharacter(context));
}

/**
 * Every role scope the current chat can involve: the selected character, the
 * group members, and the authors of the loaded messages. Used to surface packs
 * a card references but which are missing locally.
 *
 * @param {any} context
 * @returns {string[]}
 */
export function collectCharacterPackNames(context) {
    const live = liveContext(context);
    const characters = Array.isArray(live?.characters) ? live.characters : [];
    const avatars = new Set();

    const current = getCurrentCharacter(context);
    if (current?.avatar) {
        avatars.add(current.avatar);
    }

    const group = (Array.isArray(live?.groups) ? live.groups : [])
        .find((item) => String(item?.id) === String(live?.groupId));
    for (const avatar of Array.isArray(group?.members) ? group.members : []) {
        avatars.add(avatar);
    }

    for (const message of Array.isArray(live?.chat) ? live.chat : []) {
        if (message?.original_avatar) {
            avatars.add(message.original_avatar);
        }
    }

    return mergeEnabledPackNames(
        [...avatars].map((avatar) =>
            getCharacterScope(characters.find((item) => item?.avatar === avatar))),
    );
}

/**
 * Persist the role scope into the current character card. Does nothing when no
 * character is selected, such as in a group chat without a focused member.
 *
 * @param {any} context
 * @param {string[]} names
 * @returns {Promise<void>}
 */
export async function setCurrentCharacterScope(context, names) {
    const live = liveContext(context);
    const id = live?.characterId;
    if (id === undefined || id === null || !live?.characters?.[id]) {
        return;
    }
    await live.writeExtensionField(id, STORAGE_KEY, scopeRecord(names));
}

/**
 * Pack names a character card enables that the local catalogue does not have.
 * The panel lists these so the user can create the placeholders or find the
 * pack elsewhere.
 *
 * @param {import('./settings.js').Settings} settings
 * @param {string[]} names
 * @returns {string[]}
 */
export function missingPackNames(settings, names) {
    const known = new Set(
        (Array.isArray(settings?.packs) ? settings.packs : [])
            .map((pack) => normalizePackName(pack?.name)),
    );
    return mergeEnabledPackNames(names).filter((name) => !known.has(normalizePackName(name)));
}
