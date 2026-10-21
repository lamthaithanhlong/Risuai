// @vitest-environment node
// The picture queue on the real server, over HTTP (owner, 2026-10-20: pictures are their own pipeline, apart from the message turns).
// A page files a picture for a message of a chat in remotes/<chaId>.local.bin (enableRemoteSaving, the live save); the server draws it
// (a stub router), writes inlays/<id> and puts it into the message BY MESSAGE ID in that file, merged per page like any other write:
// a page whose copy of the file is older keeps the picture when it writes. One key is one picture, and a restart goes on with the queue.
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, webcrypto } from 'node:crypto'
import { createServer as netServer } from 'node:net'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SERVER = join(__dirname, '../../../server/node/server.cjs')
const hex = (s: string) => Buffer.from(s).toString('hex')
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

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
const freePort = () => new Promise<number>((resolve) => { const s = netServer(); s.listen(0, '127.0.0.1', () => { const port = (s.address() as any).port; s.close(() => resolve(port)) }) })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const CHA = 'c1'
const REMOTE = `remotes/${CHA}.local.bin`
const msg = (id: string, role: string, data: string) => ({ chatId: id, role, data, time: 1 })
const file = (char: any) => Buffer.from(JSON.stringify(char), 'utf8')
const charOf = (buf: Buffer) => JSON.parse(buf.toString('utf8'))
const text = (buf: Buffer, id: string) => charOf(buf).chats[0].message.find((m: any) => m.chatId === id)?.data

let dir: string, port: number, proc: ChildProcess | null = null
let A: Page, B: Page
let router: Server, routerPort = 0
let routerDelayMs = 100
const routerCalls: string[] = []

