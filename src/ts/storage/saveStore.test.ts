// @vitest-environment node
// The save behind one module (server/node/saveStore.cjs): the same calls on the files and on save.store.sqlite, images as BLOBs,
// the read-modify-write as one transaction (no lost update across processes), and the guard that keeps the two backends honest.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const req = createRequire(import.meta.url)
const STORE = join(__dirname, '../../../server/node/saveStore.cjs')
const { openSaveStore, resolveBackend, storeFileOf, servingPid, pidFileOf } = req(STORE)
const Database = req('better-sqlite3')
const hex = (s: string) => Buffer.from(s).toString('hex')
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

let dir: string, save: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'store-')); save = join(dir, 'save'); mkdirSync(save) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const open = (backend: 'files' | 'sqlite', extra: Record<string, unknown> = {}) => openSaveStore({ saveDir: save, backend, fullfsync: false, ...extra })

describe('RISU_STORE', () => {
    it('picks the backend, defaults to files, refuses anything else', () => {
        expect(resolveBackend({})).toBe('files')
        expect(resolveBackend({ RISU_STORE: 'sqlite' })).toBe('sqlite')
        expect(resolveBackend({ RISU_STORE: ' Files ' })).toBe('files')
        expect(() => resolveBackend({ RISU_STORE: 'sqlite3' })).toThrow(/RISU_STORE/)
    })
})

describe.each(['files', 'sqlite'] as const)('the %s backend', (backend) => {
    it('writes, reads, lists, stats and removes; a missing key reads null and removes quietly', () => {
        const s = open(backend)
        try {
            const img = randomBytes(300_000)
            img[0] = 0; img[1] = 0                         // a BLOB, not a C string: zero bytes survive
            s.write(hex('assets/a.png'), img)
            s.write(hex('inlays/u1'), 'text body')
            expect(s.read(hex('assets/a.png'))!.equals(img)).toBe(true)
            expect(s.read(hex('inlays/u1'))!.toString()).toBe('text body')
            expect(s.read(hex('nothing'))).toBeNull()
            expect(s.exists(hex('assets/a.png'))).toBe(true)
            expect(s.exists(hex('nothing'))).toBe(false)
            expect(s.stat(hex('assets/a.png'))!.size).toBe(img.length)
            expect(s.list().sort()).toEqual([hex('assets/a.png'), hex('inlays/u1')].sort())
            s.remove(hex('assets/a.png'))
            s.remove(hex('nothing'))
            expect(s.read(hex('assets/a.png'))).toBeNull()
            expect(s.list()).toEqual([hex('inlays/u1')])
        } finally { s.close() }
    })

    it('replaces a value whole (atomic replace), also through the async calls the save queue uses', async () => {
        const s = open(backend)
        try {
            await s.writeAsync(hex('database/database.bin'), Buffer.alloc(5_000_000, 1))
            await s.writeAsync(hex('database/database.bin'), Buffer.from('short'))
            expect(s.read(hex('database/database.bin'))!.toString()).toBe('short')
            await s.removeAsync(hex('database/database.bin'))
            expect(s.read(hex('database/database.bin'))).toBeNull()
        } finally { s.close() }
    })

    it('update(): fn gets the current bytes; null deletes, undefined leaves it', () => {
        const s = open(backend)
        try {
            const k = hex('database/database.bin')
            expect(s.update(k, (cur: Buffer | null) => { expect(cur).toBeNull(); return Buffer.from('1') })!.toString()).toBe('1')
            s.update(k, (cur: Buffer | null) => Buffer.from(String(Number(cur!.toString()) + 1)))
            expect(s.read(k)!.toString()).toBe('2')
            expect(s.update(k, () => undefined)).toBeUndefined()
            expect(s.read(k)!.toString()).toBe('2')
            s.update(k, () => null)
            expect(s.read(k)).toBeNull()
        } finally { s.close() }
    })
})

describe('the sqlite table', () => {
    it('keeps the bytes as a BLOB with size, sha256 and the decoded path; keys are lower-cased like the case-insensitive directory', () => {
        const s = open('sqlite')
        const img = randomBytes(4096)
        try {
            s.write(hex('assets/x.webp').toUpperCase(), img)
            expect(s.read(hex('assets/x.webp'))!.equals(img)).toBe(true)
            expect(s.list()).toEqual([hex('assets/x.webp')])
        } finally { s.close() }
        const db = new Database(storeFileOf(save), { readonly: true })
        try {
            const row = db.prepare('SELECT key, path, typeof(data) AS t, size, sha256 FROM files').get()
            expect(row).toEqual({ key: hex('assets/x.webp'), path: 'assets/x.webp', t: 'blob', size: 4096, sha256: sha(img) })
            expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
        } finally { db.close() }
    })

    it('refuses a key that is not hex', () => {
        const s = open('sqlite')
        try { expect(() => s.write('../etc/passwd', 'x')).toThrow(/hex/) } finally { s.close() }
    })

    it('a read-only open (cloudMirror) reads, cannot write, and sees later commits', () => {
        const w = open('sqlite')
        const r = open('sqlite', { readonly: true })
        try {
            w.write(hex('a'), 'one')
            expect(r.read(hex('a'))!.toString()).toBe('one')
            w.write(hex('a'), 'two')
            expect(r.read(hex('a'))!.toString()).toBe('two')
            expect(() => r.write(hex('a'), 'x')).toThrow(/read-only/)
        } finally { r.close(); w.close() }
    })
})

