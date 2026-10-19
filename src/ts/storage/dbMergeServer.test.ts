// @vitest-environment node
// The real server, two real pages (two signing keys), real HTTP: the incident this was written for.
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
const SERVER = join(__dirname, '../../../server/node/server.cjs')
const hex = (s: string) => Buffer.from(s).toString('hex')
const DB = 'database/database.bin'

type Page = { jwk: JsonWebKey; priv: CryptoKey; name: string }
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')

async function newPage(name: string): Promise<Page> {
    const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    return { jwk: await webcrypto.subtle.exportKey('jwk', kp.publicKey), priv: kp.privateKey, name }
}
async function token(p: Page) {
    const header = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT' }))
    const now = Math.floor(Date.now() / 1000)
    const payload = b64u(JSON.stringify({ iat: now, exp: now + 300, pub: p.jwk }))
    const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, p.priv, Buffer.from(`${header}.${payload}`))
    return `${header}.${payload}.${b64u(Buffer.from(sig))}`
}
const pubHash = (p: Page) => createHash('sha256').update(JSON.stringify(p.jwk)).digest('hex')

function freePort(): Promise<number> {
    return new Promise((resolve) => {
        const s = createServer()
        s.listen(0, '127.0.0.1', () => { const port = (s.address() as any).port; s.close(() => resolve(port)) })
    })
}

function blocks(chatMsgs: string[], lore: number, maxResponse: number) {
    const chat = { chaId: 'c1', name: 'Story', globalLore: Array.from({ length: lore }, (_, i) => ({ comment: 'e' + i })), chats: [{ id: 'k1', message: chatMsgs }] }
    return merge.encodeSave([
        merge.serializeBlock(1, 0, 'root', { maxResponse, __directory: ['c1'] }),
        merge.serializeBlock(2, 0, 'c1', chat),
        { type: 0, comp: 0, name: 'config', data: Buffer.from('{}') },
    ])
}

let dir: string
let port: number
let proc: ChildProcess | null = null
let A: Page, B: Page

async function start() {
    // its own HOME and jobs file: with the runner's HOME it opened ~/.risu-lan/jobs.sqlite and cut the owner's running reply (F5)
    proc = spawn(process.execPath, [SERVER], { cwd: dir, env: { ...process.env, PORT: String(port), HOME: join(dir, 'home'), RISU_JOBS_DB: join(dir, 'home', 'jobs.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] })
    proc.stdout!.on('data', () => {})
    proc.stderr!.on('data', () => {})
    for (let i = 0; i < 100; i++) {
        try { await fetch(`http://127.0.0.1:${port}/`); return } catch { await new Promise((r) => setTimeout(r, 150)) }
    }
    throw new Error('server did not start')
}
async function stop() {
    if (!proc) return
    const p = proc
    proc = null
    await new Promise<void>((resolve) => { p.on('exit', () => resolve()); p.kill('SIGTERM') })
}
async function read(p: Page) {
    const r = await fetch(`http://127.0.0.1:${port}/api/read`, { headers: { 'file-path': hex(DB), 'risu-auth': await token(p) } })
    return { status: r.status, rev: r.headers.get('x-risu-rev'), body: Buffer.from(await r.arrayBuffer()) }
}
async function write(p: Page, body: Buffer) {
    const r = await fetch(`http://127.0.0.1:${port}/api/write`, { method: 'POST', body: body as unknown as BodyInit, headers: { 'content-type': 'application/octet-stream', 'file-path': hex(DB), 'risu-auth': await token(p) } })
    return { status: r.status, json: await r.json(), rev: r.headers.get('x-risu-rev') }
}
const val = (buf: Buffer, name: string) => merge.parseBlock(merge.decodeSave(buf).find((b: any) => b.name === name))

beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'merge-srv-'))
    mkdirSync(join(dir, 'save'))
    A = await newPage('mac')
    B = await newPage('phone')
    writeFileSync(join(dir, 'save', '__known_public_key_hashes.json'), JSON.stringify([pubHash(A), pubHash(B)]))
    writeFileSync(join(dir, 'save', '__password'), 'pw')
    port = await freePort()
    await start()
}, 60000)
afterAll(async () => { await stop() })

describe('two pages write one database over HTTP', () => {
    test('the stale page does not erase the other page\'s lorebook and settings, and the answer says it was merged', async () => {
        // the first write stores the base
        expect((await write(A, blocks(['hi'], 1, 1000))).status).toBe(200)
        const a = await read(A)
        const b = await read(B)
        expect(a.status).toBe(200)
        expect(b.rev).toBe(a.rev)

        // page A: a bigger lorebook and Max Response 8000 (alone so far: stored as written)
        const w1 = await write(A, blocks(['hi'], 3, 8000))
        expect(w1.json).toMatchObject({ success: true, merged: false })

        // page B still holds the old copy and only chatted
        const w2 = await write(B, blocks(['hi', 'tiến lên'], 1, 1000))
        expect(w2.json).toMatchObject({ success: true, merged: true })

        const now = (await read(A)).body
        expect(val(now, 'c1').globalLore).toHaveLength(3)
        expect(val(now, 'c1').chats[0].message).toEqual(['hi', 'tiến lên'])
        expect(val(now, 'root').maxResponse).toBe(8000)
    }, 60000)

    test('after a restart the same page is still merged against what it loaded', async () => {
        await stop()
        await start()
        const w = await write(B, blocks(['hi', 'tiến lên', 'thêm'], 1, 1000))
        expect(w.json.merged).toBe(true)
        const now = (await read(A)).body
        expect(val(now, 'c1').globalLore).toHaveLength(3)
        expect(val(now, 'c1').chats[0].message).toEqual(['hi', 'tiến lên', 'thêm'])
        expect(val(now, 'root').maxResponse).toBe(8000)
        expect(existsSync(join(dir, 'save.sync.sqlite'))).toBe(true)
    }, 60000)

    test('a page that reloads is no longer stale: its own writes are plain again', async () => {
        const b = await read(B)
        expect(b.body.length).toBeGreaterThan(0)
        const w = await write(B, blocks(['hi', 'tiến lên', 'thêm', 'nữa'], 3, 8000))
        expect(w.json.merged).toBe(false)
    }, 60000)
})
