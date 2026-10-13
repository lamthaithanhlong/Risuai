import { describe, expect, test, vi } from 'vitest'
import { createSaveTracker } from './saveTracker'

describe('saveTracker.flush', () => {
    test('nothing changed: resolves at once', async () => {
        const t = createSaveTracker()
        await expect(t.flush()).resolves.toBeUndefined()
    })

    test('waits for a save that covers the change', async () => {
        const t = createSaveTracker()
        t.noteChange()
        let done = false
        const p = t.flush().then(() => { done = true })
        await Promise.resolve()
        expect(done).toBe(false)
        t.markSaved(t.current())
        await p
        expect(done).toBe(true)
    })

    test('a save that started before the change does not count', async () => {
        const t = createSaveTracker()
        const started = t.noteChange()          // save starts here, covering change 1
        t.noteChange()                           // the reply arrives while it runs
        let done = false
        const p = t.flush().then(() => { done = true })
        t.markSaved(started)
        await Promise.resolve()
        expect(done).toBe(false)
        t.markSaved(t.current())
        await p
        expect(done).toBe(true)
    })

    test('a stuck save cannot hold the caller for ever', async () => {
        vi.useFakeTimers()
        try {
            const t = createSaveTracker()
            t.noteChange()
            let done = false
            const p = t.flush(1000).then(() => { done = true })
            await vi.advanceTimersByTimeAsync(999)
            expect(done).toBe(false)
            await vi.advanceTimersByTimeAsync(2)
            await p
            expect(done).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

    test('an older save finishing late never moves the saved mark back', async () => {
        const t = createSaveTracker()
        t.noteChange(); t.noteChange()
        t.markSaved(2)
        t.markSaved(1)
        await expect(t.flush()).resolves.toBeUndefined()
    })
})

describe('shouldTrackChatContent', () => {
    test('a streaming chat is not deep-copied on every chunk, a settled one is', async () => {
        const { shouldTrackChatContent } = await import('./saveTracker')
        expect(shouldTrackChatContent({ isStreaming: true })).toBe(false)
        expect(shouldTrackChatContent({ isStreaming: false })).toBe(true)
        expect(shouldTrackChatContent({})).toBe(true)
        expect(shouldTrackChatContent(undefined)).toBe(true)
    })
})

describe('shouldWriteBackup', () => {
    test('the first save writes a copy, the next ones within 5 minutes do not', async () => {
        const { shouldWriteBackup, BACKUP_MIN_GAP_MS } = await import('./saveTracker')
        expect(shouldWriteBackup(0, 1_000_000)).toBe(true)
        expect(shouldWriteBackup(1_000_000, 1_000_000 + 3_000)).toBe(false)
        expect(shouldWriteBackup(1_000_000, 1_000_000 + BACKUP_MIN_GAP_MS - 1)).toBe(false)
        expect(shouldWriteBackup(1_000_000, 1_000_000 + BACKUP_MIN_GAP_MS)).toBe(true)
    })
    test('a clock that went backwards does not stop backups for ever', async () => {
        const { shouldWriteBackup } = await import('./saveTracker')
        expect(shouldWriteBackup(2_000_000, 1_000_000)).toBe(true)
    })
})
