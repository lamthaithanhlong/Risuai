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
