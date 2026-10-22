// The GM's decision for this turn from the Node server (server/node/gmSolver.cjs, POST /api/story/decide): the chat's variables,
// its last messages and this turn's dice go in; one or two lines come back, which the GM note gives the narrator in place of open
// rules (gameMaster.ts gmNote). No server, a slow answer (the solver's budget is 300 ms) or any error gives null, and the page keeps
// today's note.

import { isUnnamed, parseLooks } from './portraits'

export interface DecideDeps {
    fetch: typeof fetch
    auth(): Promise<string>
    timeoutMs?: number
}

export type DecideInput = {
    chatId: string; world: string; phase: 'seed' | 'run'; vars: Record<string, string>; messages: { role: string; text: string }[]
    dice: { pace: string; surface: string; consequence: boolean; cardNew: boolean; firstOrder: boolean }; prevNew: boolean
    kinds: string[]; stance: string; mode: { scene: string; combat: string }
    /** NPC psychology (server/node/story/npcs): the server appends a Subtext line to the note; false (db.npcPsych off) skips it */
    npc: boolean
    /** the reply count now: the $led_soc lines' turn numbers are counted the same way, so the server ages emotions by it */
    turn?: number
    /** named people the ledger may not have (decidePeople): the server counts them as people of the story, present when named */
    people?: string[]
    /** the companions the player's persona names (decideCompanions): the server starts them close to the player, there to help */
    companions?: string[]
}
type Term = { name: string; args: Term[] }
export type GmDecision = {
    line: string; newEvent: boolean; turn: string | null; present: string[]; hostile: string[]; onstage: string[]
    /** the Subtext line the server appended to `line` ('' when none), and which engine appraised it ('fatima' | 'asp'; null when none) */
    subtext: string; npcSource: string | null
}

/** the longest note line taken: the solver's own lines plus the Subtext line (server cap 520 chars) */
export const DECIDE_LINE_MAX = 2600

/** the chat's variables the solver reads (panel, ledger, the GM's notes), as text */
export function decideVars(vars: Record<string, unknown> | undefined): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(vars ?? {})) {
        const m = /^\$((st|led|gm)_[a-z0-9_]{1,40})$/.exec(k)
        if (m && v !== undefined && v !== null && !/^gm_(prev|at)$/.test(m[1])) out[m[1]] = String(v).slice(0, 6000)
    }
    return out
}

/** the chat's last 4 messages, the player's turn last, without hidden blocks */
export function decideMessages(messages: { role: string; data: string }[] | undefined): { role: string; text: string }[] {
    return (messages ?? []).slice(-4).map((m) => ({ role: m.role === 'user' ? 'user' : 'char', text: String(m.data ?? '').replace(/\[\[[A-Z_]+[\s\S]*?(\]\]|$)/g, '').slice(-1500) }))
}

/** at most this many names go with a decide request */
export const DECIDE_PEOPLE_MAX = 40

/**
 * The named people of the chat the ledger may have no line for: the [[LOOK name | ...]] lines of the last messages (the narrator
 * writes one when a named character first appears) and the card's portraits (what earlier replies named). Roles ("Người lính") are
 * no name. Measured 2026-10-21 (acceptance ss): "Martin Vale" walked beside the character for twelve replies, the ledger never named
 * him, and the NPC layer had nobody to read. Newest first, at most DECIDE_PEOPLE_MAX.
 */
export function decidePeople(messages: { data: string }[] | undefined, portraits?: Record<string, { name?: string; hand?: boolean }> | null): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const add = (n: string | undefined) => {
        const name = String(n ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
        const k = name.normalize('NFC').toLowerCase()
        if (!name || seen.has(k) || isUnnamed(name)) return
        seen.add(k)
        out.push(name)
    }
    for (const m of [...(messages ?? [])].slice(-8).reverse()) for (const l of parseLooks(String(m.data ?? ''))) add(l.name)
    for (const e of Object.values(portraits ?? {})) add(e?.name)
    return out.slice(0, DECIDE_PEOPLE_MAX)
}

/** at most this many companions go with a decide request */
export const DECIDE_COMPANIONS_MAX = 6

/** "Đồng hành: Evelyn, Linh Hồn Dẫn Lối, ..." (the creation sheet's line, or the persona's): the label and what follows it */
const COMPANION_LINE = /^[\s>*•-]*\**\s*(?:bạn đồng hành|người đồng hành|đồng hành|companions?)\s*\**\s*[:：]\s*(.+)$/gimu
/** "**Evelyn — Linh Hồn Dẫn Lối:**" (a persona's heading for a companion): a capitalised name, a dash, a role */
const COMPANION_HEAD = /^[\s>-]*\*\*\s*([^*\n:—–]{2,40}?)\s+[—–]\s+[^*\n]{1,60}\*\*/gmu
const NO_COMPANION = /^(không|chưa|none|no|n\/a|—|-)\b/iu

/**
 * The companions the player's persona names: who walks beside the character by the player's own sheet ("Đồng hành: Evelyn, ...",
 * or a persona heading "**Evelyn — Linh Hồn Dẫn Lối:**"), from the persona and the first replies (the creation sheet). The card has
 * no profile for them, and as strangers they were neutral and made small talk through danger (Mailman 2026-10-22). Each name is the
 * text before its first comma, dash or bracket; "không" is none. At most DECIDE_COMPANIONS_MAX.
 */
export function decideCompanions(persona: string | undefined, messages?: { data: string }[]): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const add = (raw: string) => {
        const name = raw.replace(/\*\*|["“”]/g, '').split(/[,(（—–]|\s-\s/)[0].replace(/\s+/g, ' ').trim()
        const k = name.normalize('NFC').toLowerCase()
        const words = name.split(' ')
        if ([...name].length < 2 || [...name].length > 40 || words.length > 4 || NO_COMPANION.test(name) || isUnnamed(name) || seen.has(k)) return
        if (!words.every((w) => /^\p{Lu}/u.test(w))) return          // a name, not a description ("bạn thân đã qua đời")
        seen.add(k)
        out.push(name)
    }
    const texts = [String(persona ?? ''), ...(messages ?? []).slice(0, 4).map((m) => String(m.data ?? ''))]
    for (const t of texts) for (const m of t.matchAll(COMPANION_LINE)) for (const part of m[1].split(/;|\s+và\s+|\s+and\s+/u)) add(part)
    for (const m of String(persona ?? '').matchAll(COMPANION_HEAD)) add(m[1])
    return out.slice(0, DECIDE_COMPANIONS_MAX)
}

export async function fetchGmDecision(input: DecideInput, deps: DecideDeps): Promise<GmDecision | null> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? 900)
    try {
        const res = await deps.fetch('/api/story/decide', {
            method: 'POST', signal: ctl.signal,
            headers: { 'content-type': 'application/json', 'risu-auth': await deps.auth() },
            body: JSON.stringify(input),
        })
        if (!res.ok) return null
        const r = await res.json()
        const line = typeof r?.line === 'string' ? r.line : ''
        if (r?.status !== 'ok' || line.length > DECIDE_LINE_MAX || !/^(This turn|People in the scene|The character)/.test(line)) return null
        const d = r.decision ?? {}
        const names = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [])
        return { line, newEvent: !!r.newEvent, turn: (d.turn as Term | null)?.name ?? null, present: names(d.present), hostile: names(d.hostile), onstage: names(d.onstage),
            subtext: typeof r.npc?.subtext === 'string' ? r.npc.subtext : '', npcSource: typeof r.npc?.source === 'string' ? r.npc.source : null }
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}
