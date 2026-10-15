import { describe, expect, test } from 'vitest'
import { nextIllustrate, replyWantsPicture } from './illustrateStatus.svelte'

describe('drawing status', () => {
    test('the first picture starts the clock, a second one does not restart it', () => {
        const a = nextIllustrate({ count: 0, startedAt: 0 }, 1, 1000)
        expect(a).toEqual({ count: 1, startedAt: 1000 })
        expect(nextIllustrate(a, 1, 5000)).toEqual({ count: 2, startedAt: 1000 })
    })

    test('the line stays until the last picture ends, then the clock resets', () => {
        const two = { count: 2, startedAt: 1000 }
        const one = nextIllustrate(two, -1, 9000)
        expect(one).toEqual({ count: 1, startedAt: 1000 })
        expect(nextIllustrate(one, -1, 9500)).toEqual({ count: 0, startedAt: 0 })
    })

    test('an end without a start never goes below zero', () => {
        expect(nextIllustrate({ count: 0, startedAt: 0 }, -1, 1)).toEqual({ count: 0, startedAt: 0 })
    })

    test('only a finished character reply with an [[img: line is about to draw a picture', () => {
        expect(replyWantsPicture([{ role: 'char', data: 'Text.\n[[img: a stone hall lit by torches]]' }])).toBe(true)
        expect(replyWantsPicture([{ role: 'char', data: 'text [[IMG: a hall]]' }])).toBe(true)
        expect(replyWantsPicture([{ role: 'char', data: 'Plain reply.' }])).toBe(false)
        expect(replyWantsPicture([{ role: 'user', data: '[[img: a hall]]' }])).toBe(false)
        expect(replyWantsPicture([])).toBe(false)
        expect(replyWantsPicture([{ role: 'char', data: '[[img: a hall]]' }, { role: 'user', data: 'next' }])).toBe(false)
    })
})
