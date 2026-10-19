#!/usr/bin/env node
// Copies the save between its two backends (saveStore.cjs) and proves the copy byte for byte.
//
//   node server/node/storeMigrate.cjs <save dir> --to sqlite [--prune]   every save/<hex> file into <save dir>.store.sqlite
//   node server/node/storeMigrate.cjs <save dir> --to files              every row back out to save/<hex> (the rollback)
//   node server/node/storeMigrate.cjs <save dir> --check                 compare the two, change nothing
//
// --to sqlite: a row is written only when its sha256 differs from the file's, so a second run copies nothing (idempotent). Then
// every file is read again and hashed, and so is every stored BLOB; the run passes only when the counts match and every hash
// matches. The files directory is never changed or deleted: it is the rollback. Rows with no file are kept and listed unless
// --prune is given (the files are then the whole truth). The non-hex files (__password, __known_public_key_hashes.json) are not
// part of the file API and stay files.
// --to files: each row is written over its file atomically (only when the bytes differ) and verified the same way; files that have
// no row are left alone and listed.
// Both refuse while a server is serving this save (its pid file <save dir>.server.pid names a live process).
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { openDb, metaOps, tableOps, rowOf, isKey, keyToPath, sha256, storeFileOf, servingPid } = require('./saveStore.cjs')

const BATCH_BYTES = 64 * 1024 * 1024
const BATCH_FILES = 500

function keyFiles(saveDir) {
    const keys = [], other = []
    for (const ent of fs.readdirSync(saveDir, { withFileTypes: true })) {
        if (ent.isFile() && isKey(ent.name)) keys.push(ent.name)
        else other.push(ent.name)
    }
    keys.sort()
    return { keys, other }
}

/** why the sqlite backend must migrate before it serves, or null */
function needsMigration(saveDir, dbFile = storeFileOf(saveDir)) {
    if (!fs.existsSync(dbFile)) return 'no store yet'
    const db = openDb(dbFile)
    try {
        const m = metaOps(db)
        if (!m.get('migrated_at')) return 'the store was never filled from the files'
        if (m.num('files_epoch') > m.num('synced_epoch')) return 'the files backend ran since the last migration'
        return null
    } finally { db.close() }
}

function migrateToSqlite(saveDir, opts = {}) {
    saveDir = path.resolve(saveDir)
    const dbFile = opts.dbFile ?? storeFileOf(saveDir)
    const log = opts.log ?? (() => {})
    const db = openDb(dbFile, { fullfsync: opts.fullfsync ?? true })
    try {
        const t = tableOps(db)
        const m = metaOps(db)
        const { keys: names, other } = keyFiles(saveDir)
        const r = { files: names.length, bytes: 0, copied: 0, unchanged: 0, verified: 0, mismatches: [], nonKey: other, onlyInStore: [], pruned: 0, storeRows: 0 }
        const seen = new Map()
        for (const n of names) {
            const k = n.toLowerCase()
            if (seen.has(k)) r.mismatches.push(`${n}: same key as ${seen.get(k)} once lower-cased`)
            seen.set(k, n)
        }
        // copy, in transactions of at most BATCH_BYTES / BATCH_FILES
        let batch = []
        let batchBytes = 0
        const flush = db.transaction((rows) => { for (const row of rows) t.put.run(row) })
        const commit = () => { if (batch.length) { flush.immediate(batch); batch = []; batchBytes = 0 } }
        for (const n of names) {
            const file = path.join(saveDir, n)
            const buf = fs.readFileSync(file)
            const st = fs.statSync(file)
            r.bytes += buf.length
            const key = n.toLowerCase()
            const have = t.stat.get(key)
            const h = sha256(buf)
            if (have && have.sha256 === h && have.size === buf.length) { r.unchanged++; continue }
            const row = rowOf(key, buf, st.mtimeMs)
            batch.push(row)
            batchBytes += buf.length
            r.copied++
            if (batchBytes >= BATCH_BYTES || batch.length >= BATCH_FILES) { commit(); log(`copied ${r.copied} (${r.copied + r.unchanged}/${names.length})`) }
        }
        commit()
        // verify: the file as it is now against the BLOB as it is now, both hashed again
        for (const n of names) {
            const fileHash = sha256(fs.readFileSync(path.join(saveDir, n)))
            const key = n.toLowerCase()
            const data = t.get.get(key)
            const st = t.stat.get(key)
            if (!data) { r.mismatches.push(`${keyToPath(n)}: no row`); continue }
            const blobHash = sha256(data)
            if (blobHash !== fileHash || st.sha256 !== fileHash || st.size !== data.length) r.mismatches.push(`${keyToPath(n)}: file ${fileHash.slice(0, 12)} row ${blobHash.slice(0, 12)} column ${st.sha256.slice(0, 12)}`)
            else r.verified++
        }
        const onFiles = new Set(names.map((n) => n.toLowerCase()))
        const storeOnly = t.keys.all().filter((k) => !onFiles.has(k))
        r.onlyInStore = storeOnly.map(keyToPath)
        if (opts.prune && storeOnly.length && !r.mismatches.length) {
            db.transaction(() => { for (const k of storeOnly) r.pruned += t.del.run(k).changes }).immediate()
            r.onlyInStore = []
        }
        r.storeRows = t.count.get().n
        if (!r.mismatches.length) {
            db.transaction(() => {
                m.set('migrated_at', new Date().toISOString())
                m.set('synced_seq', m.num('write_seq'))
                m.set('synced_epoch', m.num('files_epoch'))
            }).immediate()
        }
        return r
    } finally { db.close() }
}

