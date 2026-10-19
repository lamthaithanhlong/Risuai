// The save, behind one module: every server path that reads or writes a stored file goes through openSaveStore().
//
// Why (2026-10-19, owner: "Data lưu dưới sqlite cả hình nữa"): the save was 2900 loose files, save/<hex of the path>: card images,
// portraits, scene pictures (inlays/), database.bin and its backups. A picture drawn on the Mac did not show on the phone (10-15)
// and a copy, a backup or a sync of the save meant walking 586 MB of small files. Now the bytes can live in one SQLite file,
// save.store.sqlite, next to save.queue.sqlite and the others: images as BLOBs, not base64.
//
// Two backends, chosen by RISU_STORE=sqlite|files (resolveBackend, default sqlite):
//   files   the directory, exactly as before (atomic rename on write, readdir on list).
//   sqlite  table files(key, path, data BLOB, size, mtime, sha256). WAL, synchronous=FULL and fullfsync like the save queue: the
//           queue deletes its row once apply() returns, so the store's commit must be on the disk by then.
//
// Keys are the hex file names the HTTP API already uses (/api/read file-path header). `path` is the same key decoded, for people
// reading the table. In the sqlite backend keys are lower-cased: the directory on macOS is case-insensitive, so "AB" and "ab" were
// one file there and must stay one row here.
//
// update(key, fn) is the read-modify-write: in the sqlite backend the read, fn and the write run in ONE BEGIN IMMEDIATE transaction,
// so a second writer (another process: loreImport, the migration) waits for the first to commit and then reads what it wrote; two
// writers can never both read the old bytes and each write their own new bytes (specs/core/SaveStore.tla, LostUpdate). The files
// backend has no lock across processes; there update() is a plain read then write, as the code did before.
//
// The rollback guard (the files and the store must never silently disagree):
//   meta write_seq     bumped by every write through this module (not by the migration)
//   meta synced_seq    write_seq at the last migration or export: the files and the store were equal then
//   meta files_epoch   bumped each time the files backend opens a save that has a store
//   meta synced_epoch  files_epoch at the last migration from the files
// files backend opening a save whose store has write_seq > synced_seq: the store holds writes the files do not -> refuse (export first).
// sqlite backend opening a save whose store is missing or has files_epoch > synced_epoch: the files may be newer -> migrate first.
// Because of the first rule, that migration can only bring the files' newer bytes in; it never overwrites newer store bytes.

const fs = require('fs')
const fsp = require('fs/promises')
const path = require('path')
const crypto = require('crypto')
const { atomicWriteFile } = require('./atomicWrite.cjs')

// sqlite since the copy of the live save passed the store gate (2026-10-19); RISU_STORE=files is the rollback
const DEFAULT_BACKEND = 'sqlite'
const BACKENDS = ['files', 'sqlite']
const KEY_RE = /^[0-9a-fA-F]+$/

function resolveBackend(env = process.env) {
    const v = String(env.RISU_STORE ?? '').trim().toLowerCase()
    if (!v) return DEFAULT_BACKEND
    if (!BACKENDS.includes(v)) throw new Error(`RISU_STORE must be "sqlite" or "files", not "${env.RISU_STORE}"`)
    return v
}

const storeFileOf = (saveDir) => path.resolve(saveDir) + '.store.sqlite'
const isKey = (name) => KEY_RE.test(name)
const keyToPath = (hex) => Buffer.from(hex, 'hex').toString('utf-8')
const pathToKey = (p) => Buffer.from(p, 'utf-8').toString('hex')
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')
const toBuffer = (data) => (Buffer.isBuffer(data) ? data : typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data))

function loadDriver() {
    try {
        return require('better-sqlite3')
    } catch (error) {
        throw new Error(`better-sqlite3 is not available (${error.message}). Run "pnpm install", and "pnpm rebuild better-sqlite3" if its native binding was not built.`)
    }
}

// ---- the sqlite file, shared by the backend and the migration ---------------------------------------------------------------
function openDb(dbFile, { readonly = false, fullfsync = true, busyMs = 15000 } = {}) {
    const Database = loadDriver()
    const db = new Database(dbFile, readonly ? { readonly: true, fileMustExist: true } : {})
    db.pragma(`busy_timeout = ${busyMs}`)
    if (readonly) return db
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = FULL')
    const ff = fullfsync ? 'ON' : 'OFF'
    db.pragma(`fullfsync = ${ff}`)
    db.pragma(`checkpoint_fullfsync = ${ff}`)
    // database.bin is 2-8 MB and replaced every few seconds while a chat runs: keep the WAL from staying at its high-water mark
    db.pragma('journal_size_limit = 67108864')
    db.exec(`
        CREATE TABLE IF NOT EXISTS files (
            key TEXT PRIMARY KEY,          -- the hex file name the API uses (lower case)
            path TEXT NOT NULL,            -- the same, decoded: database/database.bin, assets/<sha>.png, inlays/<uuid>
            data BLOB NOT NULL,
            size INTEGER NOT NULL,
            mtime INTEGER NOT NULL,        -- ms; the file's mtime when it was migrated, else the time of the write
            sha256 TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS files_path ON files (path);
        CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `)
    return db
}

