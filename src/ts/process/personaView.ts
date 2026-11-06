// What the "Kho & Slot" tab shows, from the server's answer and the persona's Level/EXP (pure; the component only draws it).
import { itemSlotsOf, type PersonaData, type SkillEntry, type ItemEntry, type Tier } from '../storage/personaStore'

export const TIERS: Tier[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond']
export const TIER_LABEL: Record<Tier, string> = { bronze: 'Đồng', silver: 'Bạc', gold: 'Vàng', platinum: 'Bạch kim', diamond: 'Kim cương' }
export const TIER_CLASS: Record<Tier, string> = { bronze: 'tier-bronze', silver: 'tier-silver', gold: 'tier-gold', platinum: 'tier-platinum', diamond: 'tier-diamond' }
export const RANK_LABELS = ['Tân binh', 'Học việc', 'Sơ cấp', 'Trung cấp', 'Thành thạo', 'Tinh anh', 'Cao thủ', 'Đại sư', 'Tông sư', 'Huyền thoại']
export const SLOT_TOTAL = 11
export const STAT_LABEL: Record<string, string> = { suc_manh: 'Sức mạnh', nhanh_nhen: 'Nhanh nhẹn', the_luc: 'Thể lực', tinh_than: 'Tinh thần', cam_nhan: 'Cảm nhận', y_chi: 'Ý chí' }
export const REASON_VI: Record<string, string> = {
    full: 'Kho đầy', not_found: 'Không còn trong kho', slot_locked: 'Slot chưa mở ở rank này', no_such_skill: 'Kỹ năng này không có trong kho', no_such_item: 'Vật phẩm này không có trong kho',
    already_equipped: 'Đã gắn ở slot khác', network: 'Không kết nối được máy chủ', unknown: 'Không thực hiện được',
}
export const reasonText = (r: string) => REASON_VI[r] ?? REASON_VI.unknown

/** Smallest integer n with n*n <= x, by integer Newton steps (no float sqrt, same as stats.lua need_level). */
function isqrt(x: number): number {
    if (x < 2) return x
    let r = Math.floor(Math.sqrt(x))
    while (r * r > x) r--
    while ((r + 1) * (r + 1) <= x) r++
    return r
}
/** EXP needed to leave level L: floor(100 * L^1.5) = isqrt(10000 * L^3). */
export function needExp(level: number): number {
    const L = Math.max(1, Math.floor(Number(level) || 1))
    return isqrt(10000 * L * L * L)
}
export function rankOf(level: number): number { return Math.min(10, 1 + Math.floor((Math.max(1, Math.floor(Number(level) || 1)) - 1) / 10)) }
export const rankName = (rank: number) => `R${rank} · ${RANK_LABELS[Math.min(10, Math.max(1, rank)) - 1]}`

export const VI_WORDS: Record<string, string> = {
    'wall': 'tường', 'vibration': 'rung', 'listening': 'nghe', 'listen': 'nghe', 'rhythm': 'nhịp', 'separation': 'tách', 'sound': 'âm thanh',
    'audio': 'âm thanh', 'plastic': 'nhựa', 'clothespin': 'kẹp áo', 'knife': 'dao', 'rusty': 'gỉ', 'bandage': 'băng gạc', 'pistol': 'súng ngắn',
    'gun': 'súng', 'armor': 'giáp', 'shield': 'khiên', 'sword': 'kiếm', 'fire': 'lửa', 'ice': 'băng', 'lightning': 'sét', 'water': 'nước',
    'shadow': 'bóng tối', 'light': 'ánh sáng', 'dark': 'bóng đêm', 'sense': 'cảm nhận', 'sensing': 'cảm nhận', 'detect': 'dò', 'detection': 'dò tìm',
    'scan': 'quét', 'scanning': 'quét', 'record': 'ghi', 'recording': 'ghi nhận', 'pattern': 'mẫu', 'recognition': 'nhận dạng', 'heal': 'chữa',
    'healing': 'chữa trị', 'medicine': 'thuốc', 'potion': 'thuốc', 'key': 'chìa khoá', 'door': 'cửa', 'map': 'bản đồ', 'phone': 'điện thoại',
    'radio': 'radio', 'battery': 'pin', 'food': 'thực phẩm', 'rope': 'dây thừng', 'tool': 'dụng cụ', 'step': 'bước', 'silent': 'im lặng',
    'stealth': 'ẩn nấp', 'run': 'chạy', 'running': 'chạy', 'jump': 'nhảy', 'climb': 'leo', 'climbing': 'leo trèo', 'strike': 'đòn', 'hit': 'đánh',
    'punch': 'đấm', 'kick': 'đá', 'breath': 'hơi thở', 'breathing': 'thở', 'focus': 'tập trung', 'will': 'ý chí', 'power': 'sức mạnh', 'speed': 'tốc độ',
    'eye': 'mắt', 'eagle': 'ưng', 'void': 'hư không', 'core': 'lõi', 'energy': 'năng lượng', 'laptop': 'máy tính xách tay', 'old': 'cũ',
}
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)+$/
/** "wall-vibration-listening" -> "Nghe rung tường" (mirrors persona_store.vi_name: the words reversed, translated, an unknown word capitalised, never a hyphen). */
export function viName(id: string): string {
    const words = String(id ?? '').toLowerCase().split(/[-_\s]+/).filter(Boolean)
    const out = words.reverse().map((w) => VI_WORDS[w] ?? w).join(' ') || String(id ?? '')
    return out.charAt(0).toUpperCase() + out.slice(1)
}
/** What the page shows for an entry: its own name, unless it is missing, equal to the id or looks like a kebab-case id. */
export function displayName(e: { id: string, name?: string | null }): string {
    const n = typeof e.name === 'string' ? e.name.trim() : ''
    return !n || n === e.id || KEBAB.test(n) ? viName(e.id) : n
}
// SKILL LEVEL + EXP (one source for the page; the server's level/exp_in/need are never trusted when they disagree, same principle as levelFacts).
export const SKILL_MAX_LEVEL = 10
export const SKILL_EXP_CAP = 540
/** EXP to leave skill level lv: 20 + 10*(lv-1). */
export const skillNeed = (lv: number) => 20 + 10 * (Math.max(1, Math.floor(Number(lv) || 1)) - 1)
/** Total EXP at which level lv starts: cum(1) = 0, cum(L) = sum need(1..L-1). */
export const skillCum = (lv: number) => { let t = 0; for (let i = 1; i < Math.min(SKILL_MAX_LEVEL, Math.max(1, Math.floor(Number(lv) || 1))); i++) t += skillNeed(i); return t }
const clampExp = (e: unknown) => Math.max(0, Math.min(SKILL_EXP_CAP, Math.floor(Number(e) || 0)))
export function skillLevelOf(exp: unknown): number {
    const e = clampExp(exp)
    let lv = 1
    while (lv < SKILL_MAX_LEVEL && e >= skillCum(lv + 1)) lv++
    return lv
}
/** EXP inside the current level (0 at the top level). */
export const skillExpIn = (exp: unknown) => { const e = clampExp(exp), lv = skillLevelOf(e); return lv >= SKILL_MAX_LEVEL ? 0 : e - skillCum(lv) }
/** An OLD server's mastery (hundredths 0..10000) -> total EXP. */
export function expFromMastery(m: unknown): number {
    const v = Math.max(0, Math.min(10000, Math.floor(Number(m) || 0)))
    const lv = Math.min(SKILL_MAX_LEVEL, 1 + Math.floor(v / 1000))
    return lv >= SKILL_MAX_LEVEL ? SKILL_EXP_CAP : skillCum(lv) + Math.floor((v % 1000) * skillNeed(lv) / 1000)
}
/** Total EXP -> mastery hundredths (the old stats page's unit): 1000 per level, the rest in proportion of that level's need; 10000 at the cap. */
export function masteryFromExp(exp: unknown): number {
    const e = clampExp(exp), lv = skillLevelOf(e)
    return lv >= SKILL_MAX_LEVEL ? 10000 : (lv - 1) * 1000 + Math.floor(skillExpIn(e) * 1000 / skillNeed(lv))
}
/** A skill entry of a view -> {exp, level, expIn, need, max, barPct, text}; exp is total EXP (or an old server's mastery), everything else derived here. */
export function skillProgress(s: { exp?: unknown, mastery?: unknown }) {
    const exp = clampExp(typeof s.exp === 'number' ? s.exp : expFromMastery(s.mastery))
    const level = skillLevelOf(exp), max = level >= SKILL_MAX_LEVEL
    const expIn = skillExpIn(exp), need = max ? 0 : skillNeed(level)
    return { exp, level, expIn, need, max, barPct: max ? 100 : Math.round(expIn * 100 / need), text: max ? `Lv ${level} (tối đa)` : `Lv ${level} (EXP ${expIn}/${need})` }
}
/** "<name> · <Bạc> · Lv 3 (EXP 12/40)". */
export const skillLabel = (name: string, tier: Tier, p: { text: string }) => `${name} · ${TIER_LABEL[tier]} · ${p.text}`

