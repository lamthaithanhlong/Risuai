import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { PENDING_MAX_AGE_MS, isFresh, planResume, planResumeWithRestore, resumePage, type PendingGeneration } from './pendingGenerationCore'
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

describe('planResumeWithRestore (the page was killed before the autosave caught up)', () => {
    const sent = { role: 'user', data: 'xin chào' }
    const withText: PendingGeneration = { ...base, userMessage: sent }

    test('the saved chat has everything: same plan as planResume, nothing restored', () => {
        expect(planResumeWithRestore(withText, ['char', 'user', 'user', 'char'])).toEqual({ keep: 3 })
    })

    test('the saved chat is exactly the user message short: put it back and answer it', () => {
        expect(planResumeWithRestore(withText, ['char', 'user'])).toEqual({ keep: 3, restore: sent })
    })

    test('without the text in the note there is nothing to put back', () => {
        expect(planResumeWithRestore(base, ['char', 'user'])).toBeNull()
    })

    test('a chat that lost more than the one message is not touched', () => {
        expect(planResumeWithRestore(withText, ['char'])).toBeNull()
    })

    test('a note whose message is not the user\'s is not restored', () => {
        expect(planResumeWithRestore({ ...base, userMessage: { role: 'char', data: 'x' } }, ['char', 'user'])).toBeNull()
    })
})

// TLA+ GenQueueKill: NoteNeverHidesAFinishedReply holds only while the page's note outlasts the server's window (W >= R).
describe('windows agree with the server', () => {
    test('the note outlasts the time the server keeps a finished reply', () => {
        const require = createRequire(import.meta.url)
        const { JOB_REUSE_MAX_AGE_MS, JOB_KEEP_MS } = require('../../../server/node/jobStore.cjs')
        expect(PENDING_MAX_AGE_MS).toBeGreaterThanOrEqual(JOB_REUSE_MAX_AGE_MS)
        expect(JOB_KEEP_MS).toBeGreaterThanOrEqual(JOB_REUSE_MAX_AGE_MS)
    })
})

describe('resumePage: the note finds its chat by id', () => {
    test('New Chat put a chat first: the note still names the chat the player wrote in (repro kill: the resume answered another chat)', () => {
        const note: PendingGeneration = { ...base, chatPage: 0, chatId: 'mine' }
        expect(resumePage(note, [{ id: 'new' }, { id: 'mine' }, { id: 'old' }])).toBe(1)
    })
    test('the chat was deleted: nothing to resume', () => {
        expect(resumePage({ ...base, chatId: 'gone' }, [{ id: 'a' }, { id: 'b' }])).toBeNull()
    })
    test('a note from before ids: its index, when it is in range', () => {
        expect(resumePage({ ...base, chatPage: 1 }, [{ id: 'a' }, { id: 'b' }])).toBe(1)
        expect(resumePage({ ...base, chatPage: 5 }, [{ id: 'a' }])).toBeNull()
    })
})
