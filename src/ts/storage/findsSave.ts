// Saving a find from the chat to the global store: the narrator's [[FIND|...]] block, parsed to a record (findDrop.ts), goes to the Risu
// server's POST /api/finds (server/node/findsBridge.cjs), which forwards it to the asset manager. Never blocks a reply: when the server or
// the asset manager is down the find waits in the chat's script state under `$find_pending` (a JSON array) and is sent on the next turn.
//
//   saveFind(record)            -> 'saved' | 'known' | 'queue' | 'drop'   (one POST; 'queue' = try again later, 'drop' = refused for good)
//   enqueue(pending, record)    -> the new `$find_pending` text         (pure)
//   drain(pending, send)        -> {pending, saved, known, dropped}      (sends each waiting find; keeps only those that must retry)
export type FindRecord = {
    id: string
    kind: 'skill' | 'item'
    name: { vi: string, en: string }
    source: { card: string, chapter: string }
    effect: string
    rarity: 'common' | 'uncommon' | 'rare' | 'epic'
    conditions: string
    portable: boolean
}

export type SendResult = 'saved' | 'known' | 'queue' | 'drop'
export const PENDING_KEY = '$find_pending'
export const MAX_PENDING = 50

export function parsePending(text: string | null | undefined): FindRecord[] {
    if (!text) return []
    try {
        const v = JSON.parse(text)
        return Array.isArray(v) ? v.filter((r) => r && typeof r === 'object' && typeof r.id === 'string') : []
    } catch { return [] }
}

/** The pending list with `record` added at the end; a find already waiting (same id) is not added twice; the oldest go first when over the cap. */
export function enqueue(pending: string | null | undefined, record: FindRecord): string {
    const list = parsePending(pending)
    if (!list.some((r) => r.id === record.id)) list.push(record)
    return JSON.stringify(list.slice(-MAX_PENDING))
}

/** Sends every waiting find with `send`; those answered 'queue' (or whose send threw) stay, in order. */
export async function drain(pending: string | null | undefined, send: (r: FindRecord) => Promise<SendResult>) {
    const keep: FindRecord[] = []
    const out = { saved: [] as string[], known: [] as string[], dropped: [] as string[] }
    for (const r of parsePending(pending)) {
        let res: SendResult
        try { res = await send(r) } catch { res = 'queue' }
        if (res === 'queue') keep.push(r)
        else if (res === 'saved') out.saved.push(r.id)
        else if (res === 'known') out.known.push(r.id)
        else out.dropped.push(r.id)
    }
    return { pending: keep.length ? JSON.stringify(keep) : '', ...out }
}

// imported when first needed: nodeStorage drags the whole app (streamsaver wants a document) into anything that imports it
const defaultAuth = async () => (await import('./nodeStorage')).getNodeServerProxyAuth()

/** One POST to the server's bridge. Any network trouble, 502 or 504 means 'queue'; 401/403-like auth trouble also queues (a later turn may be signed in). */
export async function saveFind(record: FindRecord, deps: { fetch?: typeof fetch, auth?: () => Promise<string> } = {}): Promise<SendResult> {
    const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis)
    try {
        const auth = await (deps.auth ?? defaultAuth)()
        const r = await doFetch('/api/finds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'risu-auth': auth },
            body: JSON.stringify(record),
        })
        if (r.status === 200) {
            const j = await r.json().catch(() => null)
            return j && j.created === false ? 'known' : 'saved'
        }
        return r.status === 400 ? 'drop' : 'queue'
    } catch { return 'queue' }
}
