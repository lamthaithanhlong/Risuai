// Connects the finds pieces on the client (findDrop.ts parses, storage/findsSave.ts sends): a find the narrator wrote is mapped to its
// card slug, given the story's day and place, saved to the asset manager, and queued on the chat ($find_pending) when the save cannot
// be done; every request first retries what waits. The names already in the global store come from the asset manager's finds list
// (cached 60 s; a failure is "no names", never a wait). Nothing here blocks a reply.
import { LEGACY_RARITY, hasFindRule, levelOf, setFindKnownProvider, setFindParsedHandler, type FindContext, type FindRecord } from './findDrop'
import { LOOT_PENDING_KEY, LOOT_TURN_PENDING_KEY, enqueueLootTurn, parsePendingLootTurns, sendLootTurn, type LootItem, type LootSend, type LootTurnBody } from '../storage/personaStore'
import { lastTurnIsAsk } from './adminAsk'
import { PENDING_KEY, drain, enqueue, parsePending, saveFind, type SendResult } from '../storage/findsSave'

/** chaId (prefix) of a card -> the slug the asset manager knows it by (tools/assets/cards.json). Only these cards save finds. */
export const CARD_SLUGS: Record<string, string> = { fc27f53b: 'zombie' }

export function cardSlugOf(chaId: string): string {
    const id = (chaId ?? '').toLowerCase()
    for (const [prefix, slug] of Object.entries(CARD_SLUGS)) if (id.startsWith(prefix)) return slug
    return ''
}

type Vars = Record<string, string | number | boolean> | undefined
const str = (v: unknown) => (v === undefined || v === null || String(v) === 'null' ? '' : String(v).trim())

/** "Ngày 2, Chung cư Kisaragi" from the panel's day and place (either may be missing); '' when neither is known. */
export function chapterOf(vars: Vars): string {
    return [str(vars?.$st_day), str(vars?.$st_place)].filter(Boolean).join(', ').slice(0, 120)
}

type GlueChat = { scriptstate?: Record<string, string | number | boolean>, message?: unknown[], id?: string }
export type GlueDeps = {
    /** the chat a find came from */
    chatOf: (chatId: string) => GlueChat | undefined
    send: (r: FindRecord) => Promise<SendResult>
    /** true: the find is the reply's LOOT: it waits on the chat ($loot_pending) and the after-reply step sends the turn's loot by loot id
     *  (lootAfterReply); false/absent: no persona store, the find is only saved */
    recordLoot?: boolean
}

/** The text of the panel line when the persona's storage is full. */
export const fullLine = (name: string) => `Kho đầy: không nhận được ${name}`

/** The persona-store entry for a find: skill {id, name, tier, source, exp 0}, item {id, name, tier, qty 1, source}; name = the Vietnamese one. */
export function lootEntry(rec: FindRecord, source: string): Record<string, unknown> {
    const tier = LEGACY_RARITY[rec.rarity] ?? rec.rarity
    const base = { id: rec.id, name: rec.name.vi, tier, source }
    return rec.kind === 'skill' ? { ...base, exp: 0 } : { ...base, qty: 1 }
}

/** The record with its source card as a slug and its chapter filled from the chat; null when the card is not one that saves finds. */
export function withSource(rec: FindRecord, ctx: FindContext, vars: Vars): FindRecord | null {
    const slug = cardSlugOf(ctx.card || rec.source.card)
    if (!slug) return null
    return { ...rec, source: { card: slug, chapter: chapterOf(vars) || rec.source.chapter || `Lượt ${ctx.turn}` } }
}

/** A pending loot: {kind, entry} for the persona store, the find record to save once the loot is counted, and the reply it belongs to
 *  (the chat's message count: a loot left from an earlier reply is never sent under a later turn). */
export type PendingLoot = LootItem & { at: number }

export function parseLootPending(text: unknown): PendingLoot[] {
    try {
        const v = JSON.parse(String(text ?? ''))
        return Array.isArray(v) ? v.filter((l) => l && typeof l === 'object' && (l.kind === 'skill' || l.kind === 'item') && l.entry && typeof l.entry === 'object' && Number.isInteger(l.at)) : []
    } catch { return [] }
}

/** The handler for findDrop's setFindParsedHandler: with recordLoot the find waits on the chat as this reply's loot; else it is saved now (on
 *  'queue' kept on the chat for the next request). */
export function findHandler(deps: GlueDeps) {
    return (rec: FindRecord, ctx: FindContext): void => {
        const chat = deps.chatOf(ctx.chatId)
        const out = withSource(rec, ctx, chat?.scriptstate)
        if (!deps.recordLoot) { if (out) queueFind(chat, out, deps.send); return }
        if (!chat) return
        // the loot goes to the persona's store with the turn (any card: the persona carries it); the find is saved only once the loot counted
        const source = out?.source.card || ctx.card || rec.source.card
        const vars = (chat.scriptstate ??= {})
        const at = Array.isArray(chat.message) ? chat.message.length : 0
        const list = parseLootPending(vars[LOOT_PENDING_KEY]).filter((l) => l.at === at)
        list.push({ kind: rec.kind, entry: lootEntry(rec, source), ...(out ? { find: out } : {}), at })
        vars[LOOT_PENDING_KEY] = JSON.stringify(list)
    }
}

