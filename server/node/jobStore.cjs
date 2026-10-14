// A durable log for proxy stream jobs (SQLite, better-sqlite3).
//
// A job is one upstream request (a chat reply streaming back). Every event it produces is appended here with a
// sequence number, so a client that disconnected (phone screen locked, page refreshed, flaky Wi-Fi) can ask for
// "everything after seq N" and get exactly what it missed, and a job that finished while nobody listened still
// has its whole answer. A job found by its idempotency key is reused instead of asking the model again.

const Database = require('better-sqlite3');

const REUSABLE_STATUSES = ['running', 'done'];

// A finished reply is kept this long for a page that was killed and reopened (Safari swiped away mid-reply).
// The page's own note must outlast it: src/ts/process/pendingGenerationCore.ts PENDING_MAX_AGE_MS.
const JOB_REUSE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const JOB_KEEP_MS = 48 * 60 * 60 * 1000;

function openJobStore(file) {
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            idem TEXT,
            status TEXT NOT NULL,
            created INTEGER NOT NULL,
            updated INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS jobs_idem ON jobs (idem);
        CREATE TABLE IF NOT EXISTS events (
            job_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            data TEXT NOT NULL,
            PRIMARY KEY (job_id, seq)
        );
    `);

    const q = {
        insertJob: db.prepare('INSERT INTO jobs (id, idem, status, created, updated) VALUES (?, ?, ?, ?, ?)'),
        lastSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE job_id = ?'),
        insertEvent: db.prepare('INSERT INTO events (job_id, seq, data) VALUES (?, ?, ?)'),
        touch: db.prepare('UPDATE jobs SET updated = ? WHERE id = ?'),
        eventsFrom: db.prepare('SELECT seq, data FROM events WHERE job_id = ? AND seq >= ? ORDER BY seq LIMIT ?'),
        getJob: db.prepare('SELECT id, idem, status, created, updated FROM jobs WHERE id = ?'),
        setStatus: db.prepare('UPDATE jobs SET status = ?, updated = ? WHERE id = ? AND status = ?'),
        // nosemgrep: sql-built-from-a-variable (the interpolation is a fixed list of ? placeholders, one per constant status)
        byIdem: db.prepare(`SELECT id, status FROM jobs WHERE idem = ? AND status IN (${REUSABLE_STATUSES.map(() => '?').join(',')}) AND updated >= ? ORDER BY created DESC LIMIT 1`),
        running: db.prepare("SELECT id FROM jobs WHERE status = 'running'"),
        oldJobs: db.prepare('SELECT id FROM jobs WHERE updated < ?'),
        delEvents: db.prepare('DELETE FROM events WHERE job_id = ?'),
        delJob: db.prepare('DELETE FROM jobs WHERE id = ?'),
    };

    const nextSeq = new Map();

    // the event and the job's "updated" time are written together or not at all
    const appendTx = db.transaction((jobId, event, now, seq) => {
        q.insertEvent.run(jobId, seq, JSON.stringify(event));
        q.touch.run(now, jobId);
    });

    function append(jobId, event, now = Date.now()) {
        let seq = nextSeq.get(jobId);
        if (seq === undefined) {
            seq = q.lastSeq.get(jobId).seq + 1;
        }
        appendTx(jobId, event, now, seq);
        nextSeq.set(jobId, seq + 1);
        return seq;
    }

    // each of these is one transaction: a crash in the middle leaves the job as it was, not half interrupted or half pruned
    const interruptTx = db.transaction(() => {
        const ids = q.running.all().map((row) => row.id);
        for (const id of ids) {
            append(id, { type: 'error', status: 502, message: 'Server restarted while this job was running' });
            q.setStatus.run('interrupted', Date.now(), id, 'running');
        }
        return ids.length;
    });
    const pruneTx = db.transaction((before) => {
        const ids = q.oldJobs.all(before).map((row) => row.id);
        for (const id of ids) {
            q.delEvents.run(id);
            q.delJob.run(id);
        }
        return ids;
    });

    return {
        createJob(id, idem, now = Date.now()) {
            q.insertJob.run(id, idem || null, 'running', now, now);
        },

        append,

        /** Events with seq >= fromSeq, oldest first: [{ seq, event }]. */
        eventsFrom(jobId, fromSeq = 1, limit = 500) {
            return q.eventsFrom.all(jobId, Math.max(1, fromSeq), limit).map((row) => ({ seq: row.seq, event: JSON.parse(row.data) }));
        },

        getJob(jobId) {
            return q.getJob.get(jobId) || null;
        },

        /** running -> done | error | aborted | interrupted; a job already finished keeps its first outcome. */
        finish(jobId, status, now = Date.now()) {
            q.setStatus.run(status, now, jobId, 'running');
        },

        /** A job with this idempotency key that is still running or finished well, and recent enough to trust. */
        findReusable(idem, maxAgeMs, now = Date.now()) {
            if (!idem) {
                return null;
            }
            return q.byIdem.get(idem, ...REUSABLE_STATUSES, now - maxAgeMs) || null;
        },

        /** After a restart nothing is still running upstream: say so to anyone who asks for those jobs. */
        interruptRunning() {
            return interruptTx();
        },

        /** Drops jobs untouched since `before` (ms epoch). */
        prune(before) {
            const ids = pruneTx(before);
            for (const id of ids) {
                nextSeq.delete(id);
            }
            return ids.length;
        },

        close() {
            db.close();
        },
    };
}

module.exports = { openJobStore, JOB_REUSE_MAX_AGE_MS, JOB_KEEP_MS };