function writeFileAtomicSync(file, buf, tmpDir) {
    fs.mkdirSync(tmpDir, { recursive: true })
    const tmp = path.join(tmpDir, `${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}`)
    try {
        const fd = fs.openSync(tmp, 'w')
        try { fs.writeFileSync(fd, buf); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
        fs.renameSync(tmp, file)
    } catch (error) {
        fs.rmSync(tmp, { force: true })
        throw error
    }
}

function exportToFiles(saveDir, opts = {}) {
    saveDir = path.resolve(saveDir)
    const dbFile = opts.dbFile ?? storeFileOf(saveDir)
    if (!fs.existsSync(dbFile)) throw new Error(`no store at ${dbFile}`)
    fs.mkdirSync(saveDir, { recursive: true })
    const db = openDb(dbFile, { fullfsync: opts.fullfsync ?? true })
    try {
        const t = tableOps(db)
        const m = metaOps(db)
        const tmpDir = saveDir + '.tmp'
        let rows = []
        const r = { rows: 0, bytes: 0, written: 0, unchanged: 0, verified: 0, mismatches: [], onlyInFiles: [] }
        // one read transaction: the export is one consistent version of the store
        db.transaction(() => {
            rows = t.rows.all()
            r.rows = rows.length
            for (const row of rows) {
                const file = path.join(saveDir, row.key)
                const data = t.get.get(row.key)
                r.bytes += data.length
                let same = false
                try { same = sha256(fs.readFileSync(file)) === row.sha256 } catch { /* no file */ }
                if (same) { r.unchanged++; continue }
                writeFileAtomicSync(file, data, tmpDir)
                fs.utimesSync(file, new Date(row.mtime), new Date(row.mtime))
                r.written++
            }
        })()
        for (const row of rows) {
            let h = null
            try { h = sha256(fs.readFileSync(path.join(saveDir, row.key))) } catch { /* missing */ }
            if (h === row.sha256) r.verified++
            else r.mismatches.push(`${keyToPath(row.key)}: row ${row.sha256.slice(0, 12)} file ${h ? h.slice(0, 12) : 'missing'}`)
        }
        if (rows.length) {
            // fsync the directory once: the renames above are durable from here on
            const dir = fs.openSync(saveDir, 'r')
            try { fs.fsyncSync(dir) } finally { fs.closeSync(dir) }
        }
        const inStore = new Set(rows.map((x) => x.key))
        r.onlyInFiles = keyFiles(saveDir).keys.filter((n) => !inStore.has(n.toLowerCase())).map(keyToPath)
        if (!r.mismatches.length) {
            db.transaction(() => { m.set('exported_at', new Date().toISOString()); m.set('synced_seq', m.num('write_seq')) }).immediate()
        }
        return r
    } finally { db.close() }
}

/** compares the files with the store without changing either */
function compare(saveDir, opts = {}) {
    saveDir = path.resolve(saveDir)
    const dbFile = opts.dbFile ?? storeFileOf(saveDir)
    const db = openDb(dbFile, { readonly: true })
    try {
        const t = tableOps(db)
        const { keys: names } = keyFiles(saveDir)
        const r = { files: names.length, rows: t.count.get().n, same: 0, differ: [], onlyInFiles: [], onlyInStore: [] }
        const onFiles = new Set()
        for (const n of names) {
            const key = n.toLowerCase()
            onFiles.add(key)
            const data = t.get.get(key)
            if (!data) { r.onlyInFiles.push(keyToPath(n)); continue }
            if (sha256(fs.readFileSync(path.join(saveDir, n))) === sha256(data)) r.same++
            else r.differ.push(keyToPath(n))
        }
        r.onlyInStore = t.keys.all().filter((k) => !onFiles.has(k)).map(keyToPath)
        return r
    } finally { db.close() }
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`
const head = (list, n = 10) => list.slice(0, n).join(', ') + (list.length > n ? ` … (+${list.length - n})` : '')

if (require.main === module) {
    const args = process.argv.slice(2)
    const saveDir = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--to' && args[args.indexOf(a) - 1] !== '--db')
    const to = args.includes('--to') ? args[args.indexOf('--to') + 1] : null
    const dbFile = args.includes('--db') ? path.resolve(args[args.indexOf('--db') + 1]) : undefined
    const check = args.includes('--check')
    if (!saveDir || (!check && to !== 'sqlite' && to !== 'files')) {
        console.error('usage: storeMigrate.cjs <save dir> --to sqlite|files [--prune] [--db <store file>]\n       storeMigrate.cjs <save dir> --check')
        process.exit(2)
    }
    if (!fs.existsSync(saveDir)) { console.error(`no such directory: ${saveDir}`); process.exit(2) }
    const pid = servingPid(saveDir)
    if (pid && !check) { console.error(`a server (pid ${pid}) is serving ${saveDir}; stop it first (kill -TERM ${pid}: its queue flushes on SIGTERM)`); process.exit(1) }
    const t0 = Date.now()
    try {
        if (check) {
            const r = compare(saveDir, { dbFile })
            console.log(`files ${r.files}, rows ${r.rows}, same ${r.same}, differ ${r.differ.length}, only in files ${r.onlyInFiles.length}, only in store ${r.onlyInStore.length}`)
            if (r.differ.length) console.log(`differ: ${head(r.differ)}`)
            if (r.onlyInFiles.length) console.log(`only in files: ${head(r.onlyInFiles)}`)
            if (r.onlyInStore.length) console.log(`only in store: ${head(r.onlyInStore)}`)
            process.exit(r.differ.length || r.onlyInFiles.length ? 1 : 0)
        }
        if (to === 'sqlite') {
            const r = migrateToSqlite(saveDir, { dbFile, prune: args.includes('--prune'), log: (m) => console.log(m) })
            console.log(`files ${r.files} (${mb(r.bytes)}): copied ${r.copied}, unchanged ${r.unchanged}; sha256 verified ${r.verified}/${r.files}; rows in the store ${r.storeRows}`)
            if (r.nonKey.length) console.log(`left as files (not part of the file API): ${head(r.nonKey)}`)
            if (r.onlyInStore.length) console.log(`rows with no file (kept; --prune drops them): ${head(r.onlyInStore)}`)
            if (r.pruned) console.log(`pruned ${r.pruned} row(s) with no file`)
            if (r.mismatches.length) { console.error(`MISMATCH ${r.mismatches.length}: ${head(r.mismatches)}`); process.exit(1) }
        } else {
            const r = exportToFiles(saveDir, { dbFile })
            console.log(`rows ${r.rows} (${mb(r.bytes)}): written ${r.written}, unchanged ${r.unchanged}; sha256 verified ${r.verified}/${r.rows}`)
            if (r.onlyInFiles.length) console.log(`files with no row (left in place): ${head(r.onlyInFiles)}`)
            if (r.mismatches.length) { console.error(`MISMATCH ${r.mismatches.length}: ${head(r.mismatches)}`); process.exit(1) }
        }
        console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)} s`)
    } catch (e) {
        console.error(e.message)
        process.exit(1)
    }
}

module.exports = { migrateToSqlite, exportToFiles, compare, needsMigration, keyFiles }
