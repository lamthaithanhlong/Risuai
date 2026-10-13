/**
 * When a write to the Node server fails, is it worth trying again, and after how long?
 * 429 (the server's rate limit, 2000 requests a minute per client address) and a lost connection pass by themselves;
 * a bad request or a refused login does not.
 */
export const WRITE_MAX_ATTEMPTS = 6

export function retryDelayMs(status: number, attempt: number, waitHeader?: string | null): number | null {
    if (attempt + 1 >= WRITE_MAX_ATTEMPTS) {
        return null
    }
    if (status === 429) {
        const seconds = Number(waitHeader)
        if (Number.isFinite(seconds) && seconds > 0) {
            return Math.min(seconds, 70) * 1000 + 250
        }
        return Math.min(2 ** attempt, 30) * 1000
    }
    if (status === 0 || status === 502 || status === 503 || status === 504) {
        return Math.min(500 * 2 ** attempt, 5000)
    }
    return null
}

/** What the error says: the HTTP status and the server's message, instead of a bare "setItem Error". */
export function writeFailureMessage(status: number, serverMessage?: string): string {
    const detail = (serverMessage ?? '').trim().slice(0, 120)
    return `setItem Error ${status || 'network'}${detail ? ': ' + detail : ''}`
}