/** "🔒 Mở thêm 1 slot ở Lv N (còn K slot khoá)" or null when every slot is open. Rank steps every 10 levels: the next unlock is at Lv 10*rank+1. */
export function lockedLine(open: number, rank: number, limit: number | null = null): string | null {
    const k = SLOT_TOTAL - open
    if (k <= 0) return null
    if (limit !== null) return `🔒 Đang giới hạn ở ${open} slot (còn ${k} slot khoá)`
    return `🔒 Mở thêm 1 slot ở Lv ${10 * Math.max(1, rank) + 1} (còn ${k} slot khoá)`
}

/** EVERYTHING that is a function of the Level, from the one Level on the page (same formulas as persona_store.py: rank_of, slots_open, max_storage, stat_cap).
 *  The server view's own level/rank/slots_open/max_storage/stat_cap are never read: a view asked at another Level cannot make the head disagree with its bar. */
export function levelFacts(levelIn: number) {
    const level = Math.max(1, Math.floor(Number(levelIn) || 1))
    const rank = rankOf(level)
    return {
        level, rank, rankName: rankName(rank), need: needExp(level),
        slotsOpen: Math.min(SLOT_TOTAL, 1 + rank),
        maxStorage: Math.max(100, 100 + 20 * (rank - 1) + 5 * level),
        statCap: 20 + 8 * (rank - 1),
    }
}

