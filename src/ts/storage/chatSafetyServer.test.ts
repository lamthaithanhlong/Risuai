// @vitest-environment node
// The real server over HTTP for the fixes of specs/chat (F3, F5, F2 endpoint, F6). Every server here has its own HOME, save directory
// and jobs file: nothing reaches ~/.risu-lan or the owner's server.
import { afterAll, describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, webcrypto } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

const req = createRequire(import.meta.url)
const merge = req('../../../server/node/dbMerge.cjs')
const SERVER = join(__dirname, '../../../server/node/server.cjs')
const hex = (s: string) => Buffer.from(s).toString('hex')
const DB = 'database/database.bin'
const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Key = { jwk: JsonWebKey; priv: CryptoKey }
async function newKey(): Promise<Key> {
    const kp = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    return { jwk: await webcrypto.subtle.exportKey('jwk', kp.publicKey), priv: kp.privateKey }
}
async function token(k: Key) {
    const header = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT' }))
    const now = Math.floor(Date.now() / 1000)
    const payload = b64u(JSON.stringify({ iat: now, exp: now + 300, pub: k.jwk }))
    const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k.priv, Buffer.from(`${header}.${payload}`))
    return `${header}.${payload}.${b64u(Buffer.from(sig))}`
}
const pubHash = (k: Key) => createHash('sha256').update(JSON.stringify(k.jwk)).digest('hex')
function freePort(): Promise<number> {
    return new Promise((resolve) => {
        const s = createServer()
        s.listen(0, '127.0.0.1', () => { const port = (s.address() as any).port; s.close(() => resolve(port)) })
    })
}

