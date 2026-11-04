// Connects the finds pieces on the client (findDrop.ts parses, storage/findsSave.ts sends): a find the narrator wrote is mapped to its
// card slug, given the story's day and place, saved to the asset manager, and queued on the chat ($find_pending) when the save cannot
// be done; every request first retries what waits. The names already in the global store come from the asset manager's finds list
// (cached 60 s; a failure is "no names", never a wait). Nothing here blocks a reply.
import { setFindKnownProvider, setFindParsedHandler, type FindContext, type FindRecord } from './findDrop'
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

export type GlueDeps = {
    /** the chat a find came from */
    chatOf: (chatId: string) => { scriptstate?: Record<string, string | number | boolean> } | undefined
    send: (r: FindRecord) => Promise<SendResult>
}

/** The record with its source card as a slug and its chapter filled from the chat; null when the card is not one that saves finds. */
export function withSource(rec: FindRecord, ctx: FindContext, vars: Vars): FindRecord | null {
    const slug = cardSlugOf(ctx.card || rec.source.card)
    if (!slug) return null
    return { ...rec, source: { card: slug, chapter: chapterOf(vars) || rec.source.chapter || `Lượt ${ctx.turn}` } }
}

/** The handler for findDrop's setFindParsedHandler: save now; on 'queue' keep it on the chat for the next request. */
export function findHandler(deps: GlueDeps) {
    return (rec: FindRecord, ctx: FindContext): void => {
        const chat = deps.chatOf(ctx.chatId)
        const out = withSource(rec, ctx, chat?.scriptstate)
        if (!out) return
        void deps.send(out).catch((): SendResult => 'queue').then((res) => {
            if (res !== 'queue' || !chat) return
            const vars = (chat.scriptstate ??= {})
            vars[PENDING_KEY] = enqueue(String(vars[PENDING_KEY] ?? ''), out)
        })
    }
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
    setFindParsedHandler(findHandler({ chatOf, send: (r) => saveFind(r) }))
    setFindKnownProvider(knownProvider(() => fetchKnownNames()))
}

/** Call at the start of every request (not awaited by the reply): installs the glue once and retries the waiting finds. */
export function findsBeforeRequest(chat: { scriptstate?: Record<string, string | number | boolean> } | undefined): void {
    void installFinds().then(() => drainPending(chat, (r) => saveFind(r))).catch(() => {})
}
