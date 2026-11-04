// A persona's stats and skill mastery in the global store. The card's panel (status.lua) exports each turn's gains as `$stat_export`, a JSON
// array of {stat, value, turn, time} (value in hundredths of a percent; stat is one of the six stat keys or "skill:<find id>"). The page
// stamps them with the persona's id and POSTs them to the Risu server's /api/stats (server/node/statsBridge.cjs), which forwards them to
// the asset manager's append-only history.jsonl. Never blocks a reply: while the server or the asset manager is down the entries wait in the
// chat's script state under `$stat_pending` and go out, in order, on the next turn.
//
// Stats belong to the persona, not to a chat or a card: at the start of a request the persona's current values (the asset manager replays
// the log, the last value written wins) are merged into the chat's `$stats` / `$skills` (never lowering a value the chat already has, since
// growth only goes up), so a new chat, or another card of the same persona, starts where the persona is.
//
//   parseEntries(text)            -> StatEntry[]     the valid entries of an export (pure)
//   enqueue(pending, entries, persona) -> text       `$stat_pending` with the entries stamped and added (pure, capped)
//   drain(pending, send)          -> {pending, saved, dropped}   sends in batches of 200, stops at the first batch that must retry
//   sendStats(entries, deps)      -> 'saved' | 'queue' | 'drop'
//   mergeCurrent(vars, current)   -> {$stats, $skills} to write, or null when the chat already has everything
export type StatEntry = { stat: string, value: number, turn: number, time: string, persona?: string }
export type SendResult = 'saved' | 'queue' | 'drop'
export type Current = { stats: Record<string, number>, skills: Record<string, number> }

export const EXPORT_KEY = '$stat_export'
export const PENDING_KEY = '$stat_pending'
export const MAX_PENDING = 400
export const BATCH = 200
export const STAT_KEYS = ['suc_manh', 'nhanh_nhen', 'the_luc', 'tinh_than', 'cam_nhan', 'y_chi']
export const START_VALUE = 1000

const SKILL_RE = /^skill:[^\s|"\\]{1,80}$/
const TIME_RE = /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:?\d\d)?$/
const PERSONA_RE = /^[A-Za-z0-9_.-]{1,64}$/
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** The rules of the store (tools/assets/stats_store.py validate), so an entry the store would refuse is never queued. */
export function validEntry(e: unknown): e is StatEntry {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return false
    const r = e as Record<string, unknown>
    if (typeof r.stat !== 'string' || !(STAT_KEYS.includes(r.stat) || SKILL_RE.test(r.stat))) return false
    if (!isInt(r.value) || r.value < 0 || r.value > 10000) return false
    if (!isInt(r.turn) || r.turn < 0 || r.turn > 10_000_000) return false
    if (typeof r.time !== 'string' || !TIME_RE.test(r.time)) return false
    return r.persona === undefined || (typeof r.persona === 'string' && PERSONA_RE.test(r.persona))
}

function parseList(text: string | null | undefined): StatEntry[] {
    if (!text || text === 'null') return []
    try {
        const v = JSON.parse(text)
        return Array.isArray(v) ? v.filter(validEntry) : []
    } catch { return [] }
}

/** The valid entries of the panel's export (anything else in it is dropped; bad text is an empty list). */
export const parseEntries = parseList
export const parsePending = parseList

/** `$stat_pending` with `entries` added at the end, each stamped with the persona; the oldest go first when over the cap. */
export function enqueue(pending: string | null | undefined, entries: StatEntry[], persona: string): string {
    const list = [...parseList(pending), ...entries.filter(validEntry).map((e) => ({ stat: e.stat, value: e.value, turn: e.turn, time: e.time, persona: e.persona ?? persona }))]
        .filter((e) => PERSONA_RE.test(e.persona))
    return JSON.stringify(list.slice(-MAX_PENDING))
}

