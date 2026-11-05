// @vitest-environment node
// The persona page's stats section (personaStats.ts): formatting, the bar, slots, tiers, the skill cap, and what the page shows.
import { describe, expect, it } from 'vitest'
import { buildView, fetchFindNames, fmtPct, skillCap, slotsFor, tierOf, toNext } from './personaStats'

describe('fmtPct / toNext', () => {
    it('shows hundredths exactly, two decimals', () => {
        expect(fmtPct(2347)).toBe('23.47%')
        expect(fmtPct(1000)).toBe('10.00%')
        expect(fmtPct(5)).toBe('0.05%')
        expect(fmtPct(10000)).toBe('100.00%')
        expect(fmtPct(12345)).toBe('100.00%')
        expect(fmtPct(NaN)).toBe('0.00%')
    })
    it('the bar is the way through the current whole 1.00%', () => {
        expect(toNext(2347)).toBeCloseTo(0.47)
        expect(toNext(2300)).toBe(0)
        expect(toNext(2399)).toBeCloseTo(0.99)
        expect(toNext(10000)).toBe(1)
    })
})

describe('slots', () => {
    it('starts with one and opens one per Ý chí threshold, max six', () => {
        expect(slotsFor(0)).toBe(1)
        expect(slotsFor(1499)).toBe(1)
        expect(slotsFor(1500)).toBe(2)
        expect(slotsFor(3000)).toBe(3)
        expect(slotsFor(4500)).toBe(4)
        expect(slotsFor(6000)).toBe(5)
        expect(slotsFor(7499)).toBe(5)
        expect(slotsFor(7500)).toBe(6)
        expect(slotsFor(10000)).toBe(6)
    })
})

describe('tiers', () => {
    it('Sơ nhập below 25, then Tiểu thành 25, Đại thành 50, Viên mãn 75, Đăng phong at 100', () => {
        expect(tierOf(0).vi).toBe('Sơ nhập')
        expect(tierOf(2499).vi).toBe('Sơ nhập')
        expect(tierOf(2500).vi).toBe('Tiểu thành')
        expect(tierOf(5000).vi).toBe('Đại thành')
        expect(tierOf(7500).vi).toBe('Viên mãn')
        expect(tierOf(9999).vi).toBe('Viên mãn')
        expect(tierOf(10000).vi).toBe('Đăng phong')
    })
})

describe('skill cap', () => {
    const st = { suc_manh: 3000, nhanh_nhen: 4000 }
    it('is the best linked stat + 25%, never above 100%', () => {
        expect(skillCap(['suc_manh'], st)).toBe(5500)
        expect(skillCap(['suc_manh', 'nhanh_nhen'], st)).toBe(6500)
        expect(skillCap(['suc_manh'], { suc_manh: 9000 })).toBe(10000)
        expect(skillCap(undefined, st, ['nhanh_nhen'])).toBe(6500)
    })
})

describe('buildView', () => {
    it('without data says none and still lists the six stats at the start value', () => {
        const v = buildView(null, {})
        expect(v.source).toBe('none')
        expect(v.stats.map((s) => s.pct)).toEqual(Array(6).fill('10.00%'))
        expect(v.slots).toEqual({ used: 0, total: 1 })
        expect(v.skills).toEqual([])
    })
    it('takes the larger of the store and the chat, and the chat\'s equipped flag, link and name', () => {
        const store = { stats: { suc_manh: 2347, y_chi: 1600 }, skills: { 'stair-ear': 610, 'door-sense': 100 } }
        const vars = {
            $stats: JSON.stringify({ suc_manh: 2000, nhanh_nhen: 1500 }),
            $skills: JSON.stringify({ 'stair-ear': { m: 400, eq: 1, link: ['cam_nhan'], name: 'Nghe rung tường' } }),
        }
        const v = buildView(store, vars, { 'door-sense': { vi: 'Linh cảm cửa', en: 'Door sense' } })
        expect(v.source).toBe('store')
        expect(v.stats.find((s) => s.key === 'suc_manh')!.pct).toBe('23.47%')
        expect(v.stats.find((s) => s.key === 'nhanh_nhen')!.pct).toBe('15.00%')
        expect(v.slots).toEqual({ used: 1, total: 2 })
        const [first, second] = v.skills
        expect(first).toMatchObject({ id: 'stair-ear', name: 'Nghe rung tường', pct: '6.10%', equipped: true, capped: false })
        expect(first.cap).toBe(1000 + 2500)   // cam_nhan is still at the start value
        expect(second).toMatchObject({ name: 'Linh cảm cửa', pct: '1.00%', equipped: false })
    })
    it('falls back to the chat when the store is empty', () => {
        const v = buildView({ stats: {}, skills: {} }, { $stats: JSON.stringify({ y_chi: 3000 }) })
        expect(v.source).toBe('chat')
        expect(v.slots.total).toBe(3)
    })
    it('marks a skill that stands at its cap', () => {
        const v = buildView(null, { $stats: JSON.stringify({ suc_manh: 1000 }), $skills: JSON.stringify({ a: { m: 3500, eq: 1, link: ['suc_manh'] } }) })
        expect(v.skills[0].capped).toBe(true)
    })
})

describe('fetchFindNames', () => {
    const ok = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
    it('maps find ids to their names and sends the risu-auth header', async () => {
        let seen: any
        const f = (async (_u: string, init: any) => { seen = init; return new Response(JSON.stringify({ finds: [{ id: 'a', name: { vi: 'Một', en: 'One' } }, { nope: 1 }] }), { status: 200 }) }) as unknown as typeof fetch
        expect(await fetchFindNames({ fetch: f, auth: async () => 'tok' })).toEqual({ a: { vi: 'Một', en: 'One' } })
        expect(seen.headers['risu-auth']).toBe('tok')
    })
    it('is empty on errors', async () => {
        expect(await fetchFindNames({ fetch: ok({}, 502), auth: async () => 't' })).toEqual({})
        expect(await fetchFindNames({ fetch: (async () => { throw new Error('x') }) as any, auth: async () => 't' })).toEqual({})
    })
})
