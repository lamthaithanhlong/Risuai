// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildInventory, needExp, rankOf, rankName, parseLvl, filterTier, reasonText, deleteWarning, deletePlan, withLedgerMastery, itemEquipBlock, parseItemSlotsLimit, viName, displayName, lockedLine, masteryPct, TIERS } from './personaView'
import type { PersonaData } from '../storage/personaStore'

const data = (o: Partial<PersonaData> = {}): PersonaData => ({
    persona: 'k', level: 1, rank: 1, slots_open: 2, max_storage: 100, stat_cap: 20, stat_caps: { suc_manh: 20 },
    skills: [{ id: 'a', name: 'Kiếm', tier: 'gold', mastery: 1 }, { id: 'b', name: 'Cung', tier: 'bronze', mastery: 1 }],
    items: [{ id: 'i', name: 'Thuốc', tier: 'bronze', qty: 3 }], slots: ['a', null, null, null, null, null, null, null, null, null, null],
    skill_count: 2, item_count: 1, ...o,
})

describe('rank and exp', () => {
    it('rank boundaries', () => {
        expect([1, 10, 11, 91, 100, 500].map(rankOf)).toEqual([1, 1, 2, 10, 10, 10])
        expect(rankName(1)).toBe('R1 · Tân binh')
        expect(rankName(10)).toBe('R10 · Huyền thoại')
    })
    it('need(L) = floor(100*L^1.5)', () => {
        expect([1, 2, 3].map(needExp)).toEqual([100, 282, 519])
        expect(needExp(100)).toBe(100000)
        expect(needExp(0)).toBe(100)
    })
    it('parseLvl reads $lvl, else level 1', () => {
        expect(parseLvl('{"l":7,"e":40}')).toEqual({ level: 7, exp: 40 })
        expect(parseLvl(undefined)).toEqual({ level: 1, exp: 0 })
        expect(parseLvl('nope')).toEqual({ level: 1, exp: 0 })
        expect(parseLvl('{"l":0,"e":-5}')).toEqual({ level: 1, exp: 0 })
    })
})

describe('buildInventory', () => {
    it('slot cells: open, locked, equipped, x/11', () => {
        const v = buildInventory(data(), { level: 1, exp: 50 })
        expect(v.slots.length).toBe(11)
        expect(v.slots[0]).toMatchObject({ open: true, skillId: 'a', name: 'Kiếm', tier: 'gold' })
        expect(v.slots[1]).toMatchObject({ open: true, skillId: null })
        expect(v.slots[2].open).toBe(false)
        expect(v.slotText).toMatch(/^1\/\d+ \(mở \d+ trên 11\)$/)
        expect(v.freeOpenSlots).toEqual([1])
        expect(v.expPct).toBe(50)
        expect(v.skills.find((s) => s.id === 'a')?.slot).toBe(0)
        expect(v.skills.find((s) => s.id === 'b')?.slot).toBeNull()
    })
    it('storage counts and tier filter', () => {
        const v = buildInventory(data(), { level: 1, exp: 0 }, 'bronze')
        expect(v.skillCount).toBe('2 / 100')
        expect(v.itemCount).toBe('1 / 100')
        expect(v.skills.map((s) => s.id)).toEqual(['b'])
        expect(filterTier(data().skills, 'all').length).toBe(2)
        expect(buildInventory(data(), { level: 1, exp: 0 }, 'diamond').skills).toEqual([])
        expect(TIERS.map((t) => buildInventory(data(), { level: 1, exp: 0 }).skills[0].cls)[0]).toBe('tier-gold')
    })
    it('caps per stat: R1 = 20, R10 = 92', () => {
        const caps = { suc_manh: 92, nhanh_nhen: 92, the_luc: 92, tinh_than: 92, cam_nhan: 92, y_chi: 92 }
        const v10 = buildInventory(data({ rank: 10, stat_cap: 92, stat_caps: caps }), { level: 91, exp: 0 })
        expect(v10.caps.map((c) => c.cap)).toEqual([92, 92, 92, 92, 92, 92])
        expect(buildInventory(data(), { level: 1, exp: 0 }).caps[0]).toMatchObject({ key: 'suc_manh', cap: 20 })
        expect(buildInventory(data(), { level: 1, exp: 0 }).caps[1].cap).toBe(20)
    })
})

describe('messages and delete flow', () => {
    it('reason text in Vietnamese', () => {
        expect(reasonText('full')).toBe('Kho đầy')
        expect(reasonText('slot_locked')).toBe('Slot chưa mở ở rank này')
        expect(reasonText('zzz')).toBe('Không thực hiện được')
    })
    it('deleting an equipped skill warns and unequips first', () => {
        expect(deleteWarning('Kiếm', 0)).toContain('gỡ ra trước')
        expect(deleteWarning('Kiếm', null)).not.toContain('gỡ')
        expect(deletePlan('skill', 3)).toEqual(['unequip', 'delete'])
        expect(deletePlan('skill', null)).toEqual(['delete'])
        expect(deletePlan('item', null)).toEqual(['delete'])
    })
})

