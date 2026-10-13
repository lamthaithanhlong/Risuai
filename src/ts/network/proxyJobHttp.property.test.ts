import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { readJobEvents } from './proxyJobHttp'
import type { ProxyJobWsEvent } from './proxyJobWs'

// The code-level twin of specs/generation/GenQueue.tla (NoLossNoDup, Settles): whatever the network does, the events
// the reader hands over are exactly the job's log, once each, in order, and the read ends.

const enc = new TextEncoder()

/** One connection of a fake server: the log from `from` on (optionally starting a few events early, as a replay
 *  may), pings in between, delivered in pieces of random size, and killed after `cutAt` bytes if it is a drop. */
function connection(log: ProxyJobWsEvent[], from: number, opts: { overlap: number, pieces: number[], cutAt: number | null }): Response {
    const start = Math.max(1, from - opts.overlap)
    let text = ''
    for (let seq = start; seq <= log.length; seq++) {
        if (seq % 2 === 0) text += '{"type":"ping"}\n'
        text += JSON.stringify({ seq, event: log[seq - 1] }) + '\n'
    }
    const bytes = enc.encode(text)
    let sent = 0
    let piece = 0
    return new Response(new ReadableStream<Uint8Array>({
        pull(c) {
            if (opts.cutAt !== null && sent >= opts.cutAt) { c.error(new Error('network lost')); return }
            if (sent >= bytes.length) { c.close(); return }
            const size = Math.max(1, opts.pieces[piece++ % opts.pieces.length])
            const end = Math.min(bytes.length, sent + size, opts.cutAt === null ? Infinity : opts.cutAt)
            c.enqueue(bytes.slice(sent, end))
            sent = end
        },
    }))
}

const terminal = fc.constantFrom<'done' | 'error'>('done', 'error')
const scenario = fc.record({
    chunks: fc.integer({ min: 0, max: 8 }),
    end: terminal,
    drops: fc.array(fc.integer({ min: 0, max: 400 }), { maxLength: 6 }),   // byte at which each early connection dies
    pieces: fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 6 }),
    overlap: fc.integer({ min: 0, max: 3 }),
})

describe('readJobEvents under random network failures', () => {
    test('hands over exactly the log, once each and in order, and ends with the log\'s own ending', async () => {
        await fc.assert(fc.asyncProperty(scenario, async (sc) => {
            const log: ProxyJobWsEvent[] = [
                { type: 'upstream_headers', status: 200, headers: {} },
                ...Array.from({ length: sc.chunks }, (_, i): ProxyJobWsEvent => ({ type: 'chunk', dataBase64: String(i) })),
                sc.end === 'done' ? { type: 'done' } : { type: 'error', status: 502, message: 'boom' },
            ]
            let opened = 0
            const delivered: ProxyJobWsEvent[] = []
            const result = await readJobEvents({
                openEvents: async (from) => {
                    const i = opened++
                    const dropsHere = i < sc.drops.length
                    // an early connection that would end cleanly before the log's end must die instead, so it is a drop
                    return connection(log, from, { overlap: sc.overlap, pieces: sc.pieces, cutAt: dropsHere ? sc.drops[i] : null })
                },
                onEvent: (e) => delivered.push(e),
                isAborted: () => false,
                sleep: async () => {},
                maxAttempts: 1000,
            })
            expect(result).toBe(sc.end)
            expect(delivered).toEqual(log)
        }), { numRuns: 400 })
    }, 60_000)
})
