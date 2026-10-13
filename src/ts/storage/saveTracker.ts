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
