// @vitest-environment node
// The client half of saving stats (statsSave.ts), the server bridge (server/node/statsBridge.cjs) and the glue (process/statsGlue.ts).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

vi.mock('../storage/database.svelte', () => ({ getDatabase: vi.fn(() => ({ characters: [], personas: [] })) }))

import {
    BATCH, MAX_PENDING, drain, enqueue, fetchCurrent, mergeCurrent, parseEntries, parsePending, sendStats, validEntry, type Current, type SendResult, type StatEntry,
} from './statsSave'
import { drainPending, hasStatsRule, personaIdOf, statsAfterReply, statsBeforeRequest } from '../process/statsGlue'

const require = createRequire(import.meta.url)
const express = require('express')
const { mountStats, saveStats } = require('../../../server/node/statsBridge.cjs')

const e = (stat = 'suc_manh', value = 1001, turn = 3): StatEntry => ({ stat, value, turn, time: '2026-11-04T10:00:00Z' })
const exportOf = (...es: StatEntry[]) => JSON.stringify(es)

describe('entries', () => {
    it('accepts what the store accepts and nothing else', () => {
        expect(validEntry(e())).toBe(true)
        expect(validEntry(e('skill:stair-ear', 5))).toBe(true)
        for (const bad of [e('sức mạnh'), e('skill:'), e('suc_manh', 10001), e('suc_manh', -1), e('suc_manh', 1.5), { ...e(), time: 'yesterday' }, { ...e(), persona: 'a b' }, { ...e(), turn: -1 }, null, 'x', [e()]]) {
            expect(validEntry(bad), JSON.stringify(bad)).toBe(false)
        }
    })
    it('an export with a bad entry keeps the good ones; bad text is an empty list', () => {
        expect(parseEntries(JSON.stringify([e(), { stat: 'x' }, e('y_chi', 1500)])).map((x) => x.stat)).toEqual(['suc_manh', 'y_chi'])
        expect(parseEntries('{nope')).toEqual([])
        expect(parseEntries('{"a":1}')).toEqual([])
        expect(parseEntries('null')).toEqual([])
        expect(parseEntries(undefined)).toEqual([])
    })
})

describe('enqueue / drain', () => {
    it('stamps the persona, keeps order, caps the list', () => {
        let p = enqueue('', [e('suc_manh', 1)], 'kenji')
        p = enqueue(p, [e('suc_manh', 2), e('the_luc', 3)], 'kenji')
        expect(parsePending(p).map((x) => [x.stat, x.value, x.persona])).toEqual([['suc_manh', 1, 'kenji'], ['suc_manh', 2, 'kenji'], ['the_luc', 3, 'kenji']])
        for (let i = 0; i < MAX_PENDING + 5; i++) p = enqueue(p, [e('suc_manh', i)], 'kenji')
        const list = parsePending(p)
        expect(list.length).toBe(MAX_PENDING)
        expect(list[list.length - 1].value).toBe(MAX_PENDING + 4)
    })
    it('never queues an entry the store would refuse, or one for a persona it would refuse', () => {
        expect(parsePending(enqueue('', [e('suc_manh', 99999) as any], 'kenji'))).toEqual([])
        expect(parsePending(enqueue('', [e()], 'not valid'))).toEqual([])
    })
    it('sends in batches of 200, in order, and stops at the first batch that must retry', async () => {
        const p = enqueue('', Array.from({ length: 380 }, (_, i) => e('suc_manh', i)), 'kenji')
        const seen: number[] = []
        const r = await drain(p, async (b) => { seen.push(b.length); return seen.length === 2 ? 'queue' : 'saved' })
        expect(seen).toEqual([BATCH, 180])
        expect(r.saved).toBe(BATCH)
        expect(parsePending(r.pending).length).toBe(180)
        expect(parsePending(r.pending)[0].value).toBe(200)
    })
    it('a throwing send counts as queue; a drop (store refused) discards that batch', async () => {
        const p = enqueue('', [e('suc_manh', 1)], 'kenji')
        expect(parsePending((await drain(p, async () => { throw new Error('x') })).pending)).toHaveLength(1)
        const r = await drain(p, async () => 'drop')
        expect([r.pending, r.dropped, r.saved]).toEqual(['', 1, 0])
        expect((await drain('', async () => 'saved')).pending).toBe('')
    })
})

