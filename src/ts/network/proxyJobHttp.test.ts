import { afterEach, describe, expect, test, vi } from 'vitest'
import { readJobEvents } from './proxyJobHttp'
import type { ProxyJobWsEvent } from './proxyJobWs'

const enc = new TextEncoder()
const chunk = (n: number): ProxyJobWsEvent => ({ type: 'chunk', dataBase64: String(n) })
const line = (seq: number, event: ProxyJobWsEvent) => JSON.stringify({ seq, event }) + '\n'

/** A response that sends `lines` and then either ends cleanly or dies (drop). */
function response(lines: string[], opts: { drop?: boolean, status?: number } = {}): Response {
    // Like a real connection: the bytes sent so far arrive, and only then does it end or die.
    let sent = false
    const stream = new ReadableStream<Uint8Array>({
        pull(c) {
            if (!sent) {
                sent = true
                for (const l of lines) c.enqueue(enc.encode(l))
                return
            }
            if (opts.drop) c.error(new Error('network lost'))
            else c.close()
        },
    })
    return new Response(opts.status && opts.status >= 400 ? null : stream, { status: opts.status ?? 200 })
}

function run(responses: Response[], extra: { aborted?: () => boolean, maxAttempts?: number } = {}) {
    const froms: number[] = []
    const events: ProxyJobWsEvent[] = []
    let i = 0
    return {
        froms, events,
        result: readJobEvents({
            openEvents: async (from) => { froms.push(from); return responses[Math.min(i++, responses.length - 1)] },
            onEvent: (e) => events.push(e),
            isAborted: extra.aborted ?? (() => false),
            sleep: async () => {},
            maxAttempts: extra.maxAttempts,
        }),
    }
}

describe('readJobEvents', () => {
    test('a clean stream is read to the done event', async () => {
        const r = run([response([line(1, chunk(1)), line(2, chunk(2)), line(3, { type: 'done' })])])
        expect(await r.result).toBe('done')
        expect(r.events.map((e) => e.type)).toEqual(['chunk', 'chunk', 'done'])
        expect(r.froms).toEqual([1])
    })

    test('a drop mid-stream reconnects from the next sequence number: nothing lost, nothing repeated', async () => {
        const r = run([
            response([line(1, chunk(1)), line(2, chunk(2))], { drop: true }),
            // the server replays from 3; a repeated seq 2 (an overlapping replay) must be ignored
            response([line(2, chunk(2)), line(3, chunk(3)), line(4, { type: 'done' })]),
        ])
        expect(await r.result).toBe('done')
        expect(r.froms).toEqual([1, 3])
        expect(r.events.map((e) => (e as any).dataBase64 ?? e.type)).toEqual(['1', '2', '3', 'done'])
    })

    test('a stream that just ends without done is treated as a drop', async () => {
        const r = run([response([line(1, chunk(1))]), response([line(2, { type: 'done' })])])
        expect(await r.result).toBe('done')
        expect(r.froms).toEqual([1, 2])
    })

    test('pings and garbage lines are ignored', async () => {
        const r = run([response(['{"type":"ping"}\n', 'not json\n', line(1, chunk(1)), line(2, { type: 'done' })])])
        expect(await r.result).toBe('done')
        expect(r.events).toHaveLength(2)
    })

    test('an error event ends the read', async () => {
        const r = run([response([line(1, { type: 'error', status: 502, message: 'boom' })])])
        expect(await r.result).toBe('error')
    })

    test('a 404 means the job is gone: report an error instead of waiting', async () => {
        const r = run([response([], { status: 404 })])
        expect(await r.result).toBe('error')
        expect((r.events[0] as any).status).toBe(404)
    })

    test('abort stops reading', async () => {
        let aborted = false
        const r = run([response([line(1, chunk(1))], { drop: true })], { aborted: () => aborted })
        aborted = true
        expect(await r.result).toBe('aborted')
    })

    test('gives up after too many failed attempts in a row', async () => {
        const r = run([response([], { drop: true })], { maxAttempts: 3 })
        expect(await r.result).toBe('gave_up')
        expect(r.froms).toHaveLength(4)
    })

    test('an event received resets the count of failed attempts', async () => {
        // two failures, then one event, then two more failures, then done: never 3 failures in a row
        const r = run([
            response([], { drop: true }), response([], { drop: true }),
            response([line(1, chunk(1))], { drop: true }),
            response([], { drop: true }), response([], { drop: true }),
            response([line(2, { type: 'done' })]),
        ], { maxAttempts: 3 })
        expect(await r.result).toBe('done')
    })

    // Measured with UPPAAL: a phone locked for 200 s freezes the page; the job finishes on the server; on unlock the
    // wall clock says "nothing for 200 s", and the old wall-clock rule gave up before trying once.
    describe('a locked phone (the page frozen while the clock runs)', () => {
        afterEach(() => vi.useRealTimers())

        test('does not give up because the clock jumped while the page was frozen', async () => {
            vi.useFakeTimers({ toFake: ['Date'] })
            vi.setSystemTime(new Date('2026-10-13T00:00:00Z'))
            let calls = 0
            const events: ProxyJobWsEvent[] = []
            const result = await readJobEvents({
                openEvents: async () => {
                    calls++
                    if (calls === 1) {
                        // the connection dies; the page is frozen for 10 minutes before it notices
                        vi.setSystemTime(new Date('2026-10-13T00:10:00Z'))
                        throw new Error('connection reset after unlock')
                    }
                    return response([line(1, chunk(1)), line(2, { type: 'done' })])
                },
                onEvent: (e) => events.push(e),
                isAborted: () => false,
                sleep: async () => {},
            })
            expect(result).toBe('done')
            expect(events.map((e) => e.type)).toEqual(['chunk', 'done'])
        })
    })
})
