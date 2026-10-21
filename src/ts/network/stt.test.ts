// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import express from 'express'

const { createStt, mountStt, extFor } = createRequire(import.meta.url)('../../../server/node/stt.cjs')

// The real worker is Python + a 1.6 GB model; the protocol (JSON lines) is what the server depends on, so the tests run the real
// child-process path against a node script that speaks it. The clip's own bytes say what the fake does with it.
const WORKER = `
const rl = require('readline').createInterface({ input: process.stdin });
const fs = require('fs');
let inflight = 0;
setTimeout(() => console.log(JSON.stringify({ ready: true, model: 'fake', load_s: 0 })), Number(process.env.FAKE_LOAD_MS || 20));
rl.on('line', async (line) => {
  const req = JSON.parse(line);
  const body = fs.readFileSync(req.path, 'utf8');       // the clip must exist while it is transcribed
  inflight++;
  const seen = inflight;
  if (body === 'HANG') return;                          // never answers
  if (body === 'BAD') { inflight--; console.log(JSON.stringify({ id: req.id, ok: false, error: 'DecodeError: not audio' })); return; }
  await new Promise((r) => setTimeout(r, body.startsWith('SLOW') ? 150 : 5));
  inflight--;
  console.log(JSON.stringify({ id: req.id, ok: true, text: body + '|' + req.path.split('.').pop() + '|' + req.language + '|' + seen + '|' + process.pid, language: 'vi', seconds: 0.1, audio_s: 1, model: 'fake' }));
});
`

const dirs: string[] = []
const closers: (() => void)[] = []
function setup(opts: Record<string, any> = {}, auth = true) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stt-test-'))
    dirs.push(dir)
    const script = path.join(dir, 'fake_worker.cjs')
    fs.writeFileSync(script, WORKER)
    const stt = createStt({ python: process.execPath, script, args: [], tmpDir: path.join(dir, 'clips'), maxBytes: 1024, timeoutMs: 400, ...opts })
    const app = express()
    mountStt(app, {
        express, stt, limiter: (_q: any, _s: any, n: any) => n(),
        auth: async (req: any, res: any) => { if (!auth || req.headers['risu-auth'] === 'good') return true; res.status(400).send({ error: 'No auth header' }); return false },
    })
    const server = app.listen(0)
    const port = (server.address() as any).port
    closers.push(() => { stt.close(); server.close() })
    const post = (p: string, body: Buffer | string, headers: Record<string, string> = {}) => new Promise<{ status: number; json: any }>((resolve, reject) => {
        const req = http.request({ port, path: p, method: 'POST', headers: { 'content-length': Buffer.byteLength(body), ...headers } }, (res) => {
            let data = ''
            res.on('data', (c) => (data += c))
            res.on('end', () => { let json: any = null; try { json = JSON.parse(data) } catch { /* not json */ } resolve({ status: res.statusCode!, json }) })
        })
        req.on('error', reject)
        req.end(body)
    })
    return { stt, post, dir }
}
const AUDIO = { 'risu-auth': 'good', 'content-type': 'audio/mp4' }
afterEach(() => { while (closers.length) closers.pop()!() })

