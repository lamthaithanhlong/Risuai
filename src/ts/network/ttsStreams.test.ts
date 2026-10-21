// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
import express from 'express'

const { createTtsStreams, stripMp3, FrameParser } = createRequire(import.meta.url)('../../../server/node/ttsStreams.cjs')

// A real-shaped MP3 chunk, as the TTS server sends it: ID3v2 tag, the silent Info frame, audio frames (MPEG1 Layer III 128 kbps
// 44.1 kHz = 417 bytes each), and optionally an ID3v1 tag. `fill` makes each chunk's audio recognisable.
const FRAME = 417
const header = Buffer.from([0xff, 0xfb, 0x90, 0xc0])
const frame = (fill: number, tag = '') => { const f = Buffer.alloc(FRAME, fill); header.copy(f); if (tag) f.write(tag, 36, 'latin1'); return f }
function mp3(fill: number, frames = 3, v1 = false) {
    const id3 = Buffer.concat([Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x0a', 'latin1'), Buffer.alloc(10, 0x41)])
    const parts = [id3, frame(0, 'Info'), ...Array.from({ length: frames }, () => frame(fill))]
    if (v1) parts.push(Buffer.concat([Buffer.from('TAG', 'latin1'), Buffer.alloc(125, 0x20)]))
    return Buffer.concat(parts)
}
const audioOf = (fill: number, frames = 3) => Buffer.concat(Array.from({ length: frames }, () => frame(fill)))
const framed = (...files: Buffer[]) => Buffer.concat(files.map((f) => Buffer.concat([Buffer.from('A'), Buffer.from([f.length >>> 24, (f.length >> 16) & 255, (f.length >> 8) & 255, f.length & 255]), f])))
const UUID = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** A fake TTS server: yields the given byte pieces, one per `gap` ms, and records whether it was aborted. */
function fakeOpen(pieces: Buffer[], opts: { gap?: number; fail?: string } = {}) {
    const seen: { req: any; aborted: boolean }[] = []
    const open = async function* (req: any, signal: AbortSignal) {
        const rec = { req, aborted: false }
        seen.push(rec)
        signal.addEventListener('abort', () => { rec.aborted = true })
        if (opts.fail) throw new Error(opts.fail)
        for (const p of pieces) {
            if (opts.gap) await new Promise((r) => setTimeout(r, opts.gap))
            if (signal.aborted) return
            yield p
        }
    }
    return { open, seen }
}

const servers: http.Server[] = []
async function start(open: any, cfg: Record<string, number> = {}) {
    const streams = createTtsStreams({ open, ...cfg })
    const app = express()
    app.use(express.json())
    app.post('/s/:id', (req, res) => { const r = streams.register(req.params.id, req.body); res.status(r.status).send(r) })
    app.get('/s/:id', (req, res) => { void streams.serve(req.params.id, req, res) })
    app.delete('/s/:id', (req, res) => { res.send({ stopped: streams.stop(req.params.id) }) })
    const server = await new Promise<http.Server>((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)) })
    servers.push(server)
    const base = `http://127.0.0.1:${(server.address() as any).port}/s/`
    const post = (id: string, body: any = { model: 'kokoro', voice: 'af_heart', input: 'hi' }) =>
        fetch(base + id, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const get = (id: string, range?: string) => fetch(base + id, { headers: range ? { range } : {} })
    return { streams, post, get, base }
}
afterEach(async () => { for (const s of servers.splice(0)) { s.closeAllConnections?.(); await new Promise((r) => s.close(r)) } })

const bytes = async (r: Response) => Buffer.from(await r.arrayBuffer())

describe('stripMp3 / FrameParser', () => {
    it('removes the ID3v2 tag, the Info frame and an ID3v1 tag: only audio frames are left', () => {
        expect(stripMp3(mp3(7, 3, true)).equals(audioOf(7))).toBe(true)
    })
    it('leaves a file with nothing to strip alone', () => {
        expect(stripMp3(audioOf(9)).equals(audioOf(9))).toBe(true)
    })
    it('frames cut anywhere in the byte stream still come out whole', () => {
        const all = framed(Buffer.from('abc'), Buffer.from('defgh'))
        const p = new FrameParser(); const out: any[] = []
        for (let i = 0; i < all.length; i++) out.push(...p.push(all.subarray(i, i + 1)))
        expect(out.map((f) => f.data.toString())).toEqual(['abc', 'defgh'])
    })
})

describe('the stream', () => {
    it('joins the chunks back to back with their tags stripped, as one audio/mpeg 200', async () => {
        const fake = fakeOpen([framed(mp3(1), mp3(2), mp3(3, 2, true))])
        const t = await start(fake.open)
        expect((await t.post(UUID())).status).toBe(202)
        const r = await t.get(UUID())
        expect(r.status).toBe(200)
        expect(r.headers.get('content-type')).toBe('audio/mpeg')
        expect(r.headers.get('accept-ranges')).toBe('bytes')
        expect((await bytes(r)).equals(Buffer.concat([audioOf(1), audioOf(2), audioOf(3, 2)]))).toBe(true)
        expect(fake.seen[0].req).toEqual({ model: 'kokoro', voice: 'af_heart', input: 'hi' })
    })

    it('the GET may come before the POST: it waits for the registration', async () => {
        const t = await start(fakeOpen([framed(mp3(5))]).open)
        const early = t.get(UUID(2))
        await new Promise((r) => setTimeout(r, 60))
        await t.post(UUID(2))
        expect((await bytes(await early)).equals(audioOf(5))).toBe(true)
    })

    it('a GET nobody registers for is a 404 after waitMs, and leaves nothing behind', async () => {
        const t = await start(fakeOpen([]).open, { waitMs: 80 })
        const t0 = Date.now()
        const r = await t.get(UUID(3))
        expect(r.status).toBe(404)
        expect(Date.now() - t0).toBeGreaterThanOrEqual(70)
        expect(t.streams.size()).toBe(0)
    })

    it('a registration no GET claims within ttlMs is dropped and its synthesis aborted', async () => {
        const fake = fakeOpen([framed(mp3(1))], { gap: 500 })
        const t = await start(fake.open, { ttlMs: 80, waitMs: 60 })
        await t.post(UUID(4))
        await new Promise((r) => setTimeout(r, 200))
        expect(t.streams.has(UUID(4))).toBe(false)
        expect(fake.seen[0].aborted).toBe(true)
        expect((await t.get(UUID(4))).status).toBe(404)
    })

    it('single use: a second POST for the same id is refused, and the stream stops working lingerMs after it finished', async () => {
        const fake = fakeOpen([framed(mp3(1))])
        const t = await start(fake.open, { lingerMs: 100, waitMs: 60 })
        expect((await t.post(UUID(5))).status).toBe(202)
        expect((await t.post(UUID(5))).status).toBe(409)
        expect(fake.seen.length).toBe(1)
        expect((await bytes(await t.get(UUID(5)))).length).toBe(FRAME * 3)
        await new Promise((r) => setTimeout(r, 250))
        expect(t.streams.has(UUID(5))).toBe(false)
        expect((await t.get(UUID(5))).status).toBe(404)
    })

    it('a bad id is refused', async () => {
        const t = await start(fakeOpen([]).open)
        expect((await t.post('not-a-uuid')).status).toBe(400)
        expect((await t.get('not-a-uuid')).status).toBe(404)
    })

    it('a TTS server that fails before any audio is a 502 with its message, not an empty 200', async () => {
        const t = await start(fakeOpen([], { fail: 'model not loaded' }).open)
        await t.post(UUID(6))
        const r = await t.get(UUID(6))
        expect(r.status).toBe(502)
        expect(JSON.stringify(await r.json())).toContain('model not loaded')
    })

    it('an error frame after some audio ends the stream with what was made', async () => {
        const err = Buffer.concat([Buffer.from('E'), Buffer.from([0, 0, 0, 3]), Buffer.from('bad')])
        const t = await start(fakeOpen([Buffer.concat([framed(mp3(1)), err])]).open)
        await t.post(UUID(7))
        expect((await bytes(await t.get(UUID(7)))).equals(audioOf(1))).toBe(true)
    })

    it('stop aborts the synthesis and ends the reader', async () => {
        const fake = fakeOpen([framed(mp3(1)), framed(mp3(2)), framed(mp3(3))], { gap: 150 })
        const t = await start(fake.open)
        await t.post(UUID(8))
        const reading = t.get(UUID(8)).then(bytes)
        await new Promise((r) => setTimeout(r, 200))
        await fetch(t.base + UUID(8), { method: 'DELETE' })
        expect((await reading).length).toBeLessThan(FRAME * 9)
        expect(fake.seen[0].aborted).toBe(true)
        expect(t.streams.has(UUID(8))).toBe(false)
    })

    it('when every reader has left a stream still being made, it is dropped after idleMs', async () => {
        const fake = fakeOpen([framed(mp3(1)), framed(mp3(2))], { gap: 400 })
        const t = await start(fake.open, { idleMs: 80 })
        await t.post(UUID(9))
        const ctrl = new AbortController()
        const r = await fetch(t.base + UUID(9), { signal: ctrl.signal })
        await r.body!.getReader().read()
        ctrl.abort()
        await new Promise((r) => setTimeout(r, 250))
        expect(t.streams.has(UUID(9))).toBe(false)
        expect(fake.seen[0].aborted).toBe(true)
    })
})

describe('Range', () => {
    const all = Buffer.concat([audioOf(1), audioOf(2)])

    it('a finished stream answers any range exactly: 206, Content-Range with the length, Content-Length', async () => {
        const t = await start(fakeOpen([framed(mp3(1), mp3(2))]).open)
        await t.post(UUID(10))
        await bytes(await t.get(UUID(10)))
        const probe = await t.get(UUID(10), 'bytes=0-1')
        expect(probe.status).toBe(206)
        expect(probe.headers.get('content-range')).toBe(`bytes 0-1/${all.length}`)
        expect((await bytes(probe)).equals(all.subarray(0, 2))).toBe(true)
        const tail = await t.get(UUID(10), 'bytes=1000-')
        expect(tail.status).toBe(206)
        expect(tail.headers.get('content-range')).toBe(`bytes 1000-${all.length - 1}/${all.length}`)
        expect(tail.headers.get('content-length')).toBe(String(all.length - 1000))
        expect((await bytes(tail)).equals(all.subarray(1000))).toBe(true)
        const mid = await t.get(UUID(10), 'bytes=500-899')
        expect((await bytes(mid)).equals(all.subarray(500, 900))).toBe(true)
        const last = await t.get(UUID(10), 'bytes=-100')
        expect((await bytes(last)).equals(all.subarray(all.length - 100))).toBe(true)
    })

    it('past the end is 416 with the length', async () => {
        const t = await start(fakeOpen([framed(mp3(1), mp3(2))]).open)
        await t.post(UUID(11))
        await bytes(await t.get(UUID(11)))
        const r = await t.get(UUID(11), `bytes=${all.length + 5}-`)
        expect(r.status).toBe(416)
        expect(r.headers.get('content-range')).toBe(`bytes */${all.length}`)
    })

    it('while it is still being made: a start at 0 gets the whole growing stream as 200, a start the server has gets 206 with an unknown length', async () => {
        const t = await start(fakeOpen([framed(mp3(1)), framed(mp3(2))], { gap: 120 }).open)
        await t.post(UUID(12))
        const probe = await t.get(UUID(12), 'bytes=0-1')
        expect(probe.status).toBe(200)
        const body = await bytes(probe)
        expect(body.equals(all)).toBe(true)

        const t2 = await start(fakeOpen([framed(mp3(1)), framed(mp3(2))], { gap: 120 }).open)
        await t2.post(UUID(13))
        await new Promise((r) => setTimeout(r, 150))                    // the first chunk is in, the second not yet
        const resume = await t2.get(UUID(13), `bytes=${FRAME}-`)
        expect(resume.status).toBe(206)
        expect(resume.headers.get('content-range')).toBe(`bytes ${FRAME}-/*`)
        expect((await bytes(resume)).equals(all.subarray(FRAME))).toBe(true)
    })

    it('a range start the synthesis has not reached yet waits for it', async () => {
        const t = await start(fakeOpen([framed(mp3(1)), framed(mp3(2))], { gap: 120 }).open)
        await t.post(UUID(14))
        await new Promise((r) => setTimeout(r, 150))
        const r = await t.get(UUID(14), `bytes=${FRAME * 3 + 10}-`)
        expect(r.status).toBe(206)
        expect((await bytes(r)).equals(all.subarray(FRAME * 3 + 10))).toBe(true)
    })
})