describe('sendStats (client)', () => {
    const fake = (status: number) => (async () => new Response('{}', { status })) as unknown as typeof fetch
    const auth = async () => 'tok'
    it('maps answers to saved / drop / queue', async () => {
        expect(await sendStats([e()], { fetch: fake(200), auth })).toBe('saved')
        expect(await sendStats([e()], { fetch: fake(400), auth })).toBe('drop')
        expect(await sendStats([e()], { fetch: fake(502), auth })).toBe('queue')
        expect(await sendStats([e()], { fetch: fake(504), auth })).toBe('queue')
        expect(await sendStats([e()], { fetch: (async () => { throw new Error('offline') }) as any, auth })).toBe('queue')
        expect(await sendStats([e()], { fetch: fake(200), auth: async () => { throw new Error('no token') } })).toBe('queue')
    })
    it('posts {entries} to /api/stats with risu-auth', async () => {
        const calls: any[] = []
        await sendStats([e()], { auth, fetch: (async (u: string, o: any) => { calls.push([u, o]); return new Response('{}', { status: 200 }) }) as any })
        expect(calls[0][0]).toBe('/api/stats')
        expect(calls[0][1].headers['risu-auth']).toBe('tok')
        expect(JSON.parse(calls[0][1].body).entries[0].stat).toBe('suc_manh')
    })
})

describe('mergeCurrent (the persona starts the chat where it is)', () => {
    const cur: Current = { stats: { suc_manh: 2500, y_chi: 1500 }, skills: { 'stair-ear': 600, 'old-trick': 100 } }
    it('takes the larger value per stat, the other stats start at 10.00%', () => {
        const m = mergeCurrent(undefined, cur)!
        expect(JSON.parse(m.$stats)).toEqual({ suc_manh: 2500, nhanh_nhen: 1000, the_luc: 1000, tinh_than: 1000, cam_nhan: 1000, y_chi: 1500 })
        const higher = mergeCurrent({ $stats: JSON.stringify({ suc_manh: 3000, y_chi: 1200 }) }, cur)!
        expect(JSON.parse(higher.$stats).suc_manh).toBe(3000)
        expect(JSON.parse(higher.$stats).y_chi).toBe(1500)
    })
    it('a stored skill joins unequipped; a chat skill keeps link, name and slot and takes the larger mastery', () => {
        const chat = { $skills: JSON.stringify({ 'stair-ear': { m: 200, eq: 1, link: ['cam_nhan'], name: 'Tai thính' }, 'old-trick': { m: 900, eq: 0 } }) }
        const m = JSON.parse(mergeCurrent(chat, cur)!.$skills)
        expect(m['stair-ear']).toEqual({ m: 600, eq: 1, link: ['cam_nhan'], name: 'Tai thính' })
        expect(m['old-trick'].m).toBe(900)
        expect(JSON.parse(mergeCurrent(undefined, cur)!.$skills)['stair-ear']).toEqual({ m: 600, eq: 0 })
    })
    it('does nothing when the store is unreachable, empty, or behind the chat', () => {
        expect(mergeCurrent({}, null)).toBeNull()
        expect(mergeCurrent({}, { stats: {}, skills: {} })).toBeNull()
        expect(mergeCurrent({ $stats: JSON.stringify({ suc_manh: 9000, y_chi: 9000 }) }, { stats: cur.stats, skills: {} })).toBeNull()
    })
    it('bad stored text in the chat is treated as empty, never a crash', () => {
        expect(JSON.parse(mergeCurrent({ $stats: '{nope', $skills: 'x' }, cur)!.$stats).suc_manh).toBe(2500)
    })
})

describe('fetchCurrent', () => {
    const auth = async () => 'tok'
    const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
    it('reads /api/assets/stats?persona= and keeps only sane values', async () => {
        const urls: string[] = []
        const r = await fetchCurrent('kenji', { auth, fetch: (async (u: string) => { urls.push(u); return new Response(JSON.stringify({ stats: { suc_manh: 1234, bad: 'x' }, skills: { a: 5 } }), { status: 200 }) }) as any })
        expect(urls[0]).toBe('/api/assets/stats?persona=kenji')
        expect(r).toEqual({ stats: { suc_manh: 1234 }, skills: { a: 5 } })
    })
    it('null on any trouble, and no request for a persona the store would refuse', async () => {
        expect(await fetchCurrent('kenji', { auth, fetch: reply(502, {}) })).toBeNull()
        expect(await fetchCurrent('kenji', { auth, fetch: reply(200, { nope: 1 }) })).toBeNull()
        expect(await fetchCurrent('kenji', { auth, fetch: (async () => { throw new Error('x') }) as any })).toBeNull()
        const f = vi.fn()
        expect(await fetchCurrent('a b', { auth, fetch: f as any })).toBeNull()
        expect(f).not.toHaveBeenCalled()
    })
})

