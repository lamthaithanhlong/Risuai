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
// Every server process has a boot id and beats it into the store. At startup a server interrupts only the running jobs of boots that
// stopped beating (itself before a restart or a crash), never those of another server that is alive on the same file: a second
// server.cjs started by a test (dbMergeServer.test.ts, same HOME) used to cut the owner's reply in the middle (specs/chat/JobBoot.tla).
const BOOT_BEAT_MS = 10 * 1000;
const BOOT_DEAD_MS = 3 * BOOT_BEAT_MS;

function openJobStore(file, opts = {}) {
    const boot = opts.boot || require('crypto').randomUUID();
    const pid = opts.pid ?? process.pid;
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
        CREATE TABLE IF NOT EXISTS boots (
            boot TEXT PRIMARY KEY,
            beat INTEGER NOT NULL,
            pid INTEGER
        );
        CREATE TABLE IF NOT EXISTS events (
            job_id TEXT NOT NULL,
            seq INTEGER NOT NULL,
            data TEXT NOT NULL,
            PRIMARY KEY (job_id, seq)
        );
    `);

    // stores made before boots existed have no boot column; their rows (boot NULL) belong to no live server
    if (!db.prepare('PRAGMA table_info(jobs)').all().some((c) => c.name === 'boot')) {
        db.exec('ALTER TABLE jobs ADD COLUMN boot TEXT');
    }
    if (!db.prepare('PRAGMA table_info(boots)').all().some((c) => c.name === 'pid')) {
        db.exec('ALTER TABLE boots ADD COLUMN pid INTEGER');
    }

    const q = {
        insertJob: db.prepare('INSERT INTO jobs (id, idem, status, created, updated, boot) VALUES (?, ?, ?, ?, ?, ?)'),
        beat: db.prepare('INSERT OR REPLACE INTO boots (boot, beat, pid) VALUES (?, ?, ?)'),
        boots: db.prepare('SELECT boot, beat, pid FROM boots'),
        dropBoot: db.prepare('DELETE FROM boots WHERE boot = ?'),
        oldBoots: db.prepare('DELETE FROM boots WHERE beat < ?'),
        runningChats: db.prepare("SELECT idem FROM jobs WHERE status = 'running' AND idem IS NOT NULL"),
        lastSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE job_id = ?'),
        insertEvent: db.prepare('INSERT INTO events (job_id, seq, data) VALUES (?, ?, ?)'),
        touch: db.prepare('UPDATE jobs SET updated = ? WHERE id = ?'),
        eventsFrom: db.prepare('SELECT seq, data FROM events WHERE job_id = ? AND seq >= ? ORDER BY seq LIMIT ?'),
        getJob: db.prepare('SELECT id, idem, status, created, updated FROM jobs WHERE id = ?'),
        setStatus: db.prepare('UPDATE jobs SET status = ?, updated = ? WHERE id = ? AND status = ?'),
        // nosemgrep: sql-built-from-a-variable (the interpolation is a fixed list of ? placeholders, one per constant status)
        byIdem: db.prepare(`SELECT id, status FROM jobs WHERE idem = ? AND status IN (${REUSABLE_STATUSES.map(() => '?').join(',')}) AND updated >= ? ORDER BY created DESC LIMIT 1`),
        running: db.prepare("SELECT id, boot FROM jobs WHERE status = 'running'"),
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
    const isAlive = opts.isAlive ?? ((pid) => {
        try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
    });
    // a server is alive when it beat recently and its process exists (a restart after a crash or a SIGTERM finds its old boot's pid gone
    // at once, so its jobs are interrupted at startup as before); jobs with no boot predate this and belong to nobody
    const liveBoots = (now) => new Set(q.boots.all()
        .filter((b) => b.boot === boot || (b.beat >= now - BOOT_DEAD_MS && b.pid != null && b.pid !== pid && isAlive(b.pid)))
        .map((b) => b.boot));
    const interruptTx = db.transaction((now) => {
        const live = liveBoots(now);
        const ids = q.running.all().filter((row) => !row.boot || !live.has(row.boot)).map((row) => row.id);
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
        boot,

        createJob(id, idem, now = Date.now()) {
            q.insertJob.run(id, idem || null, 'running', now, now, boot);
        },

        /** This server is alive: call every BOOT_BEAT_MS. Also interrupts the jobs of a server that stopped beating since. */
        beat(now = Date.now()) {
            q.beat.run(boot, now, pid);
            return interruptTx(now);
        },

        /** The chats with a reply still being generated: the part of each running job's idempotency key before the first ':'. */
        runningChats() {
            const chats = new Set();
            for (const row of q.runningChats.all()) {
                const i = row.idem.indexOf(':');
                if (i > 0) chats.add(row.idem.slice(0, i));
            }
            return [...chats];
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

        /** After a restart nothing of ours is still running upstream: say so to anyone who asks for those jobs. Beats first. */
        interruptRunning(now = Date.now()) {
            q.beat.run(boot, now, pid);
            return interruptTx(now);
        },

        /** Drops jobs untouched since `before` (ms epoch). */
        prune(before) {
            q.oldBoots.run(before);
            const ids = pruneTx(before);
            for (const id of ids) {
                nextSeq.delete(id);
            }
            return ids.length;
        },

        close() {
            try { q.dropBoot.run(boot); } catch { /* closed already */ }
            db.close();
        },
    };
}

module.exports = { openJobStore, JOB_REUSE_MAX_AGE_MS, JOB_KEEP_MS, BOOT_BEAT_MS, BOOT_DEAD_MS };
