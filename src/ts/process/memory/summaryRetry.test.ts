import { describe, expect, it } from 'vitest'
import { withRetry } from '../retry'
import { SUMMARY_RETRY_DELAYS_MS } from './summaryRetry'

describe('summary retry schedule (specs/generation/uppaal/memory_template.xml)', () => {
    it('makes 4 attempts, so three screen locks on the same summary are survived', async () => {
        let calls = 0
        const waits: number[] = []
        const result = await withRetry(async () => {
            calls++
            if (calls <= 3) throw new TypeError('Load failed')   // three locks, each killing the request in flight
            return 'summary'
        }, { delaysMs: SUMMARY_RETRY_DELAYS_MS, sleep: async (ms) => { waits.push(ms) } })
        expect(result).toBe('summary')
        expect(calls).toBe(4)
        expect(waits).toEqual([1500, 4000, 10000])
    })

    it('still gives up after the last attempt, so a real outage does not hang the reply', async () => {
        let calls = 0
        await expect(withRetry(async () => { calls++; throw new Error('400') }, { delaysMs: SUMMARY_RETRY_DELAYS_MS, sleep: async () => {} })).rejects.toThrow('400')
        expect(calls).toBe(4)
    })
})