describe('glue', () => {
    const chatWith = (vars: Record<string, string>) => ({ scriptstate: { ...vars } })
    it('personaIdOf: its id, else its name without accents, else default', () => {
        expect(personaIdOf({ id: 'abc-123', name: 'x' })).toBe('abc-123')
        expect(personaIdOf({ name: 'Kenji Đặng' })).toBe('Kenji-dang')
        expect(personaIdOf(undefined)).toBe('default')
        expect(personaIdOf({ id: '', name: '' })).toBe('default')
        expect(personaIdOf({ name: 'x'.repeat(100) })).toHaveLength(64)
    })
    it('only a card whose description teaches the tag takes part', () => {
        expect(hasStatsRule({ desc: 'rules [[ACT|a|suc_manh|normal|]]' })).toBe(true)
        expect(hasStatsRule({ desc: 'no tag' })).toBe(false)
        expect(hasStatsRule({ desc: '[[ACT|', type: 'group' })).toBe(false)
        expect(hasStatsRule(undefined)).toBe(false)
    })
    it('after a reply: the export is stamped, sent, and the export is cleared', async () => {
        const chat = chatWith({ $stat_export: exportOf(e('suc_manh', 1001), e('skill:stair-ear', 1)) })
        const sent: StatEntry[][] = []
        await statsAfterReply(chat, { persona: () => 'kenji', send: async (b) => { sent.push(b); return 'saved' } })
        expect(sent).toHaveLength(1)
        expect(sent[0].map((x) => [x.stat, x.persona])).toEqual([['suc_manh', 'kenji'], ['skill:stair-ear', 'kenji']])
        expect(chat.scriptstate.$stat_export).toBe('')
        expect(chat.scriptstate.$stat_pending).toBe('')
    })
    it('when the server is down the entries wait on the chat; the next turn sends them first, in order', async () => {
        const chat = chatWith({ $stat_export: exportOf(e('suc_manh', 1001, 3)) })
        await statsAfterReply(chat, { persona: () => 'kenji', send: async () => 'queue' })
        expect(parsePending(chat.scriptstate.$stat_pending).map((x) => x.value)).toEqual([1001])
        chat.scriptstate.$stat_export = exportOf(e('suc_manh', 1002, 4))
        const sent: number[] = []
        await statsAfterReply(chat, { persona: () => 'kenji', send: async (b) => { sent.push(...b.map((x) => x.value)); return 'saved' } })
        expect(sent).toEqual([1001, 1002])
        expect(chat.scriptstate.$stat_pending).toBe('')
    })
    it('a send that throws never throws out of the glue, and a reply with no export sends nothing', async () => {
        const chat = chatWith({ $stat_export: exportOf(e()) })
        await expect(statsAfterReply(chat, { persona: () => 'kenji', send: async () => { throw new Error('x') } })).resolves.toBeUndefined()
        const none = chatWith({})
        const send = vi.fn(async (): Promise<SendResult> => 'saved')
        await statsAfterReply(none, { persona: () => 'kenji', send })
        expect(send).not.toHaveBeenCalled()
    })
    it('drainPending keeps what was queued while it ran', async () => {
        const chat = chatWith({ $stat_pending: enqueue('', [e('suc_manh', 1)], 'kenji') })
        await drainPending(chat, async () => { chat.scriptstate.$stat_pending = enqueue(chat.scriptstate.$stat_pending, [e('suc_manh', 2)], 'kenji'); return 'saved' })
        expect(parsePending(chat.scriptstate.$stat_pending).map((x) => x.value)).toEqual([2])
    })
    it('before a request: retries the queue, then the chat takes the persona\'s stored values', async () => {
        const chat = chatWith({ $stat_pending: enqueue('', [e('suc_manh', 1)], 'kenji') })
        const order: string[] = []
        await statsBeforeRequest(chat, {
            persona: () => 'kenji',
            send: async () => { order.push('send'); return 'saved' },
            current: async (p) => { order.push('load:' + p); return { stats: { suc_manh: 4000 }, skills: { 'stair-ear': 300 } } },
        })
        expect(order).toEqual(['send', 'load:kenji'])
        expect(JSON.parse(chat.scriptstate.$stats).suc_manh).toBe(4000)
        expect(JSON.parse(chat.scriptstate.$skills)['stair-ear']).toEqual({ m: 300, eq: 0 })
    })
    it('a store that never answers holds the request for the wait limit only, and a failing one changes nothing', async () => {
        const chat = chatWith({})
        const t = Date.now()
        await statsBeforeRequest(chat, { persona: () => 'kenji', send: async () => 'saved', current: () => new Promise(() => {}) }, 80)
        expect(Date.now() - t).toBeLessThan(1500)
        expect(chat.scriptstate.$stats).toBeUndefined()
        await statsBeforeRequest(chat, { persona: () => 'kenji', send: async () => 'saved', current: async () => { throw new Error('x') } })
        expect(chat.scriptstate.$stats).toBeUndefined()
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
    mountStats(app, { auth, limiter: (_q: any, _r: any, n: any) => n(), target, timeoutMs, log: (m: string) => logs.push(m) })
    const port = await listen(http.createServer(app))
    const post = (body: unknown, token = 'good') => fetch(`http://127.0.0.1:${port}/api/stats`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'risu-auth': token } : {}) }, body: JSON.stringify(body),
    })
    return { post, logs, seen }
}
const appended = (n: number): http.RequestListener => (_q, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ appended: n })) }