/** Sends the waiting entries in batches, in order; the first batch answered 'queue' (or that threw) and everything after it stay. */
export async function drain(pending: string | null | undefined, send: (batch: StatEntry[]) => Promise<SendResult>) {
    const list = parseList(pending)
    let at = 0, saved = 0, dropped = 0
    while (at < list.length) {
        const batch = list.slice(at, at + BATCH)
        let res: SendResult
        try { res = await send(batch) } catch { res = 'queue' }
        if (res === 'queue') break
        if (res === 'saved') saved += batch.length
        else dropped += batch.length
        at += batch.length
    }
    const keep = list.slice(at)
    return { pending: keep.length ? JSON.stringify(keep) : '', saved, dropped }
}

// imported when first needed: nodeStorage drags the whole app (streamsaver wants a document) into anything that imports it
const defaultAuth = async () => (await import('./nodeStorage')).getNodeServerProxyAuth()

/** One POST to the server's bridge. Network trouble, 502, 504 and auth trouble mean 'queue'; only a 400 (the store refused) drops. */
export async function sendStats(entries: StatEntry[], deps: { fetch?: typeof fetch, auth?: () => Promise<string> } = {}): Promise<SendResult> {
    const doFetch = deps.fetch ?? globalThis.fetch.bind(globalThis)
    try {
        const auth = await (deps.auth ?? defaultAuth)()
        const r = await doFetch('/api/stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'risu-auth': auth },
            body: JSON.stringify({ entries }),
        })
        if (r.status === 200) return 'saved'
        return r.status === 400 ? 'drop' : 'queue'
    } catch { return 'queue' }
}

/** The persona's current stats and skill mastery from the asset manager (through the Risu server), or null when it cannot be reached. */
export async function fetchCurrent(persona: string, deps: { fetch?: typeof fetch, auth?: () => Promise<string> } = {}): Promise<Current | null> {
    if (!PERSONA_RE.test(persona)) return null
    try {
        const auth = await (deps.auth ?? defaultAuth)()
        const r = await (deps.fetch ?? globalThis.fetch.bind(globalThis))(`/api/assets/stats?persona=${encodeURIComponent(persona)}`, { headers: { 'risu-auth': auth } })
        if (r.status !== 200) return null
        const j = await r.json()
        if (!j || typeof j.stats !== 'object' || typeof j.skills !== 'object' || !j.stats || !j.skills) return null
        const keep = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => isInt(v) && v >= 0 && v <= 10000)) as Record<string, number>
        return { stats: keep(j.stats), skills: keep(j.skills) }
    } catch { return null }
}

const obj = (text: unknown): Record<string, any> => {
    try { const v = JSON.parse(String(text ?? '')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} }
}

/**
 * What to write into the chat so it starts from the persona's values: each stat is the larger of the chat's and the store's (growth only
 * goes up, so a stale store never lowers a chat); a skill the store knows and the chat does not joins `$skills` unequipped (equipping is
 * the player's choice at a resting point); a skill the chat has keeps its link, name and slot and takes the larger mastery.
 * Returns the two texts, or null when the store has nothing or the chat already has it all.
 */
export function mergeCurrent(vars: Record<string, unknown> | undefined, cur: Current | null): { $stats: string, $skills: string } | null {
    if (!cur) return null
    const stats = obj(vars?.$stats)
    const skills = obj(vars?.$skills)
    let changed = false
    const outStats: Record<string, number> = {}
    for (const k of STAT_KEYS) {
        const mine = isInt(stats[k]) ? stats[k] : START_VALUE
        const theirs = isInt(cur.stats[k]) ? cur.stats[k] : 0
        outStats[k] = Math.max(mine, theirs)
        if (theirs > mine) changed = true
    }
    const outSkills: Record<string, any> = { ...skills }
    for (const [id, m] of Object.entries(cur.skills)) {
        const have = skills[id]
        if (have && typeof have === 'object') {
            if (m > (isInt(have.m) ? have.m : 0)) { outSkills[id] = { ...have, m }; changed = true }
        } else { outSkills[id] = { m, eq: 0 }; changed = true }
    }
    if (!changed) return null
    return { $stats: JSON.stringify(outStats), $skills: JSON.stringify(outSkills) }
}