function metaOps(db) {
    const get = db.prepare('SELECT v FROM meta WHERE k = ?')
    const set = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    const num = (k) => Number(get.get(k)?.v ?? 0)
    return {
        get: (k) => get.get(k)?.v ?? null,
        num,
        set: (k, v) => set.run(k, String(v)),
        bump: (k) => { const n = num(k) + 1; set.run(k, String(n)); return n },
    }
}

function tableOps(db) {
    return {
        get: db.prepare('SELECT data FROM files WHERE key = ?').pluck(),
        has: db.prepare('SELECT 1 FROM files WHERE key = ?').pluck(),
        stat: db.prepare('SELECT size, mtime, sha256 FROM files WHERE key = ?'),
        keys: db.prepare('SELECT key FROM files ORDER BY key').pluck(),
        rows: db.prepare('SELECT key, size, mtime, sha256 FROM files ORDER BY key'),
        put: db.prepare(`INSERT INTO files (key, path, data, size, mtime, sha256) VALUES (@key, @path, @data, @size, @mtime, @sha256)
            ON CONFLICT(key) DO UPDATE SET path = excluded.path, data = excluded.data, size = excluded.size, mtime = excluded.mtime, sha256 = excluded.sha256`),
        del: db.prepare('DELETE FROM files WHERE key = ?'),
        count: db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM files'),
    }
}

const rowOf = (key, data, mtime) => ({ key, path: keyToPath(key), data, size: data.length, mtime: Math.floor(mtime), sha256: sha256(data) })

