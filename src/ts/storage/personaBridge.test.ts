// @vitest-environment node
// The server bridge for the persona's skill/item storage (server/node/personaBridge.cjs): auth on every route, body whitelist, status mapping.
import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

const require = createRequire(import.meta.url)
const express = require('express')
const { mountPersona, postPersona, getPersona, personaBodyOf, postEventsTurn, getPersonaState } = require('../../../server/node/personaBridge.cjs')

const servers: http.Server[] = []
const listen = (s: http.Server) => new Promise<number>((r) => { servers.push(s); s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)) })
afterEach(() => { for (const s of servers.splice(0)) s.close() })

type Seen = { method?: string; url?: string; body: string }
async function bridge(handler: http.RequestListener | null, timeoutMs = 3000) {
    const logs: string[] = []
    const seen: Seen[] = []
    let target = 'http://127.0.0.1:9'
    if (handler) {
        const port = await listen(http.createServer((req, res) => {
            let b = ''
            req.on('data', (c) => { b += c })
            req.on('end', () => { seen.push({ method: req.method, url: req.url, body: b }); handler(req, res) })
        }))
        target = `http://127.0.0.1:${port}`
    }
    const app = express()
    app.use(express.json())
    const auth = async (req: any, res: any) => { if (req.headers['risu-auth'] === 'good') return true; res.status(400).send({ error: 'No auth header' }); return false }
    mountPersona(app, { auth, limiter: (_q: any, _r: any, n: any) => n(), target, timeoutMs, log: (m: string) => logs.push(m) })
    const port = await listen(http.createServer(app))
    const base = `http://127.0.0.1:${port}/api/persona`
    const hdr = (token: string) => ({ 'content-type': 'application/json', ...(token ? { 'risu-auth': token } : {}) })
    const post = (route: string, body: unknown, token = 'good') => fetch(`${base}/${route}`, { method: 'POST', headers: hdr(token), body: JSON.stringify(body) })
    const get = (qs: string, token = 'good') => fetch(`${base}${qs}`, { headers: hdr(token) })
    return { post, get, logs, seen, root: `http://127.0.0.1:${port}`, hdr }
}
const json = (obj: unknown, status = 200): http.RequestListener => (_q, res) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)) }
const skill = { id: 's1', name: 'Skill 1', tier: 'gold', mastery: 100, source: 'drop' }

describe('GET /api/persona (bridge)', () => {
    it('forwards only persona and level and returns the view', async () => {
        const b = await bridge(json({ rank: 1, slots_open: 2, skills: [] }))
        const r = await b.get('?persona=kenji&level=12&evil=1&path=../x')
        expect(r.status).toBe(200)
        expect(await r.json()).toEqual({ rank: 1, slots_open: 2, skills: [] })
        expect(b.seen[0].method).toBe('GET')
        expect(b.seen[0].url).toBe('/api/persona?persona=kenji&level=12')
    })
    it('needs risu-auth too, and forwards nothing without it', async () => {
        const b = await bridge(json({}))
        expect((await b.get('?persona=kenji&level=1', '')).status).toBe(400)
        expect((await b.get('?persona=kenji&level=1', 'bad')).status).toBe(400)
        expect(b.seen.length).toBe(0)
    })
    it('an array query value is not forwarded (only text goes on)', async () => {
        const b = await bridge(json({}))
        await b.get('?persona=a&persona=b&level=1')
        expect(b.seen[0].url).toBe('/api/persona?level=1')
    })
})

