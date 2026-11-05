// @vitest-environment node
// Admin is global (adminGlobal.ts, server/node/adminBridge.cjs): the card id mapping, where the block goes, the first-reply boot,
// cards that still carry their own Admin, the off switch, the deterministic budget cut, the caches, and "no copy anywhere".
import { beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ADMIN_BOOT, adminBeforeRequest, adminBlock, adminCardOf, adminGuideFor, adminRequest, cardHasOwnAdmin, fetchAdmin, fitBudget, resetAdminCache, type AdminPayload } from './adminGlobal'
import { guideNameOf } from './guideDirective'

const require = createRequire(import.meta.url)
const { getAdmin } = require('../../../server/node/adminBridge.cjs')

const ADMIN_BODY = 'Admin is the interface. {{user}} sees lines.\n\n## Connecting and standing duties\nConnect once.\n\n## Admin lines\nOne bracket line.\n\n## Scouting\nQUÉT within 10 m.'
const payload = (card = 'zombie', extra: Partial<AdminPayload> = {}): AdminPayload => ({
    card, enabled: true, guide: 'Admin', sha: 'abcdef0123',
    assets: [{ id: 'characters/admin', title: 'Admin', body: ADMIN_BODY }, { id: '_roles/guide/characters/admin', title: 'Story guide: Admin', body: '## Guide: hints\nOnly when asked.' }],
    text: '[Admin]\n' + ADMIN_BODY, ...extra,
})
const jsonRes = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response
const prompt = () => [{ role: 'system', content: 'main' }, { role: 'system', content: 'desc' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'go' }]

beforeEach(() => resetAdminCache())

describe('adminCardOf', () => {
    it('extension first, then the chaId table, then cha-<8>', () => {
        expect(adminCardOf({ chaId: 'fc27f53b-773d', extentions: { risu_story_card: 'lotm' } })).toBe('lotm')
        expect(adminCardOf({ chaId: 'fc27f53b-773d-40af' })).toBe('zombie')
        expect(adminCardOf({ chaId: 'aa7f021d-b690' })).toBe('mailman')
        expect(adminCardOf({ chaId: '22a987d8-4a13' })).toBe('lotm')
        expect(adminCardOf({ chaId: '04103f68-46fc' })).toBe('shadow-slave')
        expect(adminCardOf({ chaId: '1A2B3C4D-9999' })).toBe('cha-1a2b3c4d')
        expect(adminCardOf({ chaId: 'aa7f021d', extentions: { risu_story_card: '../x' } })).toBe('mailman')   // a bad extension is ignored
        expect(adminCardOf(undefined)).toBe('')
    })
    it('a card built before the change still has its own Admin entry', () => {
        expect(cardHasOwnAdmin({ globalLore: [{ comment: 'Admin' }] })).toBe(true)
        expect(cardHasOwnAdmin({ globalLore: [{ comment: 'Admin (2)' }] })).toBe(true)
        expect(cardHasOwnAdmin({ globalLore: [{ comment: 'Administrative Structure' }] })).toBe(false)
    })
})

describe('adminRequest / adminBlock', () => {
    it('goes after the leading system messages, as a system message that is not removable', () => {
        const out = adminRequest(prompt(), 'ADMIN')
        expect(out.map((m) => m.role)).toEqual(['system', 'system', 'system', 'user', 'assistant', 'user'])
        expect(out[2]).toMatchObject({ role: 'system', content: 'ADMIN', removable: false })
        expect(adminRequest(prompt(), '')).toEqual(prompt())
    })
    it('{{user}} becomes the persona; the boot line only on the first reply', () => {
        const first = adminBlock(payload(), { user: 'Kenji', opening: true })
        expect(first).toContain('Kenji sees lines')
        expect(first).not.toContain('{{user}}')
        expect(first.endsWith(ADMIN_BOOT)).toBe(true)
        expect(adminBlock(payload(), { user: 'Kenji', opening: false })).not.toContain('Admin boot')
    })
    it('switched off (enabled false) or empty: nothing', () => {
        expect(adminBlock(payload('lotm', { enabled: false }))).toBe('')
        expect(adminBlock(payload('lotm', { assets: [] }))).toBe('')
        expect(adminBlock(null)).toBe('')
    })
})

