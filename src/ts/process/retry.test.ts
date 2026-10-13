import { describe, expect, test } from 'vitest'
import { withRetry } from './retry'

const noSleep = async () => {}

describe('withRetry', () => {
    test('a first-try success runs once', async () => {
        let calls = 0
        const r = await withRetry(async () => { calls++; return 'ok' }, { delaysMs: [1, 2], sleep: noSleep })
        expect(r).toBe('ok')
        expect(calls).toBe(1)
    })

    test('a failure that clears on the next try is hidden from the caller', async () => {
        let calls = 0
        const seen: number[] = []
        const r = await withRetry(async () => { calls++; if (calls < 3) throw new Error('400'); return 'summary' },
            { delaysMs: [10, 20], sleep: noSleep, onRetry: (_e, a) => seen.push(a) })
        expect(r).toBe('summary')
        expect(calls).toBe(3)
        expect(seen).toEqual([1, 2])
    })

    test('after the last retry the last error reaches the caller', async () => {
        let calls = 0
        await expect(withRetry(async () => { calls++; throw new Error(`fail ${calls}`) }, { delaysMs: [1], sleep: noSleep })).rejects.toThrow('fail 2')
        expect(calls).toBe(2)
    })

    test('waits the configured delay between tries', async () => {
        const waits: number[] = []
        await withRetry(async () => { if (waits.length < 2) throw new Error('x'); return 1 }, { delaysMs: [1500, 4000], sleep: async (ms) => { waits.push(ms) } })
        expect(waits).toEqual([1500, 4000])
    })

    test('no delays means no retry', async () => {
        let calls = 0
        await expect(withRetry(async () => { calls++; throw new Error('x') }, { delaysMs: [], sleep: noSleep })).rejects.toThrow('x')
        expect(calls).toBe(1)
    })
})
