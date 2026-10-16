// The page's side of the built-in scene pictures (scenePictures.ts): the ask in the request, and drawing after a reply.

import { getDatabase, type Chat, type character, type groupChat } from '../storage/database.svelte'
import { portraitsOn } from './portraitsPage'
import { storyStyle } from './portraits'
import { placePicture } from './imageJobClient'
import { cardHasOwnPictures, COOLDOWN_KEY, pictureAllowed, planScenePicture, SCENE_ASK, SCENE_COOLDOWN_MS, SCENE_NEGATIVE } from './scenePictures'
import type { OpenAIChat } from './index.svelte'

type Room = character | groupChat

/** On for a story card (not a group) with a picture provider set and no pictures of its own (cardHasOwnPictures). */
export function scenePicturesOn(card: Room | undefined): card is character {
    const db = getDatabase()
    return db.autoScenePictures !== false && portraitsOn() && !!card && card.type !== 'group' && !cardHasOwnPictures(card as character)
}

const offUntil = (chat: Chat | undefined) => Number(chat?.scriptstate?.[COOLDOWN_KEY] ?? 0) || 0

/** The ask goes at the end of the player's message, only when a picture is allowed now (one in three replies, no cooldown). */
export function scenePictureRequest<T extends OpenAIChat>(formated: T[], card: Room | undefined, chat: Chat | undefined): T[] {
    if (!scenePicturesOn(card) || !pictureAllowed(chat?.message ?? [], offUntil(chat), Date.now())) return formated
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (last < 0 || typeof formated[last].content !== 'string') return formated
    return formated.map((m, i) => (i === last ? { ...m, content: (m.content as string) + SCENE_ASK } : m))
}

/** After a reply: its [[img: …]] line is taken out at once, and drawn when allowed (not awaited: the chat goes on). */
export function noteScenePicture(charIndex: number, chat: Chat | undefined): void {
    const db = getDatabase()
    const card = db.characters[charIndex] as Room | undefined
    if (!chat || !scenePicturesOn(card)) return
    const at = chat.message.length - 1
    const reply = chat.message[at]
    if (!reply || reply.role !== 'char') return
    const plan = planScenePicture(reply.data, chat.message.slice(0, at), offUntil(chat), Date.now())
    if (!plan) return
    chat.message[at] = { ...reply, data: plan.cleaned }
    if (!plan.prompt) {
        console.info('[scene picture] not drawn:', plan.why)
        return
    }
    // the cooldown starts now and is lifted only by a picture, so a failure of any kind costs one error, not one per reply
    chat.scriptstate ??= {}
    chat.scriptstate[COOLDOWN_KEY] = Date.now() + SCENE_COOLDOWN_MS
    const messageId = reply.chatId
    import('./scenePictureDraw')
        .then(({ drawScenePicture }) => drawScenePicture(card, chat, storyStyle(card) + plan.prompt, SCENE_NEGATIVE, at))
        .then((result) => {
            const m = /^\{\{inlay::([^}]+)\}\}/.exec(result ?? '')
            if (!m) return
            // read the chat again: it may have changed while the picture was drawn
            const live = getDatabase().characters[charIndex]?.chats?.find((c) => c === chat || (chat.id && c.id === chat.id))
            if (!live) return
            live.scriptstate ??= {}
            live.scriptstate[COOLDOWN_KEY] = 0
            const i = messageId ? live.message.findIndex((x) => x.chatId === messageId) : at
            if (i < 0 || !live.message[i]) return
            live.message[i] = { ...live.message[i], data: placePicture(live.message[i].data, m[1]) }
        })
        .catch((e) => console.warn('[scene picture] drawing failed', e))
}
