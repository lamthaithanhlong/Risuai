// A refresh kills the browser's streaming request, so the half-written bot reply is lost. We note
// "a reply is being generated for this chat after message N" in localStorage while it runs, and
// after the reload the reply is generated again. Pure logic here so it can be unit-tested.

export interface PendingGeneration {
    chaId: string
    chatPage: number
    /** Number of messages in the chat when generation started; the last one is the user's message. */
    previousLength: number
    /** The generation's key: after a refresh it re-attaches to the server job that has the reply. */
    jobKey?: string
    at: number
}

export const PENDING_MAX_AGE_MS = 10 * 60 * 1000

export function isFresh(p: PendingGeneration, now: number): boolean {
    return now - p.at >= 0 && now - p.at <= PENDING_MAX_AGE_MS
}

/**
 * How many messages to keep before generating again, or null when the chat does not fit:
 * it must still hold the user's message that the reply answered, and nothing earlier may have changed.
 * Anything after it is the partial reply (or a reply that finished just as the page went away).
 */
export function planResume(p: PendingGeneration, roles: string[]): number | null {
    if (p.previousLength < 1 || roles.length < p.previousLength) {
        return null
    }
    return roles[p.previousLength - 1] === 'user' ? p.previousLength : null
}
