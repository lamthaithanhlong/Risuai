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
