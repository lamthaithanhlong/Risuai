// One reply generation = one key. The streaming request(s) it makes carry "<key>#<n>" as their idempotency key, so
// after a page refresh the same generation attaches to the job that is already running (or finished) on the server
// instead of asking the model again. A reroll or a retry is a new generation with a new key.

let current: string | null = null
let counter = 0

/** The model a generation takes once, when it starts. Every request of it, retries included, uses this one (specs/modelslots/SlotGeneration.tla). */
export interface GenerationModel {
    aiModel: string
    requestModel: string
}
let model: GenerationModel | null = null

/** The model the running generation was started with, or null outside one (then the settings are read as before). */
export function getGenerationModel(): GenerationModel | null {
    return current !== null ? model : null
}

export function setGenerationKey(key: string | null) {
    current = key
    counter = 0
    if (key === null) {
        model = null
    }
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
export function beginGeneration(key: string, snapshot?: GenerationModel): boolean {
    if (current !== null) {
        return false
    }
    current = key
    counter = 0
    model = snapshot ?? null
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
        model = null
    }
}
