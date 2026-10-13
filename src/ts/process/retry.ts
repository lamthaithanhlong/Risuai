// A summarization request that fails once (grok behind 9router answers an intermittent 400, a phone's network drops
// with "Load failed") should be asked again, not end the whole reply: HypaV3 turns one failed summary into an error
// that stops the message from being answered at all.

export interface RetryOptions {
    /** Waits before retry 1, 2, ... ; its length is the number of retries. */
    delaysMs: number[]
    /** Called with the failure and the attempt that failed (1-based) before waiting. */
    onRetry?: (error: unknown, attempt: number) => void
    sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function withRetry<T>(run: () => Promise<T>, options: RetryOptions): Promise<T> {
    const sleep = options.sleep ?? realSleep
    for (let attempt = 1; ; attempt++) {
        try {
            return await run()
        } catch (error) {
            const delay = options.delaysMs[attempt - 1]
            if (delay === undefined) {
                throw error
            }
            options.onRetry?.(error, attempt)
            await sleep(delay)
        }
    }
}
