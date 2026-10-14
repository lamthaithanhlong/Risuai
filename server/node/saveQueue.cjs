// A durable write queue for the save directory: better-sqlite3 for the table, p-queue for the worker (specs/core/SaveQueue.tla).
//
// /api/write used to write the file while the client waited. Now it puts the bytes in a SQLite table in one transaction and answers
// success; a single worker applies the rows to the save directory in order. The roles of a task queue such as Huey, kept in the Node
// process that owns the files (Huey is Python and pickles its tasks, so Node cannot add to it):
//   * durable:      a write that was acknowledged survives a crash; at start the worker applies what was left.
//   * ordered:      one worker (p-queue, concurrency 1), lowest sequence number first, so an asset reaches the directory before the
//                   database that points at it.
//   * coalescing:   one row per key. Autosave rewrites a 2.6 MB database.bin every few hundred milliseconds; only the newest is applied.
//   * read-your-writes: /api/read and /api/list look at the table first, so a client sees its own acknowledged write at once.
//   * retries:      a failed apply is retried with a growing delay (capped at 30 s), forever. The worker does NOT skip a failing row: a
//                   later row (the database) must not reach the directory before an earlier one (its asset), also while that one is in
//                   backoff. Readers still get every acknowledged write from the table, and status() says which key is stuck and why.
//   * hung applies: an apply that never returns is cut off after applyTimeoutMs and counts as a failed attempt.
//
// Keys are the hex file names the API already uses. A key the caller marks immutable (assets, named by a hash of their bytes) keeps its
// place when written again while a row is pending: replacing it would move it behind the database row that points at it.

const path = require('path')
const fs = require('fs/promises')
const { atomicWriteFile } = require('./atomicWrite.cjs')

function loadDriver() {
    try {
        return require('better-sqlite3')
    } catch (error) {
        throw new Error(`better-sqlite3 is not available (${error.message}). Run "pnpm install", and "pnpm rebuild better-sqlite3" if its native binding was not built.`)
    }
}

const backoffMs = (attempts) => Math.min(30_000, 250 * 2 ** attempts)

