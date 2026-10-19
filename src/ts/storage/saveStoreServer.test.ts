// @vitest-environment node
// The real server on the same seeded save, once with RISU_STORE=files and once with RISU_STORE=sqlite: the file API answers the
// same bytes on both, the sqlite run keeps everything (images too) as BLOBs in save.store.sqlite and leaves the files as they were,
// a picture drawn by an image job lands in the store, and loreImport writes the sqlite save that the server then serves.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes, webcrypto } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer as netServer } from 'node:net'
import { createServer as httpServer, type Server } from 'node:http'

const req = createRequire(import.meta.url)
const merge = req('../../../server/node/dbMerge.cjs')
const { storeFileOf } = req('../../../server/node/saveStore.cjs')
const Database = req('better-sqlite3')
const SERVER = join(__dirname, '../../../server/node/server.cjs')
const hex = (s: string) => Buffer.from(s).toString('hex')
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const freePort = () => new Promise<number>((resolve) => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => resolve(p)) }) })

let jwk: JsonWebKey, priv: CryptoKey
async function token() {
    const h = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT' }))
    const now = Math.floor(Date.now() / 1000)
    const p = b64u(JSON.stringify({ iat: now, exp: now + 300, pub: jwk }))
    const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, Buffer.from(`${h}.${p}`))
    return `${h}.${p}.${b64u(Buffer.from(sig))}`
}

const DB = 'database/database.bin'
const card = (desc: string) => merge.encodeSave([
    merge.serializeBlock(1, 0, 'root', { __directory: ['ss'] }),
    merge.serializeBlock(2, 1, 'ss', { chaId: 'ss', name: 'Shadow Slave', desc, firstMessage: 'hello', globalLore: [], chats: [{ id: 'c1', name: 'c1', message: [{ role: 'char', data: 'first' }] }] }),
    { type: 0, comp: 0, name: 'config', data: Buffer.from('{}') },
])
const seed: Record<string, Buffer> = {
    [DB]: card('old desc'),
    'assets/portrait.png': randomBytes(250_000),
    'inlays/old': randomBytes(12_000),
    'database/dbbackup-1760000000.bin': randomBytes(3000),
}