/** Save a find now; 'queue' (or a throw) keeps it on the chat for the next request. */
function queueFind(chat: GlueChat | undefined, r: FindRecord, send: (r: FindRecord) => Promise<SendResult>): void {
    void Promise.resolve().then(() => send(r)).catch((): SendResult => 'queue').then((res) => {
        if (res !== 'queue' || !chat) return
        const vars = (chat.scriptstate ??= {})
        vars[PENDING_KEY] = enqueue(String(vars[PENDING_KEY] ?? ''), r)
    })
}

// ---- the loot of a reply, by loot id (persona_store.loot_turn) -----------------------------------------------------------------

export type LootDeps = {
    persona: () => string | Promise<string>
    sendLoot: (body: LootTurnBody) => Promise<LootSend>
    send: (r: FindRecord) => Promise<SendResult>
}

/** What a saved loot turn means on the chat: each counted loot (new or merged; 'kept' was counted before) saves its find; a full store
 *  writes the panel line when `line` (the reply just made), and the find is not saved (its name stays known, it is not offered again). */
function afterSaved(chat: GlueChat, body: LootTurnBody, results: LootSend & { status: 'saved' }, deps: LootDeps, line: boolean): void {
    for (const r of results.results) {
        const l = body.loots[r.idx]
        if (!l) continue
        if (r.ok && (r.added === 'new' || r.added === 'merged') && l.find) queueFind(chat, l.find as FindRecord, deps.send)
        if (!r.ok && r.reason === 'full' && line) (chat.scriptstate ??= {}).$find_line = fullLine(String(l.entry.name ?? ''))
    }
}

/** Sends the loot turns waiting on the chat, in order; the first one answered 'queue' and everything after it stay (a body replaced while
 *  sending is a new one and stays). */
export async function drainLootTurns(chat: GlueChat | undefined, deps: LootDeps): Promise<void> {
    if (!chat) return
    const was = parsePendingLootTurns(String(chat.scriptstate?.[LOOT_TURN_PENDING_KEY] ?? ''))
    if (!was.length) return
    let at = 0
    for (; at < was.length; at++) {
        let r: LootSend
        try { r = await deps.sendLoot(was[at]) } catch { r = { status: 'queue' } }
        if (r.status === 'queue') break
        if (r.status === 'saved') afterSaved(chat, was[at], r, deps, false)
    }
    const sent = new Set(was.slice(0, at).map((b) => JSON.stringify(b)))
    const left = parsePendingLootTurns(String(chat.scriptstate?.[LOOT_TURN_PENDING_KEY] ?? '')).filter((b) => !sent.has(JSON.stringify(b)))
    ;(chat.scriptstate ??= {})[LOOT_TURN_PENDING_KEY] = left.length ? JSON.stringify(left) : ''
}

/** After a reply: this turn's loot ($loot_pending, or [] when the reply found nothing: a regenerated reply's earlier loot is taken back) goes
 *  to the persona's store for (chat, turn = the chat's message count), then $loot_pending is cleared. Network trouble queues it
 *  ($loot_turn_pending, newest per turn); everything waiting goes first. Never throws. */
export async function lootAfterReply(chat: GlueChat | undefined, deps: LootDeps): Promise<void> {
    try {
        if (!chat || !Array.isArray(chat.message)) return
        const vars = (chat.scriptstate ??= {})
        const turn = chat.message.length
        const loots = parseLootPending(vars[LOOT_PENDING_KEY]).filter((l) => l.at === turn).map(({ at: _at, ...l }) => l as LootItem)
        vars[LOOT_PENDING_KEY] = ''
        const chatId = String(chat.id ?? '')
        const persona = await deps.persona()
        if (!/^[A-Za-z0-9_.-]{1,64}$/.test(chatId) || !/^[A-Za-z0-9_.-]{1,64}$/.test(persona)) return
        const body: LootTurnBody = { persona, chat: chatId, turn, level: levelOf(vars), loots }
        await drainLootTurns(chat, deps)
        const waiting = parsePendingLootTurns(String(vars[LOOT_TURN_PENDING_KEY] ?? '')).length > 0
        let r: LootSend = { status: 'queue' }
        if (!waiting) { try { r = await deps.sendLoot(body) } catch { r = { status: 'queue' } } }   // keep the order: never overtake a waiting turn
        if (r.status === 'saved') afterSaved(chat, body, r, deps, true)
        else if (r.status === 'queue') vars[LOOT_TURN_PENDING_KEY] = enqueueLootTurn(String(vars[LOOT_TURN_PENDING_KEY] ?? ''), body)
    } catch { /* the reply is never held by this */ }
}

