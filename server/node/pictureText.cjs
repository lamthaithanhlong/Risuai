// Where a picture goes in a message, for the server's side of the picture queue. The same rule as the page's placePicture
// (src/ts/process/imageJobClient.ts; imageJobClient.test.ts checks the two against each other), idempotent: a picture already in the
// message is left alone, so the server, a page that waited and a page that recovered the job can all apply it.
//   already there -> unchanged; else the first picture of the message is replaced; else it goes on top.

const inlayTag = (id) => `{{inlay::${id}}}`;

function placePicture(text, inlayId) {
    const tag = inlayTag(inlayId);
    const src = text ?? '';
    if (src.includes(tag)) return src;
    let replaced = false;
    const out = src.replace(/\{\{inlay::[^}]*\}\}/, () => { replaced = true; return tag; });
    return replaced ? out : (src.trim() ? `${tag}\n\n${src.trim()}` : tag);
}

/**
 * Puts the picture into message `target.messageId` of chat `target.chatId` in a character object (the content of
 * remotes/<chaId>.local.bin), by ids and never by position. Returns 'placed' (changed), 'already' (it was there), 'wait' (no such chat or
 * message in this file yet: the page that asked has not saved it) or 'unsupported' (no ids to go by).
 * The chat's picture cooldown (a story script's `imagegen_off_until`) is left to the page: that variable belongs to the script.
 */
function findMessage(character, target) {
    if (!character || typeof character !== 'object' || !target?.chatId || !target?.messageId) return undefined;
    const chat = (character.chats ?? []).find((c) => c?.id === target.chatId);
    return chat?.message?.find((m) => m?.chatId === target.messageId) ?? null;
}

function placeInCharacter(character, target, inlayId) {
    const message = findMessage(character, target);
    if (message === undefined) return 'unsupported';
    if (message === null) return 'wait';
    const next = placePicture(message.data, inlayId);
    if (next === message.data) return 'already';
    message.data = next;
    return 'placed';
}

module.exports = { placePicture, placeInCharacter, findMessage };
