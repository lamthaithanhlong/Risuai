// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildInventory, needExp, rankOf, rankName, parseLvl, filterTier, reasonText, deleteWarning, deletePlan, TIERS } from './personaView'
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
