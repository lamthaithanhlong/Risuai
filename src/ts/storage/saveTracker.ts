// "Is what I changed already saved?" as a comparison of two counters instead of a guess about the autosave debounce.
// Every change bumps `changed`; a save records the value of `changed` at the moment it started, so it covers every
// change up to that point and none after.

export interface SaveTracker {
    /** A change was made; returns its number. */
    noteChange(): number
    /** The current change number, to be taken when a save starts. */
    current(): number
    /** A save that started at change number `seq` is on the server. */
    markSaved(seq: number): void
    /** Resolves when everything changed so far is saved, or after timeoutMs. */
    flush(timeoutMs?: number): Promise<void>
}

/**
 * The autosave effect reads the whole chat list ($state.snapshot) so it re-runs when anything in it changes. While a
 * reply streams, that is a deep copy of every chat on every chunk. The copy is only there to subscribe: what gets saved is
 * read from the database itself. So while the chat streams, subscribe to the flag alone; its change when the reply ends
 * re-runs the effect, which then saves the finished reply. (A page killed mid-stream comes back with the saved
 * placeholder and the resume note, GenQueueKill.)
 */
export function shouldTrackChatContent(chat: { isStreaming?: boolean } | undefined): boolean {
    return !chat?.isStreaming
}

export const BACKUP_MIN_GAP_MS = 5 * 60 * 1000

/**
 * Every autosave also uploaded a timestamped copy of the whole database and then listed and pruned the old copies:
 * two ~1.7 MB uploads plus two more requests per save, and saves come every 2-4 s while messages translate. A copy at most
 * every few minutes still gives 20 restore points (now spread over ~100 minutes instead of ~1 minute).
 */
export function shouldWriteBackup(lastBackupAt: number, now: number, gapMs: number = BACKUP_MIN_GAP_MS): boolean {
    return lastBackupAt === 0 || now < lastBackupAt || now - lastBackupAt >= gapMs
}

export function createSaveTracker(): SaveTracker {
    let changed = 0
    let saved = 0
    let waiters: { target: number, resolve: () => void }[] = []
    return {
        noteChange() {
            return ++changed
        },
        current() {
            return changed
        },
        markSaved(seq) {
            saved = Math.max(saved, seq)
            waiters = waiters.filter((w) => {
                if (w.target <= saved) {
                    w.resolve()
                    return false
                }
                return true
            })
        },
        flush(timeoutMs = 8000) {
            const target = changed
            if (saved >= target) {
                return Promise.resolve()
            }
            return new Promise<void>((resolve) => {
                const waiter = { target, resolve }
                waiters.push(waiter)
                setTimeout(() => {
                    waiters = waiters.filter((w) => w !== waiter)
                    resolve()
                }, timeoutMs)
            })
        },
    }
}

/** "Something changed since the last save started": set by the debounced change effect, taken by the autosave loop. */
export interface SaveSignal {
    mark(): void
    /** true once per change: the loop then saves */
    take(): boolean
    /** the save that took it failed: what it carried is still only in this page, so the loop saves again without a new change */
    failed(): void
}

export function createSaveSignal(): SaveSignal {
    let pending = false
    return {
        mark() { pending = true },
        take() { const p = pending; pending = false; return p },
        failed() { pending = true },
    }
}

/** How long the autosave loop waits after its n-th failed save in a row before trying again (setItem has retried for ~12 s itself). */
export function saveRetryDelayMs(failuresInARow: number): number {
    return Math.min(2000 * 2 ** (Math.max(1, failuresInARow) - 1), 30_000)
}

/** The error is shown once, at the 5th failed save in a row; the later ones go to the console while the loop keeps trying. */
export function shouldAlertSaveFailure(failuresInARow: number): boolean {
    return failuresInARow === 5
}