/** index.svelte.ts (through statsAfterReplyPage): only a card that teaches finds, or a chat with loot waiting. */
export async function lootAfterReplyPage(card: Parameters<typeof hasFindRule>[0], chat: GlueChat | undefined): Promise<void> {
    if (!chat) return
    if (lastTurnIsAsk(chat.message)) return   // "@admin ..." is not a story turn: no loot for it (the module wrote none)
    const waiting = parseLootPending(chat.scriptstate?.[LOOT_PENDING_KEY]).length > 0 || !!String(chat.scriptstate?.[LOOT_TURN_PENDING_KEY] ?? '')
    if (!waiting && !hasFindRule(card)) return
    try {
        const { pageDeps } = await import('./statsGlue')
        const d = await pageDeps()
        await lootAfterReply(chat, { persona: d.persona, sendLoot: (b) => sendLootTurn(b), send: (r) => saveFind(r) })
    } catch { /* never blocks */ }
}

/**
 * Start of a request: send what waits on the chat. The remainder replaces the list, together with anything queued while this ran.
 * Resolves when done (callers do not have to wait for it).
 */
export async function drainPending(chat: { scriptstate?: Record<string, string | number | boolean> } | undefined, send: (r: FindRecord) => Promise<SendResult>): Promise<void> {
    if (!chat) return
    const first = String(chat.scriptstate?.[PENDING_KEY] ?? '')
    const was = parsePending(first)
    if (!was.length) return
    const r = await drain(first, send)
    const seen = new Set(was.map((x) => x.id))
    const now = parsePending(String(chat.scriptstate?.[PENDING_KEY] ?? '')).filter((x) => !seen.has(x.id))
    const left = [...parsePending(r.pending), ...now]
    const vars = (chat.scriptstate ??= {})
    vars[PENDING_KEY] = left.length ? JSON.stringify(left) : ''
}

// ---- the names already in the store --------------------------------------------------------------------------------------------

export const KNOWN_TTL_MS = 60_000

/** The finds list's names (Vietnamese and English), or null when the manager cannot be reached. */
export async function fetchKnownNames(deps: { fetch?: typeof fetch, auth?: () => Promise<string> } = {}): Promise<string[] | null> {
    try {
        const auth = await (deps.auth ?? (async () => (await import('../storage/nodeStorage')).getNodeServerProxyAuth()))()
        const r = await (deps.fetch ?? globalThis.fetch.bind(globalThis))('/api/assets/finds', { headers: { 'risu-auth': auth } })
        if (r.status !== 200) return null
        const j = await r.json()
        if (!j || !Array.isArray(j.finds)) return null
        return j.finds.flatMap((f: { name?: { vi?: string, en?: string } }) => [f?.name?.vi, f?.name?.en]).filter((n: unknown): n is string => typeof n === 'string' && !!n)
    } catch { return null }
}

/** A sync provider for findDrop: the cached names now, a refresh started in the background when the cache is older than the TTL. */
export function knownProvider(load: () => Promise<string[] | null>, now: () => number = Date.now) {
    let names: string[] = []
    let at = -Infinity
    let busy = false
    return (): string[] => {
        if (!busy && now() - at >= KNOWN_TTL_MS) {
            busy = true
            void load().catch(() => null).then((r) => { if (r) names = r; at = now() }).finally(() => { busy = false })
        }
        return names
    }
}

// ---- wiring --------------------------------------------------------------------------------------------------------------------

let installed = false

/** Once: the handler and the names provider (default deps: the page's database and the Risu server). */
export async function installFinds(): Promise<void> {
    if (installed) return
    installed = true
    const { getDatabase } = await import('../storage/database.svelte')
    const chatOf = (id: string) => {
        for (const c of getDatabase().characters ?? []) for (const ch of (c as { chats?: { id?: string }[] }).chats ?? []) if (ch.id === id) return ch as never
        return undefined
    }
    setFindParsedHandler(findHandler({ chatOf, send: (r) => saveFind(r), recordLoot: true }))
    setFindKnownProvider(knownProvider(() => fetchKnownNames()))
}

/** Call at the start of every request (not awaited by the reply): installs the glue once and retries the waiting finds. */
export function findsBeforeRequest(chat: { scriptstate?: Record<string, string | number | boolean> } | undefined): void {
    void installFinds().then(() => Promise.all([drainPending(chat, (r) => saveFind(r)),
        drainLootTurns(chat as GlueChat | undefined, { persona: () => '', sendLoot: (b) => sendLootTurn(b), send: (r) => saveFind(r) })])).catch(() => {})
}