// ---- files backend ------------------------------------------------------------------------------------------------------------
function filesBackend(saveDir, opts) {
    const tmpDir = opts.tmpDir ?? saveDir + '.tmp'
    const fileOf = (key) => path.join(saveDir, key)
    const writeSync = (key, data) => {
        // the same promise as atomicWriteFile: the old bytes or the new bytes, never half a file
        fs.mkdirSync(tmpDir, { recursive: true })
        const tmp = path.join(tmpDir, `${key}.${process.pid}.${crypto.randomBytes(6).toString('hex')}`)
        try {
            const fd = fs.openSync(tmp, 'w')
            try { fs.writeFileSync(fd, data); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
            fs.renameSync(tmp, fileOf(key))
        } catch (error) {
            fs.rmSync(tmp, { force: true })
            throw error
        }
    }
    const read = (key) => { try { return fs.readFileSync(fileOf(key)) } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
    return {
        backend: 'files',
        saveDir,
        filePath: fileOf,
        read,
        exists: (key) => fs.existsSync(fileOf(key)),
        stat(key) {
            try { const st = fs.statSync(fileOf(key)); return { size: st.size, mtimeMs: Math.floor(st.mtimeMs) } } catch { return null }
        },
        // every name in the directory, as /api/list always listed it
        list: () => fs.readdirSync(saveDir),
        write(key, data) { writeSync(key, toBuffer(data)) },
        remove(key) { fs.rmSync(fileOf(key), { force: true }) },
        // what the save queue's worker calls: the async write it always did (fsync the file and the directory)
        async writeAsync(key, data) { await atomicWriteFile(fileOf(key), toBuffer(data), { tmpDir, sync: true, syncDir: true }) },
        async removeAsync(key) { await fsp.rm(fileOf(key), { force: true }) },
        // no lock across processes here: read, then write (what the code did before the store)
        update(key, fn) {
            const next = fn(read(key))
            if (next === undefined) return undefined
            if (next === null) this.remove(key); else this.write(key, next)
            return next
        },
        close() {},
    }
}

// ---- sqlite backend -------------------------------------------------------------------------------------------------------
function sqliteBackend(saveDir, dbFile, opts) {
    const readonly = !!opts.readonly
    const db = openDb(dbFile, { readonly, fullfsync: opts.fullfsync ?? true })
    const t = tableOps(db)
    const meta = readonly ? null : metaOps(db)
    const now = opts.now ?? Date.now
    const norm = (key) => {
        if (typeof key !== 'string' || !isKey(key)) throw new Error(`not a hex key: ${String(key).slice(0, 40)}`)
        return key.toLowerCase()
    }
    const putTx = readonly ? null : db.transaction((key, data) => { t.put.run(rowOf(key, data, now())); meta.bump('write_seq') }).immediate
    const delTx = readonly ? null : db.transaction((key) => { if (t.del.run(key).changes) meta.bump('write_seq') }).immediate
    const updTx = readonly ? null : db.transaction((key, fn) => {
        const cur = t.get.get(key)
        const next = fn(cur ? Buffer.from(cur) : null)
        if (next === undefined) return undefined
        if (next === null) { if (t.del.run(key).changes) meta.bump('write_seq') }
        else { t.put.run(rowOf(key, toBuffer(next), now())); meta.bump('write_seq') }
        return next
    }).immediate
    const ro = () => { if (readonly) throw new Error('the store was opened read-only') }
    const store = {
        backend: 'sqlite',
        saveDir,
        dbFile,
        db,
        read(key) { const d = t.get.get(norm(key)); return d ? Buffer.from(d) : null },
        exists: (key) => !!t.has.get(norm(key)),
        stat(key) { const r = t.stat.get(norm(key)); return r ? { size: r.size, mtimeMs: r.mtime, sha256: r.sha256 } : null },
        list: () => t.keys.all(),
        rows: () => t.rows.all(),
        count: () => t.count.get(),
        write(key, data) { ro(); putTx(norm(key), toBuffer(data)) },
        remove(key) { ro(); delTx(norm(key)) },
        async writeAsync(key, data) { store.write(key, data) },
        async removeAsync(key) { store.remove(key) },
        /** fn(current Buffer|null) -> new bytes | null (delete) | undefined (no change); read, fn and write are one transaction */
        update(key, fn) { ro(); return updTx(norm(key), fn) },
        meta: () => Object.fromEntries(db.prepare('SELECT k, v FROM meta').all().map((r) => [r.k, r.v])),
        close() { db.close() },
    }
    return store
}

/**
 * Opens the save of `saveDir` with the given backend.
 *   opts.backend    'files' | 'sqlite' (default: resolveBackend(process.env))
 *   opts.dbFile     the store file (default <saveDir>.store.sqlite)
 *   opts.readonly   sqlite: open read-only, no migration, no guard writes (cloudMirror)
 *   opts.migrate    sqlite: when the store is missing or the files backend ran since the last migration, migrate first (default true)
 *   opts.ignoreNewer files: open even though the store has writes the files lack (RISU_STORE_IGNORE_NEWER=1)
 */
function openSaveStore(opts) {
    const saveDir = path.resolve(opts.saveDir)
    const backend = opts.backend ?? resolveBackend()
    const dbFile = opts.dbFile ?? storeFileOf(saveDir)
    const log = opts.log ?? (() => {})
    if (!BACKENDS.includes(backend)) throw new Error(`unknown store backend ${backend}`)
    if (backend === 'files') {
        if (!opts.readonly && fs.existsSync(dbFile)) {
            const db = openDb(dbFile, { fullfsync: opts.fullfsync ?? true })
            try {
                const m = metaOps(db)
                const ahead = m.num('write_seq') - m.num('synced_seq')
                if (ahead > 0 && !(opts.ignoreNewer ?? process.env.RISU_STORE_IGNORE_NEWER === '1')) {
                    throw new Error(`${path.basename(dbFile)} holds ${ahead} write(s) the files in ${saveDir} do not have. ` +
                        `Export them first (node server/node/storeMigrate.cjs ${saveDir} --to files) or run with RISU_STORE=sqlite. ` +
                        `RISU_STORE_IGNORE_NEWER=1 opens the files anyway.`)
                }
                // the files may now move ahead of the store: the sqlite backend migrates again before it serves
                m.bump('files_epoch')
            } finally { db.close() }
        }
        return filesBackend(saveDir, opts)
    }
    if (!opts.readonly && (opts.migrate ?? true)) {
        const { needsMigration, migrateToSqlite } = require('./storeMigrate.cjs')
        const why = needsMigration(saveDir, dbFile)
        if (why) {
            log(`store: ${why}; copying the files into ${path.basename(dbFile)}`)
            const r = migrateToSqlite(saveDir, { dbFile, log })
            if (r.mismatches.length) throw new Error(`store migration did not verify: ${r.mismatches.length} mismatch(es), first ${r.mismatches[0]}`)
            log(`store: ${r.files} files, ${r.bytes} bytes, ${r.copied} copied, ${r.unchanged} unchanged, sha256 verified ${r.verified}/${r.files}`)
        }
    }
    return sqliteBackend(saveDir, dbFile, opts)
}

// The server writes its pid next to the save while it runs, so the offline tools (storeMigrate, loreImport) can tell that this
// save is being served, whatever port it is on.
const pidFileOf = (saveDir) => path.resolve(saveDir) + '.server.pid'
function servingPid(saveDir) {
    let pid = 0
    try { pid = Number(fs.readFileSync(pidFileOf(saveDir), 'utf8').trim()) } catch { return 0 }
    if (!pid || pid === process.pid) return 0
    try { process.kill(pid, 0); return pid } catch (e) { return e.code === 'EPERM' ? pid : 0 }
}

module.exports = { pidFileOf, servingPid, openSaveStore, resolveBackend, storeFileOf, openDb, metaOps, tableOps, rowOf, isKey, keyToPath, pathToKey, sha256, DEFAULT_BACKEND }
