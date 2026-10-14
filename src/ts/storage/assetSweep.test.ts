import { describe, expect, it } from 'vitest'
import { planSweep, SWEEP_GRACE_MS } from './assetSweep'

const MIN = 60 * 1000

describe('planSweep (specs/core/AssetSweep.tla)', () => {
    it('deletes nothing the first time it sees an unreferenced file, it only remembers it', () => {
        const r = planSweep(['assets/a', 'assets/b'], {}, 1000)
        expect(r.remove).toEqual([])
        expect(r.seen).toEqual({ 'assets/a': 1000, 'assets/b': 1000 })
    })

    it('does not delete before the grace period, deletes after it', () => {
        const first = planSweep(['assets/a'], {}, 0)
        expect(planSweep(['assets/a'], first.seen, SWEEP_GRACE_MS - 1).remove).toEqual([])
        const late = planSweep(['assets/a'], first.seen, SWEEP_GRACE_MS)
        expect(late.remove).toEqual(['assets/a'])
        expect(late.seen).toEqual({})
    })

    it('forgets a file that became referenced: the importing client saved its database in time', () => {
        const first = planSweep(['assets/a'], {}, 0)
        // the next run no longer lists a as unreferenced
        const second = planSweep([], first.seen, 5 * MIN)
        expect(second.seen).toEqual({})
        // if it becomes unreferenced again later, the wait starts over
        const third = planSweep(['assets/a'], second.seen, 30 * MIN)
        expect(third.remove).toEqual([])
    })

    it('a clock that went backwards restarts the wait instead of deleting', () => {
        const r = planSweep(['assets/a'], { 'assets/a': 10 * 60 * MIN }, 1000)
        expect(r.remove).toEqual([])
        expect(r.seen['assets/a']).toBe(1000)
    })

    it('never deletes a file that is not in the unreferenced list, whatever the history says', () => {
        const seen = { 'assets/kept': 0 }
        const r = planSweep(['assets/other'], seen, 100 * MIN)
        expect(r.remove).not.toContain('assets/kept')
        expect(r.seen['assets/kept']).toBeUndefined()
    })

    it('property: a removed file was unreferenced in two runs at least the grace apart', () => {
        let state = 12345
        const rnd = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
        const names = ['a', 'b', 'c', 'd', 'e'].map((x) => 'assets/' + x)
        let seen = {}
        let now = 0
        const firstUnreferenced: Record<string, number> = {}
        for (let step = 0; step < 400; step++) {
            now += Math.floor(rnd() * 8 * MIN)
            const unref = names.filter(() => rnd() < 0.6)
            for (const n of names) if (!unref.includes(n)) delete firstUnreferenced[n]
            for (const n of unref) firstUnreferenced[n] ??= now
            const r = planSweep(unref, seen, now)
            for (const n of r.remove) {
                expect(now - firstUnreferenced[n]).toBeGreaterThanOrEqual(SWEEP_GRACE_MS)
                delete firstUnreferenced[n]
            }
            seen = r.seen
        }
    })
})
