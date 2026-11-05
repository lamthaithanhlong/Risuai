// @vitest-environment node
// The Admin on/off switch of the character settings: the client helpers (adminGlobal.ts) and the bridge route
// (server/node/adminBridge.cjs POST /api/admin/switch). Neutral test ids only.
import { beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ADMIN_LOCKED_NOTE, OFF_SEEN_KEY, adminSwitchState, adminSwitchView, fetchAdmin, readOffSeen, resetAdminCache, resolveAdmin, setAdminSwitch, type AdminPayload } from './adminGlobal'

const require = createRequire(import.meta.url)
const { switchAdmin, switchLimiter, getAdmin } = require('../../../server/node/adminBridge.cjs')

const CARD = 'cha-testcard1'
const jsonRes = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response
const payload = (extra: Partial<AdminPayload> & { locked?: boolean } = {}) => ({
    card: CARD, enabled: true, guide: 'Admin', sha: 'abc', assets: [{ id: 'characters/admin', title: 'Admin', body: 'Admin body' }], text: '[Admin]\nAdmin body', ...extra,
})
const offPayload = (extra = {}) => payload({ enabled: false, assets: [], text: '', guide: '', ...extra })
const memStore = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } } }
type Call = { url: string; init?: RequestInit }
const depsOf = (fetch: (u: string, i?: RequestInit) => Promise<Response>, storage = memStore(), logs: string[] = []) =>
    ({ fetch, auth: () => 'tok', log: (m: string) => logs.push(m), storage }) as never

beforeEach(() => resetAdminCache())

describe('adminSwitchState / adminSwitchView (client)', () => {
    it('on, off, locked and stale come from GET /api/admin; the request cache is not touched', async () => {
        const calls: Call[] = []
        const answers = [payload(), offPayload(), offPayload({ locked: true }), payload({ stale: true } as never)]
        const f = async (url: string, init?: RequestInit) => { calls.push({ url, init }); return jsonRes(200, answers.shift()) }
        expect(await adminSwitchState(CARD, depsOf(f))).toEqual({ card: CARD, state: 'on', locked: false, stale: false })
        expect(await adminSwitchState(CARD, depsOf(f))).toEqual({ card: CARD, state: 'off', locked: false, stale: false })
        expect(await adminSwitchState(CARD, depsOf(f))).toEqual({ card: CARD, state: 'off', locked: true, stale: false })
        expect(await adminSwitchState(CARD, depsOf(f))).toMatchObject({ state: 'on', stale: true })
        expect(calls[0].url).toBe('/api/admin?card=cha-testcard1')
        expect((calls[0].init?.headers as Record<string, string>)['risu-auth']).toBe('tok')
        // fetchAdmin still asks the server: the switch read put nothing in the memory copy
        await fetchAdmin(CARD, depsOf(async (u) => { calls.push({ url: u }); return jsonRes(200, payload()) }))
        expect(calls.length).toBe(5)
    })
    it('no answer, an error status or a bad id: unknown, never throws', async () => {
        expect(await adminSwitchState(CARD, depsOf(async () => { throw new Error('down') }))).toMatchObject({ state: 'unknown', locked: false })
        expect(await adminSwitchState(CARD, depsOf(async () => jsonRes(502, { error: 'x', offKnown: false })))).toMatchObject({ state: 'unknown', error: 'the server answered 502' })
        let called = 0
        expect(await adminSwitchState('', depsOf(async () => { called++; return jsonRes(200, payload()) }))).toMatchObject({ state: 'unknown' })
        expect(called).toBe(0)
    })
    it('the view: locked = disabled with the note; unknown and busy = disabled; checked = on', () => {
        expect(adminSwitchView({ card: CARD, state: 'off', locked: true })).toEqual({ checked: false, disabled: true, note: ADMIN_LOCKED_NOTE })
        expect(adminSwitchView({ card: CARD, state: 'on', locked: true }).disabled).toBe(true)
        expect(ADMIN_LOCKED_NOTE).toBe('khoá, sửa tay trong global.json')
        expect(adminSwitchView({ card: CARD, state: 'unknown', locked: false }).disabled).toBe(true)
        expect(adminSwitchView(null).disabled).toBe(true)
        expect(adminSwitchView({ card: CARD, state: 'on', locked: false })).toEqual({ checked: true, disabled: false, note: '' })
        expect(adminSwitchView({ card: CARD, state: 'off', locked: false }, true)).toEqual({ checked: false, disabled: true, note: '' })
    })
})

