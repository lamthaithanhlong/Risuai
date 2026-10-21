// @vitest-environment node
// The real server, two pages, real HTTP: two pages write one remotes/<chaId>.local.bin (enableRemoteSaving, the live save), each adding a
// message to the same chat. The old server stored the last write whole and the first message was gone (tests/turns/repro.mjs double).
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, webcrypto } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

const req = createRequire(import.meta.url)
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


const CHA = 'c1'
const REMOTE = `remotes/${CHA}.local.bin`
const msg = (id: string, data: string, time: number) => ({ chatId: id, role: 'user', data, time })
const file = (char: any) => Buffer.from(JSON.stringify(char), 'utf8')
const charOf = (buf: Buffer) => JSON.parse(buf.toString('utf8'))
const ids = (buf: Buffer) => charOf(buf).chats[0].message.map((m: any) => m.chatId)

let dir: string
let port: number
let proc: ChildProcess | null = null
let A: Page, B: Page

async function start() {
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
// a page is its key AND its tab: two tabs of one key are two pages (server.cjs clientIdOf)
async function read(p: Page, key: string, tab = 'tab-' + p.name + '-0') {
    const r = await fetch(`http://127.0.0.1:${port}/api/read`, { headers: { 'file-path': hex(key), 'risu-auth': await token(p), 'x-risu-tab': tab } })
    return { status: r.status, body: Buffer.from(await r.arrayBuffer()) }
}
async function write(p: Page, key: string, body: Buffer, tab = 'tab-' + p.name + '-0') {
    const r = await fetch(`http://127.0.0.1:${port}/api/write`, { method: 'POST', body: body as unknown as BodyInit, headers: { 'content-type': 'application/octet-stream', 'file-path': hex(key), 'risu-auth': await token(p), 'x-risu-tab': tab } })
    return { status: r.status, json: await r.json() }
}

beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'remote-srv-'))
    mkdirSync(join(dir, 'save'))
    A = await newPage('mac')
    B = await newPage('phone')
    writeFileSync(join(dir, 'save', '__known_public_key_hashes.json'), JSON.stringify([pubHash(A), pubHash(B)]))
    writeFileSync(join(dir, 'save', '__password'), 'pw')
    port = await freePort()
    await start()
}, 60000)
afterAll(async () => { await stop() })

const chat0 = () => ({ chaId: CHA, name: 'Story', chatPage: 0, chats: [{ id: 'k1', name: 'one', message: [msg('m0', 'hello', 100)] }] })

describe('two pages write one remote character file over HTTP', () => {
    test('each adds a message to the same chat: both are kept, and the answer says it was merged', async () => {
        expect((await write(A, REMOTE, file(chat0()))).status).toBe(200)
        const a = await read(A, REMOTE)
        const b = await read(B, REMOTE)
        expect(a.body.equals(b.body)).toBe(true)

        const mac = charOf(a.body); mac.chats[0].message.push(msg('a1', 'from mac', 200))
        const phone = charOf(b.body); phone.chats[0].message.push(msg('p1', 'from phone', 210))
        expect((await write(A, REMOTE, file(mac))).json).toMatchObject({ success: true, merged: false })
        expect((await write(B, REMOTE, file(phone))).json).toMatchObject({ success: true, merged: true })

        const now = (await read(A, REMOTE, 'tab-mac-1')).body
        expect(ids(now)).toEqual(['m0', 'a1', 'p1'])
    }, 60000)

    test('two tabs of one key are two pages', async () => {
        const t1 = (await read(A, REMOTE, 'tab-one-aaaa')).body
        const t2 = (await read(A, REMOTE, 'tab-two-bbbb')).body
        const x = charOf(t1); x.chats[0].message.push(msg('t1', 'tab one', 300))
        const y = charOf(t2); y.chats[0].message.push(msg('t2', 'tab two', 310))
        await write(A, REMOTE, file(x), 'tab-one-aaaa')
        await write(A, REMOTE, file(y), 'tab-two-bbbb')
        expect(ids((await read(B, REMOTE)).body)).toEqual(['m0', 'a1', 'p1', 't1', 't2'])
    }, 60000)

    test('after a restart the same page is still merged against what it read', async () => {
        const mine = (await read(B, REMOTE, 'tab-phone-9')).body
        await stop()
        await start()
        const other = charOf(mine); other.chats[0].message.push(msg('o1', 'other page', 400))
        await write(A, REMOTE, file(other), 'tab-mac-9')
        const phone = charOf(mine); phone.chats[0].message.push(msg('p2', 'phone again', 410))
        expect((await write(B, REMOTE, file(phone), 'tab-phone-9')).json.merged).toBe(true)
        expect(ids((await read(A, REMOTE)).body)).toEqual(['m0', 'a1', 'p1', 't1', 't2', 'o1', 'p2'])
    }, 60000)

    test('a file that is not a remote character file is written as it was', async () => {
        const w1 = await write(A, 'assets/x.bin', Buffer.from('one'))
        const w2 = await write(B, 'assets/x.bin', Buffer.from('two'))
        expect([w1.json.merged, w2.json.merged]).toEqual([false, false])
        expect((await read(A, 'assets/x.bin')).body.toString()).toBe('two')
    }, 60000)
})
