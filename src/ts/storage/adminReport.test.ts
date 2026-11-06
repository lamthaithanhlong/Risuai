// @vitest-environment node
// What the Admin module exported for the Game Master ($admin_report) reaches the asset manager once: the page side (storage/adminReport.ts) and the
// server bridge (server/node/adminReportBridge.cjs).
import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { ADMIN_REPORT_KEY, reportAfterReply, reportOf, sendReport } from './adminReport'

const require = createRequire(import.meta.url)
const express = require('express')
const { mountAdminReport, saveReport, reportOf: bridgeReportOf } = require('../../../server/node/adminReportBridge.cjs')

const RAW = JSON.stringify({ turn: 12, kind: 'loop', text: 'loop: 3 replies, high n-gram overlap' })
const ctx = { card: 'cha-abc123', chat: 'chat-1' }

describe('reportOf', () => {
    it('adds the card and the chat and keeps only the report', () => {
        expect(reportOf(RAW, ctx)).toEqual({ ...ctx, turn: 12, kind: 'loop', text: 'loop: 3 replies, high n-gram overlap' })
        expect(reportOf(JSON.stringify({ turn: 1, kind: 'bug', text: 'x'.repeat(400), extra: 'the chat text' }), ctx)!.text).toHaveLength(160)
        expect(Object.keys(reportOf(JSON.stringify({ turn: 1, kind: 'bug', text: 'a', extra: 'zzz' }), ctx)!).sort()).toEqual(['card', 'chat', 'kind', 'text', 'turn'])
    })
    it('refuses what the store would refuse', () => {
        for (const bad of ['', 'nope', '[]', JSON.stringify({ turn: 1, kind: 'x', text: 'a' }), JSON.stringify({ turn: 1.5, kind: 'bug', text: 'a' }), JSON.stringify({ turn: 1, kind: 'bug', text: '  ' }), JSON.stringify({ kind: 'bug', text: 'a' })])
            expect(reportOf(bad, ctx)).toBeNull()
        expect(reportOf(RAW, { card: '', chat: 'c' })).toBeNull()
        expect(reportOf(RAW, { card: 'x', chat: 'bad chat' })).toBeNull()
    })
})

describe('reportAfterReply', () => {
    const chat = (raw = RAW) => ({ id: 'chat-1', scriptstate: { [ADMIN_REPORT_KEY]: raw } as Record<string, unknown> })
    it('posts once and clears the variable', async () => {
        const c = chat(); const seen: unknown[] = []
        await reportAfterReply(c, 'cha-abc123', async (b) => { seen.push(b); return 'saved' })
        await reportAfterReply(c, 'cha-abc123', async (b) => { seen.push(b); return 'saved' })
        expect(seen).toHaveLength(1)
        expect(c.scriptstate[ADMIN_REPORT_KEY]).toBe('')
    })
    it('a down store keeps it for the next reply; a refusal or a malformed one clears it', async () => {
        const c = chat()
        await reportAfterReply(c, 'cha-abc123', async () => 'queue')
        expect(c.scriptstate[ADMIN_REPORT_KEY]).toBe(RAW)
        await reportAfterReply(c, 'cha-abc123', async () => 'drop')
        expect(c.scriptstate[ADMIN_REPORT_KEY]).toBe('')
        const bad = chat('garbage'); let called = false
        await reportAfterReply(bad, 'cha-abc123', async () => { called = true; return 'saved' })
        expect(called).toBe(false); expect(bad.scriptstate[ADMIN_REPORT_KEY]).toBe('')
    })
    it('does nothing without a card id, without the variable, and never throws', async () => {
        let n = 0
        const send = async () => { n++; return 'saved' as const }
        await reportAfterReply(chat(), '', send)
        await reportAfterReply({ id: 'c', scriptstate: {} }, 'x', send)
        await reportAfterReply(undefined, 'x', send)
        await reportAfterReply(chat(), 'x', async () => { throw new Error('boom') })
        expect(n).toBe(0)
    })
})

