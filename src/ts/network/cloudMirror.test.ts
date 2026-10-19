// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'

const SCRIPT = join(__dirname, '../../../server/node/cloudMirror.cjs')
const { openSaveStore } = createRequire(import.meta.url)('../../../server/node/saveStore.cjs')
// every case runs on the files and on the sqlite store (saveStore.cjs, RISU_STORE): the mirror reads the save the way the server keeps it
let backend: 'files' | 'sqlite' = 'files'
const hex = (s: string) => Buffer.from(s).toString('hex')

// a database.bin in the block format: magic, then [type, compressed, nameLen, name, len(u32 le), data] blocks
function makeDb(token = 'tok-1') {
    const root = Buffer.from(JSON.stringify({ account: { token } }))
    const head = Buffer.from('RISUSAVE\0')
    const len = Buffer.alloc(4)
    len.writeUInt32LE(root.length)
    return Buffer.concat([head, Buffer.from([1, 0, 4]), Buffer.from('root'), len, root])
}

type Hit = { key: string; auth: string; session: string; body: Buffer }

let dir: string
let save: string
let state: string
let server: Server
let hits: Hit[]
let behaviour: (key: string, n: number, hit: Hit) => { status: number; text?: string; headers?: Record<string, string> } | void

beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mirror-'))
    save = join(dir, 'save')
    state = join(dir, 'state.json')
    require('node:fs').mkdirSync(save)
    hits = []
    behaviour = () => undefined
    server = createServer((req, res) => {
        if (req.url?.startsWith('/api/account/getsessionnumber')) {
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ sessionNumber: 7 }))
            return
        }
        const chunks: Buffer[] = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
            const hit: Hit = {
                key: String(req.headers['x-risu-key']),
                auth: String(req.headers['x-risu-auth']),
                session: String(req.headers['x-risu-session']),
                body: Buffer.concat(chunks),
            }
            hits.push(hit)
            const n = hits.filter((h) => h.key === hit.key).length
            const r = behaviour(hit.key, n, hit) || { status: 200, text: hit.key }
            for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v)
            res.statusCode = r.status
            res.end(r.text ?? '')
        })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
})

afterEach(async () => {
    await new Promise((r) => server.close(r))
    rmSync(dir, { recursive: true, force: true })
})

function put(key: string, data: Buffer | string) {
    if (backend === 'files') { writeFileSync(join(save, hex(key)), data); return }
    const st = openSaveStore({ saveDir: save, backend: 'sqlite', fullfsync: false })
    try { st.write(hex(key), data) } finally { st.close() }
}

function run(extra: string[] = [], env: Record<string, string> = {}) {
    return new Promise<{ code: number | null; out: string }>((resolve) => {
        const p = spawn(process.execPath, [SCRIPT, '--once', ...extra], {
            env: {
                ...process.env,
                RISU_SAVE_DIR: save,
                RISU_HUB_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
                RISU_MIRROR_STATE: state,
                RISU_STORE: backend,
                ...env,
            },
        })
        let out = ''
        p.stdout.on('data', (d) => (out += d))
        p.stderr.on('data', (d) => (out += d))
        p.on('close', (code) => resolve({ code, out }))
    })
}

