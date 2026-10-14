import { beforeEach, describe, expect, test } from 'vitest'
import { beginGeneration, endGeneration, getGenerationModel, isGenerationActive, nextJobKey, setGenerationKey } from './generationKey'

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

describe('the model a generation starts with (specs/modelslots/SlotGeneration.tla)', () => {
    test('is kept for the whole generation and cleared when it ends', () => {
        expect(getGenerationModel()).toBeNull()
        expect(beginGeneration('k1', { aiModel: 'reverse_proxy', requestModel: 'main' })).toBe(true)
        expect(getGenerationModel()).toEqual({ aiModel: 'reverse_proxy', requestModel: 'main' })
        endGeneration('k1')
        expect(getGenerationModel()).toBeNull()
    })

    test("a second begin does not replace the running generation's model, and a late end of another key does not clear it", () => {
        expect(beginGeneration('a', { aiModel: 'm1', requestModel: 'x' })).toBe(true)
        expect(beginGeneration('b', { aiModel: 'm2', requestModel: 'y' })).toBe(false)
        endGeneration('b')
        expect(getGenerationModel()).toEqual({ aiModel: 'm1', requestModel: 'x' })
        endGeneration('a')
    })

    test('a generation begun without a snapshot reads the settings as before', () => {
        beginGeneration('c')
        expect(getGenerationModel()).toBeNull()
        endGeneration('c')
    })
})
