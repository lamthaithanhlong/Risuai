// @vitest-environment node
// Real client reader against a real, separate Risu server (own port, temp dir, temp job DB) and a fake model.
// Needs Node with node:sqlite, so it only runs with RISU_E2E=1.
import { spawn, type ChildProcess } from 'node:child_process'
import http from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { readJobEvents } from './proxyJobHttp'
import type { ProxyJobWsEvent } from './proxyJobWs'

const REPO = resolve(__dirname, '../../..')
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const freePort = () => new Promise<number>((res) => { const s = createServer().listen(0, () => { const p = (s.address() as any).port; s.close(() => res(p)) }) })

describe.skipIf(!process.env.RISU_E2E)('durable stream jobs: client reader + real server', () => {
    let tmp = '', server: ChildProcess, upstream: http.Server, base = '', upPort = 0, upstreamCalls = 0
    const AUTH = { 'risu-auth': 'testpw', 'content-type': 'application/json' }

    beforeAll(async () => {
        tmp = mkdtempSync(join(tmpdir(), 'jobs-e2e-'))
        mkdirSync(join(tmp, 'save'))
        writeFileSync(join(tmp, 'save', '__password'), 'testpw')
        upPort = await freePort()
        upstream = http.createServer((req, res) => {
            upstreamCalls++
            res.writeHead(Number(req.headers['x-status'] || 200), { 'content-type': 'text/event-stream' })
            let i = 0
            const t = setInterval(() => { i++; res.write(`data: chunk-${i}\n\n`); if (i >= 6) { clearInterval(t); res.end() } }, 150)
            req.on('close', () => clearInterval(t))
        })
        await new Promise<void>((r) => upstream.listen(upPort, '127.0.0.1', r))
        const port = await freePort()
        base = `http://localhost:${port}`
        server = spawn('node', [join(REPO, 'server/node/server.cjs')], {
            cwd: tmp, env: { ...process.env, PORT: String(port), RISU_JOBS_DB: join(tmp, 'jobs.sqlite') }, stdio: 'ignore',
        })
        for (let i = 0; i < 80; i++) { try { await fetch(base + '/'); break } catch { await sleep(150) } }
    }, 30_000)

    afterAll(() => { server?.kill('SIGKILL'); upstream?.close(); rmSync(tmp, { recursive: true, force: true }) })

    const createJob = async (key: string, upstreamStatus = 200) => (await fetch(`${base}/proxy-stream-jobs`, {
        method: 'POST', headers: AUTH,
        body: JSON.stringify({ url: `http://127.0.0.1:${upPort}/`, method: 'POST', headers: { 'x-status': String(upstreamStatus) }, bodyBase64: '', idempotencyKey: key }),
    })).json() as Promise<{ jobId: string, reused?: boolean }>

    /** The first connection dies after `cutAfter` lines, the way a locked phone's does. */
    function openEvents(jobId: string, cutAfter: number) {
        let calls = 0
        const froms: number[] = []
        const open = async (from: number) => {
            froms.push(from)
            const res = await fetch(`${base}/proxy-stream-jobs/${jobId}/events?from=${from}`, { headers: AUTH })
            if (calls++ > 0) return res
            const reader = res.body!.getReader()
            let lines = 0
            return new Response(new ReadableStream<Uint8Array>({
                async pull(c) {
                    const { done, value } = await reader.read()
                    if (done) return c.close()
                    lines += new TextDecoder().decode(value).split('\n').filter((l) => l.includes('"seq"')).length
                    c.enqueue(value)
                    if (lines >= cutAfter) { reader.cancel().catch(() => {}); c.error(new Error('network lost')) }
                },
            }))
        }
        return { open, froms }
    }
    const chunks = (events: ProxyJobWsEvent[]) => events.filter((e) => e.type === 'chunk').map((e: any) => Buffer.from(e.dataBase64, 'base64').toString()).join('')
    const FULL = Array.from({ length: 6 }, (_, i) => `data: chunk-${i + 1}\n\n`).join('')

    test('a dropped connection is resumed from the cursor and the reply is whole', async () => {
        const { jobId } = await createJob('E1')
        const { open, froms } = openEvents(jobId, 3)
        const events: ProxyJobWsEvent[] = []
        const result = await readJobEvents({ openEvents: open, onEvent: (e) => events.push(e), isAborted: () => false, sleep })
        expect(result).toBe('done')
        expect(froms.length).toBeGreaterThanOrEqual(2)
        expect(froms[1]).toBeGreaterThan(1)
        expect(chunks(events)).toBe(FULL)
    }, 20_000)

    test('after a page refresh the same key gets the whole reply from the finished job, without asking the model again', async () => {
        const first = await createJob('E2')
        const a: ProxyJobWsEvent[] = []
        await readJobEvents({ openEvents: (from) => fetch(`${base}/proxy-stream-jobs/${first.jobId}/events?from=${from}`, { headers: AUTH }), onEvent: (e) => a.push(e), isAborted: () => false, sleep })
        const calls = upstreamCalls
        const again = await createJob('E2')
        expect(again.reused).toBe(true)
        expect(again.jobId).toBe(first.jobId)
        const b: ProxyJobWsEvent[] = []
        await readJobEvents({ openEvents: (from) => fetch(`${base}/proxy-stream-jobs/${again.jobId}/events?from=${from}`, { headers: AUTH }), onEvent: (e) => b.push(e), isAborted: () => false, sleep })
        expect(chunks(b)).toBe(FULL)
        expect(upstreamCalls).toBe(calls)
    }, 20_000)

    test('a job whose model answered with an HTTP error is not reused: a refresh asks again instead of replaying the error', async () => {
        const first = await createJob('E3', 502)
        const a: ProxyJobWsEvent[] = []
        await readJobEvents({ openEvents: (from) => fetch(`${base}/proxy-stream-jobs/${first.jobId}/events?from=${from}`, { headers: AUTH }), onEvent: (e) => a.push(e), isAborted: () => false, sleep })
        expect((a.find((e) => e.type === 'upstream_headers') as any).status).toBe(502)
        const calls = upstreamCalls
        const again = await createJob('E3', 200)
        expect(again.reused).toBeFalsy()
        expect(again.jobId).not.toBe(first.jobId)
        const b: ProxyJobWsEvent[] = []
        await readJobEvents({ openEvents: (from) => fetch(`${base}/proxy-stream-jobs/${again.jobId}/events?from=${from}`, { headers: AUTH }), onEvent: (e) => b.push(e), isAborted: () => false, sleep })
        expect(chunks(b)).toBe(FULL)
        expect(upstreamCalls).toBe(calls + 1)
    }, 20_000)
})