type Srv = { proc: ChildProcess; port: number; log: () => string; dir: string }
const started: Srv[] = []
async function startServer(root: string, name: string, keys: Key[], env: Record<string, string> = {}, seed?: (save: string) => void): Promise<Srv> {
    const dir = join(root, name)
    mkdirSync(join(dir, 'save'), { recursive: true })
    writeFileSync(join(dir, 'save', '__known_public_key_hashes.json'), JSON.stringify(keys.map(pubHash)))
    writeFileSync(join(dir, 'save', '__password'), 'pw')
    seed?.(join(dir, 'save'))
    const port = await freePort()
    const home = join(root, 'home')
    mkdirSync(home, { recursive: true })
    const proc = spawn(process.execPath, [SERVER], {
        cwd: dir,
        env: { ...process.env, HOME: home, RISU_JOBS_DB: join(home, 'jobs.sqlite'), PORT: String(port), ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    proc.stdout!.on('data', (d) => { log += d })
    proc.stderr!.on('data', (d) => { log += d })
    const srv = { proc, port, log: () => log, dir }
    started.push(srv)
    for (let i = 0; i < 100; i++) {
        try { await fetch(`http://127.0.0.1:${port}/`); return srv } catch { await sleep(150) }
    }
    throw new Error('server did not start: ' + log)
}
async function stop(s: Srv) {
    if (s.proc.exitCode !== null) return
    await new Promise<void>((resolve) => { s.proc.on('exit', () => resolve()); s.proc.kill('SIGTERM') })
}
afterAll(async () => { for (const s of started) await stop(s) })

async function read(s: Srv, k: Key, tab?: string) {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/read`, { headers: { 'file-path': hex(DB), 'risu-auth': await token(k), ...(tab ? { 'x-risu-tab': tab } : {}) } })
    return Buffer.from(await r.arrayBuffer())
}
async function write(s: Srv, k: Key, body: Buffer, tab?: string) {
    const r = await fetch(`http://127.0.0.1:${s.port}/api/write`, { method: 'POST', body: body as unknown as BodyInit, headers: { 'content-type': 'application/octet-stream', 'file-path': hex(DB), 'risu-auth': await token(k), ...(tab ? { 'x-risu-tab': tab } : {}) } })
    return r.json()
}
const root0 = (v: any) => merge.encodeSave([merge.serializeBlock(1, 0, 'root', { ...v, __directory: [] }), { type: 0, comp: 0, name: 'config', data: Buffer.from('{}') }])
const rootOf = (buf: Buffer) => merge.parseBlock(merge.decodeSave(buf).find((b: any) => b.name === 'root'))
const withRoot = (buf: Buffer, patch: any) => root0({ ...rootOf(buf), ...patch })

describe('F3: two tabs of one browser (one signing key) are two pages', () => {
    test('tab 2 changes maxResponse, tab 1 (loaded before) changes temperature: both stay', async () => {
        const root = mkdtempSync(join(tmpdir(), 'chat-f3-'))
        const browser = await newKey()
        const s = await startServer(root, 'srv', [browser], {}, (save) => writeFileSync(join(save, hex(DB)), root0({ maxResponse: 8000, temperature: 100 })))
        const tab1 = await read(s, browser, 'tab-one-aaaaaaaa')
        const tab2 = await read(s, browser, 'tab-two-bbbbbbbb')
        await write(s, browser, withRoot(tab2, { maxResponse: 1234 }), 'tab-two-bbbbbbbb')
        const r = await write(s, browser, withRoot(tab1, { temperature: 77 }), 'tab-one-aaaaaaaa')
        expect(r.merged).toBe(true)
        const now = rootOf(await read(s, browser, 'tab-three-cccccccc'))
        expect({ maxResponse: now.maxResponse, temperature: now.temperature }).toEqual({ maxResponse: 1234, temperature: 77 })
        await stop(s)
    }, 60000)
})

describe('F5: a second server on the same jobs file', () => {
    test('a reply keeps streaming to its end when another server.cjs starts on the same jobs file', async () => {
        const root = mkdtempSync(join(tmpdir(), 'chat-f5-'))
        const k = await newKey()
        // a fake model: 12 chunks, one every 250 ms
        const up = http.createServer((_req, res) => {
            res.writeHead(200, { 'content-type': 'text/event-stream' })
            let i = 0
            const t = setInterval(() => {
                if (i < 12) res.write(`data: {"choices":[{"delta":{"content":"w${i++} "}}]}\n\n`)
                else { res.write('data: [DONE]\n\n'); res.end(); clearInterval(t) }
            }, 250)
        })
        const upPort = await freePort()
        await new Promise<void>((r) => up.listen(upPort, '127.0.0.1', () => r()))
        const live = await startServer(root, 'live', [k])
        const auth = { 'content-type': 'application/json', 'risu-auth': await token(k) }
        const job = await (await fetch(`http://127.0.0.1:${live.port}/proxy-stream-jobs`, {
            method: 'POST', headers: auth,
            body: JSON.stringify({ url: `http://127.0.0.1:${upPort}/v1/chat/completions`, method: 'POST', bodyBase64: b64u('{}'), idempotencyKey: 'chat-k1:gen-1#0' }),
        })).json()
        await sleep(800)
        const second = await startServer(root, 'second', [k])           // what a test run did with the owner's HOME
        await sleep(4500)
        const text = await (await fetch(`http://127.0.0.1:${live.port}/proxy-stream-jobs/${job.jobId}/events?from=1`, { headers: auth })).text()
        const types = text.trim().split('\n').map((l) => JSON.parse(l)).filter((l) => l.event).map((l) => l.event.type)
        expect(types).not.toContain('error')
        expect(types.at(-1)).toBe('done')
        expect(live.log()).not.toContain('Job store append failed')
        await stop(second)
        await stop(live)
        up.close()
    }, 60000)
})

describe('F2: the server says which chats a job is still answering', () => {
    test('GET /proxy-stream-jobs/running lists the chat of a running job (from its key "<chat id>:<uuid>#n"), then nothing once it is done', async () => {
        const root = mkdtempSync(join(tmpdir(), 'chat-f2-'))
        const k = await newKey()
        // a fake model: 12 chunks, one every 250 ms
        const up = http.createServer((_req, res) => {
            res.writeHead(200, { 'content-type': 'text/event-stream' })
            let i = 0
            const t = setInterval(() => {
                if (i < 12) res.write(`data: {"choices":[{"delta":{"content":"w${i++} "}}]}\n\n`)
                else { res.write('data: [DONE]\n\n'); res.end(); clearInterval(t) }
            }, 250)
        })
        const upPort = await freePort()
        await new Promise<void>((r) => up.listen(upPort, '127.0.0.1', () => r()))
        const live = await startServer(root, 'live', [k])
        const auth = { 'content-type': 'application/json', 'risu-auth': await token(k) }
        await fetch(`http://127.0.0.1:${live.port}/proxy-stream-jobs`, {
            method: 'POST', headers: auth,
            body: JSON.stringify({ url: `http://127.0.0.1:${upPort}/v1/chat/completions`, method: 'POST', bodyBase64: b64u('{}'), idempotencyKey: 'chat-k1:gen-1#0' }),
        })
        await sleep(800)
        const during = await fetch(`http://127.0.0.1:${live.port}/proxy-stream-jobs/running`, { headers: auth })
        expect(during.status).toBe(200)
        expect((await during.json()).chats).toEqual(['chat-k1'])
        await sleep(3500)
        expect((await (await fetch(`http://127.0.0.1:${live.port}/proxy-stream-jobs/running`, { headers: auth })).json()).chats).toEqual([])
        await stop(live)
        up.close()
    }, 60000)
})
