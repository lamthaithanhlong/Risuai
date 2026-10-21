// The GM's decision for this turn from the Node server (server/node/gmSolver.cjs, POST /api/story/decide): the chat's variables,
// its last messages and this turn's dice go in; one or two lines come back, which the GM note gives the narrator in place of open
// rules (gameMaster.ts gmNote). No server, a slow answer (the solver's budget is 300 ms) or any error gives null, and the page keeps
// today's note.

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