describe('POST /api/stt', () => {
    it('refuses a request with no auth, before reading the body', async () => {
        const { post, stt } = setup()
        const r = await post('/api/stt', 'hello', { 'content-type': 'audio/mp4' })
        expect(r.status).toBe(400)
        expect(stt.isRunning()).toBe(false)               // nothing was started for an unauthenticated call
    })

    it('answers the text, passes the content-type through as the clip extension and the language header on', async () => {
        const { post } = setup()
        const r = await post('/api/stt', 'xin chao', { ...AUDIO, 'x-stt-language': 'en' })
        expect(r.status).toBe(200)
        expect(r.json.text).toMatch(/^xin chao\|m4a\|en\|1\|\d+$/)
        expect(r.json.language).toBe('vi')
        const w = await post('/api/stt', 'x', { 'risu-auth': 'good', 'content-type': 'audio/webm;codecs=opus' })
        expect(w.json.text).toMatch(/^x\|webm\|auto\|/)  // an unknown or missing language means auto (vi or en)
    })

    it('removes the clip it wrote', async () => {
        const { post, dir } = setup()
        await post('/api/stt', 'xin chao', AUDIO)
        expect(fs.readdirSync(path.join(dir, 'clips'))).toEqual([])
    })

    it('refuses a body over the cap with 413, and an empty one with 400, and a non-audio type with 415', async () => {
        const { post } = setup({ maxBytes: 100 })
        expect((await post('/api/stt', 'x'.repeat(101), AUDIO)).status).toBe(413)
        expect((await post('/api/stt', '', AUDIO)).status).toBe(400)
        expect((await post('/api/stt', '{"a":1}', { 'risu-auth': 'good', 'content-type': 'application/json' })).status).toBe(415)
        expect((await post('/api/stt', 'x'.repeat(100), AUDIO)).status).toBe(200)   // exactly at the cap is fine
    })

    it('answers 504 when the worker does not answer in time, then works again on a fresh worker', async () => {
        const { post } = setup({ timeoutMs: 300 })
        const t = Date.now()
        const r = await post('/api/stt', 'HANG', AUDIO)
        expect(r.status).toBe(504)
        expect(r.json.error.code).toBe('timeout')
        expect(Date.now() - t).toBeLessThan(2500)
        const ok = await post('/api/stt', 'after', AUDIO)
        expect(ok.status).toBe(200)
        expect(ok.json.text).toMatch(/^after\|/)
    })

    it('a clip the worker cannot decode is a 500 and the worker survives it', async () => {
        const { post } = setup()
        const a = await post('/api/stt', 'first', AUDIO)
        const bad = await post('/api/stt', 'BAD', AUDIO)
        expect(bad.status).toBe(500)
        expect(bad.json.error.message).toContain('DecodeError')
        const b = await post('/api/stt', 'second', AUDIO)
        expect(b.status).toBe(200)
        const pid = (r: any) => r.json.text.split('|').pop()
        expect(pid(b)).toBe(pid(a))                        // the same worker: the model was not reloaded
    })

    it('transcribes one at a time', async () => {
        const { post } = setup({ timeoutMs: 5000 })
        const [a, b, c] = await Promise.all([post('/api/stt', 'SLOW1', AUDIO), post('/api/stt', 'SLOW2', AUDIO), post('/api/stt', 'SLOW3', AUDIO)])
        // the fake reports how many clips it held at once while it worked on this one
        for (const r of [a, b, c]) expect(r.json.text.split('|')[3]).toBe('1')
    })

    it('503 unavailable when no speech model is installed', async () => {
        const { post } = setup({ python: '/nonexistent/stt-venv/bin/python', spawn: undefined })
        const r = await post('/api/stt', 'x', AUDIO)
        expect(r.status).toBe(503)
        expect(r.json.error.code).toBe('unavailable')
    })
})

describe('worker lifetime', () => {
    it('POST /api/stt/warm loads the worker before any clip, and needs auth', async () => {
        const { post, stt } = setup()
        expect((await post('/api/stt/warm', '')).status).toBe(400)
        expect(stt.isRunning()).toBe(false)
        const r = await post('/api/stt/warm', '', { 'risu-auth': 'good' })
        expect(r.status).toBe(200)
        expect(stt.isRunning()).toBe(true)
    })

    it('is stopped after the idle time and started again by the next clip', async () => {
        const { post, stt } = setup({ idleMs: 150 })
        const a = await post('/api/stt', 'one', AUDIO)
        expect(stt.isRunning()).toBe(true)
        await new Promise((r) => setTimeout(r, 500))
        expect(stt.isRunning()).toBe(false)
        const b = await post('/api/stt', 'two', AUDIO)
        expect(b.status).toBe(200)
        expect(b.json.text.split('|').pop()).not.toBe(a.json.text.split('|').pop())
    })
})

describe('extFor', () => {
    it('maps what the browsers record to an extension the decoder recognises', () => {
        expect(extFor('audio/mp4')).toBe('m4a')
        expect(extFor('audio/webm;codecs=opus')).toBe('webm')
        expect(extFor('audio/ogg')).toBe('ogg')
        expect(extFor('application/octet-stream')).toBe('bin')
    })
})
