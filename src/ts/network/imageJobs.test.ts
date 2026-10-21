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
    const clock = { t: 1_000_000 }
    const fetchImpl = async (_url: string, init: any) => {
        const body = JSON.parse(init.body)
        calls.push({ model: body.model, headers: init.headers })
        const step = (plan[body.model] ?? ['ok']).shift() ?? 'ok'
        if (step === 'throw') throw new Error('connect ECONNREFUSED')
        const text = step === 'ok' ? STREAM(B64) : step === 'cut' ? 'event: progress\ndata: {}\n\n' : '{"error":{"message":"The model is not supported (reset after 30m)"}}'
        return { status: step === 'refuse' ? 400 : 200, text: async () => text }
    }
    // no background timers: the test moves its own clock and calls pump()/sweep()
    const jobs = openImageJobs({
        dbFile: join(dir, 'img.sqlite'), fetchImpl, timers: false, now: () => clock.t, convert: async (b: Buffer) => Buffer.concat([Buffer.from('WEBP:'), b.subarray(0, 4)]),
        writeInlay: async (id: string, bytes: Buffer) => { written.set(id, bytes) }, log: () => {}, ...extra,
    })
    opened.push(jobs)
    return { jobs, written, calls, clock }
}
const settle = async (jobs: any) => { for (let i = 0; i < 200 && !jobs.idle(); i++) await new Promise((r) => setTimeout(r, 5)); await new Promise((r) => setTimeout(r, 5)) }
const req = (models: string[]) => ({ url: 'http://127.0.0.1:20128/v1/images/generations', key: 'k', models, body: { prompt: 'a lantern', n: 1 } })
/** Moves the clock to when the job's next try is due and lets the queue run. */
async function nextTry(t: ReturnType<typeof setup>, id: string) {
    const j = t.jobs.get(id)
    expect(j.status).toBe('retrying')
    const waitMs = j.nextAt - t.clock.t
    t.clock.t = j.nextAt
    t.jobs.pump()
    await settle(t.jobs)
    return waitMs
}

describe('the router answer', () => {
    it('takes the picture from the done event, and plain JSON too; a cut stream is temporary', () => {
        expect(parseImageStream(STREAM('AAAA')).b64).toBe('AAAA')
        expect(parseImageStream('{"data":[{"b64_json":"BBBB"}]}').b64).toBe('BBBB')
        expect(parseImageStream('event: progress\ndata: {}\n\n')).toMatchObject({ status: 0 })
    })
    it('reads a PNG size', () => expect(pngSize(PNG)).toEqual({ w: 1254, h: 1254 }))
})

describe('image jobs: drawing', () => {
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
    it('falls back to the next model at once; when every model failed for a temporary reason it waits (retrying) and goes round again', async () => {
        const t = setup({ luna: ['refuse', 'refuse'], terra: ['cut', 'ok'] })
        const id = t.jobs.submit(req(['luna', 'terra']))
        await settle(t.jobs)
        expect(t.jobs.get(id)).toMatchObject({ status: 'retrying', attempt: 1 })
        expect(t.jobs.get(id).error).toContain('luna:')
        expect(await nextTry(t, id)).toBe(8000)
        expect(t.jobs.get(id)).toMatchObject({ status: 'done', model: 'terra' })
        expect(t.calls.map((c) => c.model)).toEqual(['luna', 'terra', 'luna', 'terra'])
    })
    it('the router down (no model reachable) is waited out longer: a ~90 s 9router restart failed three jobs (2026-10-15)', async () => {
        const t = setup({ luna: ['throw', 'throw', 'throw', 'ok'], terra: ['throw', 'throw', 'throw'] })
        const id = t.jobs.submit(req(['luna', 'terra']))
        await settle(t.jobs)
        const waits = [await nextTry(t, id), await nextTry(t, id)]
        // the third round: waits come from the job row, one by one
        const third = t.jobs.get(id).nextAt - t.clock.t
        await nextTry(t, id)
        expect([...waits, third]).toEqual([8000, 15000, 30000])
        expect(t.jobs.get(id)).toMatchObject({ status: 'done', model: 'luna' })
    })
    it('the router down for good still ends, after about 100 s of waiting', async () => {
        const t = setup({ luna: Array(9).fill('throw'), terra: Array(9).fill('throw') })
        const id = t.jobs.submit(req(['luna', 'terra']))
        await settle(t.jobs)
        let total = 0
        for (let i = 0; i < 4; i++) total += await nextTry(t, id)
        expect(t.jobs.get(id).status).toBe('error')
        expect(total).toBe(98000)
    })
    it('a model that answers (an error, not a dead connection) keeps the single retry round', async () => {
        const t = setup({ luna: Array(9).fill('refuse'), terra: Array(9).fill('throw') })
        const id = t.jobs.submit(req(['luna', 'terra']))
        await settle(t.jobs)
        await nextTry(t, id)
        expect(t.jobs.get(id).status).toBe('error')
        expect(t.calls.length).toBe(4)
    })
    it('every model failing ends in an error that names each one', async () => {
        const { jobs } = setup({ luna: ['refuse', 'refuse'], terra: ['refuse', 'refuse'] })
        const id = jobs.submit(req(['luna', 'terra']))
        await settle(jobs)
        const job = jobs.get(id)
        expect(job.status).toBe('error')
        expect(job.error).toContain('luna:')
        expect(job.error).toContain('terra:')
    })
    it('a picture that cannot be written ends in an error', async () => {
        const { jobs } = setup({}, { writeInlay: async () => { throw new Error('disk full') } })
        const id = jobs.submit(req(['luna']))
        await settle(jobs)
        expect(jobs.get(id)).toMatchObject({ status: 'error', error: 'disk full' })
    })
    it('refuses a request without a prompt or an http URL', () => {
        const { jobs } = setup({})
        expect(() => jobs.submit({ url: 'file:///etc/passwd', body: { prompt: 'x' } })).toThrow()
        expect(() => jobs.submit({ url: 'http://127.0.0.1:1/x', body: {} })).toThrow()
    })
})