describe('fitBudget (deterministic)', () => {
    const assets = payload().assets
    it('under budget: nothing cut, both blocks whole', () => {
        const r = fitBudget(assets, 10_000)
        expect(r.cut).toEqual([])
        expect(r.text).toContain('[Story guide: Admin]\n## Guide: hints\nOnly when asked.')
    })
    it('over budget: whole sections from the end, never the intro, Connecting or the guide block; same input = same output', () => {
        const full = fitBudget(assets, 10_000).text
        const r = fitBudget(assets, full.length - 10)
        expect(r.cut).toEqual(['Scouting'])
        const tight = fitBudget(assets, 50)
        expect(tight.cut).toEqual(['Scouting', 'Admin lines'])
        for (const keep of ['Admin is the interface', '## Connecting and standing duties', 'Connect once.', '[Story guide: Admin]', 'Only when asked.']) expect(tight.text).toContain(keep)
        expect(fitBudget(assets, 50)).toEqual(tight)
        expect(JSON.stringify(fitBudget(assets, 50))).toBe(JSON.stringify(tight))
    })
})

describe('fetchAdmin: cache, offline, never blocks', () => {
    const deps = (fetch: (u: string) => Promise<Response>, logs: string[], now = () => 1_000_000) => ({ fetch: (u: string) => fetch(u), auth: () => 'tok', log: (m: string) => logs.push(m), now, timeoutMs: 50 })
    it('fresh, then from memory within the TTL (one fetch)', async () => {
        let n = 0
        const logs: string[] = []
        const d = deps(async () => { n++; return jsonRes(200, payload()) }, logs)
        expect((await fetchAdmin('zombie', d))?.guide).toBe('Admin')
        expect((await fetchAdmin('zombie', d))?.guide).toBe('Admin')
        expect(n).toBe(1)
    })
    it('server down after a good answer: the last good copy, one log line', async () => {
        let t = 1_000_000, up = true
        const logs: string[] = []
        const d = deps(async () => { if (!up) throw new Error('down'); return jsonRes(200, payload()) }, logs, () => t)
        await fetchAdmin('zombie', d)
        up = false; t += 120_000
        expect((await fetchAdmin('zombie', d))?.sha).toBe('abcdef0123')
        expect(logs).toEqual([expect.stringMatching(/^\[Admin\] zombie: the server is not reachable, using the copy from /)])
    })
    it('no cache and no store: the request goes WITHOUT Admin, exactly one log line, nothing else changes', async () => {
        const logs: string[] = []
        const d = deps(async () => jsonRes(502, { error: 'no copy' }), logs)
        const card = { chaId: 'aa7f021d-b690', globalLore: [] }
        const before = prompt()
        const out = await adminBeforeRequest(before, card, [{ role: 'char' }], 'Kenji', d)
        expect(out).toEqual(prompt())
        expect(logs).toEqual(['[Admin] mailman: the server answered 502 and no copy, the request goes without Admin'])
        expect(guideNameOf(card)).toBe('')
    })
    it('a timeout never waits past timeoutMs', async () => {
        const logs: string[] = []
        const d = deps((u) => new Promise((_, rej) => { void u; setTimeout(() => rej(new Error('abort')), 5000) }), logs)
        const start = Date.now()
        const d2 = { ...d, fetch: (u: string, o?: RequestInit) => new Promise<Response>((_, rej) => { void u; o?.signal?.addEventListener('abort', () => rej(new Error('aborted'))) }) }
        expect(await fetchAdmin('lotm', d2)).toBeNull()
        expect(Date.now() - start).toBeLessThan(1000)
        expect(logs).toEqual(['[Admin] lotm: no answer in time and no copy, the request goes without Admin'])
    })
})

describe('adminBeforeRequest + the guide name', () => {
    const d = (p: AdminPayload) => ({ fetch: async () => jsonRes(200, p), auth: () => 'tok', log: () => {} })
    it('a card with no Admin of its own gets the block; the guide name comes from the payload', async () => {
        const card = { chaId: 'fc27f53b-773d', globalLore: [{ comment: 'Kisaragi' }] }
        expect(guideNameOf(card)).toBe('')
        const out = await adminBeforeRequest(prompt(), card, [], 'Kenji', d(payload()))
        expect(out[2].content).toContain('Admin is the interface. Kenji sees lines.')
        expect(out[2].content).toContain('Admin boot')
        expect(guideNameOf(card)).toBe('Admin')
        expect(adminGuideFor(card)).toBe('Admin')
    })
    it('a card that still carries its Admin entry: nothing injected, its own guide name', async () => {
        const card = { chaId: 'fc27f53b-773d', globalLore: [{ comment: 'Admin' }, { comment: 'Story guide: Admin' }] }
        expect(await adminBeforeRequest(prompt(), card, [], 'Kenji', d(payload()))).toEqual(prompt())
        expect(guideNameOf(card)).toBe('Admin')
    })
    it('a group chat is left alone; a switched-off card gets nothing and no guide', async () => {
        expect(await adminBeforeRequest(prompt(), { type: 'group', chaId: 'x' }, [], 'K', d(payload()))).toEqual(prompt())
        const card = { chaId: '22a987d8-4a13', globalLore: [] }
        expect(await adminBeforeRequest(prompt(), card, [{ role: 'char' }], 'K', d(payload('lotm', { enabled: false, assets: [], text: '', guide: '' })))).toEqual(prompt())
        expect(guideNameOf(card)).toBe('')
    })
})

