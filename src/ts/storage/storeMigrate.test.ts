// @vitest-environment node
// storeMigrate.cjs: every save/<hex> file into save.store.sqlite and back, each one proved by sha256, idempotent, the files never
// deleted; the CLI refuses a save a live server holds.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const req = createRequire(import.meta.url)
const CLI = join(__dirname, '../../../server/node/storeMigrate.cjs')
const { migrateToSqlite, exportToFiles, compare, needsMigration } = req(CLI)
const { storeFileOf, pidFileOf, openSaveStore } = req('../../../server/node/saveStore.cjs')
const Database = req('better-sqlite3')
const hex = (s: string) => Buffer.from(s).toString('hex')
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const quiet = { fullfsync: false }

let dir: string, save: string
const files: Record<string, Buffer> = {}
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'migrate-')); save = join(dir, 'save'); mkdirSync(save)
    for (const k of Object.keys(files)) delete files[k]
    files['database/database.bin'] = randomBytes(2_000_000)
    files['database/dbbackup-1760000000.bin'] = randomBytes(1000)
    for (let i = 0; i < 30; i++) files[`assets/${i}.png`] = randomBytes(1000 + i * 977)
    files['inlays/9f1c'] = randomBytes(16_000)
    files['remotes/x.local'] = Buffer.from('{"a":1}')
    files['assets/empty.png'] = Buffer.alloc(0)
    for (const [k, v] of Object.entries(files)) writeFileSync(join(save, hex(k)), v)
    utimesSync(join(save, hex('assets/0.png')), new Date(1_700_000_000_000), new Date(1_700_000_000_000))
    writeFileSync(join(save, '__password'), 'pw')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const rowsOf = () => {
    const db = new Database(storeFileOf(save), { readonly: true })
    try { return db.prepare('SELECT path, data, size, mtime, sha256 FROM files').all() as { path: string; data: Buffer; size: number; mtime: number; sha256: string }[] } finally { db.close() }
}

describe('--to sqlite', () => {
    it('copies every key file as a BLOB, verifies each by sha256, leaves the files and the non-key files alone', () => {
        const before = readdirSync(save).sort()
        const r = migrateToSqlite(save, quiet)
        const n = Object.keys(files).length
        expect(r).toMatchObject({ files: n, copied: n, unchanged: 0, verified: n, mismatches: [], onlyInStore: [], storeRows: n })
        expect(r.bytes).toBe(Object.values(files).reduce((a, b) => a + b.length, 0))
        expect(r.nonKey).toEqual(['__password'])
        const rows = rowsOf()
        expect(rows.length).toBe(n)
        for (const row of rows) {
            expect(Buffer.from(row.data).equals(files[row.path])).toBe(true)
            expect(row.sha256).toBe(sha(files[row.path]))
        }
        // the file's mtime comes along (cloudMirror compares size + mtime, so nothing is sent again)
        expect(rows.find((x) => x.path === 'assets/0.png')!.mtime).toBe(1_700_000_000_000)
        expect(readdirSync(save).sort()).toEqual(before)
        expect(needsMigration(save)).toBeNull()
    })

    it('is idempotent: a second run copies nothing; a changed file is copied again', () => {
        migrateToSqlite(save, quiet)
        expect(migrateToSqlite(save, quiet)).toMatchObject({ copied: 0, unchanged: Object.keys(files).length, mismatches: [] })
        writeFileSync(join(save, hex('assets/3.png')), 'changed')
        const r = migrateToSqlite(save, quiet)
        expect(r).toMatchObject({ copied: 1, mismatches: [] })
        expect(rowsOf().find((x) => x.path === 'assets/3.png')!.data.toString()).toBe('changed')
    })

    it('keeps a row with no file unless --prune', () => {
        migrateToSqlite(save, quiet)
        rmSync(join(save, hex('assets/5.png')))
        expect(migrateToSqlite(save, quiet).onlyInStore).toEqual(['assets/5.png'])
        expect(rowsOf().length).toBe(Object.keys(files).length)
        expect(migrateToSqlite(save, { ...quiet, prune: true })).toMatchObject({ pruned: 1, onlyInStore: [] })
        expect(rowsOf().length).toBe(Object.keys(files).length - 1)
    })

    it('a BLOB that does not hash like its file is a mismatch, and the migration is not marked done', () => {
        migrateToSqlite(save, quiet)
        const db = new Database(storeFileOf(save))
        db.prepare("UPDATE files SET data = ? WHERE path = 'assets/7.png'").run(Buffer.from('rot'))
        db.prepare("DELETE FROM meta WHERE k = 'migrated_at'").run()
        db.close()
        const r = migrateToSqlite(save, quiet)
        expect(r.mismatches.length).toBe(1)
        expect(r.mismatches[0]).toMatch(/^assets\/7\.png: file /)
        expect(needsMigration(save)).toMatch(/never filled/)
        expect(compare(save).differ).toEqual(['assets/7.png'])
    })
})

describe('--to files', () => {
    it('writes every row back byte for byte (with its mtime), keeps files that have no row, and verifies', () => {
        migrateToSqlite(save, quiet)
        const s = openSaveStore({ saveDir: save, backend: 'sqlite', ...quiet })
        const pic = randomBytes(50_000)
        s.write(hex('inlays/new'), pic)
        s.write(hex('database/database.bin'), 'newer')
        s.close()
        writeFileSync(join(save, hex('assets/stray.png')), 'stray')
        const r = exportToFiles(save, quiet)
        expect(r).toMatchObject({ rows: Object.keys(files).length + 1, written: 2, mismatches: [], onlyInFiles: ['assets/stray.png'] })
        expect(r.verified).toBe(r.rows)
        expect(readFileSync(join(save, hex('inlays/new'))).equals(pic)).toBe(true)
        expect(readFileSync(join(save, hex('database/database.bin'))).toString()).toBe('newer')
        expect(readFileSync(join(save, hex('assets/stray.png'))).toString()).toBe('stray')
        expect(statSync(join(save, hex('assets/0.png'))).mtimeMs).toBe(1_700_000_000_000)
        expect(compare(save)).toMatchObject({ differ: [], onlyInStore: [], onlyInFiles: ['assets/stray.png'] })
        // export then migrate is a round trip that changes nothing
        expect(migrateToSqlite(save, quiet)).toMatchObject({ copied: 1, mismatches: [] })   // only the stray file is new to the store
    })
})

describe('the command line', () => {
    const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
    it('migrates, checks, and refuses a save a live server holds', () => {
        const a = run(save, '--to', 'sqlite')
        expect(a.status).toBe(0)
        expect(a.stdout).toMatch(new RegExp(`sha256 verified ${Object.keys(files).length}/${Object.keys(files).length}`))
        expect(a.stdout).toMatch(/left as files \(not part of the file API\): __password/)
        expect(run(save, '--check').status).toBe(0)
        writeFileSync(join(save, hex('assets/1.png')), 'drift')
        const c = run(save, '--check')
        expect(c.status).toBe(1)
        expect(c.stdout).toMatch(/differ 1/)
        writeFileSync(pidFileOf(save), String(process.pid))          // this test process stands in for a live server
        const d = run(save, '--to', 'sqlite')
        expect(d.status).toBe(1)
        expect(d.stderr).toMatch(/is serving/)
        expect(run(save).status).toBe(2)
    })
})