describe('setAdminSwitch (client)', () => {
    it('switch off: POST {card, off:true}, the memory copy is dropped and the card joins the once-off set', async () => {
        const store = memStore()
        const calls: Call[] = []
        let state: 'on' | 'off' = 'on'
        const f = async (url: string, init?: RequestInit) => {
            calls.push({ url, init })
            if (url === '/api/admin/switch') { state = JSON.parse(String(init?.body)).off ? 'off' : 'on'; return jsonRes(200, { ok: true, card: CARD, enabled: state === 'on', locked: false, off: state === 'off' ? [CARD] : [] }) }
            return jsonRes(200, state === 'on' ? payload() : offPayload())
        }
        expect((await resolveAdmin(CARD, depsOf(f, store))).source).toBe('fresh')     // cached as on
        const r = await setAdminSwitch(CARD, false, depsOf(f, store))
        expect(r).toEqual({ card: CARD, state: 'off', locked: false })
        const post = calls.find((c) => c.url === '/api/admin/switch')!
        expect(post.init?.method).toBe('POST')
        expect(JSON.parse(String(post.init?.body))).toEqual({ card: CARD, off: true })
        expect((post.init?.headers as Record<string, string>)['risu-auth']).toBe('tok')
        expect(JSON.parse(store.m.get(OFF_SEEN_KEY)!)).toEqual([CARD])
        // the next request asks again (cache cleared) and gets off, within the TTL of the old copy
        expect((await resolveAdmin(CARD, depsOf(f, store))).source).toBe('off')
        expect(calls.filter((c) => c.url.startsWith('/api/admin?')).length).toBe(2)
    })
    it('switch on: the card leaves the once-off set, so offline later = the built-in core, not fail-closed off', async () => {
        const store = memStore()
        store.setItem(OFF_SEEN_KEY, JSON.stringify([CARD, 'cha-other001']))
        const f = async (url: string) => url === '/api/admin/switch' ? jsonRes(200, { ok: true, card: CARD, enabled: true, locked: false, off: [] }) : (() => { throw new Error('down') })()
        expect(await setAdminSwitch(CARD, true, depsOf(f, store))).toEqual({ card: CARD, state: 'on', locked: false })
        expect([...readOffSeen(depsOf(f, store))]).toEqual(['cha-other001'])
        expect((await resolveAdmin(CARD, depsOf(f, store))).source).toBe('built-in')
    })
    it('locked: {locked:true}, nothing changes (set and memory copy kept)', async () => {
        const store = memStore()
        store.setItem(OFF_SEEN_KEY, JSON.stringify([CARD]))
        const calls: string[] = []
        const f = async (url: string) => { calls.push(url); return url === '/api/admin/switch' ? jsonRes(403, { error: 'locked', locked: true, card: CARD }) : jsonRes(200, offPayload({ locked: true })) }
        await resolveAdmin(CARD, depsOf(f, store))
        expect(await setAdminSwitch(CARD, true, depsOf(f, store))).toMatchObject({ locked: true, state: 'unknown' })
        expect(JSON.parse(store.m.get(OFF_SEEN_KEY)!)).toEqual([CARD])
        await resolveAdmin(CARD, depsOf(f, store))
        expect(calls.filter((u) => u.startsWith('/api/admin?')).length).toBe(1)   // memory copy still used
    })
    it('server error or down: unknown with the reason, never throws; a bad id makes no call', async () => {
        expect(await setAdminSwitch(CARD, false, depsOf(async () => jsonRes(502, { error: 'the asset manager is not running' })))).toMatchObject({ state: 'unknown', locked: false, error: 'the asset manager is not running' })
        expect(await setAdminSwitch(CARD, false, depsOf(async () => { throw new Error('x') }))).toMatchObject({ state: 'unknown', error: 'the server is not reachable' })
        let n = 0
        expect(await setAdminSwitch('BAD ID', false, depsOf(async () => { n++; return jsonRes(200, {}) }))).toMatchObject({ state: 'unknown' })
        expect(n).toBe(0)
    })
})

