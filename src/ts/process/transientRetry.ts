// A model request that fails before any byte of the reply arrives (the provider says "no available channel", 502/503/504, a dropped
// connection) leaves the chat with nothing: an error popup and no message, which reads as "it just stopped". These failures are
// usually gone a few seconds later (measured on 9router -> deepseek-v4.1-flash: about one in four large requests got model_not_found
// and the next try 10 s later succeeded), so the request is simply sent again, a limited number of times.

/** Waits before the 2nd and 3rd attempt. */
export const TRANSIENT_RETRY_DELAYS_MS = [2000, 6000]

/**
 * True for a failure worth sending again. A usage limit that says how long it lasts ("reset after 10m") is not: waiting a few seconds
 * will not help, and the owner should see it at once.
 */
export function isTransientFailure(message: string): boolean {
    const text = String(message ?? '')
    if (/reset after\s*(\d+\s*h|\d+\s*m)/i.test(text)) {
        return false
    }
    if (/(^|[^\d])(408|425|500|502|503|504)([^\d]|$)/.test(text)) {
        return true
    }
    return /model_not_found|no available channel|overloaded|temporarily unavailable|service unavailable|bad gateway|gateway time-?out|timed? ?out|econnreset|socket hang up|fetch failed|network ?error/i.test(text)
}
