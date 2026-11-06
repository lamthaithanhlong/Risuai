// Connects the growth pieces on the client (storage/statsSave.ts sends and loads, statsTags.ts hides): after a reply the panel's
// `$stat_export` goes to the global store stamped with the persona's id; at the start of a request the waiting entries are retried and the
// persona's stored stats are merged into the chat. Nothing here blocks a reply for more than LOAD_WAIT_MS, and nothing here throws.
import { parseTrain, sendTrain, trainBody, type TrainBody } from '../storage/trainSave'
import { EXPORT_KEY, PENDING_KEY, drain, enqueue, fetchCurrent, mergeCurrent, parseEntries, parsePending, sendStats, type Current, type SendResult, type StatEntry } from '../storage/statsSave'

export const LOAD_WAIT_MS = 1500
type Vars = Record<string, string | number | boolean>
type ChatLike = { scriptstate?: Vars } | undefined

/** Only a card whose description teaches the tag takes part (the way hasFindRule asks for finds). */
export function hasStatsRule(card: { desc?: string, type?: string } | undefined): boolean {
    return !!card && card.type !== 'group' && /\[\[ACT\|/.test(card.desc ?? '')
}

/** A persona's id for the store: its own id, else its name without accents, else 'default'; only letters, digits, dot, dash, underscore. */
export function personaIdOf(p: { id?: string, name?: string } | undefined | null): string {
    const clean = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
    return clean(String(p?.id ?? '')) || clean(String(p?.name ?? '')) || 'default'
}

export type StatsDeps = {
    persona: () => string
    send: (batch: StatEntry[]) => Promise<SendResult>
    current: (persona: string) => Promise<Current | null>
}

/** Sends what waits on the chat. The remainder replaces the list, together with anything queued while this ran. */
export async function drainPending(chat: ChatLike, send: StatsDeps['send']): Promise<void> {
    if (!chat) return
    const first = String(chat.scriptstate?.[PENDING_KEY] ?? '')
    const was = parsePending(first)
    if (!was.length) return
    const r = await drain(first, send)
    const now = parsePending(String(chat.scriptstate?.[PENDING_KEY] ?? '')).slice(was.length)
    const left = [...parsePending(r.pending), ...now]
    const vars = (chat.scriptstate ??= {})
    vars[PENDING_KEY] = left.length ? JSON.stringify(left) : ''
}

/** After a reply: this turn's export is stamped with the persona and queued on the chat, then everything waiting is sent. */
export async function statsAfterReply(chat: ChatLike, deps: Pick<StatsDeps, 'persona' | 'send'>): Promise<void> {
    if (!chat) return
    try {
        const vars = (chat.scriptstate ??= {})
        const fresh = parseEntries(String(vars[EXPORT_KEY] ?? ''))
        vars[EXPORT_KEY] = ''
        if (fresh.length) vars[PENDING_KEY] = enqueue(String(vars[PENDING_KEY] ?? ''), fresh, deps.persona())
        await drainPending(chat, deps.send)
    } catch { /* the reply is never held by this */ }
}

/** Start of a request: retry what waits, then start the chat from the persona's stored values. Gives up after LOAD_WAIT_MS. */
export async function statsBeforeRequest(chat: ChatLike, deps: StatsDeps, waitMs = LOAD_WAIT_MS): Promise<void> {
    if (!chat) return
    const work = (async () => {
        await drainPending(chat, deps.send)
        const merged = mergeCurrent(chat.scriptstate, await deps.current(deps.persona()))
        if (merged) Object.assign((chat.scriptstate ??= {}), merged)
    })().catch(() => {})
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([work, new Promise<void>((r) => { timer = setTimeout(r, waitMs) })])
    clearTimeout(timer)
}

/** The page's own deps: the selected persona, the Risu server's routes. */
export async function pageDeps(): Promise<StatsDeps> {
    const util = await import('../util')
    const { getDatabase } = await import('../storage/database.svelte')
    const persona = () => {
        const db = getDatabase()
        return personaIdOf(util.checkPersonaBinded() ?? db.personas?.[db.selectedPersona])
    }
    return { persona, send: (b) => sendStats(b), current: (p) => fetchCurrent(p) }
}

/** index.svelte.ts calls these two; both do nothing for a card without the rule. */
export async function statsBeforeRequestPage(card: { desc?: string, type?: string } | undefined, chat: ChatLike): Promise<void> {
    if (!hasStatsRule(card)) return
    try { await statsBeforeRequest(chat, await pageDeps()) } catch { /* never blocks */ }
}
export async function statsAfterReplyPage(card: { desc?: string, type?: string } | undefined, chat: ChatLike): Promise<void> {
    if (!hasStatsRule(card)) return
    try { await statsAfterReply(chat, await pageDeps()) } catch { /* never blocks */ }
}

// ---- the global training tag: [[TRAIN|stat+stat|level]] on a card with no growth engine of its own (storage/trainSave.ts) ----------------

type TrainChat = { id?: string, message?: { role?: string, data?: string }[] } | undefined

/** The text of the newest character message as the model wrote it. Read BEFORE tidyLastReply takes the hidden tags out of the stored text. */
export function lastReplyRaw(chat: TrainChat): string {
    const m = chat?.message
    const last = Array.isArray(m) && m.length ? m[m.length - 1] : undefined
    return last && last.role === 'char' ? String(last.data ?? '') : ''
}

/** After a reply: its TRAIN tag (if any) goes to the global store, once per (persona, chat, turn); the store skips Admin-off, locked and engine cards.
 *  A card whose description teaches [[ACT| counts its own training in its Lua, so it never posts (no double count). Never throws. */
export async function trainAfterReply(card: { desc?: string, type?: string } | undefined, chat: TrainChat, raw: string,
    deps: { persona: () => string, cardId: () => string, send: (b: TrainBody) => Promise<string> }): Promise<void> {
    try {
        if (!card || card.type === 'group' || hasStatsRule(card)) return
        const tag = parseTrain(raw)
        const id = String(chat?.id ?? '')
        const cardId = deps.cardId()
        if (!tag || !cardId || !/^[A-Za-z0-9_.-]{1,64}$/.test(id) || !Array.isArray(chat?.message)) return
        await deps.send(trainBody(tag, { persona: deps.persona(), card: cardId, chat: id, turn: chat!.message!.length }))
    } catch { /* the reply is never held by this */ }
}

export async function trainAfterReplyPage(card: { desc?: string, type?: string, chaId?: string } | undefined, chat: TrainChat, raw: string): Promise<void> {
    if (!raw || !/\[\[\s*train/i.test(raw)) return
    try {
        const d = await pageDeps()
        const { adminCardOf } = await import('./adminGlobal')
        await trainAfterReply(card, chat, raw, { persona: d.persona, cardId: () => adminCardOf(card as never), send: (b) => sendTrain(b) })
    } catch { /* never blocks */ }
}