describe('adminBridge.cjs (server)', () => {
    const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'admin-cache-'))
    it('fresh answer is passed through and kept on disk; then the asset manager is down: the copy, stale', async () => {
        const dir = tmp()
        const logs: string[] = []
        const ok = await getAdmin('zombie', { fetch: async () => jsonRes(200, payload()), cacheDir: dir, log: (m: string) => logs.push(m), now: () => new Date('2026-11-05T10:00:00Z') })
        expect(ok.status).toBe(200)
        expect(JSON.parse(fs.readFileSync(path.join(dir, 'zombie.json'), 'utf8')).payload.sha).toBe('abcdef0123')
        const down = await getAdmin('zombie', { fetch: async () => { throw new Error('ECONNREFUSED') }, cacheDir: dir, log: (m: string) => logs.push(m) })
        expect(down.status).toBe(200)
        expect(down.body).toMatchObject({ stale: true, cachedAt: '2026-11-05T10:00:00.000Z', guide: 'Admin' })
        expect(logs).toEqual(['[Admin] zombie: fresh sha=abcdef01', '[Admin] zombie: the asset manager is not running, serving the copy from 2026-11-05T10:00:00.000Z'])
        fs.rmSync(dir, { recursive: true, force: true })
    })
    it('no answer and no copy: 502 and one log line; a bad card id: 400 without a fetch', async () => {
        const dir = tmp()
        const logs: string[] = []
        let called = 0
        const r = await getAdmin('mailman', { fetch: async () => { called++; return jsonRes(500, {}) }, cacheDir: dir, log: (m: string) => logs.push(m) })
        expect(r.status).toBe(502)
        expect(logs).toEqual(['[Admin] mailman: the asset manager answered 500 and no copy, the reply goes without Admin'])
        expect((await getAdmin('../etc', { fetch: async () => { called++; return jsonRes(200, payload()) }, cacheDir: dir })).status).toBe(400)
        expect(called).toBe(1)
        fs.rmSync(dir, { recursive: true, force: true })
    })
})

// ---- the persona record (owner 2026-11-05: Admin manages the persona's stats in every story; a card with no engine has no panel) ----
import { fetchRecord, hasOwnEngine, personaRecordText, resetRecordCache, RECORD_TITLE } from './adminGlobal'
import { buildView } from './personaStats'

const KENJI = { stats: { the_luc: 1015, nhanh_nhen: 1001, suc_manh: 1002, cam_nhan: 1001, tinh_than: 1002 }, skills: { 'wall-vibration-listening': 4 } }
const FINDS = { finds: [{ id: 'wall-vibration-listening', name: { vi: 'Nghe rung vách', en: 'Wall listening' } }] }
const storeFetch = (stats: unknown, opts: { down?: boolean; calls?: string[] } = {}) => async (url: string) => {
    opts.calls?.push(url)
    if (opts.down) throw new Error('down')
    if (url.startsWith('/api/admin')) return jsonRes(200, payload('cha-0a1b2c3d'))
    if (url.startsWith('/api/assets/stats')) return jsonRes(200, stats)
    if (url.startsWith('/api/assets/finds')) return jsonRes(200, FINDS)
    return jsonRes(404, {})
}
const plain = { chaId: '0a1b2c3d-1111' }