describe('image jobs: the queue is its own pipeline', () => {
    it('filing a picture returns at once, whatever the router does', async () => {
        const never = () => new Promise(() => {})
        const { jobs } = setup({}, { fetchImpl: never })
        const t0 = Date.now()
        const { id, existing } = jobs.enqueue(req(['luna']), { chatId: 'c', messageId: 'm' }, { key: 'k1' })
        expect(Date.now() - t0).toBeLessThan(200)
        expect(existing).toBe(false)
        expect(jobs.get(id).status).toBe('running')
    })
    it('one job per key: asking again, in whatever state the job is, finds it; a new key makes another', async () => {
        const { jobs, calls } = setup({})
        const a = jobs.enqueue(req(['luna']), { chatId: 'c', messageId: 'm' }, { key: 'c|m|main' })
        const again = jobs.enqueue(req(['luna']), { chatId: 'c', messageId: 'm' }, { key: 'c|m|main' })
        expect(again).toEqual({ id: a.id, existing: true })
        await settle(jobs)
        expect(jobs.enqueue(req(['luna']), { chatId: 'c', messageId: 'm' }, { key: 'c|m|main' })).toEqual({ id: a.id, existing: true })   // done: still the same
        const redraw = jobs.enqueue(req(['luna']), { chatId: 'c', messageId: 'm' }, { key: 'c|m|main#redraw1' })
        expect(redraw.existing).toBe(false)
        await settle(jobs)
        expect(calls.length).toBe(2)
    })
    it('no more than `limit` pictures are drawn at once, oldest first', async () => {
        let inFlight = 0, peak = 0
        const release: (() => void)[] = []
        const order: string[] = []
        const fetchImpl = async (_u: string, init: any) => {
            order.push(JSON.parse(init.body).prompt)
            inFlight++; peak = Math.max(peak, inFlight)
            await new Promise<void>((r) => release.push(r))
            inFlight--
            return { status: 200, text: async () => STREAM(B64) }
        }
        const { jobs } = setup({}, { fetchImpl, limit: 2 })
        const ids = [1, 2, 3, 4].map((n) => jobs.submit({ ...req(['luna']), body: { prompt: 'p' + n } }))
        await new Promise((r) => setTimeout(r, 20))
        expect(order).toEqual(['p1', 'p2'])
        expect(ids.map((i) => jobs.get(i).status)).toEqual(['running', 'running', 'queued', 'queued'])
        release.shift()!()
        await new Promise((r) => setTimeout(r, 20))
        expect(order).toEqual(['p1', 'p2', 'p3'])
        while (release.length || !jobs.idle()) { release.shift()?.(); await new Promise((r) => setTimeout(r, 10)) }
        expect(peak).toBe(2)
        expect(ids.map((i) => jobs.get(i).status)).toEqual(['done', 'done', 'done', 'done'])
    })
    it('a job waiting to be tried again holds no slot: the next picture is drawn meanwhile (limit 1)', async () => {
        const t = setup({ luna: ['cut', 'ok', 'ok'] }, { limit: 1 })
        const a = t.jobs.submit(req(['luna']))                 // fails once: retrying
        const b = t.jobs.submit(req(['luna']))
        await settle(t.jobs)
        expect(t.jobs.get(a).status).toBe('retrying')
        expect(t.jobs.get(b).status).toBe('done')              // drawn while a waits
        await nextTry(t, a)
        expect(t.jobs.get(a).status).toBe('done')
    })
    it('survives a restart: a queued, running or retrying job goes on from its stored request; the key is never in a listing', async () => {
        const never = () => new Promise(() => {})
        const first = setup({}, { fetchImpl: never })
        const running = first.jobs.submit(req(['luna']))
        const waiting = first.jobs.submit(req(['luna']))       // limit 2: both running
        const third = first.jobs.submit(req(['luna']))         // queued
        await new Promise((r) => setTimeout(r, 20))
        expect(first.jobs.get(third).status).toBe('queued')
        first.jobs.close(); opened.splice(opened.indexOf(first.jobs), 1)
        const again = setup({})
        again.jobs.pump()                                      // the server does this itself once it listens (timers on)
        await settle(again.jobs)
        for (const id of [running, waiting, third]) expect(again.jobs.get(id).status).toBe('done')
        expect(JSON.stringify(again.jobs.get(running))).not.toContain('"k"')
        expect(JSON.stringify(again.jobs.unacked())).not.toContain('Bearer')
    })
    it('a row of the version that kept no request cannot run again: "interrupted"', async () => {
        const Database = createRequire(import.meta.url)('better-sqlite3')
        const d = new Database(join(dir, 'img.sqlite'))
        d.exec(`CREATE TABLE image_jobs (id TEXT PRIMARY KEY, status TEXT NOT NULL, target TEXT, inlay_id TEXT, model TEXT, error TEXT, acked INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL)`)
        d.prepare("INSERT INTO image_jobs (id, status, created, updated) VALUES ('old', 'running', 1, 1)").run()
        d.close()
        const { jobs } = setup({})
        expect(jobs.get('old').status).toBe('interrupted')
    })
    it('a job can be stopped, queued or being drawn, and nothing is written for it', async () => {
        const seen: AbortSignal[] = []
        const fetchImpl = (_u: string, init: any) => new Promise((_res, rej) => { seen.push(init.signal); init.signal.addEventListener('abort', () => rej(new Error('aborted'))) })
        const { jobs, written } = setup({}, { fetchImpl, limit: 1 })
        const a = jobs.submit(req(['luna']))
        const b = jobs.submit(req(['luna']))
        await new Promise((r) => setTimeout(r, 10))
        expect(jobs.cancel(b)).toBe(true)                       // queued
        expect(jobs.cancel(a)).toBe(true)                       // running: aborted
        await new Promise((r) => setTimeout(r, 20))
        expect(jobs.get(a).status).toBe('cancelled')
        expect(jobs.get(b).status).toBe('cancelled')
        expect(seen.length).toBe(1)
        expect(written.size).toBe(0)
    })
    it('a turn that was undone takes its pictures with it: the ones not drawn yet and not in a saved message are stopped', async () => {
        const never = () => new Promise(() => {})
        const { jobs, clock } = setup({}, { fetchImpl: never, limit: 1 })
        const mine = (m: string) => ({ charId: 'ss', chatId: 'c', messageId: m, chatIndex: 0, messageIndex: 1 })
        const before = jobs.submit(req(['luna']), mine('old'))              // asked before the turn began
        clock.t += 1000
        const gone = jobs.submit(req(['luna']), mine('gone'))               // the undone reply's picture (queued behind `before`: limit 1)
        const saved = jobs.submit(req(['luna']), mine('saved'))             // a message that did reach the chat file
        const elsewhere = jobs.submit(req(['luna']), { ...mine('x'), chatId: 'other' })
        const n = jobs.cancelUnsaved('c', clock.t, (t: any) => t.messageId === 'saved')
        expect(n).toBe(1)                                                   // only `gone`: `saved` is in the file, `before` is older than the turn, `elsewhere` is another chat
        expect([before, gone, saved, elsewhere].map((i) => jobs.get(i).status)).toEqual(['running', 'cancelled', 'queued', 'queued'])
    })
    it('a failed job can be tried again with its stored request', async () => {
        const t = setup({ luna: ['refuse', 'ok'] })
        const id = t.jobs.submit(req(['luna']))
        await settle(t.jobs)
        expect(t.jobs.get(id).status).toBe('error')
        expect(t.jobs.retry(id)).toBe(true)
        await settle(t.jobs)
        expect(t.jobs.get(id)).toMatchObject({ status: 'done', attempt: 1 })
        expect(t.jobs.retry(id)).toBe(false)                    // not failed any more
    })
    it('finished jobs wait for a page to take them; taking one removes it from the list', async () => {
        const { jobs } = setup({})
        const a = jobs.submit(req(['luna'])), b = jobs.submit(req(['luna']))
        await settle(jobs)
        expect(jobs.unacked().map((j: any) => j.id).sort()).toEqual([a, b].sort())
        expect(jobs.ack(a)).toBe(true)
        expect(jobs.unacked().map((j: any) => j.id)).toEqual([b])
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

describe('image jobs: placing the picture in its message', () => {
    const target = { charId: 'ss', chatId: 'c', messageId: 'm2', chatIndex: 0, messageIndex: 1 }
    it('a drawn picture goes to its message through `place`, with the ids and the picture; the job is then "placed"', async () => {
        const placed: any[] = []
        const { jobs } = setup({}, { place: async (tg: any, inlay: string) => { placed.push([tg.messageId, inlay]); return 'placed' } })
        const { id } = jobs.enqueue(req(['luna']), target, { key: 'ss|c|m2|main' })
        await settle(jobs)
        const j = jobs.get(id)
        expect(j.status).toBe('placed')
        expect(placed).toEqual([['m2', j.inlayId]])
    })
    it('a request without a key (a page of the version before the picture queue) is drawn but left "done": that page places it itself', async () => {
        const placed: unknown[] = []
        const { jobs } = setup({}, { place: async (...a: unknown[]) => { placed.push(a); return 'placed' } })
        const id = jobs.submit(req(['luna']), target)
        await settle(jobs)
        await jobs.sweep()
        expect(jobs.get(id).status).toBe('done')
        expect(placed).toEqual([])
    })
    it('the message is not saved yet: the picture waits as "done" and is placed at a later sweep; past the window the server gives up (orphan)', async () => {
        let there = false
        const t = setup({}, { place: async () => (there ? 'placed' : 'wait'), placeWindowMs: 60_000 })
        const id = t.jobs.enqueue(req(['luna']), target, { key: 'k-wait' }).id
        await settle(t.jobs)
        expect(t.jobs.get(id).status).toBe('done')
        await t.jobs.sweep()
        expect(t.jobs.get(id).status).toBe('done')
        there = true
        await t.jobs.sweep()
        expect(t.jobs.get(id).status).toBe('placed')
        // a picture whose message never came
        there = false
        const lost = t.jobs.enqueue(req(['luna']), { ...target, messageId: 'never' }, { key: 'k-lost' }).id
        await settle(t.jobs)
        t.clock.t += 61_000
        await t.jobs.sweep()
        expect(t.jobs.get(lost).status).toBe('orphan')
        expect(t.jobs.get(lost).inlayId).toBeTruthy()          // still there for a page that has the message
    })
    it('a placement that throws leaves the picture for a page, never an error', async () => {
        const t = setup({}, { place: async () => { throw new Error('boom') } })
        const id = t.jobs.enqueue(req(['luna']), target, { key: 'k-boom' }).id
        await settle(t.jobs)
        expect(t.jobs.get(id).status).toBe('done')
    })
    it('lists a chat\'s pictures: open and failed ones, drawn ones nobody took, and ones placed a moment ago', async () => {
        const t = setup({ luna: ['ok', 'refuse', 'ok', 'ok'] }, { place: async (tg: any) => (tg.messageId === 'm2' ? 'placed' : 'unsupported') })
        const placedJob = t.jobs.enqueue(req(['luna']), target, { key: 'a' }).id
        const failed = t.jobs.enqueue(req(['luna']), { ...target, messageId: 'm3' }, { key: 'b' }).id
        const drawn = t.jobs.enqueue(req(['luna']), { ...target, messageId: 'm4' }, { key: 'c' }).id
        const other = t.jobs.enqueue(req(['luna']), { ...target, chatId: 'other', messageId: 'm2' }, { key: 'd' }).id
        await settle(t.jobs)
        const ids = (l: any[]) => l.map((j) => j.id).sort()
        expect(ids(t.jobs.forChat('c'))).toEqual(ids([{ id: placedJob }, { id: failed }, { id: drawn }]))
        expect(ids(t.jobs.forChat('other'))).toEqual([other])
        t.clock.t += 11 * 60_000                                // the placed one ages out of the list; the failed and untaken ones stay
        expect(ids(t.jobs.forChat('c'))).toEqual(ids([{ id: failed }, { id: drawn }]))
        expect(t.jobs.placedSince('c', t.clock.t - 20 * 60_000).map((j: any) => j.id)).toEqual([placedJob])
    })
})
