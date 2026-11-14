// Connects the growth pieces on the client (storage/statsSave.ts sends and loads, statsTags.ts hides): after a reply the panel's
// `$stat_export` goes to the global store stamped with the persona's id; at the start of a request the waiting entries are retried and the
// persona's stored stats are merged into the chat. Nothing here blocks a reply for more than LOAD_WAIT_MS, and nothing here throws.
import { fetchPersona, itemSlotsOf, type Deps as PersonaDeps, type PersonaData } from '../storage/personaStore'
import { displayName, effectOf } from './personaView'
import { levelOf } from './findDrop'
import { lastTurnIsAsk } from './adminAsk'
import { parseTrain, sendTrain, trainBody, type TrainBody } from '../storage/trainSave'
import { EXPORT_KEY, EXP_PENDING_KEY, PENDING_KEY, TURN_EVENTS_KEY, drain, enqueue, enqueueTurn, fetchCurrent, fetchLedger, foldSkills, foldVars, isExpChat, migrateTurnNote, SKILL_EXP_MARKER, mergeCurrent, parseEntries, parsePending, parsePendingTurns, sendStats, sendTurn, turnEventsOf, type Current, type LedgerState, type SendResult, type StatEntry, type TurnBody } from '../storage/statsSave'

export const LOAD_WAIT_MS = 1500
type Vars = Record<string, string | number | boolean>
type ChatLike = { scriptstate?: Vars, id?: string } | undefined

