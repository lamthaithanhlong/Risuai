import { beforeEach, describe, expect, test } from 'vitest'
import { beginGeneration, endGeneration, isGenerationActive, nextJobKey, setGenerationKey } from './generationKey'

beforeEach(() => setGenerationKey(null))

describe('one generation at a time', () => {
    test('a second generation cannot take over the key of the one running', () => {
        expect(beginGeneration('A')).toBe(true)
        expect(nextJobKey()).toBe('A#0')
        expect(beginGeneration('B')).toBe(false)
        expect(nextJobKey()).toBe('A#1')            // the loser did not reset the counter or replace the key
        endGeneration('B')                          // nor can it release the slot
        expect(isGenerationActive()).toBe(true)
        expect(nextJobKey()).toBe('A#2')
    })

    test('after the holder ends, the next generation gets a clean sequence', () => {
        expect(beginGeneration('A')).toBe(true)
        nextJobKey()
        endGeneration('A')
        expect(isGenerationActive()).toBe(false)
        expect(nextJobKey()).toBeUndefined()
        expect(beginGeneration('B')).toBe(true)
        expect(nextJobKey()).toBe('B#0')
    })

    test('a late end from an earlier generation does not release a later one', () => {
        expect(beginGeneration('A')).toBe(true)
        endGeneration('A')
        expect(beginGeneration('B')).toBe(true)
        endGeneration('A')
        expect(nextJobKey()).toBe('B#0')
    })

    test('a retry ends its own generation before starting the next', () => {
        expect(beginGeneration('A')).toBe(true)
        endGeneration('A')
        expect(beginGeneration('A2')).toBe(true)
    })
})