async function start() {
    proc = spawn(process.execPath, [SERVER], { cwd: dir, env: { ...process.env, PORT: String(port), HOME: join(dir, 'home'), RISU_JOBS_DB: join(dir, 'home', 'jobs.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] })
    proc.stdout!.on('data', () => {}); proc.stderr!.on('data', () => {})
    for (let i = 0; i < 100; i++) { try { await fetch(`http://127.0.0.1:${port}/`); return } catch { await sleep(150) } }
    throw new Error('server did not start')
}
async function stop() {
    if (!proc) return
    const p = proc; proc = null
    await new Promise<void>((resolve) => { p.on('exit', () => resolve()); p.kill('SIGTERM') })
}
const url = (path: string) => `http://127.0.0.1:${port}${path}`
async function api(p: Page, method: string, path: string, body?: unknown) {
    const r = await fetch(url(path), { method, headers: { 'content-type': 'application/json', 'risu-auth': await token(p) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => ({})) as any }
}
async function read(p: Page, key: string, tab = 'tab-' + p.name) {
    const r = await fetch(url('/api/read'), { headers: { 'file-path': hex(key), 'risu-auth': await token(p), 'x-risu-tab': tab } })
    return { status: r.status, body: Buffer.from(await r.arrayBuffer()) }
}
async function write(p: Page, key: string, body: Buffer, tab = 'tab-' + p.name) {
    const r = await fetch(url('/api/write'), { method: 'POST', body: body as unknown as BodyInit, headers: { 'content-type': 'application/octet-stream', 'file-path': hex(key), 'risu-auth': await token(p), 'x-risu-tab': tab } })
    return { status: r.status, json: await r.json() as any }
}
const askFor = (p: Page, messageId: string, key: string, prompt = 'a lantern') => api(p, 'POST', '/api/image-jobs', {
    request: { url: `http://127.0.0.1:${routerPort}/v1/images/generations`, key: 'k', models: ['stub'], body: { prompt } },
    target: { charId: CHA, chatId: 'k1', chatIndex: 0, messageId, messageIndex: 1 }, key,
})
async function until<T>(what: string, fn: () => Promise<T | null | false>, ms = 15000): Promise<T> {
    const t0 = Date.now()
    for (;;) {
        const v = await fn()
        if (v) return v
        if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + what)
        await sleep(150)
    }
}
const jobStatus = async (id: string) => (await api(A, 'GET', `/api/image-jobs/${id}`)).json

beforeAll(async () => {
    router = createServer(async (req, res) => {
        routerCalls.push(req.url ?? '')
        for await (const _ of req) { /* the body */ }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('event: progress\ndata: {}\n\n')
        await sleep(routerDelayMs)
        res.end(`event: done\ndata: ${JSON.stringify({ data: [{ b64_json: PNG_1X1 }] })}\n\n`)
    })
    await new Promise<void>((r) => router.listen(0, '127.0.0.1', r))
    routerPort = (router.address() as any).port
    dir = mkdtempSync(join(tmpdir(), 'picq-srv-'))
    mkdirSync(join(dir, 'save'))
    A = await newPage('mac'); B = await newPage('phone')
    writeFileSync(join(dir, 'save', '__known_public_key_hashes.json'), JSON.stringify([pubHash(A), pubHash(B)]))
    writeFileSync(join(dir, 'save', '__password'), 'pw')
    port = await freePort()
    await start()
}, 60000)
afterAll(async () => { await stop(); await new Promise((r) => router.close(r)) })

const chat0 = () => ({ chaId: CHA, name: 'Story', chatPage: 0, chats: [{ id: 'k1', name: 'one', message: [msg('m0', 'user', 'I knock.'), msg('m1', 'char', 'The door opens.')] }] })

describe('a picture is placed in its message on the server, by message id', () => {
    let inlay = ''
    test('filed with a key: drawn, written as an inlay, put on top of message m1 of the chat file; nothing else in the file changes', async () => {
        await write(A, REMOTE, file(chat0()))
        await read(A, REMOTE); await read(B, REMOTE)                              // both pages now hold this version
        const filed = await askFor(A, 'm1', `${CHA}|k1|m1|main`)
        expect(filed.json).toMatchObject({ existing: false })
        const job = await until('placed', async () => { const j = await jobStatus(filed.json.id); return j.status === 'placed' ? j : null })
        inlay = job.inlayId
        const now = (await read(A, REMOTE, 'tab-mac-2')).body
        expect(text(now, 'm1')).toBe(`{{inlay::${inlay}}}\n\nThe door opens.`)
        expect(text(now, 'm0')).toBe('I knock.')
        const stored = await read(A, `inlays/${inlay}`)
        expect(stored.body.length).toBeGreaterThan(0)
    }, 30000)

    test('the same key is the same picture: nothing is drawn twice', async () => {
        const before = routerCalls.length
        const again = await askFor(A, 'm1', `${CHA}|k1|m1|main`)
        expect(again.json.existing).toBe(true)
        await sleep(400)
        expect(routerCalls.length).toBe(before)
    })

    test('a page whose copy of the file is older (it never saw the picture) writes its own change: the picture stays, merged per message', async () => {
        // the phone read the file before the placement (tab-phone, first test) and writes its own change after it
        const oldCopy = chat0(); oldCopy.chats[0].message.push(msg('p1', 'user', 'from the phone'))
        const w = await write(B, REMOTE, file(oldCopy), 'tab-phone')
        expect(w.json).toMatchObject({ success: true, merged: true })
        const now = (await read(A, REMOTE, 'tab-mac-3')).body
        expect(text(now, 'p1')).toBe('from the phone')
        expect(text(now, 'm1')).toContain(`{{inlay::${inlay}}}`)
    }, 30000)

    test('a message that is not saved yet: the picture waits, and goes in when the page saves it', async () => {
        const filed = await askFor(A, 'm9', `${CHA}|k1|m9|main`, 'a second lantern')
        await until('drawn', async () => { const j = await jobStatus(filed.json.id); return j.status === 'done' ? j : null })
        await sleep(2500)                                                           // the server sweeps every 2 s: still no message m9
        expect((await jobStatus(filed.json.id)).status).toBe('done')
        const mine = charOf((await read(A, REMOTE, 'tab-mac-4')).body)
        mine.chats[0].message.push(msg('m9', 'char', 'A later reply.'))
        await write(A, REMOTE, file(mine), 'tab-mac-4')
        const job = await until('placed', async () => { const j = await jobStatus(filed.json.id); return j.status === 'placed' ? j : null })
        const now = (await read(A, REMOTE, 'tab-mac-5')).body
        expect(text(now, 'm9')).toBe(`{{inlay::${job.inlayId}}}\n\nA later reply.`)
        expect(text(now, 'm1')).toContain(`{{inlay::${inlay}}}`)                    // the first picture is where it was
    }, 40000)

    test('the chat\'s rows: the page asks for them by chat id and sees what was placed a moment ago', async () => {
        const listed = (await api(A, 'GET', '/api/image-jobs?chat=k1')).json.jobs as any[]
        expect(listed.map((j) => j.status).sort()).toEqual(['placed', 'placed'])
        expect(listed.every((j) => j.target.chatId === 'k1' && !('req' in j) && !JSON.stringify(j).includes('"key"'))).toBe(true)
    })

    test('a restart goes on with the queue: a picture being drawn when the server stopped is drawn after it starts, and placed', async () => {
        routerDelayMs = 2500
        const filed = await askFor(A, 'm1', `${CHA}|k1|m1|main#redraw`, 'a redraw')
        await sleep(400)
        await stop()
        routerDelayMs = 100
        await start()
        const job = await until('placed after restart', async () => { const j = await jobStatus(filed.json.id); return j.status === 'placed' ? j : null }, 30000)
        const now = (await read(A, REMOTE, 'tab-mac-6')).body
        // a redraw replaces the message's first picture where it stands
        expect(text(now, 'm1')).toBe(`{{inlay::${job.inlayId}}}\n\nThe door opens.`)
        expect((await jobStatus(filed.json.id)).superseded).toBe(false)
    }, 60000)
})