export type Lvl = { level: number, exp: number }
/** The chat variable $lvl ({"l":..,"e":..}) -> level and exp; anything else is Level 1, EXP 0. */
export function parseLvl(text: unknown): Lvl {
    try {
        const v = typeof text === 'string' ? JSON.parse(text) : text as any
        const l = Math.floor(Number(v?.l)), e = Math.floor(Number(v?.e))
        return { level: Number.isFinite(l) && l >= 1 ? l : 1, exp: Number.isFinite(e) && e >= 0 ? e : 0 }
    } catch { return { level: 1, exp: 0 } }
}

export type SlotCell = { index: number, open: boolean, skillId: string | null, name: string | null, tier: Tier | null, prog: ReturnType<typeof skillProgress> | null }
export type ItemSlotCell = { index: number, open: boolean, itemId: string | null, name: string | null, tier: Tier | null, qty: number }
export type Filter = Tier | 'all'

export function filterTier<T extends { tier: Tier }>(list: T[], f: Filter): T[] { return f === 'all' ? list : list.filter((e) => e.tier === f) }

export function buildInventory(d: PersonaData, lvl: Lvl, filter: Filter = 'all') {
    const f = levelFacts(lvl.level)
    const need = f.need
    const byId = new Map(d.skills.map((s) => [s.id, s]))
    const slots: SlotCell[] = Array.from({ length: SLOT_TOTAL }, (_, i) => {
        const id = d.slots[i] ?? null
        const s = id ? byId.get(id) : undefined
        return { index: i, open: i < f.slotsOpen, skillId: id, name: id ? (s ? displayName(s) : viName(id)) : null, tier: s?.tier ?? null, prog: s ? skillProgress(s) : null }
    })
    const equippedAt = new Map<string, number>()
    slots.forEach((c) => { if (c.skillId) equippedAt.set(c.skillId, c.index) })
    const used = slots.filter((c) => c.skillId).length
    const iById = new Map(d.items.map((i) => [i.id, i]))
    const limit = Number.isInteger(d.item_slots_limit) ? d.item_slots_limit as number : null
    const itemOpen = limit !== null ? Math.max(0, Math.min(SLOT_TOTAL, limit)) : f.slotsOpen
    const itemSlots: ItemSlotCell[] = itemSlotsOf(d).map((id, i) => {
        const it = id ? iById.get(id) : undefined
        return { index: i, open: i < itemOpen, itemId: id, name: id ? (it ? displayName(it) : viName(id)) : null, tier: it?.tier ?? null, qty: it?.qty ?? 0 }
    })
    const itemAt = new Map<string, number>()
    itemSlots.forEach((c) => { if (c.itemId) itemAt.set(c.itemId, c.index) })
    const itemUsed = itemSlots.filter((c) => c.itemId).length
    const itemDefault = f.slotsOpen
    return {
        rank: f.rank, rankName: f.rankName,
        level: lvl.level, exp: lvl.exp, need, expPct: Math.min(100, Math.round((lvl.exp / need) * 100)),
        openSkillSlots: slots.filter((c) => c.open), openItemSlots: itemSlots.filter((c) => c.open),
        skillHeading: `Slot kỹ năng · đang mở ${used}/${f.slotsOpen} (tối đa ${SLOT_TOTAL})`, itemHeading: `Slot trang bị · đang mở ${itemUsed}/${itemOpen} (tối đa ${SLOT_TOTAL})`,
        skillLockedLine: lockedLine(f.slotsOpen, f.rank), itemLockedLine: lockedLine(itemOpen, f.rank, limit),
        slots, slotText: `${used}/${f.slotsOpen} (mở ${f.slotsOpen} trên ${SLOT_TOTAL})`, freeOpenSlots: slots.filter((c) => c.open && !c.skillId).map((c) => c.index),
        itemSlots, itemSlotText: `${itemUsed}/${itemOpen} (mở ${itemOpen} trên ${SLOT_TOTAL})`, freeOpenItemSlots: itemSlots.filter((c) => c.open).map((c) => c.index),
        itemSlotsLimit: limit, itemSlotsDefault: itemDefault, itemSlotsOpen: itemOpen,
        skillsFull: d.skill_count >= f.maxStorage, itemsFull: d.item_count >= f.maxStorage,
        pickableSkills: d.skills.filter((x) => !equippedAt.has(x.id)).map((x) => ({ id: x.id, name: displayName(x), label: TIER_LABEL[x.tier], text: skillLabel(displayName(x), x.tier, skillProgress(x)) })),
        pickableItems: d.items.filter((x) => !itemAt.has(x.id)).map((x) => ({ id: x.id, name: displayName(x), label: TIER_LABEL[x.tier] })),
        skillCount: `${d.skill_count} / ${f.maxStorage}`, itemCount: `${d.item_count} / ${f.maxStorage}`,
        skills: filterTier(d.skills, filter).map((s: SkillEntry) => ({ ...s, name: displayName(s), prog: skillProgress(s), text: skillLabel(displayName(s), s.tier, skillProgress(s)), cls: TIER_CLASS[s.tier], label: TIER_LABEL[s.tier], slot: equippedAt.get(s.id) ?? null })),
        items: filterTier(d.items, filter).map((i: ItemEntry) => ({ ...i, name: displayName(i), cls: TIER_CLASS[i.tier], label: TIER_LABEL[i.tier], slot: itemAt.get(i.id) ?? null })),
        caps: Object.keys(STAT_LABEL).map((k) => ({ key: k, label: STAT_LABEL[k], cap: f.statCap })),
    }
}
export type Inventory = ReturnType<typeof buildInventory>

