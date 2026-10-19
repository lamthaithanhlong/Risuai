// The page's side of the Game Master (gameMaster.ts): the note in the request, and the [[GM]] block taken out after a reply.
// Works on every platform: no server, the state lives in the chat's variables (scriptstate "$gm_*").

import { getDatabase, type Chat, type character, type groupChat } from '../storage/database.svelte'
import { applyBookkeep, BOOK_KEYS, bookkeepPrompt, creationNote, GM_KEYS, gmNote, hasCreationStep, hasPanel, markAdvance, gmPhase, gmRequest, gmStateOf, parseBookkeep, rollGm, settleGm, takeGm, worldFlavour, yesAt, type GmState } from './gameMaster'
import { applyStatus, parseStatus, statusPrompt, statusSpec, type StatusSpec } from './statusBook'
import { storyShape } from './replyFormat'

type Room = character | groupChat

/** On for a story card (not a group) unless turned off in the settings. */
export function gameMasterOn(card: Room | undefined): card is character {
    return getDatabase().gameMaster !== false && !!card && card.type !== 'group'
}

function writeState(chat: Chat, state: GmState): void {
    chat.scriptstate ??= {}
    // every key, so a value the rolled-back reply had added is cleared too
    for (const k of [...GM_KEYS, ...BOOK_KEYS]) chat.scriptstate['$' + k] = state[k] ?? ''
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
    const dice = rollGm(state, replies.length, rng)
    // the pace clock is the app's: an advance rolled now is marked on the chat (sinceAdvance)
    const mark = phase === 'run' ? markAdvance(state, replies.length, dice) : null
    if (mark) { chat.scriptstate ??= {}; chat.scriptstate.$gm_adv_at = mark.gm_adv_at ?? ''; chat.scriptstate.$gm_adv_prev = mark.gm_adv_prev ?? '' }
    return gmRequest(formated, gmNote(phase, state, dice, worldFlavour(card)))
}

/** The note at the end of the player's message while the character is being made (gameMaster.ts creationNote); none after. */
export function creationRequest<T extends { role: string; content: unknown }>(formated: T[], card: Room | undefined, chat: Chat | undefined): T[] {
    if (!card || card.type === 'group' || !chat) return formated
    return gmRequest(formated, creationNote(card, chat.message ?? [], chat.scriptstate, gmStateOf(chat.scriptstate)))
}

/** The status panel's keys are kept once the character is confirmed: the yes was given, or the GM already runs (statusBook.ts). */
export function statusConfirmed(card: character, messages: Chat['message'], vars: Chat['scriptstate']): boolean {
    const s = gmStateOf(vars)
    return yesAt(messages) >= 0 || !!s.gm_arc || !!s.gm_past || (!hasCreationStep(card) && hasPanel(vars))
}

/** After a reply: its [[GM]] block leaves the message and its values go to the chat's variables; then the bookkeeper. */
export function noteGameMaster(charIndex: number, chat: Chat | undefined): void {
    const card = getDatabase().characters[charIndex] as Room | undefined
    if (!chat || !card || card.type === 'group') return
    const at = chat.message.length - 1
    const reply = chat.message[at]
    if (!reply || reply.role !== 'char') return
    const replies = chat.message.filter((m) => m.role === 'char').length
    const player = [...chat.message.slice(0, at)].reverse().find((m) => m.role === 'user')?.data ?? ''
    const storyLike = () => { const shape = storyShape(chat.message.filter((m) => m.role === 'char').map((m) => m.data ?? '')); return shape.head.length + shape.tail.length > 0 }
    const gmOn = gameMasterOn(card)
    if (gmOn) {
        const before = settleGm(gmStateOf(chat.scriptstate), chat.message.slice(0, at)).state
        // a side the player commits to counts once the character is confirmed (not a creation answer that names a faction)
        const quiet = gmPhase(card, chat.message, chat.scriptstate, before, storyLike()) === 'silent'
        const taken = takeGm(before, reply, replies, quiet ? '' : player)
        if (taken) {
            chat.message[at] = { ...reply, data: taken.text }
            writeState(chat, taken.state)
        }
    }
    // the bookkeeper, once the character is confirmed (not awaited: the chat goes on); Settings can turn the extra call off.
    // One helper call per turn asks for both the GM's notes and the card's status panel.
    if (getDatabase().gmBookkeeper === false) return
    const gm = gmOn && gmPhase(card, chat.message, chat.scriptstate, gmStateOf(chat.scriptstate), storyLike()) !== 'silent'
    const spec = statusSpec(card)
    const status = spec && statusConfirmed(card, chat.message, chat.scriptstate) ? spec : null
    if (!gm && !status) return
    // the chat is read again when the answer comes: it may have been replaced meanwhile (as scenePicturesPage does)
    const live = () => getDatabase().characters[charIndex]?.chats?.find((c) => c === chat || (!!chat.id && c.id === chat.id)) ?? chat
    const redraw = () => { const c = getDatabase().characters[charIndex]; if (c) c.reloadKeys = (c.reloadKeys ?? 0) + 1 }
    void bookkeep(live, chat.message[at], replies, worldFlavour(card), undefined, { gm, status, redraw }).catch((e) => console.warn('[game master] bookkeeper failed', e))
}

const BOOKKEEP_TIMEOUT_MS = 60_000

/**
 * Ask the submodel for the notes this reply changed (the GM's, and the card's panel keys when `status` is given); applied only
 * while that reply is still the chat's last one. True when anything was written.
 */
export async function bookkeep(live: () => Chat, reply: { data: string; chatId?: string }, replies: number, flavour: string,
    ask?: (prompt: string) => Promise<string | null>, opts: { gm?: boolean; status?: StatusSpec | null; redraw?: () => void } = {}): Promise<boolean> {
    const wantGm = opts.gm !== false
    const before = live()
    const player = [...before.message].reverse().find((m) => m.role === 'user')?.data ?? ''
    const prompt = bookkeepPrompt(wantGm ? gmStateOf(before.scriptstate) : null, player, reply.data ?? '', flavour, opts.status ? statusPrompt(opts.status, before.scriptstate) : '')
    const answer = await (ask ?? askSubmodel)(prompt)
    const chat = live()
    const last = chat.message[chat.message.length - 1]
    if (!answer || !last || last.role !== 'char' || (reply.chatId && last.chatId !== reply.chatId)) return false
    let wrote = false
    const bodies = wantGm ? parseBookkeep(answer) : null
    if (bodies) {
        writeState(chat, applyBookkeep(gmStateOf(chat.scriptstate), bodies, reply.chatId ?? '', replies, player))
        wrote = true
    }
    if (opts.status) {
        const updates = parseStatus(answer, opts.status, chat.scriptstate)
        if (Object.keys(updates).length) {
            chat.scriptstate ??= {}
            applyStatus(chat.scriptstate, updates)
            opts.redraw?.()
            wrote = true
        }
    }
    return wrote
}

async function askSubmodel(prompt: string): Promise<string | null> {
    const { requestChatData } = await import('./request/request')
    const ask = requestChatData({ formated: [{ role: 'user', content: prompt }], bias: {}, useStreaming: false, noMultiGen: true }, 'submodel')
    const res = await Promise.race([ask, new Promise<null>((r) => setTimeout(() => r(null), BOOKKEEP_TIMEOUT_MS))])
    return res && res.type === 'success' && typeof res.result === 'string' ? res.result : null
}
