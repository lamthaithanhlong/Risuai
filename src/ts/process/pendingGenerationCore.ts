// A refresh kills the browser's streaming request, so the half-written bot reply is lost. We note
// "a reply is being generated for this chat after message N" in localStorage while it runs, and
// after the reload the reply is generated again. Pure logic here so it can be unit-tested.

export interface PendingGeneration {
    chaId: string
    chatPage: number
    /**
     * The chat's id. chatPage is an index, and New Chat puts the new chat first: after a reload the index named another chat, the
     * resume answered that one and the turn's own chat kept its message unanswered while the page spun (tests/turns/repro.mjs kill;
     * owner on the phone 2026-10-20: "đóng trang 60 giây nó loading mãi"). Notes written before this have no id: the index is used.
     */
    chatId?: string
    /** Number of messages in the chat when generation started; the last one is the user's message. */
    previousLength: number
    /** The generation's key: after a refresh it re-attaches to the server job that has the reply. */
    jobKey?: string
    /**
     * The user's message the reply answers. The chat is autosaved on a debounce, so a page killed in the first
     * second after "send" comes back without it; with the text here the message can be put back and answered.
     */
    userMessage?: { role: string, data: string, [key: string]: unknown }
    at: number
}

/**
 * How long the note is trusted. The server decides how long it keeps a finished job (JOB_REUSE_MAX_AGE_MS in
 * server/node/jobStore.cjs); this must outlast it, or a reply the server still holds is dropped here as "stale".
 * Past the server's window the same key just asks the model again.
 */
export const PENDING_MAX_AGE_MS = 48 * 60 * 60 * 1000

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

export interface ResumePlan {
    /** Messages to keep before generating again. */
    keep: number
    /** The user's message to put back first, when the saved chat is exactly one message short. */
    restore?: PendingGeneration['userMessage']
}

/** planResume, plus the case where the user's own message never reached the saved chat but the note carries it. */
export function planResumeWithRestore(p: PendingGeneration, roles: string[]): ResumePlan | null {
    const keep = planResume(p, roles)
    if (keep !== null) {
        return { keep }
    }
    if (p.userMessage?.role === 'user' && p.previousLength >= 1 && roles.length === p.previousLength - 1) {
        return { keep: p.previousLength, restore: p.userMessage }
    }
    return null
}

/** The index of the chat the note is about, found by its id when the note has one; null when that chat is gone. */
export function resumePage(p: PendingGeneration, chats: { id?: string }[]): number | null {
    if (typeof p.chatId === 'string') {
        const i = chats.findIndex((c) => c?.id === p.chatId)
        return i >= 0 ? i : null
    }
    return p.chatPage >= 0 && p.chatPage < chats.length ? p.chatPage : null
}