/** The store's skills with the EXP of the persona's event ledger (GET /api/persona/state `skill_exp` = loot EXP + the fold's awards, 0..540):
 *  a skill the ledger names shows that EXP; without ledger skills (down, older server) the store's own stays. (pure) */
export function withLedgerMastery(d: PersonaData, skills: Record<string, number> | null | undefined): PersonaData {
    if (!skills) return d
    const ok = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= SKILL_EXP_CAP
    return { ...d, skills: d.skills.map((s) => { if (!ok(skills[s.id])) return s; const { mastery: _old, ...rest } = s; return { ...rest, exp: skills[s.id] } }) }
}

// ENTRY DETAIL: what a skill / item DOES. Never an entry without a "Công dụng" line: a row the server sent without `effect` (old server, or '')
// gets the same words the server's default uses.
export const TIER_MOD: Record<Tier, number> = { bronze: 0, silver: 1, gold: 2, platinum: 3, diamond: 4 }
/** The dice modifier of a skill now = tier_mod + floor(skill level / 3). */
export const skillMod = (tier: Tier, level: number) => (TIER_MOD[tier] ?? 0) + Math.floor(Math.max(1, Math.floor(Number(level) || 1)) / 3)
export const modLine = (mod: number) => `Xúc xắc +${mod} khi dùng`
export const ITEM_SLOT_SENTENCE = 'Chỉ có tác dụng khi gắn vào slot trang bị; không gắn thì nằm trong kho, không ảnh hưởng lượt chơi.'
/** The text of "Công dụng": the row's own effect, else the client fallback (skill: the mod sentence; item: the slot sentence). */
export function effectOf(kind: 'skill' | 'item', e: { tier: Tier, effect?: unknown, exp?: unknown, mastery?: unknown }): string {
    const own = typeof e.effect === 'string' ? e.effect.trim() : ''
    if (own) return own
    return kind === 'skill' ? `Cộng +${skillMod(e.tier, skillProgress(e as any).level)} vào xúc xắc mỗi khi dùng kỹ năng này.` : ITEM_SLOT_SENTENCE
}
export type EntryDetail = { kind: 'skill' | 'item', id: string, name: string, tier: Tier, tierLabel: string, cls: string, stat: string, rule: string, effect: string, conditions: string }
/** The detail block of one skill / item (null when the id is not in the view). Equipped = its slot in the view, whatever the tier filter hides. */
export function entryDetail(d: PersonaData, kind: 'skill' | 'item', id: string): EntryDetail | null {
    if (kind === 'skill') {
        const s = d.skills.find((x) => x.id === id)
        if (!s) return null
        const p = skillProgress(s)
        return { kind, id, name: displayName(s), tier: s.tier, tierLabel: TIER_LABEL[s.tier], cls: TIER_CLASS[s.tier], stat: p.text, rule: modLine(skillMod(s.tier, p.level)), effect: effectOf('skill', s), conditions: typeof s.conditions === 'string' ? s.conditions.trim() : '' }
    }
    const i = d.items.find((x) => x.id === id)
    if (!i) return null
    const at = itemSlotsOf(d).indexOf(id)
    return { kind, id, name: displayName(i), tier: i.tier, tierLabel: TIER_LABEL[i.tier], cls: TIER_CLASS[i.tier], stat: `× ${i.qty}`, rule: `Chỉ có tác dụng khi gắn slot (${at >= 0 ? `Đã gắn slot ${at + 1}` : 'Chưa gắn'})`, effect: effectOf('item', i), conditions: typeof i.conditions === 'string' ? i.conditions.trim() : '' }
}