describe.each(['files', 'sqlite'] as const)('cloud mirror (%s)', (b) => {
    beforeEach(() => { backend = b })
    it('sends assets first and the database last, skips backups, and the session and token ride along', async () => {
        put('database/database.bin', makeDb())
        put('database/dbbackup-1.bin', 'backup')
        put('remotes/x', 'pointer')
        put('assets/a.png', 'AAA')
        put('assets/b.png', 'BBB')
        const r = await run()
        expect(r.code).toBe(0)
        // assets go up in parallel (cloudMirror.cjs WORKERS), so they may arrive in any order: a slow a.png next to a small
        // b.png reached the hub second and this test failed now and then. What must hold is which files go, and the
        // database strictly after every asset.
        expect(hits.slice(0, -1).map((h) => h.key).sort()).toEqual(['assets/a.png', 'assets/b.png'])
        expect(hits[hits.length - 1].key).toBe('database/database.bin')
        expect(hits.every((h) => h.auth === 'tok-1' && h.session === '7')).toBe(true)
        expect(hits.find((h) => h.key === 'database/database.bin')!.body.equals(makeDb())).toBe(true)
        expect(r.out).not.toContain('tok-1')
    })

    it('is resumable: a second run sends nothing, a changed file is sent again', async () => {
        put('database/database.bin', makeDb())
        put('assets/a.png', 'AAA')
        await run()
        const first = hits.length
        await run()
        expect(hits.length).toBe(first)
        put('assets/a.png', 'AAAA-changed')
        await run()
        expect(hits.filter((h) => h.key === 'assets/a.png').length).toBe(2)
    })

    it('holds the database back when the hub renamed an asset, also on later runs', async () => {
        put('database/database.bin', makeDb())
        put('assets/a.png', 'AAA')
        behaviour = (key) => (key === 'assets/a.png' ? { status: 200, text: 'assets/other-name.png' } : undefined)
        let r = await run()
        expect(hits.some((h) => h.key === 'database/database.bin')).toBe(false)
        expect(r.out).toContain('renamed')
        behaviour = () => undefined
        put('assets/b.png', 'BBB') // a new asset makes the second run do work with renamed = 0 in that run
        r = await run()
        expect(hits.some((h) => h.key === 'database/database.bin')).toBe(false)
    })

    it('does not send a database that is torn (half written)', async () => {
        const db = makeDb()
        put('database/database.bin', db.subarray(0, db.length - 3))
        put('assets/a.png', 'AAA')
        // the token cannot be read from a torn file, so give it through the environment
        const r = await run([], { RISU_ACCOUNT_TOKEN: 'tok-env' })
        expect(hits.some((h) => h.key === 'database/database.bin')).toBe(false)
        expect(r.out).toContain('being written')
    })

    it('does not send the database when an asset appeared while the pass ran', async () => {
        put('database/database.bin', makeDb())
        put('assets/a.png', 'AAA')
        behaviour = (key, n, hit) => {
            if (key === 'assets/a.png' && n === 1) put('assets/late.png', 'LATE')
            return undefined
        }
        const r = await run()
        expect(hits.some((h) => h.key === 'database/database.bin')).toBe(false)
        expect(r.out).toContain('not in the account yet')
        // the next run picks up the late asset and then the database
        behaviour = () => undefined
        await run()
        expect(hits.some((h) => h.key === 'assets/late.png')).toBe(true)
        expect(hits[hits.length - 1].key).toBe('database/database.bin')
    })

    it('retries a 5xx from the hub', async () => {
        put('database/database.bin', makeDb())
        put('assets/a.png', 'AAA')
        behaviour = (key, n) => (key === 'assets/a.png' && n === 1 ? { status: 503, text: 'busy' } : undefined)
        const r = await run()
        expect(r.code).toBe(0)
        expect(hits.filter((h) => h.key === 'assets/a.png').length).toBe(2)
        expect(existsSync(state) && JSON.parse(readFileSync(state, 'utf8')).done['assets/a.png']).toBeTruthy()
    }, 20000)

    it('stops with exit code 2 when the token is refused, and never prints it', async () => {
        put('database/database.bin', makeDb('secret-token-value'))
        put('assets/a.png', 'AAA')
        behaviour = () => ({ status: 403, text: 'no' })
        const r = await run()
        expect(r.code).toBe(2)
        expect(r.out).toContain('STOPPED')
        expect(r.out).not.toContain('secret-token-value')
    })

    // specs/mirror/MirrorRace.tla: TLC found that checking "every asset is in the account" BEFORE reading the database lets a chat
    // add an asset and save in between. This drives exactly that interleaving in-process through the test seam.
    it('does not send a database saved after the last check (the race TLC found)', async () => {
        put('database/database.bin', makeDb())
        put('assets/a.png', 'AAA')
        const saved = { ...process.env }
        process.env.RISU_SAVE_DIR = save
        process.env.RISU_HUB_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        process.env.RISU_MIRROR_STATE = state
        process.env.RISU_STORE = backend
        const req = createRequire(import.meta.url)
        const path = req.resolve(SCRIPT)
        delete req.cache[path]
        const mirror = req(SCRIPT)
        try {
            mirror.hooks.beforeDbRead = () => {
                put('assets/late.png', 'LATE')            // a chat adds an asset...
                put('database/database.bin', makeDb('tok-2')) // ...and saves the database that points at it
            }
            const st = mirror.loadState()
            await mirror.pass(new mirror.Cloud('tok-1'), st)
            expect(hits.some((h) => h.key === 'database/database.bin')).toBe(false)
            mirror.hooks.beforeDbRead = () => {}
            await mirror.pass(new mirror.Cloud('tok-1'), st)
            expect(hits.some((h) => h.key === 'assets/late.png')).toBe(true)
            expect(hits[hits.length - 1].key).toBe('database/database.bin')
        } finally {
            process.env = saved
            delete req.cache[path]
        }
    })
})
