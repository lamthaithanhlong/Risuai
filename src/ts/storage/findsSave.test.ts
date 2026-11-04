// @vitest-environment node
// The client half of saving a find (findsSave.ts) and the server bridge (server/node/findsBridge.cjs).
import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { drain, enqueue, parsePending, saveFind, MAX_PENDING, type FindRecord } from './findsSave'

const require = createRequire(import.meta.url)
const express = require('express')
const { mountFinds, saveFind: bridgeSave } = require('../../../server/node/findsBridge.cjs')

const rec = (id: string): FindRecord => ({
    id, kind: 'skill', name: { vi: 'Mắt đêm', en: id }, source: { card: 'zombie', chapter: 'Ngày 2' },
    effect: 'See in the dark.', rarity: 'rare', conditions: 'Costs sleep.', portable: true,
})

describe('enqueue / drain', () => {
    it('adds in order, never twice, caps the list', () => {
        let p = enqueue('', rec('a'))
        p = enqueue(p, rec('b'))
        p = enqueue(p, rec('a'))
        expect(parsePending(p).map((r) => r.id)).toEqual(['a', 'b'])
        for (let i = 0; i < MAX_PENDING + 5; i++) p = enqueue(p, rec('x' + i))
        const ids = parsePending(p).map((r) => r.id)
        expect(ids.length).toBe(MAX_PENDING)
        expect(ids[ids.length - 1]).toBe('x' + (MAX_PENDING + 4))
    })
    it('bad stored text is an empty queue, not a crash', () => {
        expect(parsePending('{nope')).toEqual([])
        expect(parsePending('{"a":1}')).toEqual([])
        expect(parsePending(null)).toEqual([])
    })
    it('keeps what must retry, in order, and reports the rest', async () => {
        const p = ['a', 'b', 'c', 'd', 'e'].reduce((t, id) => enqueue(t, rec(id)), '')
        const answers: Record<string, 'saved' | 'known' | 'queue' | 'drop' | 'throw'> = { a: 'saved', b: 'queue', c: 'known', d: 'throw', e: 'drop' }
        const r = await drain(p, async (f) => { if (answers[f.id] === 'throw') throw new Error('x'); return answers[f.id] as any })
        expect(parsePending(r.pending).map((x) => x.id)).toEqual(['b', 'd'])
        expect([r.saved, r.known, r.dropped]).toEqual([['a'], ['c'], ['e']])
        expect((await drain('', async () => 'saved')).pending).toBe('')
    })
})

const servers: http.Server[] = []
const listen = (s: http.Server) => new Promise<number>((r) => { servers.push(s); s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)) })
afterEach(() => { for (const s of servers.splice(0)) s.close() })

async function bridge(handler: http.RequestListener | null, timeoutMs = 3000) {
    const logs: string[] = []
    const seen: string[] = []
    let target = 'http://127.0.0.1:9'
    if (handler) {
        const port = await listen(http.createServer((req, res) => {
            let b = ''
            req.on('data', (c) => { b += c })
            req.on('end', () => { seen.push(b); handler(req, res) })
        }))
        target = `http://127.0.0.1:${port}`
    }
    const app = express()
    app.use(express.json())
    const auth = async (req: any, res: any) => { if (req.headers['risu-auth'] === 'good') return true; res.status(400).send({ error: 'No auth header' }); return false }
    mountFinds(app, { auth, limiter: (_q: any, _r: any, n: any) => n(), target, timeoutMs, log: (m: string) => logs.push(m) })
    const port = await listen(http.createServer(app))
    const post = (body: unknown, token = 'good') => fetch(`http://127.0.0.1:${port}/api/finds`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'risu-auth': token } : {}) }, body: JSON.stringify(body),
    })
    return { post, logs, seen, port }
}
const ok = (created: boolean): http.RequestListener => (_q, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ created, record: { ...rec('r'), found_at: 't', fingerprint: 'f' } })) }

