import { describe, expect, test } from 'vitest'
import { nextFlushDelay } from './streamingPace'

describe('nextFlushDelay', () => {
    test('a cheap repaint keeps the base delay', () => {
        expect(nextFlushDelay(125, 5)).toBe(125)
        expect(nextFlushDelay(125, 41)).toBe(125)
    })
    test('a slow repaint waits three times as long', () => {
        expect(nextFlushDelay(125, 100)).toBe(300)
    })
    test('never above the cap', () => {
        expect(nextFlushDelay(125, 5000)).toBe(800)
    })
    test('a bad measurement falls back to the base', () => {
        expect(nextFlushDelay(125, NaN)).toBe(125)
        expect(nextFlushDelay(125, -4)).toBe(125)
    })
    test('always between base and max, and never shrinks as the cost grows', () => {
        let prev = 0
        for (let cost = 0; cost <= 20000; cost += 7) {
            const d = nextFlushDelay(125, cost)
            expect(d).toBeGreaterThanOrEqual(125)
            expect(d).toBeLessThanOrEqual(800)
            expect(d).toBeGreaterThanOrEqual(prev)
            prev = d
        }
    })
})
