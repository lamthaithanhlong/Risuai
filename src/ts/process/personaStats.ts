// The persona page's "Chỉ số & Kỹ năng" section: read-only. Values are integer hundredths of a percent (1000 = 10.00%), as the card's Lua
// and the global store keep them (tools/stats/config.json is the reference for the numbers below). Pure helpers, so the page only draws.
//
//   fmtPct(v)                 -> "23.47%"
//   toNext(v)                 -> 0..1, how far v is through its current whole 1.00% (the bar to the next milestone)
//   slotsFor(yChi)            -> 1..6, a slot per Ý chí threshold passed (15/30/45/60/75%)
//   tierOf(m)                 -> tier name from the mastery
//   skillCap(link, stats)     -> the most mastery the skill can reach now: linked stat + 25%, never above 100%
//   buildView(inputs)         -> the rows the page draws
export const STAT_ROWS: { key: string, vi: string, en: string }[] = [
    { key: 'suc_manh', vi: 'Sức mạnh', en: 'Strength' },
    { key: 'nhanh_nhen', vi: 'Nhanh nhẹn', en: 'Agility' },
    { key: 'the_luc', vi: 'Thể lực', en: 'Stamina' },
    { key: 'tinh_than', vi: 'Tinh thần', en: 'Spirit' },
    { key: 'cam_nhan', vi: 'Cảm nhận', en: 'Perception' },
    { key: 'y_chi', vi: 'Ý chí', en: 'Will' },
]
export const SLOT_THRESHOLDS = [1500, 3000, 4500, 6000, 7500]
export const MAX_SLOTS = 6
export const LINK_MARGIN = 2500
export const HARD_CAP = 10000
export const START_VALUE = 1000
export const TIERS: { vi: string, en: string, from: number }[] = [
    { vi: 'Sơ nhập', en: 'Novice', from: 0 },
    { vi: 'Tiểu thành', en: 'Minor', from: 2500 },
    { vi: 'Đại thành', en: 'Major', from: 5000 },
    { vi: 'Viên mãn', en: 'Perfect', from: 7500 },
    { vi: 'Đăng phong', en: 'Summit', from: 10000 },
]

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const clamp = (v: number) => Math.max(0, Math.min(HARD_CAP, v))

export function fmtPct(v: number): string {
    const n = isInt(v) ? clamp(v) : 0
    return `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}%`
}

/** A stat as the player reads it: the whole point and its EXP, "11 (EXP 5/30)" (owner 2026-11-06: stats are integers with EXP; no percent sign). The store keeps
 *  hundredths of a point, so the EXP is the decimal part's share of the need, rounded down (the same split stats.lua makes when it reads an old $stats). */
export function fmtStat(v: number): string {
    const n = isInt(v) ? clamp(v) : 0
    const s = Math.floor(n / 100)
    const need = 20 + 10 * (Math.max(10, s) - 10)
    return `${s} (EXP ${Math.floor(((n % 100) * need) / 100)}/${need})`
}

export function toNext(v: number): number {
    const n = isInt(v) ? clamp(v) : 0
    return n >= HARD_CAP ? 1 : (n % 100) / 100
}

export function slotsFor(yChi: number): number {
    const n = isInt(yChi) ? yChi : 0
    return Math.min(MAX_SLOTS, 1 + SLOT_THRESHOLDS.filter((t) => n >= t).length)
}

export function tierOf(m: number): { vi: string, en: string, index: number } {
    const n = isInt(m) ? clamp(m) : 0
    let at = 0
    TIERS.forEach((t, i) => { if (n >= t.from) at = i })
    return { vi: TIERS[at].vi, en: TIERS[at].en, index: at }
}

export function skillCap(link: string[] | undefined, stats: Record<string, number>, defaultLink: string[] = []): number {
    const keys = link && link.length ? link : defaultLink
    const linked = keys.reduce((hi, k) => Math.max(hi, isInt(stats[k]) ? stats[k] : 0), 0)
    return Math.min(linked + LINK_MARGIN, HARD_CAP)
}

import { masteryFromExp } from './personaView'
export type StoreCurrent = { stats: Record<string, number>, skills: Record<string, number> } | null
export type FindNames = Record<string, { vi?: string, en?: string }>
export type StatRow = { key: string, vi: string, en: string, value: number, pct: string, bar: number }
export type SkillRow = { id: string, name: string, m: number, pct: string, tier: { vi: string, en: string, index: number }, equipped: boolean, cap: number, capPct: string, capped: boolean }
export type View = { source: 'store' | 'chat' | 'none', stats: StatRow[], slots: { used: number, total: number }, skills: SkillRow[] }

const obj = (text: unknown): Record<string, any> => {
    try { const v = JSON.parse(String(text ?? '')); return v && typeof v === 'object' && !Array.isArray(v) ? v : {} } catch { return {} }
}

/**
 * What the page shows. The store (the persona's global history) is the source; the open chat's `$stats` / `$skills` fill what the store
 * lacks and carry what only the chat knows (equipped flag, link, name). A value is the larger of the two: growth only goes up.
 * `ledgerSkills` (GET /api/persona/state `skills`, L1 2026-11-06 item (e)): a skill's mastery from the persona's event ledger, used as it is (a regenerated
 * reply's mastery is taken back, so no max with the old store); a skill it does not name keeps the old rule.
 */