describe('adminBridge.cjs switchAdmin (server)', () => {
    const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'admin-switch-'))
    it('bad id or bad off: 400 without a call', async () => {
        let n = 0
        const f = async () => { n++; return jsonRes(200, {}) }
        for (const b of [{ card: '../etc', off: true }, { card: '', off: true }, { card: 'A', off: true }, { card: 'x'.repeat(41), off: true }, { card: CARD, off: 'yes' }, { card: CARD }, null, 'x'])
            expect((await switchAdmin(b, { fetch: f })).status).toBe(400)
        expect(n).toBe(0)
    })
    it('switched off: forwards {card, off}, then refreshes its disk copy so the next GET says off at once', async () => {
        const dir = tmp()
        const calls: Call[] = []
        let off = false
        const f = async (url: string, init?: RequestInit) => {
            calls.push({ url, init })
            if (url.endsWith('/api/admin/switch')) { off = JSON.parse(String(init?.body)).off; return jsonRes(200, { ok: true, card: CARD, enabled: !off, locked: false, off: off ? [CARD] : [] }) }
            return jsonRes(200, off ? offPayload() : payload())
        }
        await getAdmin(CARD, { fetch: f, cacheDir: dir })                                    // an "on" copy on disk
        const r = await switchAdmin({ card: CARD, off: true }, { fetch: f, cacheDir: dir, target: 'http://am' })
        expect(r.status).toBe(200)
        expect(r.body).toMatchObject({ ok: true, card: CARD, enabled: false, locked: false, off: [CARD], admin: { enabled: false } })
        expect(calls[1].url).toBe('http://am/api/admin/switch')
        expect(JSON.parse(String(calls[1].init?.body))).toEqual({ card: CARD, off: true })
        expect(JSON.parse(fs.readFileSync(path.join(dir, `${CARD}.json`), 'utf8')).payload.enabled).toBe(false)
        // the asset manager goes down: the copy says off
        expect((await getAdmin(CARD, { fetch: async () => { throw new Error('down') }, cacheDir: dir })).body).toMatchObject({ enabled: false, stale: true })
        fs.rmSync(dir, { recursive: true, force: true })
    })
    it('switched off but the refresh fails: an off copy is written (fail-closed); switched on with a failed refresh keeps the old copy', async () => {
        const dir = tmp()
        await getAdmin(CARD, { fetch: async () => jsonRes(200, payload()), cacheDir: dir })
        let first = true
        const okThenDown = (enabled: boolean) => async () => { if (first) { first = false; return jsonRes(200, { ok: true, card: CARD, enabled, locked: false, off: enabled ? [] : [CARD] }) } throw new Error('down') }
        const r = await switchAdmin({ card: CARD, off: true }, { fetch: okThenDown(false), cacheDir: dir, globalJson: path.join(dir, 'none.json') })
        expect(r.body).toMatchObject({ ok: true, enabled: false, admin: { enabled: false } })
        expect(JSON.parse(fs.readFileSync(path.join(dir, `${CARD}.json`), 'utf8')).payload.enabled).toBe(false)
        first = true
        const on = await switchAdmin({ card: CARD, off: false }, { fetch: okThenDown(true), cacheDir: dir, globalJson: path.join(dir, 'none.json') })
        expect(on.body).toMatchObject({ ok: true, enabled: true, admin: null })
        expect(JSON.parse(fs.readFileSync(path.join(dir, `${CARD}.json`), 'utf8')).payload.enabled).toBe(false)
        fs.rmSync(dir, { recursive: true, force: true })
    })
    it('locked: 403 {locked:true}; other refusals 400; down 502; no copy is touched', async () => {
        const dir = tmp()
        const logs: string[] = []
        expect(await switchAdmin({ card: CARD, off: false }, { fetch: async () => jsonRes(403, { error: 'locked here', locked: true }), cacheDir: dir, log: (m: string) => logs.push(m) }))
            .toEqual({ status: 403, body: { error: 'locked here', locked: true, card: CARD } })
        expect((await switchAdmin({ card: CARD, off: false }, { fetch: async () => jsonRes(403, { error: 'loopback only' }), cacheDir: dir })).status).toBe(400)
        expect((await switchAdmin({ card: CARD, off: false }, { fetch: async () => jsonRes(400, { error: 'bad' }), cacheDir: dir })).status).toBe(400)
        expect((await switchAdmin({ card: CARD, off: false }, { fetch: async () => { throw new Error('ECONNREFUSED') }, cacheDir: dir })).status).toBe(502)
        expect(fs.readdirSync(dir)).toEqual([])
        expect(logs).toEqual([`[Admin] ${CARD}: switch refused, locked`])
        fs.rmSync(dir, { recursive: true, force: true })
    })
    it('rate limit: at most N a minute, then free again', () => {
        let t = 0
        const may = switchLimiter(3, () => t)
        expect([may(), may(), may(), may()]).toEqual([true, true, true, false])
        t = 60_000
        expect(may()).toBe(true)
    })
})
