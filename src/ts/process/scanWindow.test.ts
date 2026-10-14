import { describe, expect, it } from 'vitest'
import { lastItems } from './scanWindow'

describe('lastItems (lorebook scan window)', () => {
    it('returns every message when the chat is shorter than the depth', () => {
        expect(lastItems([1, 2, 3, 4], 5)).toEqual([1, 2, 3, 4])      // slice(length - depth) gave [4]
        expect(lastItems([1, 2, 3, 4, 5, 6, 7, 8], 12)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]) // and [5..8] here
    })
    it('returns the last depth messages when the chat is longer', () => {
        expect(lastItems([1, 2, 3, 4, 5], 2)).toEqual([4, 5])
        expect(lastItems([1, 2, 3], 3)).toEqual([1, 2, 3])
    })
    it('returns nothing for depth 0, a negative or a non-number depth', () => {
        expect(lastItems([1, 2, 3], 0)).toEqual([])
        expect(lastItems([1, 2, 3], -2)).toEqual([])
        expect(lastItems([1, 2, 3], NaN)).toEqual([])
        expect(lastItems([], 5)).toEqual([])
    })
    it('property: the result is always the last min(depth, length) items, in order', () => {
        let state = 99
        const rnd = (n: number) => Math.floor(((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * n)
        for (let i = 0; i < 500; i++) {
            const len = rnd(30)
            const depth = rnd(40)
            const items = Array.from({ length: len }, (_, k) => k)
            const got = lastItems(items, depth)
            expect(got).toEqual(items.slice(items.length - Math.min(depth, items.length)))
            expect(got.length).toBe(Math.min(depth, len))
        }
    })
})