describe('withLedgerMastery (Kho & Slot shows the ledger mastery, L1 2026-11-06 item (e))', () => {
    it('replaces the mastery of a skill the ledger names, keeps the rest; nothing from a missing ledger', () => {
        const d = data()
        expect(withLedgerMastery(d, { a: 4321, z: 5, b: -1 }).skills.map((s) => s.mastery)).toEqual([4321, 1])
        expect(withLedgerMastery(d, null)).toBe(d)
        expect(withLedgerMastery(d, undefined).skills).toEqual(d.skills)
        expect(buildInventory(withLedgerMastery(d, { a: 777 }), parseLvl('{"l":1,"e":0}')).skills.find((s) => s.id === 'a')!.mastery).toBe(777)
    })
})

describe('item slot grid', () => {
    const isl = (o: Record<number, string>) => Array.from({ length: 11 }, (_, i) => o[i] ?? null)
    it('an old server view (no item_slots): 11 empty cells, open = skill slots open', () => {
        const v = buildInventory(data(), { level: 1, exp: 0 })
        expect(v.itemSlots.length).toBe(11)
        expect(v.itemSlots.every((c) => c.itemId === null)).toBe(true)
        expect(v.itemSlots.filter((c) => c.open).length).toBe(2)
        expect(v.itemSlotText).toBe('0/2 (mở 2 trên 11)')
        expect(v.itemSlotsLimit).toBeNull()
        expect(v.itemSlotsDefault).toBe(2)
    })
    it('cells: open, locked, equipped with name+tier; the item row knows its slot; limit and default come from the server', () => {
        const v = buildInventory(data({ item_slots: isl({ 1: 'i' }), item_slots_open: 3, item_slots_limit: 3, item_slots_default: 2 }), { level: 1, exp: 0 })
        expect(v.itemSlots[1]).toMatchObject({ open: true, itemId: 'i', name: 'Thuốc', tier: 'bronze' })
        expect(v.itemSlots[3].open).toBe(false)
        expect(v.itemSlotText).toBe('1/3 (mở 3 trên 11)')
        expect(v.freeOpenItemSlots).toEqual([0, 1, 2])
        expect(v.items[0].slot).toBe(1)
        expect([v.itemSlotsLimit, v.itemSlotsDefault, v.itemSlotsOpen]).toEqual([3, 2, 3])
    })
    it('itemEquipBlock: equipped, no open slot, or free to gắn', () => {
        expect(itemEquipBlock({ freeOpenItemSlots: [0] }, 4)).toBe('Đã gắn (slot 5)')
        expect(itemEquipBlock({ freeOpenItemSlots: [] }, null)).toMatch(/slot/)
        expect(itemEquipBlock({ freeOpenItemSlots: [0] }, null)).toBeNull()
    })
    it('parseItemSlotsLimit: whole numbers 1..11 only', () => {
        expect([parseItemSlotsLimit('4'), parseItemSlotsLimit(11), parseItemSlotsLimit(1)]).toEqual([4, 11, 1])
        for (const bad of ['', '0', '12', '2.5', 'x', null, undefined]) expect(parseItemSlotsLimit(bad)).toBeNull()
    })
    it('storage full flags; the new reasons are in Vietnamese', () => {
        const v = buildInventory(data({ skill_count: 100, item_count: 99 }), { level: 1, exp: 0 })
        expect([v.skillsFull, v.itemsFull]).toEqual([true, false])
        expect(reasonText('no_such_item')).toBe('Vật phẩm này không có trong kho')
    })
})

describe('display names and locked line', () => {
    it('viName mirrors persona_store.vi_name; displayName replaces a missing/id-like name only', () => {
        expect(viName('wall-vibration-listening')).toBe('Nghe rung tường')
        expect(viName('zzz-rusty-knife')).toBe('Dao gỉ zzz')
        expect(displayName({ id: 'wall-vibration-listening', name: 'wall-vibration-listening' })).toBe('Nghe rung tường')
        expect(displayName({ id: 'a-b', name: '' })).toBe('B a')
        expect(displayName({ id: 'a-b', name: 'Tên riêng' })).toBe('Tên riêng')
        expect(displayName({ id: 'x-y', name: 'foo-bar' })).toBe('Y x')
    })
    it('lockedLine: next unlock at Lv 10*rank+1, none at 11 open, owner limit wording', () => {
        expect(lockedLine(2, 1)).toBe('🔒 Mở thêm 1 slot ở Lv 11 (còn 9 slot khoá)')
        expect(lockedLine(11, 10)).toBeNull()
        expect(lockedLine(4, 3, 4)).toBe('🔒 Đang giới hạn ở 4 slot (còn 7 slot khoá)')
    })
    it('masteryPct', () => { expect([masteryPct(2500), masteryPct(99999), masteryPct(undefined)]).toEqual([25, 100, 0]) })
})
