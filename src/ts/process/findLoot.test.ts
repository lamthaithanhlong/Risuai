// @vitest-environment node
// The five loot tiers (owner 2026-11-06): the table by rank, the pick, the DC, the rank from $lvl, the legacy words.
// TABLES is copied from tools/stats/formal/Loot.dfy (the constant its lemma LootValues proves equal to LootTable); stats.lua computes the same numbers.
import { describe, expect, test } from 'vitest'
import { FIND_DC, LEGACY_RARITY, TIERS, findDue, findRequest, levelOf, lootPick, lootTable, parseFind, rankOfLevel } from './findDrop'

const TABLES = [[50, 28, 14, 6, 2], [48, 28, 15, 6, 3], [46, 29, 15, 7, 3], [44, 30, 16, 7, 3], [42, 31, 16, 8, 3],
    [40, 32, 17, 8, 3], [38, 32, 18, 8, 4], [36, 33, 18, 9, 4], [34, 34, 19, 9, 4], [32, 35, 19, 10, 4]]

describe('loot table by rank', () => {
    test('ranks 1, 2, 5 and 10 equal the proved table (Lua S.loot_table)', () => {
        for (const r of [1, 2, 5, 10]) expect(lootTable(r)).toEqual(TABLES[r - 1])
        expect(lootTable(1)).toEqual([50, 28, 14, 6, 2])
        expect(lootTable(10)).toEqual([32, 35, 19, 10, 4])
    })
    test('every rank equals the table and sums to 100; out-of-range ranks clamp', () => {
        for (let r = 1; r <= 10; r++) { expect(lootTable(r)).toEqual(TABLES[r - 1]); expect(lootTable(r).reduce((a, b) => a + b)).toBe(100) }
        expect(lootTable(0)).toEqual(TABLES[0]); expect(lootTable(99)).toEqual(TABLES[9])
    })
})

describe('the pick walks the cumulative table', () => {
    test('rank 1 boundaries: 49 is bronze, 50 is silver, 99 is diamond', () => {
        expect(lootPick(0, 1)).toBe('bronze'); expect(lootPick(49, 1)).toBe('bronze'); expect(lootPick(50, 1)).toBe('silver')
        expect(lootPick(77, 1)).toBe('silver'); expect(lootPick(78, 1)).toBe('gold'); expect(lootPick(91, 1)).toBe('gold'); expect(lootPick(92, 1)).toBe('platinum')
        expect(lootPick(97, 1)).toBe('platinum'); expect(lootPick(98, 1)).toBe('diamond'); expect(lootPick(99, 1)).toBe('diamond')
    })
    test('rank 10 moves the boundaries (32 bronze)', () => {
        expect(lootPick(31, 10)).toBe('bronze'); expect(lootPick(32, 10)).toBe('silver'); expect(lootPick(95, 10)).toBe('platinum'); expect(lootPick(96, 10)).toBe('diamond')
    })
    test('over the 100 rolls the counts are exactly the table, at every rank', () => {
        for (let r = 1; r <= 10; r++) {
            const n = [0, 0, 0, 0, 0]
            for (let roll = 0; roll < 100; roll++) n[TIERS.indexOf(lootPick(roll, r))]++
            expect(n).toEqual(TABLES[r - 1])
        }
    })
    test('findDue picks by floor(unit*100) at the rank: a higher rank gives fewer bronze and more silver over many seeds', () => {
        const count = (rank: number) => {
            const c: Record<string, number> = {}
            for (let i = 0; i < 4000; i++) { const d = findDue({ turn: 10, lastFindTurn: 0, sceneKind: 'scavenge', seed: `s${i}`, rank }); if (d.due) c[d.rarity] = (c[d.rarity] ?? 0) + 1 }
            const tot = Object.values(c).reduce((a, b) => a + b, 0)
            return TIERS.map((t) => (c[t] ?? 0) / tot)
        }
        const r1 = count(1), r10 = count(10)
        expect(r1[0]).toBeGreaterThan(0.45); expect(r1[0]).toBeLessThan(0.55)
        expect(r10[0]).toBeGreaterThan(0.27); expect(r10[0]).toBeLessThan(0.37)
        expect(r10[1]).toBeGreaterThan(r1[1])
    })
})

describe('DC by tier', () => {
    test('8 / 11 / 14 / 17 / 20', () => {
        expect(FIND_DC).toEqual({ bronze: 8, silver: 11, gold: 14, platinum: 17, diamond: 20 })
        expect(TIERS.map((t) => FIND_DC[t])).toEqual([8, 11, 14, 17, 20])
    })
})

describe('rank from $lvl', () => {
    test('Level 1, 10 -> rank 1; 11 -> 2; 91 and more -> 10', () => {
        expect(rankOfLevel(1)).toBe(1); expect(rankOfLevel(10)).toBe(1); expect(rankOfLevel(11)).toBe(2); expect(rankOfLevel(20)).toBe(2); expect(rankOfLevel(21)).toBe(3)
        expect(rankOfLevel(90)).toBe(9); expect(rankOfLevel(91)).toBe(10); expect(rankOfLevel(500)).toBe(10); expect(rankOfLevel(0)).toBe(1)
    })
    test('levelOf reads {"l":n,"e":n}; missing or broken = 1', () => {
        expect(levelOf({ $lvl: '{"l":42,"e":7}' })).toBe(42)
        expect(levelOf({})).toBe(1); expect(levelOf({ $lvl: 'x' })).toBe(1); expect(levelOf(undefined)).toBe(1); expect(levelOf({ $lvl: '{"e":3}' })).toBe(1)
    })
    test('findRequest asks at the rank of the chat Level: some (chat, turn) land on a different tier at Level 1 and Level 95', () => {
        const msgs = Array.from({ length: 11 }, (_, i) => ({ role: i % 2 ? 'user' : 'char', data: 'x' }))
        const card = { desc: '[[FIND|', type: 'character', chaId: 'c' } as never
        const tierFor = (id: string, lvl: string) => {
            const chat = { id, message: msgs, scriptstate: { $lvl: lvl } } as never
            const out = findRequest([{ role: 'user', content: 'hello' }], card, chat)
            return /a (\w+) (skill|item) is due/.exec(JSON.stringify(out))?.[1] ?? ''
        }
        let differ = 0, seen = 0
        for (let i = 0; i < 300; i++) { const a = tierFor(`c${i}`, '{"l":1,"e":0}'), b = tierFor(`c${i}`, '{"l":95,"e":0}'); if (a && b) { seen++; if (a !== b) differ++ } }
        expect(seen).toBeGreaterThan(20); expect(differ).toBeGreaterThan(0)
    })
})

describe('legacy rarity words', () => {
    const block = (w: string) => `[[FIND|item|Dao|Knife|Cắt.|${w}|Không|no]]`
    test('the old words map to the new tiers; the new ones pass; others are refused', () => {
        expect(LEGACY_RARITY).toEqual({ common: 'bronze', uncommon: 'silver', rare: 'gold', epic: 'platinum' })
        for (const [old, now] of Object.entries(LEGACY_RARITY)) expect(parseFind(block(old))?.rarity).toBe(now)
        for (const t of TIERS) expect(parseFind(block(t))?.rarity).toBe(t)
        expect(parseFind(block('DIAMOND'))?.rarity).toBe('diamond')
        expect(parseFind(block('legendary'))).toBeNull()
    })
})
