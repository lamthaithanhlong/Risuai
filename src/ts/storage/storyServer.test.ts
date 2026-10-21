// @vitest-environment node
// The real server, its own temp save dir, HOME and jobs file: story.sqlite follows the save, /api/story reads it.
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, webcrypto } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

const req = createRequire(import.meta.url)
const merge = req('../../../server/node/dbMerge.cjs')
const { findSwipl } = req('../../../server/node/storyLogic.cjs')
const SERVER = join(__dirname, '../../../server/node/server.cjs')
// the server runs with a temp HOME: it is told where this machine's clingo is (gmSolver.cjs looks under ~/.risu-lan otherwise)
const CLINGO = req('../../../server/node/gmSolver.cjs').findClingo()
if (CLINGO) process.env.RISU_CLINGO_PYTHON ??= CLINGO
const hex = (s: string) => Buffer.from(s).toString('hex')
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')

let dir: string, port: number, proc: ChildProcess | null = null
let jwk: JsonWebKey, priv: CryptoKey
async function token() {
    const h = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT' }))
    const now = Math.floor(Date.now() / 1000)
    const p = b64u(JSON.stringify({ iat: now, exp: now + 300, pub: jwk }))
    const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, Buffer.from(`${h}.${p}`))
    return `${h}.${p}.${b64u(Buffer.from(sig))}`
}
const freePort = () => new Promise<number>((resolve) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)) }) })
async function start(env: Record<string, string> = {}) {
    proc = spawn(process.execPath, [SERVER], { cwd: dir, env: { ...process.env, PORT: String(port), HOME: join(dir, 'home'), RISU_JOBS_DB: join(dir, 'home', 'jobs.sqlite'), ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    proc.stdout!.on('data', () => {})
    proc.stderr!.on('data', () => {})
    for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/`); return } catch { await new Promise((r) => setTimeout(r, 150)) } }
    throw new Error('server did not start')
}
async function stop() { if (!proc) return; const p = proc; proc = null; await new Promise<void>((r) => { p.on('exit', () => r()); p.kill('SIGTERM') }) }
const vars = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => ['$' + k, v]))
function save(chats: any[]) {
    return merge.encodeSave([
        merge.serializeBlock(1, 0, 'root', { __directory: ['ss'] }),
        merge.serializeBlock(2, 1, 'ss', { chaId: 'ss', name: 'Shadow Slave', globalLore: [{ comment: 'Region: Forgotten Shore', key: 'Dark City', content: 'x' }], chats }),
        { type: 0, comp: 0, name: 'config', data: Buffer.from('{}') },
    ])
}
const chat = (id: string, extra: Record<string, string> = {}) => ({ id, name: id, message: [], scriptstate: vars({ st_name: 'Kenji', st_rank: 'Aspirant (Ứng viên)', st_place: 'Trại lính', st_date: 'Thử Thách Đầu Tiên', led_rel: 'Nephis | Kenji | trusts', led_ev: 'Day 1, dawn | Kenji wakes', ...extra }) })
async function write(body: Buffer) {
    const r = await fetch(`http://127.0.0.1:${port}/api/write`, { method: 'POST', body: body as unknown as BodyInit, headers: { 'content-type': 'application/octet-stream', 'file-path': hex('database/database.bin'), 'risu-auth': await token() } })
    expect(r.status).toBe(200)
}
async function get(path: string, auth = true) {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { headers: auth ? { 'risu-auth': await token() } : {} })
    return { status: r.status, json: await r.json().catch(() => null) }
}
async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean) {
    let v = await fn()
    for (let i = 0; i < 40 && !ok(v); i++) { await new Promise((r) => setTimeout(r, 50)); v = await fn() }
    return v
}

beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'story-srv-'))
    mkdirSync(join(dir, 'save'))
    const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    jwk = await webcrypto.subtle.exportKey('jwk', kp.publicKey); priv = kp.privateKey
    writeFileSync(join(dir, 'save', '__known_public_key_hashes.json'), JSON.stringify([createHash('sha256').update(JSON.stringify(jwk)).digest('hex')]))
    writeFileSync(join(dir, 'save', '__password'), 'pw')
    // a save that is already there when the server starts (written while it was stopped): indexed at start
    writeFileSync(join(dir, 'save', hex('database/database.bin')), save([chat('k0')]))
    port = await freePort()
    await start()
}, 60000)
afterAll(async () => { await stop() })