class Srv {
    proc: ChildProcess | null = null
    port = 0
    log = ''
    constructor(public dir: string, public backend: 'files' | 'sqlite') {}
    get save() { return join(this.dir, 'save') }
    async start(env: Record<string, string> = {}) {
        this.port = await freePort()
        this.proc = spawn(process.execPath, [SERVER], { cwd: this.dir, env: { ...process.env, PORT: String(this.port), HOME: join(this.dir, 'home'), RISU_JOBS_DB: join(this.dir, 'home', 'jobs.sqlite'), RISU_STORE: this.backend, RISU_STORY: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
        this.proc.stdout!.on('data', (d) => (this.log += d))
        this.proc.stderr!.on('data', (d) => (this.log += d))
        for (let i = 0; i < 100; i++) {
            if (this.proc.exitCode !== null) break
            try { await fetch(`http://127.0.0.1:${this.port}/`); return } catch { await new Promise((r) => setTimeout(r, 150)) }
        }
        throw new Error('server did not start:\n' + this.log)
    }
    async stop() {
        if (!this.proc) return
        const p = this.proc; this.proc = null
        if (p.exitCode !== null) return
        await new Promise<void>((r) => { p.on('exit', () => r()); p.kill('SIGTERM') })
    }
    url(p: string) { return `http://127.0.0.1:${this.port}${p}` }
    async read(key: string) { const r = await fetch(this.url('/api/read'), { headers: { 'file-path': hex(key), 'risu-auth': await token() } }); return Buffer.from(await r.arrayBuffer()) }
    async write(key: string, body: Buffer) {
        const r = await fetch(this.url('/api/write'), { method: 'POST', body: body as unknown as BodyInit, headers: { 'content-type': 'application/octet-stream', 'file-path': hex(key), 'risu-auth': await token() } })
        return { status: r.status, json: await r.json() }
    }
    async list() { const r = await fetch(this.url('/api/list'), { headers: { 'risu-auth': await token() } }); return (await r.json()).content as string[] }
    async remove(...keys: string[]) { const r = await fetch(this.url('/api/remove'), { headers: { 'file-path': keys.map(hex).join('$$'), 'risu-auth': await token() } }); return r.status }
}

function makeSaveDir(name: string) {
    const dir = mkdtempSync(join(tmpdir(), `store-srv-${name}-`))
    mkdirSync(join(dir, 'save'))
    mkdirSync(join(dir, 'home'))
    writeFileSync(join(dir, 'save', '__known_public_key_hashes.json'), JSON.stringify([createHash('sha256').update(JSON.stringify(jwk)).digest('hex')]))
    writeFileSync(join(dir, 'save', '__password'), 'pw')
    for (const [k, v] of Object.entries(seed)) writeFileSync(join(dir, 'save', hex(k)), v)
    return dir
}
const filesOf = (save: string) => Object.fromEntries(readdirSync(save).sort().map((n) => [n, sha(readFileSync(join(save, n)))]))

// the same session against either backend; everything it observes is returned so the two runs can be compared
const newPic = randomBytes(80_000)
const newDb = card('new desc')
async function session(s: Srv) {
    const seen: Record<string, unknown> = {}
    seen.listAtStart = (await s.list()).filter(Boolean).sort()
    for (const k of Object.keys(seed)) seen[`read ${k}`] = sha(await s.read(k))
    seen.writeDb = (await s.write(DB, newDb)).status
    seen.readDb = sha(await s.read(DB))
    seen.writeInlay = (await s.write('inlays/new', newPic)).status
    seen.readInlay = sha(await s.read('inlays/new'))
    // twenty writers at once, then every one reads back
    const many = Array.from({ length: 20 }, (_, i) => randomBytes(5000 + i))
    const st = await Promise.all(many.map((b, i) => s.write(`assets/c${i}.webp`, b)))
    seen.manyStatus = st.map((x) => x.status)
    seen.manyRead = (await Promise.all(many.map((_, i) => s.read(`assets/c${i}.webp`)))).map((b, i) => b.equals(many[i]))
    seen.remove = await s.remove('inlays/old', 'database/dbbackup-1760000000.bin')
    seen.readRemoved = (await s.read('inlays/old')).length
    seen.listAtEnd = (await s.list()).filter(Boolean).sort()
    return { seen, many }
}

let files: Srv, sqlite: Srv
const runs: Record<string, Awaited<ReturnType<typeof session>>> = {}
beforeAll(async () => {
    const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    jwk = await webcrypto.subtle.exportKey('jwk', kp.publicKey); priv = kp.privateKey
    files = new Srv(makeSaveDir('files'), 'files')
    sqlite = new Srv(makeSaveDir('sqlite'), 'sqlite')
}, 30_000)
afterAll(async () => {
    await files?.stop(); await sqlite?.stop()
    for (const s of [files, sqlite]) if (s) rmSync(s.dir, { recursive: true, force: true })
})

describe('the file API on both backends', () => {
    it('answers the same bytes, lists the same keys, and each backend keeps them where it should', async () => {
        const seedFiles = filesOf(sqlite.save)
        for (const s of [files, sqlite]) { await s.start(); runs[s.backend] = await session(s); await s.stop() }
        expect(runs.sqlite.seen).toEqual({ ...runs.files.seen })
        expect(runs.files.seen.listAtStart).toEqual(Object.keys(seed).sort())
        expect(runs.files.seen.manyStatus).toEqual(Array(20).fill(200))
        expect((runs.files.seen.manyRead as boolean[]).every(Boolean)).toBe(true)
        expect(runs.files.seen.readRemoved).toBe(0)
        expect(sqlite.log).toMatch(/\[Store\] backend sqlite/)
        expect(files.log).toMatch(/\[Store\] backend files/)

        // files: in the directory
        const f = readFileSync(join(files.save, hex('inlays/new')))
        expect(f.equals(newPic)).toBe(true)
        // sqlite: every key a BLOB in save.store.sqlite, and the directory exactly as it was seeded (it is the rollback)
        expect(filesOf(sqlite.save)).toEqual(seedFiles)
        const db = new Database(storeFileOf(sqlite.save), { readonly: true })
        try {
            const rows = db.prepare('SELECT path, typeof(data) AS t, data FROM files ORDER BY path').all() as { path: string; t: string; data: Buffer }[]
            expect(rows.map((r) => r.path)).toEqual(runs.sqlite.seen.listAtEnd)
            expect(new Set(rows.map((r) => r.t))).toEqual(new Set(['blob']))
            expect(rows.find((r) => r.path === 'inlays/new')!.data.equals(newPic)).toBe(true)
            expect(rows.find((r) => r.path === 'assets/portrait.png')!.data.equals(seed['assets/portrait.png'])).toBe(true)
        } finally { db.close() }
        // the pid file is gone once the server stopped
        expect(readdirSync(sqlite.dir).some((n) => n.endsWith('.server.pid'))).toBe(false)
    }, 120_000)

    it('a server with RISU_STORE=files refuses the save once the sqlite store has writes the files lack', async () => {
        const s = new Srv(sqlite.dir, 'files')
        await expect(s.start()).rejects.toThrow(/do not have/)
        await s.stop()
    }, 60_000)
})

describe('on the sqlite backend', () => {
    let router: Server
    beforeAll(async () => {
        // an image router on this machine: one picture in the `done` event
        const png = randomBytes(2000)
        router = httpServer((rq, rs) => { rq.resume(); rq.on('end', () => { rs.setHeader('content-type', 'text/event-stream'); rs.end(`event: done\ndata: {"data":[{"b64_json":"${png.toString('base64')}"}]}\n\n`) }) })
        await new Promise<void>((r) => router.listen(0, '127.0.0.1', r))
        await sqlite.start()
    }, 60_000)
    afterAll(async () => { await sqlite.stop(); await new Promise((r) => router.close(r)) })

    it('an image job writes its picture to inlays/<id> in the store, and it reads back', async () => {
        const rp = (router.address() as any).port
        const r = await fetch(sqlite.url('/api/image-jobs'), { method: 'POST', headers: { 'content-type': 'application/json', 'risu-auth': await token() }, body: JSON.stringify({ request: { url: `http://127.0.0.1:${rp}/v1/images/generations`, key: 'k', models: ['m'], body: { prompt: 'a lantern' } }, target: { chatId: 'c1', messageId: 'm1' } }) })
        const { id } = await r.json()
        let job: any = null
        for (let i = 0; i < 100; i++) {
            job = await (await fetch(sqlite.url(`/api/image-jobs/${id}`), { headers: { 'risu-auth': await token() } })).json()
            if (job.status === 'done' || job.status === 'error') break
            await new Promise((res) => setTimeout(res, 100))
        }
        expect(job.status).toBe('done')
        const pic = await sqlite.read(`inlays/${job.inlayId}`)
        expect(pic.length).toBeGreaterThan(0)
        await sqlite.stop()
        const db = new Database(storeFileOf(sqlite.save), { readonly: true })
        try {
            const row = db.prepare('SELECT typeof(data) AS t, data FROM files WHERE path = ?').get(`inlays/${job.inlayId}`) as { t: string; data: Buffer }
            expect(row.t).toBe('blob')
            expect(Buffer.from(row.data).equals(pic)).toBe(true)
        } finally { db.close() }
        expect(readdirSync(sqlite.save)).not.toContain(hex(`inlays/${job.inlayId}`))
    }, 60_000)

    it('loreImport writes the sqlite save (a recorded write) and the server serves it', async () => {
        await sqlite.stop()
        const prev = process.env.RISU_STORE
        process.env.RISU_STORE = 'sqlite'
        try {
            const li = req('../../../server/node/loreImport.cjs')
            const r = li.setCardText(sqlite.save, ['ss'], 'imported desc', 'imported opening')
            expect(r[0]).toMatchObject({ prefix: 'ss', after: ['imported desc'.length, 'imported opening'.length] })
            const pic = randomBytes(3000)
            const img = li.setCardImage(sqlite.save, ['ss'], pic, 'png')
            expect(img[0].after).toBe(`assets/${sha(pic)}.png`)
        } finally { if (prev === undefined) delete process.env.RISU_STORE; else process.env.RISU_STORE = prev }
        await sqlite.start()
        const blocks = merge.decodeSave(await sqlite.read(DB))
        const v = merge.parseBlock(blocks.find((b: any) => b.name === 'ss'))
        expect(v.desc).toBe('imported desc')
        expect(v.firstMessage).toBe('imported opening')
        expect((await sqlite.read(v.image)).length).toBe(3000)
        // the page's chat is still there
        expect(v.chats[0].message[0].data).toBe('first')
    }, 60_000)
})
