// What the "Kho & Slot" tab shows, from the server's answer and the persona's Level/EXP (pure; the component only draws it).
import type { PersonaData, SkillEntry, ItemEntry, Tier } from '../storage/personaStore'

export const TIERS: Tier[] = ['bronze', 'silver', 'gold', 'platinum', 'diamond']
export const TIER_LABEL: Record<Tier, string> = { bronze: 'Đồng', silver: 'Bạc', gold: 'Vàng', platinum: 'Bạch kim', diamond: 'Kim cương' }
export const TIER_CLASS: Record<Tier, string> = { bronze: 'tier-bronze', silver: 'tier-silver', gold: 'tier-gold', platinum: 'tier-platinum', diamond: 'tier-diamond' }
export const RANK_LABELS = ['Tân binh', 'Học việc', 'Sơ cấp', 'Trung cấp', 'Thành thạo', 'Tinh anh', 'Cao thủ', 'Đại sư', 'Tông sư', 'Huyền thoại']
export const SLOT_TOTAL = 11
export const STAT_LABEL: Record<string, string> = { suc_manh: 'Sức mạnh', nhanh_nhen: 'Nhanh nhẹn', the_luc: 'Thể lực', tinh_than: 'Tinh thần', cam_nhan: 'Cảm nhận', y_chi: 'Ý chí' }
export const REASON_VI: Record<string, string> = {
    full: 'Kho đầy', not_found: 'Không còn trong kho', slot_locked: 'Slot chưa mở ở rank này', no_such_skill: 'Kỹ năng này không có trong kho',
    already_equipped: 'Kỹ năng đã gắn ở slot khác', network: 'Không kết nối được máy chủ', unknown: 'Không thực hiện được',
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

export type Lvl = { level: number, exp: number }
/** The chat variable $lvl ({"l":..,"e":..}) -> level and exp; anything else is Level 1, EXP 0. */
export function parseLvl(text: unknown): Lvl {
    try {
        const v = typeof text === 'string' ? JSON.parse(text) : text as any
        const l = Math.floor(Number(v?.l)), e = Math.floor(Number(v?.e))
        return { level: Number.isFinite(l) && l >= 1 ? l : 1, exp: Number.isFinite(e) && e >= 0 ? e : 0 }
    } catch { return { level: 1, exp: 0 } }
}

export type SlotCell = { index: number, open: boolean, skillId: string | null, name: string | null, tier: Tier | null }
export type Filter = Tier | 'all'

export function filterTier<T extends { tier: Tier }>(list: T[], f: Filter): T[] { return f === 'all' ? list : list.filter((e) => e.tier === f) }

export function buildInventory(d: PersonaData, lvl: Lvl, filter: Filter = 'all') {
    const need = needExp(lvl.level)
    const byId = new Map(d.skills.map((s) => [s.id, s]))
    const slots: SlotCell[] = Array.from({ length: SLOT_TOTAL }, (_, i) => {
        const id = d.slots[i] ?? null
        const s = id ? byId.get(id) : undefined
        return { index: i, open: i < d.slots_open, skillId: id, name: s?.name ?? (id ? id : null), tier: s?.tier ?? null }
    })
    const equippedAt = new Map<string, number>()
    slots.forEach((c) => { if (c.skillId) equippedAt.set(c.skillId, c.index) })
    const used = slots.filter((c) => c.skillId).length
    return {
        rank: d.rank, rankName: rankName(d.rank),
        level: lvl.level, exp: lvl.exp, need, expPct: Math.min(100, Math.round((lvl.exp / need) * 100)),
        slots, slotText: `${used}/${d.slots_open} (mở ${d.slots_open} trên ${SLOT_TOTAL})`, freeOpenSlots: slots.filter((c) => c.open && !c.skillId).map((c) => c.index),
        skillCount: `${d.skill_count} / ${d.max_storage}`, itemCount: `${d.item_count} / ${d.max_storage}`,
        skills: filterTier(d.skills, filter).map((s: SkillEntry) => ({ ...s, cls: TIER_CLASS[s.tier], label: TIER_LABEL[s.tier], slot: equippedAt.get(s.id) ?? null })),
        items: filterTier(d.items, filter).map((i: ItemEntry) => ({ ...i, cls: TIER_CLASS[i.tier], label: TIER_LABEL[i.tier] })),
        caps: Object.keys(STAT_LABEL).map((k) => ({ key: k, label: STAT_LABEL[k], cap: d.stat_caps?.[k] ?? d.stat_cap })),
    }
}
export type Inventory = ReturnType<typeof buildInventory>

/** The confirmation text for Xoá. */
export function deleteWarning(name: string, slot: number | null): string {
    return slot === null ? `Xoá "${name}" khỏi kho? Không hoàn lại được.` : `Xoá "${name}" khỏi kho? Kỹ năng đang gắn ở slot ${slot + 1}, sẽ được gỡ ra trước. Không hoàn lại được.`
}
/** What to call for Xoá: an equipped skill is unequipped first. */
export function deletePlan(kind: 'skill' | 'item', slot: number | null): ('unequip' | 'delete')[] {
    return kind === 'skill' && slot !== null ? ['unequip', 'delete'] : ['delete']
}
