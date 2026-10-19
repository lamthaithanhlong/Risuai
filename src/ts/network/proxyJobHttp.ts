import type { ProxyJobWsEvent } from "./proxyJobWs"

export interface JobLine { seq: number, event: ProxyJobWsEvent }
export type JobReadResult = 'done' | 'error' | 'aborted' | 'gave_up'

export interface JobReaderOptions {
    /** Opens the event stream from a sequence number (GET /proxy-stream-jobs/:id/events?from=N). */
    openEvents: (from: number) => Promise<Response>
    /** Called once per event, in order, never twice for the same sequence number. */
    onEvent: (event: ProxyJobWsEvent) => void
    isAborted: () => boolean
    sleep: (ms: number) => Promise<void>
    /** Give up after this many failed attempts in a row (an event or ping that arrives resets the count). */
    maxAttempts?: number
    /**
     * A connection that sends nothing for this long is dead and is opened again (default 45 s: the server pings every 15 s).
     * Measured with Toxiproxy (J4): a path that dies silently (no data, no FIN) held the reply until the server ended the response.
     */
    idleMs?: number
}

export const JOB_READ_IDLE_MS = 45_000

/** reader.read(), or 'idle' when nothing arrives for ms (the reader is then cancelled) */
async function readOrIdle(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number): Promise<ReadableStreamReadResult<Uint8Array> | 'idle'> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const idle = new Promise<'idle'>((resolve) => { timer = setTimeout(() => resolve('idle'), ms) })
    try {
        const r = await Promise.race([reader.read(), idle])
        if (r === 'idle') {
            reader.cancel().catch(() => {})
        }
        return r
    } finally {
        clearTimeout(timer)
    }
}

/**
 * Follows a stream job to its end. When the connection drops (phone screen locked, Wi-Fi blip, Safari suspending
 * the page) it opens the stream again from the next sequence number, so nothing is lost and nothing is repeated.
 */
export async function readJobEvents(opt: JobReaderOptions): Promise<JobReadResult> {
    // Count failed attempts, never wall-clock time: a locked phone freezes the page for minutes while the job keeps
    // running on the server, and Date.now() jumps over that gap. Measured with UPPAAL (specs/generation/uppaal):
    // "give up when now - lastProgress > 120 s" gave up at the first failure after any lock longer than 2 minutes.
    const maxAttempts = opt.maxAttempts ?? 30
    const idleMs = opt.idleMs ?? JOB_READ_IDLE_MS
    let next = 1
    let attempt = 0

    while (true) {
        if (opt.isAborted()) {
            return 'aborted'
        }
        try {
            const res = await opt.openEvents(next)
            if (res.status === 404) {
                // The server no longer knows this job: nothing to wait for.
                opt.onEvent({ type: 'error', status: 404, message: 'The stream job is gone (server restarted or job expired)' })
                return 'error'
            }
            if (!res.ok || !res.body) {
                throw new Error(`events ${res.status}`)
            }
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''
            while (true) {
                const r = await readOrIdle(reader, idleMs)
                if (r === 'idle') {
                    // silent for idleMs although the server pings: the connection is dead, open it again from where we are
                    break
                }
                const { done, value } = r
                if (done) {
                    break
                }
                buffer += decoder.decode(value, { stream: true })
                let newline: number
                while ((newline = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, newline).trim()
                    buffer = buffer.slice(newline + 1)
                    if (!line) {
                        continue
                    }
                    let parsed: Partial<JobLine> & { type?: string }
                    try {
                        parsed = JSON.parse(line)
                    } catch {
                        continue
                    }
                    if (parsed.type === 'ping' || typeof parsed.seq !== 'number' || !parsed.event) {
                        attempt = 0
                        continue
                    }
                    if (parsed.seq < next) {
                        continue
                    }
                    next = parsed.seq + 1
                    attempt = 0
                    opt.onEvent(parsed.event)
                    if (parsed.event.type === 'done') {
                        return 'done'
                    }
                    if (parsed.event.type === 'error') {
                        return 'error'
                    }
                }
            }
            // The stream ended without a final event: the connection dropped. Reconnect from where we are.
        } catch {
            if (opt.isAborted()) {
                return 'aborted'
            }
        }
        attempt++
        if (attempt > maxAttempts) {
            return 'gave_up'
        }
        await opt.sleep(Math.min(500 * 2 ** (attempt - 1), 5000))
    }
}
