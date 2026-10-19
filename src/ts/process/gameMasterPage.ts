// The page's side of the Game Master (gameMaster.ts): the note in the request, and the [[GM]] block taken out after a reply.
// Works on every platform: no server, the state lives in the chat's variables (scriptstate "$gm_*").

import { getDatabase, type Chat, type character, type groupChat } from '../storage/database.svelte'
import { applyBookkeep, bookkeepPrompt, GM_KEYS, gmNote, gmPhase, gmRequest, gmStateOf, parseBookkeep, rollGm, settleGm, takeGm, worldFlavour, type GmState } from './gameMaster'
import { storyShape } from './replyFormat'

type Room = character | groupChat

/** On for a story card (not a group) unless turned off in the settings. */
export function gameMasterOn(card: Room | undefined): card is character {
    return getDatabase().gameMaster !== false && !!card && card.type !== 'group'
}

function writeState(chat: Chat, state: GmState): void {
    chat.scriptstate ??= {}
    // every key, so a value the rolled-back reply had added is cleared too
    for (const k of [...GM_KEYS, 'gm_beat_at', 'gm_at', 'gm_prev'] as const) chat.scriptstate['$' + k] = state[k] ?? ''
}

/** This turn's note at the end of the player's message (fresh dice every request); unchanged while the GM is silent. */
export function gameMasterRequest<T extends { role: string; content: unknown }>(formated: T[], card: Room | undefined, chat: Chat | undefined, rng?: () => number): T[] {
    if (!gameMasterOn(card) || !chat) return formated
    const messages = chat.message ?? []
    const settled = settleGm(gmStateOf(chat.scriptstate), messages)
    if (settled.rolledBack) writeState(chat, settled.state)
    const state = settled.state
    const replies = messages.filter((m) => m.role === 'char')
    const shape = storyShape(replies.map((m) => m.data ?? ''))
    const phase = gmPhase(card, messages, chat.scriptstate, state, shape.head.length + shape.tail.length > 0)
    const note = gmNote(phase, state, rollGm(state, replies.length, rng), worldFlavour(card))
    return gmRequest(formated, note)
}

/** After a reply: its [[GM]] block leaves the message and its values go to the chat's variables. */
export function noteGameMaster(charIndex: number, chat: Chat | undefined): void {
    const card = getDatabase().characters[charIndex] as Room | undefined
    if (!chat || !gameMasterOn(card)) return
    const at = chat.message.length - 1
    const reply = chat.message[at]
    if (!reply || reply.role !== 'char') return
    const replies = chat.message.filter((m) => m.role === 'char').length
    const taken = takeGm(settleGm(gmStateOf(chat.scriptstate), chat.message.slice(0, at)).state, reply, replies)
    if (taken) {
        chat.message[at] = { ...reply, data: taken.text }
        writeState(chat, taken.state)
    }
    // the bookkeeper, once the character is confirmed (not awaited: the chat goes on)
    const shape = storyShape(chat.message.filter((m) => m.role === 'char').map((m) => m.data ?? ''))
    if (gmPhase(card, chat.message, chat.scriptstate, gmStateOf(chat.scriptstate), shape.head.length + shape.tail.length > 0) === 'silent') return
    // the chat is read again when the answer comes: it may have been replaced meanwhile (as scenePicturesPage does)
    const live = () => getDatabase().characters[charIndex]?.chats?.find((c) => c === chat || (!!chat.id && c.id === chat.id)) ?? chat
    void bookkeep(live, chat.message[at], replies, worldFlavour(card)).catch((e) => console.warn('[game master] bookkeeper failed', e))
}

const BOOKKEEP_TIMEOUT_MS = 60_000

/** Ask the submodel for the notes this reply changed; applied only while that reply is still the chat's last one. */
export async function bookkeep(live: () => Chat, reply: { data: string; chatId?: string }, replies: number, flavour: string,
    ask?: (prompt: string) => Promise<string | null>): Promise<boolean> {
    const before = live()
    const player = [...before.message].reverse().find((m) => m.role === 'user')?.data ?? ''
    const prompt = bookkeepPrompt(gmStateOf(before.scriptstate), player, reply.data ?? '', flavour)
    const answer = await (ask ?? askSubmodel)(prompt)
    const bodies = parseBookkeep(answer ?? '')
    const chat = live()
    const last = chat.message[chat.message.length - 1]
    if (!bodies || !last || last.role !== 'char' || (reply.chatId && last.chatId !== reply.chatId)) return false
    writeState(chat, applyBookkeep(gmStateOf(chat.scriptstate), bodies, reply.chatId ?? '', replies))
    return true
}

async function askSubmodel(prompt: string): Promise<string | null> {
    const { requestChatData } = await import('./request/request')
    const ask = requestChatData({ formated: [{ role: 'user', content: prompt }], bias: {}, useStreaming: false, noMultiGen: true }, 'submodel')
    const res = await Promise.race([ask, new Promise<null>((r) => setTimeout(() => r(null), BOOKKEEP_TIMEOUT_MS))])
    return res && res.type === 'success' && typeof res.result === 'string' ? res.result : null
}
