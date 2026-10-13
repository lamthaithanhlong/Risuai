import { writable } from "svelte/store"
import { isFresh, type PendingGeneration } from "./pendingGenerationCore"

const KEY = 'risu-pending-generation'

/** Set after a reload when a reply was cut off; the chat screen of that character picks it up. */
export const resumeGeneration = writable<PendingGeneration | null>(null)

export function markPending(p: Omit<PendingGeneration, 'at'>) {
    try {
        localStorage.setItem(KEY, JSON.stringify({ ...p, at: Date.now() }))
    } catch {}
}

export function clearPending() {
    try {
        localStorage.removeItem(KEY)
    } catch {}
}

/** The reply that was running when the page went away, or null (and the note is dropped when stale). */
export function readPending(): PendingGeneration | null {
    try {
        const raw = localStorage.getItem(KEY)
        if (!raw) {
            return null
        }
        const p = JSON.parse(raw) as PendingGeneration
        if (typeof p?.chaId === 'string' && Number.isInteger(p.chatPage) && Number.isInteger(p.previousLength) && isFresh(p, Date.now())) {
            return p
        }
    } catch {}
    clearPending()
    return null
}
