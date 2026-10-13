// One reply generation = one key. The streaming request(s) it makes carry "<key>#<n>" as their idempotency key, so
// after a page refresh the same generation attaches to the job that is already running (or finished) on the server
// instead of asking the model again. A reroll or a retry is a new generation with a new key.

let current: string | null = null
let counter = 0

export function setGenerationKey(key: string | null) {
    current = key
    counter = 0
}

/** The idempotency key for the next streaming request of this generation, or undefined outside one. */
export function nextJobKey(): string | undefined {
    return current ? `${current}#${counter++}` : undefined
}

/**
 * Claims the single generation slot. False when another generation is running: the caller must then do nothing at all
 * (not touch the key, the resume note, the busy flag or the abort controller of the one that is running). Before this,
 * a second sendChatMain overwrote the key and counter, and its tail cleared the key, the note and "doingChat" of the first.
 */
export function beginGeneration(key: string): boolean {
    if (current !== null) {
        return false
    }
    current = key
    counter = 0
    return true
}

/** True while a generation holds the slot. */
export function isGenerationActive(): boolean {
    return current !== null
}

/** Releases the slot, but only for the generation that holds it (a late call from an earlier one is a no-op). */
export function endGeneration(key: string) {
    if (current === key) {
        current = null
        counter = 0
    }
}
