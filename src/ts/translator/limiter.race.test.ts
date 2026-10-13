import { describe, expect, test } from 'vitest'
import { createLimiter } from './limiter'

// A woken waiter used to run `running++` a microtask after `release` had already done `running--`, so a call that arrived in
// between could take the free slot and the waiter then took one more: more than `max` tasks at once.

const hops = async (n: number) => {
    for (let i = 0; i < n; i++) {
        await null
    }
}

function lcg(seed: number) {
    let s = seed >>> 0
    return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

describe('createLimiter never runs more than max tasks at once', () => {
    test('random start times and task lengths, measured peak concurrency', async () => {
        let worst = 0
        for (let seed = 1; seed <= 400; seed++) {
            const rnd = lcg(seed)
            const max = 1 + Math.floor(rnd() * 3)
            const run = createLimiter(max)
            let current = 0
            let peak = 0
            const jobs: Promise<void>[] = []
            for (let i = 0; i < 12; i++) {
                const startHops = Math.floor(rnd() * 6)
                const taskHops = Math.floor(rnd() * 6)
                jobs.push((async () => {
                    await hops(startHops)
                    await run(async () => {
                        current++
                        peak = Math.max(peak, current)
                        await hops(taskHops)
                        current--
                    })
                })())
            }
            await Promise.all(jobs)
            worst = Math.max(worst, peak - max)
            expect(peak, `seed ${seed}, max ${max}`).toBeLessThanOrEqual(max)
        }
        expect(worst).toBeLessThanOrEqual(0)
    })

    test('everything asked for finishes, in the order it was asked for', async () => {
        const run = createLimiter(2)
        const started: number[] = []
        await Promise.all([0, 1, 2, 3, 4, 5].map((i) => run(async () => { started.push(i); await hops(3) })))
        expect(started).toEqual([0, 1, 2, 3, 4, 5])
    })
})