describe('POST /api/finds (bridge)', () => {
    it('forwards the record without the page stamps and returns {created, record}', async () => {
        const b = await bridge(ok(true))
        const r = await b.post({ ...rec('r'), found_at: 'fake', fingerprint: 'fake' })
        expect(r.status).toBe(200)
        const j = await r.json()
        expect(j.created).toBe(true)
        expect(j.record.id).toBe('r')
        const sent = JSON.parse(b.seen[0])
        expect(sent.found_at).toBeUndefined()
        expect(sent.fingerprint).toBeUndefined()
        expect(sent.effect).toBe('See in the dark.')
    })
    it('needs risu-auth (a phone has none) and forwards nothing without it', async () => {
        const b = await bridge(ok(true))
        expect((await b.post(rec('r'), '')).status).toBe(400)
        expect((await b.post(rec('r'), 'bad')).status).toBe(400)
        expect(b.seen.length).toBe(0)
    })
    it('a refusal is 400, a dead asset manager is 502, a 500 is 502', async () => {
        const refuse = await bridge((_q, res) => { res.statusCode = 400; res.end(JSON.stringify({ error: 'effect is empty' })) })
        const r = await refuse.post(rec('r'))
        expect(r.status).toBe(400)
        expect((await r.json()).error).toBe('effect is empty')
        expect((await (await bridge(null)).post(rec('r'))).status).toBe(502)
        expect((await (await bridge((_q, res) => { res.statusCode = 500; res.end('boom') })).post(rec('r'))).status).toBe(502)
    })
    it('gives up after the timeout with 504', async () => {
        const b = await bridge(() => { /* never answers */ }, 150)
        const t = Date.now()
        expect((await b.post(rec('r'))).status).toBe(504)
        expect(Date.now() - t).toBeLessThan(2000)
    })
    it('never logs the text of a find, only its id', async () => {
        const b = await bridge(ok(true))
        await b.post({ ...rec('night-eyes'), effect: 'SECRET-EFFECT-TEXT', conditions: 'SECRET-COND' })
        const dead = await bridge(null)
        await dead.post({ ...rec('night-eyes'), effect: 'SECRET-EFFECT-TEXT' })
        const all = [...b.logs, ...dead.logs].join('\n')
        expect(all).toContain('night-eyes')
        expect(all).not.toMatch(/SECRET/)
        expect(all).not.toContain('See in the dark')
    })
    it('a body that is not an object is 400', async () => {
        const b = await bridge(ok(true))
        expect((await b.post([1, 2])).status).toBe(400)
        expect((await bridgeSave(null)).status).toBe(400)
    })
})

describe('saveFind (client)', () => {
    const fake = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
    const auth = async () => 'tok'
    it('maps answers to saved / known / drop / queue', async () => {
        expect(await saveFind(rec('a'), { fetch: fake(200, { created: true, record: {} }), auth })).toBe('saved')
        expect(await saveFind(rec('a'), { fetch: fake(200, { created: false, record: {} }), auth })).toBe('known')
        expect(await saveFind(rec('a'), { fetch: fake(400, { error: 'x' }), auth })).toBe('drop')
        expect(await saveFind(rec('a'), { fetch: fake(502, {}), auth })).toBe('queue')
        expect(await saveFind(rec('a'), { fetch: fake(504, {}), auth })).toBe('queue')
        expect(await saveFind(rec('a'), { fetch: (async () => { throw new Error('net') }) as any, auth })).toBe('queue')
        expect(await saveFind(rec('a'), { fetch: fake(200, {}), auth: async () => { throw new Error('no auth') } })).toBe('queue')
    })
    it('posts to /api/finds with the token and the record', async () => {
        let got: any
        const f = (async (url: string, init: any) => { got = { url, init }; return new Response('{"created":true,"record":{}}') }) as unknown as typeof fetch
        await saveFind(rec('a'), { fetch: f, auth })
        expect(got.url).toBe('/api/finds')
        expect(got.init.method).toBe('POST')
        expect(got.init.headers['risu-auth']).toBe('tok')
        expect(JSON.parse(got.init.body).id).toBe('a')
    })
})
