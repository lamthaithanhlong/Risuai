// node --test tests/acceptance/diskCopy.check.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { createRequire } from 'module'
import { cloneCopy, diskProblem, freeBytes, MIN_FREE_AFTER_COPY } from './lib/diskCopy.mjs'
import { snapshotSqlite } from './lib/env.mjs'

const require = createRequire(import.meta.url)
const Database = require(new URL('../../node_modules/better-sqlite3', import.meta.url).pathname)

const MB = 1024 * 1024
function scratch() { return fs.mkdtempSync(path.join(os.tmpdir(), 'diskcopy-')) }
function bigFile(dir, mb) {
    const f = path.join(dir, 'big.bin')
    const fd = fs.openSync(f, 'w')
    const chunk = Buffer.alloc(MB, 7)
    for (let i = 0; i < mb; i++) fs.writeSync(fd, chunk)
    fs.fsyncSync(fd); fs.closeSync(fd)
    return f
}

test('a clone of a 200 MB file costs almost no disk, a plain copy costs all of it', () => {
    const dir = scratch()
    try {
        const src = path.join(dir, 'src'); fs.mkdirSync(src); bigFile(src, 200)
        execFileSync('sync')
        const f0 = freeBytes(dir)
        const how = cloneCopy(src, path.join(dir, 'cloned'), { log: () => {} })
        execFileSync('sync')
        const f1 = freeBytes(dir)
        execFileSync('cp', ['-R', src, path.join(dir, 'plain')])
        execFileSync('sync')
        const f2 = freeBytes(dir)
        const cloneCost = f0 - f1, plainCost = f1 - f2
        console.log(`clone cost ${(cloneCost / MB).toFixed(1)} MB, plain copy cost ${(plainCost / MB).toFixed(1)} MB`)
        assert.equal(how, 'clone', 'cp -c must work on this volume')
        assert.ok(cloneCost < 50 * MB, `clone cost ${cloneCost / MB} MB`)
        assert.ok(plainCost > 150 * MB, `plain copy cost ${plainCost / MB} MB`)
        assert.deepEqual(fs.readFileSync(path.join(dir, 'cloned/big.bin')).subarray(0, 8), Buffer.alloc(8, 7))
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('when clone is refused the copy falls back to a plain one and logs it', () => {
    const dir = scratch()
    try {
        const src = path.join(dir, 'src'); fs.mkdirSync(src); fs.writeFileSync(path.join(src, 'a.txt'), 'hello')
        const logs = [], calls = []
        const run = (cmd, args) => {
            calls.push(args[0])
            if (args[0] === '-cR') { fs.mkdirSync(args[2], { recursive: true }); throw new Error('cp: clonefile failed: Operation not supported') }
            return execFileSync(cmd, args)
        }
        const how = cloneCopy(src, path.join(dir, 'dst'), { log: (m) => logs.push(m), run })
        assert.equal(how, 'copy')
        assert.deepEqual(calls, ['-cR', '-R'])
        assert.equal(fs.readFileSync(path.join(dir, 'dst/a.txt'), 'utf8').length, 5)
        assert.match(logs.join('\n'), /clone refused .*plain copy/)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a launch with less than 2 GB free after the copy stops with a clear message', () => {
    assert.equal(diskProblem({ free: 3 * 1024 ** 3 }), '')
    assert.equal(diskProblem({ free: MIN_FREE_AFTER_COPY }), '')
    const bad = diskProblem({ free: 1.2 * 1024 ** 3 })
    assert.match(bad, /only 1\.20 GB free after copying the save/)
    assert.match(bad, /--base-from/)
    assert.notEqual(diskProblem({ free: 0 }), '')
})

function liveDb(dir) {
    const f = path.join(dir, 'live.sqlite')
    const db = new Database(f)
    db.pragma('journal_mode = WAL')
    db.exec('create table t(id integer primary key, v blob)')
    const ins = db.prepare('insert into t(v) values (?)')
    const blob = Buffer.alloc(100 * 1024, 5)
    db.transaction(() => { for (let i = 0; i < 600; i++) ins.run(blob) })()   // ~60 MB
    db.pragma('wal_checkpoint(TRUNCATE)')
    ins.run(Buffer.from('in-the-wal'))   // lives only in the -wal while the live connection stays open
    return { f, db }
}
const count = (f) => { const d = new Database(f, { readonly: true }); try { return d.prepare('select count(*) c from t').get().c } finally { d.close() } }

test('a live SQLite file is snapshotted by clone: WAL rows are in it and it costs almost no disk', async () => {
    const dir = scratch()
    const { f, db } = liveDb(dir)
    try {
        execFileSync('sync')
        const f0 = freeBytes(dir)
        const how = await snapshotSqlite(f, path.join(dir, 'snap.sqlite'), { log: () => {} })
        execFileSync('sync')
        const cost = f0 - freeBytes(dir)
        console.log(`sqlite snapshot ${how}, cost ${(cost / MB).toFixed(1)} MB`)
        assert.equal(how, 'clone')
        assert.equal(count(path.join(dir, 'snap.sqlite')), 601)
        assert.ok(cost < 20 * MB, `cost ${cost / MB} MB`)
        assert.equal(count(f), 601, 'the live file is untouched')
    } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a clone that fails quick_check is thrown away and the backup API makes the copy', async () => {
    const dir = scratch()
    const { f, db } = liveDb(dir)
    try {
        const logs = []
        let backedUp = 0
        const backup = async (src, dst) => { backedUp++; await db.backup(dst) }
        const how = await snapshotSqlite(f, path.join(dir, 'snap.sqlite'), { log: (m) => logs.push(m), check: () => 'database disk image is malformed', backup })
        assert.equal(how, 'backup')
        assert.equal(backedUp, 1)
        assert.equal(count(path.join(dir, 'snap.sqlite')), 601)
        assert.match(logs.join('\n'), /clone of live\.sqlite not usable .*malformed.*online backup/)
    } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }) }
})