/**
 * What the persona store (/api/persona) says the persona holds now: the skill ids in its storage, their names, the open slots and what is
 * in them. null = the store was not asked or did not answer (the page then shows every skill it knows a mastery for, as before).
 */
export type Held = { ids: string[], names: Record<string, string>, slotsOpen: number, slotted: string[] }
export function heldOf(d: { skills?: { id: string, name?: string | null }[], slots?: (string | null)[], slots_open?: number }): Held {
    const skills = Array.isArray(d.skills) ? d.skills.filter((e) => e && typeof e.id === 'string') : []
    const ids = skills.map((e) => e.id)
    const names: Record<string, string> = {}
    for (const e of skills) if (typeof e.name === 'string' && e.name) names[e.id] = e.name
    const has = new Set(ids)
    return {
        ids, names, slotsOpen: Math.max(0, Math.floor(Number(d.slots_open) || 0)),
        slotted: [...new Set((Array.isArray(d.slots) ? d.slots : []).filter((x): x is string => typeof x === 'string' && has.has(x)))],
    }
}

/**
 * `held` (the persona store's answer): a mastery kept by the stats store or the ledger for a skill the persona no longer holds (deleted in
 * "Kho & Slot") is not drawn; the open chat's own `$skills` stay, the chat may hold a skill the store has not been told of yet. The slot
 * count and the equipped marks then follow the persona store, not the stat formula.
 */
export function buildView(store: StoreCurrent, vars: Record<string, unknown> | undefined, finds: FindNames = {}, ledgerSkills: Record<string, number> | null = null, held: Held | null = null): View {
    const cs = obj(vars?.$stats)
    const ck = obj(vars?.$skills)
    const stats: Record<string, number> = {}
    let any = false
    for (const r of STAT_ROWS) {
        const a = isInt(cs[r.key]) ? cs[r.key] : undefined
        const b = store && isInt(store.stats[r.key]) ? store.stats[r.key] : undefined
        if (a !== undefined || b !== undefined) any = true
        stats[r.key] = clamp(Math.max(a ?? START_VALUE, b ?? 0))
    }
    const kept = held ? new Set<string>([...held.ids, ...Object.keys(ck)]) : null
    const ids = new Set<string>([...Object.keys(ck), ...Object.keys(store?.skills ?? {}), ...Object.keys(ledgerSkills ?? {}), ...(held?.ids ?? [])].filter((id) => !kept || kept.has(id)))
    const slotted = new Set(held?.slotted ?? [])
    if (ids.size) any = true
    const skills: SkillRow[] = [...ids].map((id) => {
        const c = ck[id] && typeof ck[id] === 'object' ? ck[id] : {}
        const chatM = isInt(c.m) ? (String(vars?.$skill_exp ?? '') === '1' ? masteryFromExp(c.m) : c.m) : 0   // a chat marked $skill_exp = 1 holds EXP; this page shows the 0..10000 scale
        const m = ledgerSkills && isInt(ledgerSkills[id]) ? masteryFromExp(ledgerSkills[id]) : clamp(Math.max(chatM, store && isInt(store.skills[id]) ? store.skills[id] : 0))
        const cap = skillCap(Array.isArray(c.link) ? c.link.filter((x: unknown) => typeof x === 'string') : undefined, stats)
        const name = (typeof c.name === 'string' && c.name) || held?.names[id] || finds[id]?.vi || finds[id]?.en || id
        return { id, name, m, pct: fmtPct(m), tier: tierOf(m), equipped: c.eq === 1 || slotted.has(id), cap, capPct: fmtPct(cap), capped: m >= cap }
    }).sort((x, y) => Number(y.equipped) - Number(x.equipped) || y.m - x.m || x.name.localeCompare(y.name))
    const total = held ? held.slotsOpen : slotsFor(stats.y_chi)
    return {
        source: !any ? 'none' : store && (Object.keys(store.stats).length || Object.keys(store.skills).length) ? 'store' : 'chat',
        stats: STAT_ROWS.map((r) => ({ key: r.key, vi: r.vi, en: r.en, value: stats[r.key], pct: fmtStat(stats[r.key]), bar: toNext(stats[r.key]) })),
        slots: { used: skills.filter((s) => s.equipped).length, total },
        skills,
    }
}

type Auth = () => Promise<string>
const defaultAuth: Auth = async () => (await import('../storage/nodeStorage')).getNodeServerProxyAuth()

/** Skill names by find id from the asset manager (through the Risu server), or {} when it cannot be reached. */
export async function fetchFindNames(deps: { fetch?: typeof fetch, auth?: Auth } = {}): Promise<FindNames> {
    try {
        const auth = await (deps.auth ?? defaultAuth)()
        const r = await (deps.fetch ?? globalThis.fetch.bind(globalThis))('/api/assets/finds', { headers: { 'risu-auth': auth } })
        if (r.status !== 200) return {}
        const j = await r.json()
        const list: any[] = Array.isArray(j) ? j : Array.isArray(j?.finds) ? j.finds : []
        const out: FindNames = {}
        for (const f of list) if (f && typeof f.id === 'string' && f.name && typeof f.name === 'object') out[f.id] = { vi: f.name.vi, en: f.name.en }
        return out
    } catch { return {} }
}
