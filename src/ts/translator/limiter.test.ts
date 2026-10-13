import { describe, expect, test } from 'vitest'
import { createLimiter, splitThoughts } from './limiter'

const tick = () => new Promise((r) => setTimeout(r, 0))

describe('createLimiter', () => {
    test('never runs more than max at once and keeps the order asked', async () => {
        const run = createLimiter(2)
        let active = 0, peak = 0
        const started: number[] = []
        const gates: (() => void)[] = []
        const job = (n: number) => run(async () => {
            started.push(n); active++; peak = Math.max(peak, active)
            await new Promise<void>((resolve) => gates.push(resolve))
            active--
        })
        const all = [1, 2, 3, 4].map(job)
        await tick()
        expect(started).toEqual([1, 2])
        gates.shift()!(); await tick()
        expect(started).toEqual([1, 2, 3])
        while (gates.length) { gates.shift()!(); await tick() }
        await Promise.all(all)
        expect(started).toEqual([1, 2, 3, 4])
        expect(peak).toBe(2)
    })

    test('a task that throws still frees its slot', async () => {
        const run = createLimiter(1)
        await expect(run(async () => { throw new Error('x') })).rejects.toThrow('x')
        await expect(run(async () => 'ok')).resolves.toBe('ok')
    })
})

describe('splitThoughts', () => {
    test('separates the reasoning from the reply', () => {
        expect(splitThoughts('<Thoughts>\nnghĩ\n</Thoughts>\n*Khang cười*')).toEqual({ thoughts: '<Thoughts>\nnghĩ\n</Thoughts>\n', body: '*Khang cười*' })
    })

    test('a reply without reasoning is untouched', () => {
        expect(splitThoughts('Chào em.')).toEqual({ thoughts: '', body: 'Chào em.' })
    })

    test('a Thoughts block that is not at the start stays in the body', () => {
        expect(splitThoughts('Chào <Thoughts>x</Thoughts>').thoughts).toBe('')
    })
})