describe('POST /api/persona/* (bridge)', () => {
    it('every write route needs risu-auth', async () => {
        const b = await bridge(json({ ok: true }))
        for (const route of ['loot', 'loot/turn', 'delete', 'equip', 'unequip']) {
            expect((await b.post(route, { persona: 'k' }, '')).status, route).toBe(400)
            expect((await b.post(route, { persona: 'k' }, 'bad')).status, route).toBe(400)
        }
        expect(b.seen.length).toBe(0)
    })
    it('forwards the whitelisted fields to the same route and returns the store answer', async () => {
        const b = await bridge(json({ ok: true, added: 'new', entry: skill }))
        const r = await b.post('loot', { persona: 'kenji', kind: 'skill', entry: skill, level: 5, admin: true, __proto__x: 1 })
        expect(r.status).toBe(200)
        expect((await r.json()).added).toBe('new')
        expect(b.seen[0].url).toBe('/api/persona/loot')
        expect(JSON.parse(b.seen[0].body)).toEqual({ persona: 'kenji', kind: 'skill', entry: skill, level: 5 })
    })
    it('each route keeps only its own fields', async () => {
        const b = await bridge(json({ ok: true }))
        await b.post('delete', { persona: 'k', kind: 'item', id: 'i1', level: 3, slot: 2, skillId: 'x' })
        await b.post('equip', { persona: 'k', slot: 2, skillId: 'x', level: 3, id: 'y', kind: 'skill' })
        await b.post('unequip', { persona: 'k', slot: 2, level: 3, skillId: 'x' })
        expect(b.seen.map((s) => [s.url, Object.keys(JSON.parse(s.body)).sort()])).toEqual([
            ['/api/persona/delete', ['id', 'kind', 'level', 'persona']],
            ['/api/persona/equip', ['level', 'persona', 'skillId', 'slot']],
            ['/api/persona/unequip', ['level', 'persona', 'slot']],
        ])
    })
    it('loot/turn forwards {persona, chat, turn, loots, level} only, to the same route', async () => {
        const b = await bridge(json({ ok: true, written: true, results: [{ idx: 0, ok: true, added: 'new' }] }))
        const r = await b.post('loot/turn', { persona: 'k', chat: 'c1', turn: 6, loots: [{ kind: 'skill', entry: skill }], level: 2, kind: 'x', entry: skill, admin: 1 })
        expect(r.status).toBe(200)
        expect((await r.json()).results[0].added).toBe('new')
        expect(b.seen[0].url).toBe('/api/persona/loot/turn')
        expect(JSON.parse(b.seen[0].body)).toEqual({ persona: 'k', chat: 'c1', turn: 6, loots: [{ kind: 'skill', entry: skill }], level: 2 })
    })
    it('a rule failure (ok:false) is passed through as 200', async () => {
        const b = await bridge(json({ ok: false, reason: 'full', max_storage: 105, count: 105 }))
        const r = await b.post('loot', { persona: 'k', kind: 'skill', entry: skill, level: 1 })
        expect([r.status, (await r.json()).reason]).toEqual([200, 'full'])
        expect(b.logs.join('\n')).toContain('refused: full')
    })
    it('a refusal is 400 with the message, a dead asset manager is 502, a 500 is 502', async () => {
        const refuse = await bridge(json({ error: 'slot: 99 is outside 0..10' }, 400))
        const r = await refuse.post('equip', { persona: 'k', slot: 99, skillId: 'x', level: 1 })
        expect([r.status, (await r.json()).error]).toEqual([400, 'slot: 99 is outside 0..10'])
        expect((await (await bridge(null)).post('unequip', { persona: 'k', slot: 0 })).status).toBe(502)
        expect((await (await bridge(json({ error: 'boom' }, 500))).get('?persona=k&level=1')).status).toBe(502)
    })
    it('gives up after the timeout with 504', async () => {
        const b = await bridge(() => { /* never answers */ }, 150)
        const t = Date.now()
        expect((await b.post('loot', { persona: 'k' })).status).toBe(504)
        expect(Date.now() - t).toBeLessThan(2000)
    })
    it('a body that is not an object is 400 and goes nowhere', async () => {
        const b = await bridge(json({ ok: true }))
        for (const bad of [[], 'x', 5, null]) expect((await b.post('loot', bad)).status).toBe(400)
        expect((await postPersona('wipe', {})).status).toBe(400)
        expect((await postPersona('loot', null)).status).toBe(400)
        expect(personaBodyOf('loot', [1])).toBeNull()
        expect(b.seen.length).toBe(0)
    })
    it('logs the route and the outcome, never ids or values', async () => {
        const b = await bridge(json({ ok: true }))
        await b.post('loot', { persona: 'secret-persona', kind: 'skill', entry: { ...skill, name: 'Secret Name' }, level: 1 })
        const log = b.logs.join('\n')
        expect(log).toContain('[Persona] loot ok')
        expect(log).not.toMatch(/secret|Secret/i)
    })
    it('the direct helpers never throw on a dead target', async () => {
        const o = { target: 'http://127.0.0.1:9', timeoutMs: 300 }
        expect((await getPersona({ persona: 'k', level: '1' }, o)).status).toBe(502)
        expect((await postPersona('loot', { persona: 'k' }, o)).status).toBe(502)
    })
})

