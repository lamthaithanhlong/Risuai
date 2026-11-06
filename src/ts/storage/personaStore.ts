// Client for the persona's skill/item storage and skill slots (server/node/personaBridge.cjs -> asset manager persona_store.py).
// Every function returns a value and never throws: a rule failure is {ok:false, reason}, trouble reaching the server is reason 'network'.
// Nothing is kept here: the page asks the server again after each action.
export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond'
export type SkillEntry = { id: string, name: string, tier: Tier, mastery: number, source?: string }
export type ItemEntry = { id: string, name: string, tier: Tier, qty: number, source?: string }
export type PersonaData = {
    persona: string, level: number, rank: number, slots_open: number, max_storage: number, stat_cap: number,
    stat_caps: Record<string, number>, skills: SkillEntry[], items: ItemEntry[], slots: (string | null)[],
    skill_count: number, item_count: number,
}
export type Fail = { ok: false, reason: string, [k: string]: unknown }
export type Deps = { fetch?: typeof fetch, auth?: () => Promise<string> }
export type ViewResult = { ok: true, data: PersonaData } | Fail
export type ActResult = { ok: true, [k: string]: unknown } | Fail

const defaultAuth = async () => (await import('./nodeStorage')).getNodeServerProxyAuth()
const NETWORK: Fail = { ok: false, reason: 'network' }
const lv = (n: number) => String(Math.max(1, Math.floor(Number(n) || 1)))

export async function fetchPersona(persona: string, level: number, deps: Deps = {}): Promise<ViewResult> {
    try {
        const auth = await (deps.auth ?? defaultAuth)()
        const r = await (deps.fetch ?? globalThis.fetch.bind(globalThis))(`/api/persona?persona=${encodeURIComponent(persona)}&level=${lv(level)}`, { headers: { 'risu-auth': auth } })
        if (r.status !== 200) return { ok: false, reason: 'network' }
        const j = await r.json()
        if (!j || typeof j !== 'object' || !Array.isArray(j.skills) || !Array.isArray(j.items) || !Array.isArray(j.slots)) return { ok: false, reason: 'network' }
        return { ok: true, data: j as PersonaData }
    } catch { return { ...NETWORK } }
}

async function post(route: string, body: Record<string, unknown>, deps: Deps): Promise<ActResult> {
    try {
        const auth = await (deps.auth ?? defaultAuth)()
        const r = await (deps.fetch ?? globalThis.fetch.bind(globalThis))(`/api/persona/${route}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'risu-auth': auth }, body: JSON.stringify(body),
        })
        if (r.status !== 200) return { ok: false, reason: 'network' }
        const j = await r.json()
        if (!j || typeof j !== 'object') return { ok: false, reason: 'network' }
        return j.ok === true ? j : { ...j, ok: false, reason: typeof j.reason === 'string' ? j.reason : 'unknown' }
    } catch { return { ...NETWORK } }
}

/** Not used by the page (loot comes from the story); kept for completeness and tests. */
export const lootPersona = (persona: string, kind: 'skill' | 'item', entry: Record<string, unknown>, level: number, deps: Deps = {}) =>
    post('loot', { persona, kind, entry, level }, deps)
export const deleteEntry = (persona: string, kind: 'skill' | 'item', id: string, level: number, deps: Deps = {}) =>
    post('delete', { persona, kind, id, level }, deps)
export const equipSkill = (persona: string, slot: number, skillId: string, level: number, deps: Deps = {}) =>
    post('equip', { persona, slot, skillId, level }, deps)
export const unequipSkill = (persona: string, slot: number, level: number, deps: Deps = {}) =>
    post('unequip', { persona, slot, level }, deps)