// SHOW/HIDE of the effect text under each entry. Per kind: a mode ('auto' = hidden when the list has more than EFFECT_AUTO_MAX entries, else shown;
// 'all'; 'none') and `flipped` ids whose state is the opposite of the mode's. One state per entry id, shared by the row, the card and the detail block.
export const EFFECT_AUTO_MAX = 6
export const EFFECT_PREFS_KEY = 'persona_effects_shown'
export type EffectMode = 'auto' | 'all' | 'none'
export type EffectKindPrefs = { mode: EffectMode, flipped: string[] }
export type EffectPrefs = { skill: EffectKindPrefs, item: EffectKindPrefs }
export const defaultEffectPrefs = (): EffectPrefs => ({ skill: { mode: 'auto', flipped: [] }, item: { mode: 'auto', flipped: [] } })
export function parseEffectPrefs(text: unknown): EffectPrefs {
    const out = defaultEffectPrefs()
    try {
        const v = JSON.parse(String(text ?? ''))
        for (const k of ['skill', 'item'] as const) {
            const m = v?.[k]?.mode, f = v?.[k]?.flipped
            if (m === 'auto' || m === 'all' || m === 'none') out[k].mode = m
            if (Array.isArray(f)) out[k].flipped = f.filter((x: unknown): x is string => typeof x === 'string')
        }
    } catch { /* default */ }
    return out
}
export function effectShown(p: EffectPrefs, kind: 'skill' | 'item', id: string, count: number): boolean {
    const k = p[kind]
    const base = k.mode === 'all' ? true : k.mode === 'none' ? false : count <= EFFECT_AUTO_MAX
    return k.flipped.includes(id) ? !base : base
}
/** A new prefs object with this entry's state set to `want` (flipped only when it differs from the mode's default). */
export function setEffectShown(p: EffectPrefs, kind: 'skill' | 'item', id: string, want: boolean, count: number): EffectPrefs {
    const k = p[kind]
    const rest = k.flipped.filter((x) => x !== id)
    const base = effectShown({ ...p, [kind]: { mode: k.mode, flipped: [] } } as EffectPrefs, kind, id, count)
    return { ...p, [kind]: { mode: k.mode, flipped: base === want ? rest : [...rest, id] } }
}
export const setEffectMode = (p: EffectPrefs, kind: 'skill' | 'item', mode: 'all' | 'none'): EffectPrefs => ({ ...p, [kind]: { mode, flipped: [] } })