/** Only a card whose description teaches the tag takes part (the way hasFindRule asks for finds). */
export function hasStatsRule(card: { desc?: string, type?: string } | undefined): boolean {
    return !!card && card.type !== 'group' && /\[\[ACT\|/.test(card.desc ?? '')
}

/** The global Admin engine module counts growth in this chat ($admin_module, which the module's Lua writes): its $stat_export goes to the persona's store
 *  and the persona's stored stats are merged in, exactly as for a card with a stats script of its own. */
export function moduleCounts(chat: ChatLike): boolean { return String((chat?.scriptstate as Record<string, unknown> | undefined)?.$admin_module ?? '') === '1' }

/** A persona's id for the store: its own id, else its name without accents, else 'default'; only letters, digits, dot, dash, underscore. */
export function personaIdOf(p: { id?: string, name?: string } | undefined | null): string {
    const clean = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
    return clean(String(p?.id ?? '')) || clean(String(p?.name ?? '')) || 'default'
}

export type StatsDeps = {
    persona: () => string
    send: (batch: StatEntry[]) => Promise<SendResult>
    current: (persona: string) => Promise<Current | null>
    /** the persona's event ledger (both absent: the old max(chat, store) merge only) */
    sendTurn?: (body: TurnBody) => Promise<SendResult>
    ledger?: (persona: string) => Promise<LedgerState | null>
}

/** Sends the turns waiting on the chat ($exp_pending), in order; the first one answered 'queue' (or that threw) and everything after it stay. A turn queued
 *  while this ran (a regenerated reply) is kept, and replaces the one it supersedes. */
export async function drainTurns(chat: ChatLike, sendTurn: NonNullable<StatsDeps['sendTurn']>): Promise<void> {
    if (!chat) return
    const was = parsePendingTurns(String(chat.scriptstate?.[EXP_PENDING_KEY] ?? ''))
    if (!was.length) return
    let at = 0
    for (; at < was.length; at++) {
        let r: SendResult
        try { r = await sendTurn(was[at]) } catch { r = 'queue' }
        if (r === 'queue') break
    }
    const now = parsePendingTurns(String(chat.scriptstate?.[EXP_PENDING_KEY] ?? ''))
    // what is there now minus what was sent (compared by content: an entry replaced while sending is a new one and stays)
    const sentKeys = new Set(was.slice(0, at).map((b) => JSON.stringify(b)))
    const left = now.filter((b) => !sentKeys.has(JSON.stringify(b)))
    ;(chat.scriptstate ??= {})[EXP_PENDING_KEY] = left.length ? JSON.stringify(left) : ''
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

/** After a reply: this turn's export is stamped with the persona and queued on the chat, then everything waiting is sent. The turn's EXP events go to the
 *  persona's ledger the same way (queued per (chat, turn), so a regenerated reply replaces the turn, here and in the ledger). */
export async function statsAfterReply(chat: ChatLike, deps: Pick<StatsDeps, 'persona' | 'send' | 'sendTurn'>): Promise<void> {
    if (!chat) return
    try {
        const vars = (chat.scriptstate ??= {})
        const fresh = parseEntries(String(vars[EXPORT_KEY] ?? ''))
        vars[EXPORT_KEY] = ''
        if (fresh.length) vars[PENDING_KEY] = enqueue(String(vars[PENDING_KEY] ?? ''), fresh, deps.persona())
        let turn: TurnBody | null = null
        if (deps.sendTurn) {
            turn = turnEventsOf(vars, String(chat.id ?? ''), deps.persona())
            vars[TURN_EVENTS_KEY] = ''
            if (turn) vars[EXP_PENDING_KEY] = enqueueTurn(String(vars[EXP_PENDING_KEY] ?? ''), turn)
        }
        await Promise.all([drainPending(chat, deps.send), deps.sendTurn ? drainTurns(chat, deps.sendTurn) : undefined])
    } catch { /* the reply is never held by this */ }
}

/** Start of a request: retry what waits, then start the chat from the persona's stored values. Gives up after LOAD_WAIT_MS. */
export async function statsBeforeRequest(chat: ChatLike, deps: StatsDeps, waitMs = LOAD_WAIT_MS): Promise<void> {
    if (!chat) return
    const work = (async () => {
        await Promise.all([drainPending(chat, deps.send), deps.sendTurn ? drainTurns(chat, deps.sendTurn) : undefined])
        const persona = deps.persona()
        // the ledger's fold is the persona's Level / EXP / stats; a turn of this chat still waiting means the fold lacks it: then the old merge, which never lowers
        const waiting = parsePendingTurns(String(chat.scriptstate?.[EXP_PENDING_KEY] ?? '')).length > 0
        const [cur, led] = await Promise.all([deps.current(persona), deps.ledger && !waiting ? deps.ledger(persona) : null])
        const fold = foldVars(led)
        const merged = mergeCurrent(chat.scriptstate, cur)
        // skill mastery from the fold (L1 2026-11-06 item (e)); without it (no event yet, a turn waiting, no `skills` from the server) the old merge, as for the stats
        const skills = foldSkills(chat.scriptstate, led)
        const ledgerSkills = !!(led && led.event_count > 0 && led.skills)
        if (fold) Object.assign((chat.scriptstate ??= {}), fold)
        else if (merged) (chat.scriptstate ??= {}).$stats = merged.$stats
        if (skills) {
            const vars = (chat.scriptstate ??= {})
            if (!isExpChat(vars)) { const t = migrateTurnNote(vars.$exp_turn); if (t) vars.$exp_turn = t }   // as S.skill_exp_migrate: the note's `sk` goes with $skills
            vars.$skills = skills
            vars[SKILL_EXP_MARKER] = '1'
        }
        else if (merged && !ledgerSkills) (chat.scriptstate ??= {}).$skills = merged.$skills
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
    return { persona, send: (b) => sendStats(b), current: (p) => fetchCurrent(p), sendTurn: (b) => sendTurn(b), ledger: (p) => fetchLedger(p) }
}

/** {id: {name, effect, conditions, tier}} for the equipped skills and items (tier: what the narrator's tier ladder keys on); effect falls back to the client sentence so it is never empty. */
export function equippedEffects(d: PersonaData): Record<string, { name: string, effect: string, conditions: string, tier: string }> {
    const out: Record<string, { name: string, effect: string, conditions: string, tier: string }> = {}
    const skills = new Map(d.skills.map((s) => [s.id, s])), items = new Map(d.items.map((i) => [i.id, i]))
    for (const id of d.slots) {
        const s = typeof id === 'string' ? skills.get(id) : undefined
        if (s) out[s.id] = { name: displayName(s), effect: effectOf('skill', s), conditions: typeof s.conditions === 'string' ? s.conditions.trim() : '', tier: s.tier }
    }
    for (const id of itemSlotsOf(d)) {
        const i = id ? items.get(id) : undefined
        if (i) out[i.id] = { name: displayName(i), effect: effectOf('item', i), conditions: typeof i.conditions === 'string' ? i.conditions.trim() : '', tier: i.tier }
    }
    return out
}

/** The chat variable holding the equipped skill ids (a JSON list), written before each request from the persona's slots. */
export const STORE_SLOTS_KEY = '$store_slots'

/** The chat variable holding the equipped item ids (a JSON list of the non-null item slots): the truth Lua reads for which items are equipped. */
export const STORE_ITEM_SLOTS_KEY = '$store_item_slots'

/** The chat variable holding what the EQUIPPED skills and items do: JSON {id: {name, effect, conditions}} (the non-null slots only). */
export const STORE_EFFECTS_KEY = '$store_effects'

/** Reads the persona's store and writes the equipped skill ids (the non-null slots) to `$store_slots`; a failed read leaves the old value. Never throws. */
export async function syncStoreSlots(chat: ChatLike, persona: string, deps: PersonaDeps = {}): Promise<void> {
    try {
        if (!chat) return
        const r = await fetchPersona(persona, levelOf(chat.scriptstate), deps)
        if (!r.ok) return
        const st = (chat.scriptstate ??= {})
        st[STORE_SLOTS_KEY] = JSON.stringify(r.data.slots.filter((x): x is string => typeof x === 'string' && x !== ''))
        st[STORE_ITEM_SLOTS_KEY] = JSON.stringify(itemSlotsOf(r.data).filter((x): x is string => x !== null))
        st[STORE_EFFECTS_KEY] = JSON.stringify(equippedEffects(r.data))
    } catch { /* never blocks */ }
}

/** index.svelte.ts calls these two; both do nothing for a card without the rule. */
export async function statsBeforeRequestPage(card: { desc?: string, type?: string } | undefined, chat: ChatLike): Promise<void> {
    if (!hasStatsRule(card) && !moduleCounts(chat)) return
    try {
        const d = await pageDeps()
        await statsBeforeRequest(chat, d)   // first: the merged stats can carry the Level the slots depend on
        let timer: ReturnType<typeof setTimeout> | undefined
        await Promise.race([syncStoreSlots(chat, d.persona()), new Promise<void>((r) => { timer = setTimeout(r, LOAD_WAIT_MS) })])
        clearTimeout(timer)
    } catch { /* never blocks */ }
}
export async function statsAfterReplyPage(card: { desc?: string, type?: string } | undefined, chat: ChatLike): Promise<void> {
    // the turn's loot by loot id (findGlue.lootAfterReply): any card that teaches finds, whether or not it counts growth
    try { await (await import('./findGlue')).lootAfterReplyPage(card as never, chat as never) } catch { /* never blocks */ }
    if (!hasStatsRule(card) && !moduleCounts(chat)) return
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
        if (!card || card.type === 'group' || hasStatsRule(card) || moduleCounts(chat as ChatLike)) return   // the module (or the card's Lua) counts it: no second count
        if (lastTurnIsAsk(chat?.message)) return   // "@admin ..." is not a story turn: no training for it
        const tag = parseTrain(raw)   // no tag: the store is still told (stats []), so a regenerated reply that lost its tag takes the earlier gain back
        const id = String(chat?.id ?? '')
        const cardId = deps.cardId()
        if (!cardId || !/^[A-Za-z0-9_.-]{1,64}$/.test(id) || !Array.isArray(chat?.message)) return
        await deps.send(trainBody(tag, { persona: deps.persona(), card: cardId, chat: id, turn: chat!.message!.length }))
    } catch { /* the reply is never held by this */ }
}

export async function trainAfterReplyPage(card: { desc?: string, type?: string, chaId?: string } | undefined, chat: TrainChat, raw: string): Promise<void> {
    if (!raw) return
    try {
        const d = await pageDeps()
        const { adminCardOf } = await import('./adminGlobal')
        await trainAfterReply(card, chat, raw, { persona: d.persona, cardId: () => adminCardOf(card as never), send: (b) => sendTrain(b) })
    } catch { /* never blocks */ }
}

/** After a reply: what the Admin module exported for the Game Master ($admin_report) goes to the asset manager's reports file (storage/adminReport.ts). */
export async function adminReportAfterReplyPage(card: { type?: string, chaId?: string } | undefined, chat: (TrainChat & { scriptstate?: Record<string, unknown> }) | undefined): Promise<void> {
    try {
        if (!card || card.type === 'group' || !chat?.scriptstate?.['$admin_report']) return
        const { adminCardOf } = await import('./adminGlobal')
        const { reportAfterReply } = await import('../storage/adminReport')
        await reportAfterReply(chat as never, adminCardOf(card as never))
    } catch { /* never blocks */ }
}

// ---- Admin's mission points on a card with no quest script (adminQuest.ts) ---------------------------------------------------------------

/** After a reply: the app's points line goes into the stored reply (sync), then the reply's mission events (EXP for a mission done, the
 *  game-over penalty) go to the persona's ledger as the events of (chat + '.q', turn = the chat's length): the mechanic owns that turn, so
 *  a regenerated reply replaces what the earlier one paid or cost. Never throws; the post is not waited for. */
export function questAfterReplyPage(card: { type?: string, chaId?: string } | undefined, chat: (TrainChat & { scriptstate?: Record<string, unknown> }) | undefined, post = true): void {
    try {
        const msgs = chat?.message
        if (!card || card.type === 'group' || !Array.isArray(msgs) || !msgs.length) return
        void (async () => {
            try {
                const { adminCardOf } = await import('./adminGlobal')
                const q = await import('./adminQuest')
                if (q.SCRIPTED_QUEST_CARDS.includes(adminCardOf(card as never))) return
                if (!q.questState(msgs).marks) return   // Admin never spoke of a mission in this chat
                let level = 1
                try { const l = JSON.parse(String(chat!.scriptstate?.$lvl ?? ''))?.l; if (Number.isInteger(l) && l >= 1) level = l } catch { /* Level 1 */ }
                const scripted = q.moduleRunsQuests(chat!.scriptstate)   // the Admin module hands out and pays: the app keeps only the points
                const text = q.stampPoints(msgs, level, scripted)
                if (text !== null) msgs[msgs.length - 1].data = text
                const id = String(chat!.id ?? '')
                if (!post || !/^[A-Za-z0-9_.-]{1,62}$/.test(id)) return
                const d = await pageDeps()
                await sendTurn({ persona: d.persona(), chat: id + '.q', turn: msgs.length, events: q.questEvents(msgs, level, scripted) as never })
            } catch { /* never blocks */ }
        })()
    } catch { /* never blocks */ }
}