// N processes each add 1 to a counter M times through update(). With the read and the write in one BEGIN IMMEDIATE transaction
// the total is N*M; the same work as a read followed by a separate write loses increments (the second half proves the test can
// see a lost update at all).
function counterWorker(saveDir: string, mode: 'update' | 'naive', times: number) {
    const code = `
        const { openSaveStore } = require(${JSON.stringify(STORE)})
        const s = openSaveStore({ saveDir: ${JSON.stringify(saveDir)}, backend: 'sqlite', fullfsync: false, migrate: false })
        const k = ${JSON.stringify(hex('database/database.bin'))}
        const spin = () => { const t = Date.now() + Math.random() * 2; while (Date.now() < t) {} }
        for (let i = 0; i < ${times}; i++) {
            if (${JSON.stringify(mode)} === 'update') {
                s.update(k, (cur) => { const n = Number(cur.toString()); spin(); return Buffer.from(String(n + 1)) })
            } else {
                const n = Number(s.read(k).toString()); spin(); s.write(k, Buffer.from(String(n + 1)))
            }
        }
        s.close()`
    return new Promise<number | null>((resolve) => {
        const p = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'inherit'] })
        p.on('exit', (c) => resolve(c))
    })
}

describe('read-modify-write across processes', () => {
    const N = 4, M = 60
    it.each([['update', N * M], ['naive', -1]] as const)('%s', async (mode, want) => {
        const s = open('sqlite')
        s.write(hex('database/database.bin'), '0')
        s.close()
        const codes = await Promise.all(Array.from({ length: N }, () => counterWorker(save, mode, M)))
        expect(codes).toEqual(Array(N).fill(0))
        const r = open('sqlite')
        const total = Number(r.read(hex('database/database.bin'))!.toString())
        r.close()
        if (want > 0) expect(total).toBe(want)
        else expect(total).toBeLessThan(N * M)        // lost updates: the race exists, and update() is what closes it
    }, 60_000)
})

describe('atomic replace under a concurrent reader', () => {
    it('a reader in another process sees one whole version or the other, never a mix', async () => {
        const A = Buffer.alloc(3_000_000, 0x41), B = Buffer.alloc(1_000_000, 0x42)
        const good = new Set([sha(A), sha(B)])
        const s = open('sqlite')
        s.write(hex('k'), A)
        const code = `
            const crypto = require('crypto')
            const { openSaveStore } = require(${JSON.stringify(STORE)})
            const s = openSaveStore({ saveDir: ${JSON.stringify(save)}, backend: 'sqlite', readonly: true })
            const seen = new Set()
            const end = Date.now() + 1500
            while (Date.now() < end) seen.add(crypto.createHash('sha256').update(s.read(${JSON.stringify(hex('k'))})).digest('hex'))
            console.log(JSON.stringify([...seen]))`
        const out = new Promise<string>((resolve) => {
            const p = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] })
            let o = ''; p.stdout.on('data', (d) => (o += d)); p.on('exit', () => resolve(o))
        })
        const end = Date.now() + 1500
        let i = 0
        while (Date.now() < end) { s.write(hex('k'), i++ % 2 ? A : B); await new Promise((r) => setImmediate(r)) }
        s.close()
        const seen: string[] = JSON.parse(await out)
        expect(seen.length).toBeGreaterThan(0)
        for (const h of seen) expect(good.has(h)).toBe(true)
    }, 20_000)
})

describe('the guard between the two backends', () => {
    it('sqlite on a save that has only files migrates it first; the files stay', () => {
        writeFileSync(join(save, hex('database/database.bin')), 'db')
        writeFileSync(join(save, '__password'), 'pw')
        const logs: string[] = []
        const s = open('sqlite', { log: (m: string) => logs.push(m) })
        try {
            expect(s.read(hex('database/database.bin'))!.toString()).toBe('db')
            expect(s.list()).toEqual([hex('database/database.bin')])
            expect(logs.join('\n')).toMatch(/no store yet/)
        } finally { s.close() }
        expect(readdirSync(save).sort()).toEqual(['__password', hex('database/database.bin')].sort())
    })

    it('files refuses a save whose store has writes the files lack; after an export it opens', () => {
        writeFileSync(join(save, hex('database/database.bin')), 'v1')
        const s = open('sqlite')
        s.write(hex('database/database.bin'), 'v2')
        s.close()
        expect(() => open('files')).toThrow(/holds 1 write\(s\) the files .* do not have/)
        expect(open('files', { ignoreNewer: true }).read(hex('database/database.bin'))!.toString()).toBe('v1')
        req('../../../server/node/storeMigrate.cjs').exportToFiles(save, { fullfsync: false })
        const f = open('files')
        expect(f.read(hex('database/database.bin'))!.toString()).toBe('v2')
        f.close()
    })

    it('after the files backend ran, sqlite migrates again and serves what the files have now', () => {
        writeFileSync(join(save, hex('database/database.bin')), 'v1')
        open('sqlite').close()
        const f = open('files')                         // the files move ahead of the store
        f.write(hex('database/database.bin'), 'v3')
        f.close()
        const s = open('sqlite')
        try { expect(s.read(hex('database/database.bin'))!.toString()).toBe('v3') } finally { s.close() }
    })
})

describe('the pid file', () => {
    it('names a live server for this save; a dead pid or our own is not one', () => {
        expect(servingPid(save)).toBe(0)
        writeFileSync(pidFileOf(save), String(process.ppid))
        expect(servingPid(save)).toBe(process.ppid)
        writeFileSync(pidFileOf(save), '999999')
        expect(servingPid(save)).toBe(0)
        writeFileSync(pidFileOf(save), String(process.pid))
        expect(servingPid(save)).toBe(0)
        expect(existsSync(pidFileOf(save))).toBe(true)
        expect(readFileSync(pidFileOf(save), 'utf8')).toBe(String(process.pid))
    })
})