// The persona's EVENT LEDGER (event_ledger.py): GET /api/persona/state (the fold) and POST /api/events/turn (a turn's events replace the old ones)
describe('the event ledger routes (bridge)', () => {
    const turnBody = { persona: 'kenji', chat: 'c-1', turn: 7, events: [{ kind: 'train', idx: 1, level: 12, stats: { suc_manh: 12 } }], base: { lvl: { l: 1, e: 0 }, stats: {} } }
    it('POST /api/events/turn forwards only its fields to the same route and returns the store answer', async () => {
        const b = await bridge(json({ ok: true, written: 2, state: { level: 1, exp: 12 } }))
        const r = await fetch(`${b.root}/api/events/turn`, { method: 'POST', headers: b.hdr('good'), body: JSON.stringify({ ...turnBody, admin: 1, level: 99 }) })
        expect(r.status).toBe(200)
        expect((await r.json()).state.exp).toBe(12)
        expect(b.seen[0].url).toBe('/api/events/turn')
        expect(JSON.parse(b.seen[0].body)).toEqual(turnBody)
        expect(b.logs.join('\n')).toContain('[Persona] events ok')
    })
    it('GET /api/persona/state forwards only the persona (not routed to GET /api/persona)', async () => {
        const b = await bridge(json({ persona: 'kenji', level: 3, event_count: 4 }))
        const r = await fetch(`${b.root}/api/persona/state?persona=kenji&level=9&x=1`, { headers: b.hdr('good') })
        expect([r.status, (await r.json()).level]).toEqual([200, 3])
        expect(b.seen[0].url).toBe('/api/persona/state?persona=kenji')
    })
    it('both need risu-auth and forward nothing without it', async () => {
        const b = await bridge(json({ ok: true }))
        for (const token of ['', 'bad']) {
            expect((await fetch(`${b.root}/api/events/turn`, { method: 'POST', headers: b.hdr(token), body: JSON.stringify(turnBody) })).status).toBe(400)
            expect((await fetch(`${b.root}/api/persona/state?persona=kenji`, { headers: b.hdr(token) })).status).toBe(400)
        }
        expect(b.seen.length).toBe(0)
    })
    it('a refusal is 400 with the message; a dead or failing store is 502; a corrupt ledger (500) is 502', async () => {
        const refuse = await bridge(json({ error: "kind: must be one of ('train', 'kill', 'mission', 'act')" }, 400))
        const r = await fetch(`${refuse.root}/api/events/turn`, { method: 'POST', headers: refuse.hdr('good'), body: JSON.stringify(turnBody) })
        expect([r.status, (await r.json()).error]).toEqual([400, "kind: must be one of ('train', 'kill', 'mission', 'act')"])
        const corrupt = await bridge(json({ error: 'line 3: bad' }, 500))
        expect((await fetch(`${corrupt.root}/api/persona/state?persona=k`, { headers: corrupt.hdr('good') })).status).toBe(502)
        const o = { target: 'http://127.0.0.1:9', timeoutMs: 300 }
        expect((await postEventsTurn(turnBody, o)).status).toBe(502)
        expect((await getPersonaState({ persona: 'k' }, o)).status).toBe(502)
    })
    it('a body that is not an object is 400 and goes nowhere', async () => {
        const b = await bridge(json({ ok: true }))
        for (const bad of [[], 'x', 5, null]) expect((await postEventsTurn(bad, { target: b.root })).status).toBe(400)
        expect(b.seen.length).toBe(0)
    })
})