describe('sendReport', () => {
    const body = reportOf(RAW, ctx)!
    const reply = (status: number) => (async () => ({ status, json: async () => ({}) })) as unknown as typeof fetch
    it('posts with the auth header and maps the status', async () => {
        let seen: { url: string, init: RequestInit } | null = null
        const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return { status: 200 } }) as unknown as typeof fetch
        expect(await sendReport(body, { fetch: f, auth: async () => 'tok' })).toBe('saved')
        expect(seen!.url).toBe('/api/admin/report')
        expect((seen!.init.headers as Record<string, string>)['risu-auth']).toBe('tok')
        expect(JSON.parse(String(seen!.init.body))).toEqual(body)
        expect(await sendReport(body, { fetch: reply(400), auth: async () => 't' })).toBe('drop')
        expect(await sendReport(body, { fetch: reply(502), auth: async () => 't' })).toBe('queue')
        expect(await sendReport(body, { fetch: (async () => { throw new Error('x') }) as never, auth: async () => 't' })).toBe('queue')
        expect(await sendReport(body, { fetch: reply(200), auth: async () => { throw new Error('no token') } })).toBe('queue')
    })
})

const servers: http.Server[] = []
const listen = (s: http.Server) => new Promise<number>((r) => { servers.push(s); s.listen(0, '127.0.0.1', () => r((s.address() as AddressInfo).port)) })
afterEach(() => { for (const s of servers.splice(0)) s.close() })

describe('the server bridge', () => {
    async function bridge(handler: http.RequestListener | null) {
        const logs: string[] = []; const seen: { url?: string, body: string }[] = []
        let target = 'http://127.0.0.1:9'
        if (handler) target = `http://127.0.0.1:${await listen(http.createServer((q, s) => { let b = ''; q.on('data', (c) => { b += c }); q.on('end', () => { seen.push({ url: q.url, body: b }); handler(q, s) }) }))}`
        const app = express(); app.use(express.json())
        const auth = async (req: any, res: any) => { if (req.headers['risu-auth'] === 'good') return true; res.status(400).send({ error: 'No auth header' }); return false }
        mountAdminReport(app, { auth, limiter: (_q: any, _r: any, n: any) => n(), target, timeoutMs: 500, log: (m: string) => logs.push(m) })
        const port = await listen(http.createServer(app))
        const post = (b: unknown, token = 'good') => fetch(`http://127.0.0.1:${port}/api/admin/report`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'risu-auth': token } : {}) }, body: JSON.stringify(b) })
        return { post, logs, seen }
    }
    const json = (obj: unknown, status = 200): http.RequestListener => (_q, res) => { res.statusCode = status; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)) }
    const full = reportOf(RAW, ctx)!

    it('needs the auth header', async () => {
        const b = await bridge(json({ dup: false }))
        expect((await b.post(full, '')).status).toBe(400)
        expect(b.seen).toHaveLength(0)
    })
    it('sends only the known fields on, and says what the store did (never the text in the log)', async () => {
        const b = await bridge(json({ added: true, merged: false, dup: false, lines: 1 }))
        const r = await b.post({ ...full, junk: 'the chat text' })
        expect(r.status).toBe(200)
        expect(JSON.parse(b.seen[0].body)).toEqual(full)
        expect(b.seen[0].url).toBe('/api/admin/report')
        expect(b.logs.join('\n')).toContain('added'); expect(b.logs.join('\n')).not.toContain('overlap')
    })
    it('maps the asset manager: refused -> 400, down -> 502, silent -> 504; a body without kind and text -> 400', async () => {
        expect((await (await bridge(json({ error: 'kind' }, 400))).post(full)).status).toBe(400)
        expect((await (await bridge(json({}, 500))).post(full)).status).toBe(502)
        expect((await (await bridge(null)).post(full)).status).toBe(502)
        expect((await (await bridge(() => { /* never answers */ })).post(full)).status).toBe(504)
        expect((await (await bridge(json({ dup: false }))).post({ card: 'x' })).status).toBe(400)
        expect(bridgeReportOf([1])).toBeNull()
        expect((await saveReport({ kind: 'bug' })).status).toBe(400)
    })
})