describe('story.sqlite next to the save, and /api/story', () => {
    test('the save present at start is indexed; story.sqlite sits next to the save', async () => {
        const r = await eventually(() => get('/api/story/k0'), (v) => v.status === 200)
        expect(r.json).toMatchObject({ status: 'ok', chat: { id: 'k0', character: 'Shadow Slave' }, state: { st_rank: 'Aspirant (Ứng viên)' } })
        expect(existsSync(join(dir, 'save.story.sqlite'))).toBe(true)
    }, 60000)

    test('a write is followed: state, npcs, timeline', async () => {
        await write(save([chat('k0'), chat('k1', { led_ev: 'Day 1, dawn | Kenji wakes\nDay 2, dusk | Nephis died in Dark City' })]))
        const r = await eventually(() => get('/api/story/k1'), (v) => v.status === 200)
        expect(r.json.npcs).toEqual([expect.objectContaining({ name: 'Nephis', status: 'dead', last_seen_place: 'Dark City' })])
        expect(r.json.timeline).toHaveLength(2)
    }, 60000)

    test.skipIf(!findSwipl())('/check returns the violations', async () => {
        await write(save([chat('k0'), chat('k1', { st_rank: 'Sleeper', led_ev: 'Day 1, dawn | Kenji wakes' })]))
        const r = await eventually(() => get('/api/story/k1/check'), (v) => (v.json?.violations ?? []).length > 0)
        expect(r.json).toMatchObject({ status: 'ok', chatId: 'k1' })
        expect(r.json.violations.map((v: any) => v.rule)).toEqual(['rank_without_event'])
        expect(r.json.line).toBe('[Story consistency check: Rank changed aspirant -> sleeper with no Nightmare or Gateway in the timeline. Correct this in the story without mentioning the check.]')
        expect((await get('/api/story/k0/check')).json).toMatchObject({ status: 'ok', violations: [] })
    }, 60000)

    test('/plan answers a plan, an impossible goal, a bad goal', async () => {
        const ok = await get('/api/story/k0/plan?goal=' + encodeURIComponent('(awakened)'))
        expect(ok.status).toBe(200)
        expect(ok.json.status).toBe('ok')
        expect(ok.json.plan[0]).toBe('(survive-nightmare)')
        expect(ok.json.plan.some((s: string) => s.startsWith('(pass-gateway'))).toBe(true)
        const no = await get('/api/story/k0/plan?goal=' + encodeURIComponent('(and (aspirant) (awakened))'))
        expect(no.json.status).toBe('impossible')
        expect((await get('/api/story/k0/plan?goal=' + encodeURIComponent('(nope)'))).status).toBe(400)
    }, 60000)

    test('a chat deleted from the save is archived: 410 with when; unknown is 404; no auth is refused', async () => {
        await write(save([chat('k0')]))
        const r = await eventually(() => get('/api/story/k1'), (v) => v.status === 410)
        expect(r.json).toMatchObject({ status: 'archived', chatId: 'k1' })
        expect(typeof r.json.deleted_at).toBe('number')
        expect((await get('/api/story/zzz')).status).toBe(404)
        expect((await get('/api/story/k0', false)).status).toBe(400)
        expect((await get('/api/story/bad%20id')).status).toBe(400)
    }, 60000)

    test('/api/story/decide: the GM\'s decision for a turn, its line, and nothing without auth', async () => {
        const body = { chatId: 'k0', world: 'shadow_slave', phase: 'run', vars: { st_name: 'Kenji', st_place: 'Trại lính', led_rel: 'Nephis | Kenji | trusts', $junk: 'x' },
            messages: [{ role: 'user', text: 'Kenji đi theo đoàn người.' }], dice: { pace: 'quiet', cardNew: true }, kinds: ['a stranger'], stance: 'wants to use the character' }
        const post = async (auth: boolean) => fetch(`http://127.0.0.1:${port}/api/story/decide`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(auth ? { 'risu-auth': await token() } : {}) } })
        expect((await post(false)).status).toBe(400)
        const r = await (await post(true)).json()
        if (!CLINGO) { expect(r.status).toBe('unavailable'); return }
        expect(r.status).toBe('ok')
        expect(r.decision.turn.name).toBe('new')
        expect(r.line).toMatch(/^This turn \(decided, follow it\)/)
        expect(r.line).toContain('stated no need')
    }, 60000)

    test('RISU_STORY=0: the API says unavailable and writes still work', async () => {
        await stop()
        await start({ RISU_STORY: '0' })
        await write(save([chat('k0')]))
        expect(await get('/api/story/k0')).toMatchObject({ status: 503, json: { status: 'unavailable' } })
        await stop()
        await start()
    }, 60000)
})
