// Client for the persona's skill/item storage and skill slots (server/node/personaBridge.cjs -> asset manager persona_store.py).
// Every function returns a value and never throws: a rule failure is {ok:false, reason}, trouble reaching the server is reason 'network'.
// Nothing is kept here: the page asks the server again after each action.
export type Tier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond'
export type SkillEntry = { id: string, name: string, tier: Tier, exp: number, level?: number, exp_in?: number, need?: number, source?: string, mastery?: number /* OLD server only */, effect?: string, effect_is_default?: boolean, conditions?: string, mod?: number }
export type ItemEntry = { id: string, name: string, tier: Tier, qty: number, source?: string, effect?: string, effect_is_default?: boolean, conditions?: string }
export type PersonaData = {
    persona: string, level: number, rank: number, slots_open: number, max_storage: number, stat_cap: number,
    stat_caps: Record<string, number>, skills: SkillEntry[], items: ItemEntry[], slots: (string | null)[],
    skill_count: number, item_count: number,
    // the item slot grid (an older server sends none: read it through itemSlotsOf / itemSlotsOpenOf)
    item_slots?: (string | null)[], item_slots_open?: number, item_slots_limit?: number | null, item_slots_default?: number,
}
export const ITEM_SLOT_TOTAL = 11
/** The 11 item slots of a view: an old server's view has none = 11 empty. */
export function itemSlotsOf(d: Pick<PersonaData, 'item_slots'>): (string | null)[] {
    const g = Array.isArray(d.item_slots) ? d.item_slots : []
    return Array.from({ length: ITEM_SLOT_TOTAL }, (_, i) => (typeof g[i] === 'string' && g[i] !== '' ? g[i] as string : null))
}
/** How many item slots are open: the server's number, else (old server) the same as the skill slots. */
export function itemSlotsOpenOf(d: Pick<PersonaData, 'item_slots_open' | 'slots_open'>): number {
    const n = Number.isInteger(d.item_slots_open) ? d.item_slots_open as number : d.slots_open
    return Math.max(0, Math.min(ITEM_SLOT_TOTAL, Number(n) || 0))
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
export const equipItem = (persona: string, slot: number, itemId: string, level: number, deps: Deps = {}) =>
    post('equip-item', { persona, slot, itemId, level }, deps)
export const unequipItem = (persona: string, slot: number, level: number, deps: Deps = {}) =>
    post('unequip-item', { persona, slot, level }, deps)
/** The owner's number of open item slots (1..11), null = back to the formula. */
export const setItemSlots = (persona: string, limit: number | null, level: number, deps: Deps = {}) =>
    post('item-slots', { persona, limit, level }, deps)

// ---- the loot of a reply as an event with an id (chat, turn, 'loot', idx): POST /api/persona/loot/turn (persona_store.loot_turn) ----------
// The turn's loot REPLACES what that (chat, turn) had: a regenerated reply takes the earlier loot back, [] takes it all back, a replay adds nothing.
export type LootItem = { kind: 'skill' | 'item', entry: Record<string, unknown>, find?: unknown }
export type LootTurnBody = { persona: string, chat: string, turn: number, level: number, loots: LootItem[] }
export type LootResult = { idx: number, ok: boolean, reason?: string, added?: 'new' | 'merged' | 'kept' }
export type LootSend = { status: 'saved', results: LootResult[] } | { status: 'queue' } | { status: 'drop' }

/** The chat variable with this reply's loot (findGlue's handler writes it; the after-reply step sends it and clears it). */
export const LOOT_PENDING_KEY = '$loot_pending'
/** Loot turns that could not be sent, newest per (persona, chat, turn). */
export const LOOT_TURN_PENDING_KEY = '$loot_turn_pending'
export const MAX_LOOT_PENDING = 50
const PERSONA_RE = /^[A-Za-z0-9_.-]{1,64}$/
const CHAT_RE = /^[A-Za-z0-9_.-]{1,64}$/
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const parseJson = (text: unknown): unknown => { try { return JSON.parse(String(text ?? '')) } catch { return undefined } }

const isLoot = (l: unknown): l is LootItem => !!l && typeof l === 'object' && ((l as LootItem).kind === 'skill' || (l as LootItem).kind === 'item')
    && !!(l as LootItem).entry && typeof (l as LootItem).entry === 'object'

export function parsePendingLootTurns(text: string | null | undefined): LootTurnBody[] {
    const v = parseJson(text)
    return Array.isArray(v) ? v.filter((b) => b && typeof b === 'object' && PERSONA_RE.test(b.persona) && CHAT_RE.test(b.chat) && isInt(b.turn) && b.turn >= 0
        && isInt(b.level) && Array.isArray(b.loots) && b.loots.every(isLoot)) : []
}

/** The queue with `body` in place of any earlier body of the same (persona, chat, turn): the newest reply of a turn wins. */
export function enqueueLootTurn(pending: string | null | undefined, body: LootTurnBody): string {
    const list = parsePendingLootTurns(pending).filter((b) => !(b.persona === body.persona && b.chat === body.chat && b.turn === body.turn))
    list.push(body)
    return JSON.stringify(list.slice(-MAX_LOOT_PENDING))
}

/** One POST /api/persona/loot/turn (only {kind, entry} of each loot goes). 200 -> saved with the results; 400 -> drop; anything else -> queue. */
export async function sendLootTurn(body: LootTurnBody, deps: Deps = {}): Promise<LootSend> {
    try {
        const auth = await (deps.auth ?? defaultAuth)()
        const wire = { persona: body.persona, chat: body.chat, turn: body.turn, level: body.level, loots: body.loots.map((l) => ({ kind: l.kind, entry: l.entry })) }
        const r = await (deps.fetch ?? globalThis.fetch.bind(globalThis))('/api/persona/loot/turn', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'risu-auth': auth }, body: JSON.stringify(wire),
        })
        if (r.status === 400) return { status: 'drop' }
        if (r.status !== 200) return { status: 'queue' }
        const j = await r.json()
        if (!j || typeof j !== 'object' || j.ok !== true || !Array.isArray(j.results)) return { status: 'queue' }
        return { status: 'saved', results: j.results as LootResult[] }
    } catch { return { status: 'queue' } }
}