describe('persona record', () => {
    beforeEach(() => resetRecordCache())
    it('the text carries the persona page numbers (2 decimals), slots, skills with mastery and tier, items', () => {
        const t = personaRecordText(buildView(KENJI, undefined, { 'wall-vibration-listening': { vi: 'Nghe rung vách' } }), 'Kenji Park')
        expect(t.startsWith(RECORD_TITLE)).toBe(true)
        expect(t).toContain('Thể lực 10.15%')
        expect(t).toContain('Ý chí 10.00%')
        expect(t).toContain('Ô kỹ năng mở: 1')
        expect(t).toContain('Nghe rung vách (thành thạo 0.04%, Sơ nhập)')
        expect(t).toContain('Vật phẩm:')
    })
    it('an empty store is said plainly, with no number', () => {
        const t = personaRecordText(buildView({ stats: {}, skills: {} }, undefined), 'Kenji Park')
        expect(t).toContain('Kho chung chưa ghi nhận chỉ số, kỹ năng hay vật phẩm nào của Kenji Park.')
        expect(t).not.toMatch(/%/)
    })
    it('a card with its own engine gets no record: story cards, the [[ACT| rule, $stats in the chat', () => {
        expect(hasOwnEngine({ chaId: 'fc27f53b-773d' })).toBe(true)
        expect(hasOwnEngine({ chaId: 'x', extentions: { risu_story_card: 'lotm' } })).toBe(true)
        expect(hasOwnEngine({ chaId: 'x', desc: 'tag [[ACT|...]]' } as never)).toBe(true)
        expect(hasOwnEngine(plain, { scriptstate: { $stats: '{"suc_manh":1000}' } })).toBe(true)
        expect(hasOwnEngine(plain, { scriptstate: {} })).toBe(false)
    })
    it('merged into the one Admin system message for a card with no engine', async () => {
        const out = await adminBeforeRequest(prompt(), plain, [], 'Kenji Park', { fetch: storeFetch(KENJI) as never, auth: () => 't' }, { id: 'kenji', chat: { scriptstate: {} } })
        const sys = out.filter((m) => String(m.content).includes('[Admin (global'))
        expect(sys).toHaveLength(1)
        expect(String(sys[0].content)).toContain(RECORD_TITLE)
        expect(String(sys[0].content)).toContain('Thể lực 10.15%')
        expect(String(sys[0].content)).toContain('Nghe rung vách')
    })
    it('the Zombie path is unchanged: no record, not even a store call', async () => {
        const calls: string[] = []
        const out = await adminBeforeRequest(prompt(), { chaId: 'fc27f53b-773d' }, [], 'Kenji Park', { fetch: storeFetch(KENJI, { calls }) as never, auth: () => 't' }, { id: 'kenji', chat: { scriptstate: {} } })
        expect(out.some((m) => String(m.content).includes(RECORD_TITLE))).toBe(false)
        expect(calls.some((u) => u.includes('/api/assets/'))).toBe(false)
    })
    it('offline: no store and no copy = no record block, one log line, the reply still gets Admin from its cache', async () => {
        const logs: string[] = []
        await adminBeforeRequest(prompt(), plain, [], 'K', { fetch: storeFetch(KENJI) as never, auth: () => 't' })   // Admin cached, no persona
        const down = async (url: string) => { if (url.startsWith('/api/assets/')) throw new Error('down'); return jsonRes(200, payload('cha-0a1b2c3d')) }
        const out = await adminBeforeRequest(prompt(), plain, [], 'K', { fetch: down as never, auth: () => 't', log: (m) => logs.push(m) }, { id: 'kenji' })
        expect(out.some((m) => String(m.content).includes('[Admin (global'))).toBe(true)
        expect(out.some((m) => String(m.content).includes(RECORD_TITLE))).toBe(false)
        expect(logs.filter((l) => l.includes('persona kenji'))).toHaveLength(1)
    })
    it('a store that answered once is reused when it goes down', async () => {
        let t = 0
        await fetchRecord('kenji', { fetch: storeFetch(KENJI) as never, auth: () => 't', now: () => t })
        t = 120_000
        const v = await fetchRecord('kenji', { fetch: storeFetch(KENJI, { down: true }) as never, auth: () => 't', now: () => t, log: () => {} })
        expect(v?.stats.find((s) => s.key === 'the_luc')?.pct).toBe('10.15%')
    })
    it('cut order: sections first, then the record, never intro, Connecting or the Story guide', () => {
        const assets = payload().assets
        const rec = `${RECORD_TITLE}\n` + 'x'.repeat(200)
        const full = fitBudget(assets, 100000, rec).text
        const noRec = fitBudget(assets, 100000).text
        // budget fits everything but the last section: the section goes, the record stays
        const a = fitBudget(assets, full.length - 10, rec)
        expect(a.cut).toEqual(['Scouting'])
        expect(a.text).toContain(RECORD_TITLE)
        // budget too small for the record even with all sections gone: the record goes, protected parts stay
        const b = fitBudget(assets, noRec.length - 1, rec)
        expect(b.cut).toEqual(['Scouting', 'Admin lines', 'Persona record'])
        expect(b.text).not.toContain(RECORD_TITLE)
        expect(b.text).toContain('Connecting and standing duties')
        expect(b.text).toContain('Story guide: Admin')
        expect(b.text).toContain('Admin is the interface')
    })
})