describe('POST /api/stats (bridge)', () => {
    it('forwards the entries as {entries} and returns {appended}', async () => {
        const b = await bridge(appended(2))
        const r = await b.post([{ ...e(), persona: 'kenji' }, e('y_chi', 1500)])
        expect(r.status).toBe(200)
        expect(await r.json()).toEqual({ appended: 2 })
        expect(JSON.parse(b.seen[0]).entries).toHaveLength(2)
        expect(JSON.parse(b.seen[0]).entries[0].persona).toBe('kenji')
        expect((await (await bridge(appended(1))).post({ entries: [e()] })).status).toBe(200)
    })
    it('needs risu-auth (a phone has none) and forwards nothing without it', async () => {
        const b = await bridge(appended(1))
        expect((await b.post([e()], '')).status).toBe(400)
        expect((await b.post([e()], 'bad')).status).toBe(400)
        expect(b.seen.length).toBe(0)
    })
    it('a refusal is 400, a dead asset manager is 502, a 500 is 502', async () => {
        const refuse = await bridge((_q, res) => { res.statusCode = 400; res.end(JSON.stringify({ error: 'value: out of range' })) })
        const r = await refuse.post([e()])
        expect(r.status).toBe(400)
        expect((await r.json()).error).toBe('value: out of range')
        expect((await (await bridge(null)).post([e()])).status).toBe(502)
        expect((await (await bridge((_q, res) => { res.statusCode = 500; res.end('boom') })).post([e()])).status).toBe(502)
    })
    it('gives up after the timeout with 504', async () => {
        const b = await bridge(() => { /* never answers */ }, 150)
        const t = Date.now()
        expect((await b.post([e()])).status).toBe(504)
        expect(Date.now() - t).toBeLessThan(2000)
    })
    it('a body that is not a list of 1..200 objects is 400 and goes nowhere', async () => {
        const b = await bridge(appended(1))
        for (const bad of [{}, [], 'x', [1, 2], { entries: [] }, Array.from({ length: 201 }, () => e())]) expect((await b.post(bad)).status).toBe(400)
        expect((await saveStats(null)).status).toBe(400)
        expect(b.seen.length).toBe(0)
    })
    it('logs counts, never the values', async () => {
        const b = await bridge(appended(1))
        await b.post([{ ...e('suc_manh', 4242), persona: 'SECRET-PERSONA' }])
        const dead = await bridge(null)
        await dead.post([{ ...e('suc_manh', 4242), persona: 'SECRET-PERSONA' }])
        const all = [...b.logs, ...dead.logs].join('\n')
        expect(all).toMatch(/\[Stats\]/)
        expect(all).not.toMatch(/SECRET|4242/)
    })
})
