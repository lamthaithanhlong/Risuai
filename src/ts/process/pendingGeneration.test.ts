import { describe, expect, test } from 'vitest'
import { PENDING_MAX_AGE_MS, isFresh, planResume, type PendingGeneration } from './pendingGenerationCore'

const base: PendingGeneration = { chaId: 'c1', chatPage: 0, previousLength: 3, at: 1_000 }

describe('planResume', () => {
    test('a partial reply after the user message is dropped and regenerated', () => {
        expect(planResume(base, ['char', 'user', 'user', 'char'])).toBe(3)
    })

    test('no partial reply saved: still regenerates', () => {
        expect(planResume(base, ['char', 'char', 'user'])).toBe(3)
    })

    test('the user message never reached the save: nothing to resume', () => {
        expect(planResume(base, ['char', 'user'])).toBeNull()
    })

    test('generation that did not answer a user message (auto mode, continue) is not resumed', () => {
        expect(planResume(base, ['user', 'user', 'char', 'char'])).toBeNull()
    })

    test('an empty chat is not resumed', () => {
        expect(planResume({ ...base, previousLength: 0 }, [])).toBeNull()
    })
})

describe('isFresh', () => {
    test('recent note counts', () => {
        expect(isFresh(base, base.at + 30_000)).toBe(true)
    })

    test('an old note (the owner came back a day later) does not', () => {
        expect(isFresh(base, base.at + PENDING_MAX_AGE_MS + 1)).toBe(false)
    })

    test('a note from the future (clock change) does not', () => {
        expect(isFresh(base, base.at - 1)).toBe(false)
    })
})
