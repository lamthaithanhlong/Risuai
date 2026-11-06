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
/** Mastery 0..10000 -> a whole percent for the bar. */
export const masteryPct = (m: unknown) => Math.max(0, Math.min(100, Math.round((Number(m) || 0) / 100)))

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

export type SlotCell = { index: number, open: boolean, skillId: string | null, name: string | null, tier: Tier | null, pct: number }
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
        return { index: i, open: i < f.slotsOpen, skillId: id, name: id ? (s ? displayName(s) : viName(id)) : null, tier: s?.tier ?? null, pct: masteryPct(s?.mastery) }
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
        pickableSkills: d.skills.filter((x) => !equippedAt.has(x.id)).map((x) => ({ id: x.id, name: displayName(x), label: TIER_LABEL[x.tier] })),
        pickableItems: d.items.filter((x) => !itemAt.has(x.id)).map((x) => ({ id: x.id, name: displayName(x), label: TIER_LABEL[x.tier] })),
        skillCount: `${d.skill_count} / ${f.maxStorage}`, itemCount: `${d.item_count} / ${f.maxStorage}`,
        skills: filterTier(d.skills, filter).map((s: SkillEntry) => ({ ...s, name: displayName(s), pct: masteryPct(s.mastery), cls: TIER_CLASS[s.tier], label: TIER_LABEL[s.tier], slot: equippedAt.get(s.id) ?? null })),
        items: filterTier(d.items, filter).map((i: ItemEntry) => ({ ...i, name: displayName(i), cls: TIER_CLASS[i.tier], label: TIER_LABEL[i.tier], slot: itemAt.get(i.id) ?? null })),
        caps: Object.keys(STAT_LABEL).map((k) => ({ key: k, label: STAT_LABEL[k], cap: f.statCap })),
    }
}
export type Inventory = ReturnType<typeof buildInventory>

/** The store's skills with the mastery of the persona's event ledger (GET /api/persona/state `skills` = loot base + the fold's gains, L1 2026-11-06 item (e)):
 *  a skill the ledger names shows that mastery; without ledger skills (down, older server) the store's own mastery stays. (pure) */
export function withLedgerMastery(d: PersonaData, skills: Record<string, number> | null | undefined): PersonaData {
    if (!skills) return d
    const ok = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10000
    return { ...d, skills: d.skills.map((s) => ok(skills[s.id]) ? { ...s, mastery: skills[s.id] } : s) }
}

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
