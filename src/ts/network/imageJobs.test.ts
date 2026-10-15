// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const { openImageJobs, parseImageStream, pngSize } = createRequire(import.meta.url)('../../../server/node/imageJobs.cjs')

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]), Buffer.from([0, 0, 4, 0xe6, 0, 0, 4, 0xe6])])
const STREAM = (b64: string) => `event: progress\ndata: {"stage":"response.created"}\n\nevent: done\ndata: {"data":[{"b64_json":"${b64}"}]}\n\n`
const B64 = PNG.toString('base64')

let dir: string
const opened: any[] = []
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'imgjobs-')) })
afterEach(() => { for (const j of opened.splice(0)) { try { j.close() } catch {} } rmSync(dir, { recursive: true, force: true }) })

/** A router that answers per model: 'ok' (a picture), 'cut' (stream ended), 'refuse' (not supported), 'throw' (connection). */
function setup(plan: Record<string, string[]>, extra: Record<string, unknown> = {}) {
    const written = new Map<string, Buffer>()
    const calls: { model: string; headers: any }[] = []
    const fetchImpl = async (_url: string, init: any) => {
        const body = JSON.parse(init.body)
        calls.push({ model: body.model, headers: init.headers })
        const step = (plan[body.model] ?? ['ok']).shift() ?? 'ok'
        if (step === 'throw') throw new Error('connect ECONNREFUSED')
        const text = step === 'ok' ? STREAM(B64) : step === 'cut' ? 'event: progress\ndata: {}\n\n' : '{"error":{"message":"The model is not supported (reset after 30m)"}}'
        return { status: step === 'refuse' ? 400 : 200, text: async () => text }
    }
    const jobs = openImageJobs({
        dbFile: join(dir, 'img.sqlite'), fetchImpl, sleep: async () => {}, convert: async (b: Buffer) => Buffer.concat([Buffer.from('WEBP:'), b.subarray(0, 4)]),
        writeInlay: async (id: string, bytes: Buffer) => { written.set(id, bytes) }, log: () => {}, ...extra,
    })
    opened.push(jobs)
    return { jobs, written, calls }
}
const settle = async (jobs: any) => { for (let i = 0; i < 100 && !jobs.idle(); i++) await new Promise((r) => setTimeout(r, 5)) }
const req = (models: string[]) => ({ url: 'http://127.0.0.1:20128/v1/images/generations', key: 'k', models, body: { prompt: 'a lantern', n: 1 } })

describe('the router answer', () => {
    it('takes the picture from the done event, and plain JSON too; a cut stream is temporary', () => {
        expect(parseImageStream(STREAM('AAAA')).b64).toBe('AAAA')
        expect(parseImageStream('{"data":[{"b64_json":"BBBB"}]}').b64).toBe('BBBB')
        expect(parseImageStream('event: progress\ndata: {}\n\n')).toMatchObject({ status: 0 })
    })
    it('reads a PNG size', () => expect(pngSize(PNG)).toEqual({ w: 1254, h: 1254 }))
})

describe('image jobs', () => {
    it('draws, converts, writes inlays/<id> and reports the id with the model', async () => {
        const { jobs, written, calls } = setup({})
        const id = jobs.submit(req(['luna']), { chatId: 'c1', messageId: 'm7', mode: 'auto' })
        await settle(jobs)
        const job = jobs.get(id)
        expect(job).toMatchObject({ status: 'done', model: 'luna', target: { chatId: 'c1', messageId: 'm7' } })
        expect(written.get(job.inlayId)!.toString('ascii', 0, 5)).toBe('WEBP:')
        expect(calls[0].headers.accept).toBe('text/event-stream')
        expect(calls[0].headers.authorization).toBe('Bearer k')
    })
    it('falls back to the next model when one fails, and waits a round when all fail for a temporary reason', async () => {
        const { jobs, calls } = setup({ luna: ['refuse', 'refuse'], terra: ['cut', 'ok'] })
        const id = jobs.submit(req(['luna', 'terra']))
        await settle(jobs)
        expect(jobs.get(id)).toMatchObject({ status: 'done', model: 'terra' })
        expect(calls.map((c) => c.model)).toEqual(['luna', 'terra', 'luna', 'terra'])
    })
    it('every model failing ends in an error that names each one', async () => {
        const { jobs } = setup({ luna: ['refuse', 'refuse'], terra: ['throw', 'throw'] })
        const id = jobs.submit(req(['luna', 'terra']))
        await settle(jobs)
        const job = jobs.get(id)
        expect(job.status).toBe('error')
        expect(job.error).toContain('luna:')
        expect(job.error).toContain('terra:')
    })
    it('finished jobs wait for a page to take them; taking one removes it from the list', async () => {
        const { jobs } = setup({})
        const a = jobs.submit(req(['luna'])), b = jobs.submit(req(['luna']))
        await settle(jobs)
        expect(jobs.unacked().map((j: any) => j.id).sort()).toEqual([a, b].sort())
        expect(jobs.ack(a)).toBe(true)
        expect(jobs.unacked().map((j: any) => j.id)).toEqual([b])
    })
    it('a job running when the server stopped is "interrupted" after a restart; the key was never stored', async () => {
        const never = () => new Promise(() => {})
        const first = setup({}, { fetchImpl: never })
        const id = first.jobs.submit(req(['luna']))
        await new Promise((r) => setTimeout(r, 20))
        first.jobs.close(); opened.splice(opened.indexOf(first.jobs), 1)
        const again = setup({})
        expect(again.jobs.get(id).status).toBe('interrupted')
        expect(JSON.stringify(again.jobs.get(id))).not.toContain('"k"')
    })
    it('refuses a request without a prompt or an http URL', () => {
        const { jobs } = setup({})
        expect(() => jobs.submit({ url: 'file:///etc/passwd', body: { prompt: 'x' } })).toThrow()
        expect(() => jobs.submit({ url: 'http://127.0.0.1:1/x', body: {} })).toThrow()
    })
    it('a newer job for the same message supersedes an older one; other messages are not affected', async () => {
        const { jobs } = setup({})
        const t = { charId: 'ss', chatId: 'c', messageId: 'm1', chatIndex: 0, messageIndex: 3 }
        const old = jobs.submit(req(['luna']), t)
        const other = jobs.submit(req(['luna']), { ...t, messageId: 'm2' })
        const redraw = jobs.submit(req(['luna']), t)
        await settle(jobs)
        expect(jobs.get(old).superseded).toBe(true)
        expect(jobs.get(redraw).superseded).toBe(false)
        expect(jobs.get(other).superseded).toBe(false)
    })
})