/** Why Gắn is disabled for an item, or null when it can be gắn. */
export function itemEquipBlock(inv: Pick<Inventory, 'freeOpenItemSlots'>, slot: number | null): string | null {
    if (slot !== null) return `Đã gắn (slot ${slot + 1})`
    return inv.freeOpenItemSlots.length === 0 ? 'Không có slot trang bị nào đã mở' : null
}
/** The "Số slot item" input text -> a limit 1..11, or null when it is not a whole number in range. */
export function parseItemSlotsLimit(text: unknown): number | null {
    const n = Number(String(text ?? '').trim())
    return String(text ?? '').trim() !== '' && Number.isInteger(n) && n >= 1 && n <= SLOT_TOTAL ? n : null
}

/** The confirmation text for Xoá. */
export function deleteWarning(name: string, slot: number | null): string {
    return slot === null ? `Xoá "${name}" khỏi kho? Không hoàn lại được.` : `Xoá "${name}" khỏi kho? Kỹ năng đang gắn ở slot ${slot + 1}, sẽ được gỡ ra trước. Không hoàn lại được.`
}
/** What to call for Xoá: an equipped skill is unequipped first. */
export function deletePlan(kind: 'skill' | 'item', slot: number | null): ('unequip' | 'delete')[] {
    return kind === 'skill' && slot !== null ? ['unequip', 'delete'] : ['delete']
}