function withTimeout(promise, ms) {
    let timer
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('apply timed out')), ms) })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function openSaveQueue(opts) {
    const Database = loadDriver()
    const PQueue = require('p-queue').default
    const { dbFile, saveDir, tmpDir = saveDir + '.tmp' } = opts
    const now = opts.now ?? Date.now
    const isImmutable = opts.isImmutable ?? (() => false)
    const log = opts.log ?? (() => {})

    const apply = opts.apply ?? (async (row) => {
        const target = path.join(saveDir, row.key)
        if (row.op === 'delete') {
            await fs.rm(target, { force: true })
        } else {
            await atomicWriteFile(target, Buffer.from(row.data), { tmpDir, sync: true, syncDir: true })
        }
    })

    const db = new Database(dbFile)
    // incremental auto-vacuum has to be chosen before the first table exists; it lets the file shrink after a burst of assets
    db.pragma('auto_vacuum = INCREMENTAL')
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = FULL')
    // fullfsync: on macOS a plain fsync does not flush the drive's own cache; without it a power cut can lose an acknowledged write
    const fullfsync = (opts.fullfsync ?? true) ? 'ON' : 'OFF'
    db.pragma(`fullfsync = ${fullfsync}`)
    db.pragma(`checkpoint_fullfsync = ${fullfsync}`)
    db.exec(`
        CREATE TABLE IF NOT EXISTS pending (
            key TEXT PRIMARY KEY,
            seq INTEGER NOT NULL,
            op TEXT NOT NULL CHECK (op IN ('write', 'delete')),
            data BLOB,
            rev INTEGER NOT NULL DEFAULT 0,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_try INTEGER NOT NULL DEFAULT 0,
            last_error TEXT,
            enqueued INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS pending_seq ON pending (seq);
        -- sequence numbers only grow, also across deletes: the worker identifies the row it applied by (key, seq, rev), and a number
        -- reused after the table emptied would make it delete the newer row that took the same number
        CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY CHECK (id = 1), value INTEGER NOT NULL);
        INSERT OR IGNORE INTO counter (id, value) VALUES (1, 0);
    `)

    const q = {
        get: db.prepare('SELECT key, seq, op, data FROM pending WHERE key = ?'),
        bump: db.prepare('UPDATE counter SET value = value + 1 WHERE id = 1 RETURNING value'),
        del: db.prepare('DELETE FROM pending WHERE key = ?'),
        refresh: db.prepare('UPDATE pending SET data = ?, rev = rev + 1, attempts = 0, next_try = 0, last_error = NULL WHERE key = ?'),
        insert: db.prepare('INSERT INTO pending (key, seq, op, data, enqueued) VALUES (?, ?, ?, ?, ?)'),
        // strictly the lowest sequence number, whether or not it is in backoff: nothing may overtake it
        head: db.prepare('SELECT key, seq, rev, op, data, attempts, next_try FROM pending ORDER BY seq LIMIT 1'),
        done: db.prepare('DELETE FROM pending WHERE key = ? AND seq = ? AND rev = ?'),
        fail: db.prepare('UPDATE pending SET attempts = attempts + 1, next_try = ?, last_error = ? WHERE key = ? AND seq = ? AND rev = ?'),
        keys: db.prepare('SELECT key, op FROM pending'),
        stats: db.prepare('SELECT COUNT(*) AS n, COALESCE(MIN(enqueued), 0) AS oldest FROM pending'),
        stuck: db.prepare('SELECT key, attempts, last_error FROM pending WHERE attempts > 0 ORDER BY seq LIMIT 20'),
    }

    // better-sqlite3 runs the function in BEGIN IMMEDIATE ... COMMIT and rolls back if it throws
    const putTx = db.transaction((key, op, data) => {
        const existing = q.get.get(key)
        if (existing && existing.op === 'write' && op === 'write' && isImmutable(key)) {
            // Same bytes under a hash name: keep the place in the queue. If the bytes differ after all, still keep the place and
            // take the newer bytes, so nothing acknowledged is lost and the ordering guarantee stays.
            if (!Buffer.from(existing.data).equals(Buffer.from(data))) {
                q.refresh.run(data, key)
            }
            return existing.seq
        }
        if (existing) {
            q.del.run(key)
        }
        const next = q.bump.get().value
        q.insert.run(key, next, op, data ?? null, now())
        return next
    }).immediate

    // ---- the worker: p-queue with concurrency 1 runs one "apply the head row" step after the other ----------------------------
    // One row per step. The timeout is applied inside the step, not with p-queue's own: when p-queue's timeout fires it frees the slot
    // at once, the next step can start before the failure is recorded, and the same row would be applied twice in parallel.
    const pq = new PQueue({ concurrency: 1 })
    const applyTimeoutMs = opts.applyTimeoutMs ?? 60_000
    let timer = null
    let closed = false
    let didWork = false
    let queued = false        // a step is already waiting in p-queue; one is enough

    function schedule(delayMs) {
        if (closed) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => { timer = null; enqueueStep() }, delayMs)
        timer.unref?.()
    }

    function enqueueStep() {
        if (closed || queued) return pq.onIdle()
        queued = true
        return pq.add(step).catch((error) => {
            // e.g. SQLITE_FULL while recording a result: the rows are still in the table, try again later
            log('worker', '', 0, error)
            schedule(5000)
        })
    }

    async function step() {
        queued = false
        if (closed) return
        const row = q.head.get()
        if (!row) {
            if (didWork) {
                // idle and empty: give the space of the applied rows back so the file does not stay at its high-water mark
                didWork = false
                try { db.pragma('incremental_vacuum'); db.pragma('wal_checkpoint(TRUNCATE)') } catch (e) { /* busy: next time */ }
            }
            return
        }
        const t = now()
        if (row.next_try > t) {
            schedule(Math.max(10, row.next_try - t))   // the head is waiting out a failure; everything behind it waits too
            return
        }
        didWork = true
        try {
            await withTimeout(apply({ key: row.key, op: row.op, data: row.data }), applyTimeoutMs)
            q.done.run(row.key, row.seq, row.rev)   // no-op when a newer write replaced or refreshed the row while it was applied
        } catch (error) {
            const attempts = row.attempts + 1
            q.fail.run(now() + backoffMs(attempts), String(error && error.message || error).slice(0, 300), row.key, row.seq, row.rev)
            log('retry', row.key, attempts, error)
            schedule(backoffMs(attempts))
            return
        }
        enqueueStep()                                   // the next row, as its own step
    }

    function put(key, op, data) {
        const seq = putTx(key, op, data)
        schedule(0)
        return seq
    }

    return {
        enqueueWrite: (key, data) => put(key, 'write', data),
        enqueueDelete: (key) => put(key, 'delete', null),
        // the newest acknowledged state of a key if it has not reached the directory yet: {op, data} or null
        readPending(key) {
            const row = q.get.get(key)
            return row ? { op: row.op, data: row.data ? Buffer.from(row.data) : null } : null
        },
        pendingKeys: () => q.keys.all(),
        // resolves when nothing is left that can be applied now
        async flush() {
            for (let i = 0; i < 100_000; i++) {
                await enqueueStep()
                await pq.onIdle()
                const head = q.head.get()
                if (!head || head.next_try > now()) return
            }
        },
        start: () => { schedule(0) },
        status() {
            const s = q.stats.get()
            return { pending: s.n, oldestAgeMs: s.oldest ? now() - s.oldest : 0, stuck: q.stuck.all() }
        },
        async close() {
            closed = true
            if (timer) clearTimeout(timer)
            pq.pause()
            pq.clear()
            await Promise.race([pq.onIdle(), new Promise((r) => setTimeout(r, opts.closeWaitMs ?? 5000))])
            db.close()
        },
    }
}

module.exports = { openSaveQueue, backoffMs }
