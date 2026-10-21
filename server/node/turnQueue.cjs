// The turn queue: once the player presses send, the turn belongs to the server (owner, 2026-10-20: "input xong gửi xuống queue dựng
// cờ lên rồi xử lý"). Before this the page ran the whole turn (helpers, prompt, the model's stream, tidy, Lua triggers, the save) and
// only the model's stream lived on the server, so a phone that switched apps froze the turn wherever it was (tests/turns/repro.mjs).
//
// A turn is a row keyed by the page's turn key ("<chat id>:<uuid>"): POST /api/turns makes it, or finds it when the page asks again.
//   queued -> assembling -> generating -> tidying -> saved
//                 \______________\____________\____> retrying (model error, lost lease: back to queued after a backoff, same key)
//                                                \__> failed (out of attempts) | cancelled (Stop)
// One active turn per chat; the others wait in the order they came. The worker (turnWorker.cjs) leases a turn for leaseMs and
// renews it while it works; a lease that runs out puts the turn back (specs/turns/uppaal: the lease must outlast the longest gap
// between renewals, or a living worker loses its turn to a second run). Every change is an event with a sequence number, so a page
// that dropped follows on from where it was (GET /api/turns/:key/events?from=N).
// Models: specs/turns/TurnQueue.tla (TLC), TurnKeys.als (Alloy), uppaal/turn_*.xml (UPPAAL), TurnApply.dfy (Dafny).

const Database = require('better-sqlite3');

const ACTIVE = ['assembling', 'generating', 'tidying'];
const WAITING = ['queued', 'retrying'];
const FINAL = ['saved', 'failed', 'cancelled'];
const KINDS = ['send', 'reroll', 'continue'];
const KEEP_MS = 48 * 60 * 60 * 1000;
const KEY_RE = /^[A-Za-z0-9-]{1,80}:[A-Za-z0-9-]{8,80}$/;

/** Wait before the n-th retry (n >= 1): 2 s, 8 s, 30 s, then 60 s. */
function backoffMs(n) {
    return [2000, 8000, 30000][n - 1] ?? 60000;
}

function openTurnQueue(file, opts = {}) {
    const now = opts.now ?? Date.now;
    const leaseMs = opts.leaseMs ?? 60000;
    const maxAttempts = opts.maxAttempts ?? 4;
    const db = new Database(file);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS turns (
            key TEXT PRIMARY KEY,
            chat TEXT NOT NULL,
            cha TEXT NOT NULL,
            kind TEXT NOT NULL,
            input TEXT NOT NULL,
            state TEXT NOT NULL,
            attempt INTEGER NOT NULL DEFAULT 0,
            next_at INTEGER NOT NULL DEFAULT 0,
            lease_owner TEXT,
            lease_until INTEGER NOT NULL DEFAULT 0,
            job_id TEXT,
            error TEXT,
            result TEXT,
            ord INTEGER NOT NULL,
            created INTEGER NOT NULL,
            updated INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS turns_chat ON turns (chat, ord);
        CREATE INDEX IF NOT EXISTS turns_state ON turns (state, next_at);
        CREATE TABLE IF NOT EXISTS turn_events (
            key TEXT NOT NULL,
            seq INTEGER NOT NULL,
            data TEXT NOT NULL,
            PRIMARY KEY (key, seq)
        );
    `);
    const q = {
        get: db.prepare('SELECT * FROM turns WHERE key = ?'),
        insert: db.prepare(`INSERT INTO turns (key, chat, cha, kind, input, state, ord, created, updated)
            VALUES (@key, @chat, @cha, @kind, @input, 'queued', (SELECT COALESCE(MAX(ord), 0) + 1 FROM turns), @t, @t)`),
        // the oldest waiting turn of a chat with no active turn, whose backoff is over; only the oldest waiting turn of its chat
        // may go (a retrying turn keeps its place ahead of the turns sent after it)
        next: db.prepare(`SELECT * FROM turns t WHERE state IN ('queued', 'retrying') AND next_at <= @t
            AND NOT EXISTS (SELECT 1 FROM turns a WHERE a.chat = t.chat AND a.state IN ('assembling', 'generating', 'tidying'))
            AND NOT EXISTS (SELECT 1 FROM turns o WHERE o.chat = t.chat AND o.state IN ('queued', 'retrying') AND o.ord < t.ord)
            ORDER BY ord LIMIT 1`),
        // a new run has no stream job yet: the one of the run before (failed, cut) must not be read as this run's
        lease: db.prepare(`UPDATE turns SET state = 'assembling', attempt = attempt + 1, lease_owner = @owner, lease_until = @until,
            error = NULL, job_id = NULL, updated = @t WHERE key = @key AND state IN ('queued', 'retrying')`),
        renew: db.prepare(`UPDATE turns SET lease_until = @until, updated = @t WHERE key = @key AND lease_owner = @owner
            AND state IN ('assembling', 'generating', 'tidying')`),
        setState: db.prepare(`UPDATE turns SET state = @state, job_id = COALESCE(@job, job_id), updated = @t WHERE key = @key
            AND lease_owner = @owner AND state IN ('assembling', 'generating', 'tidying')`),
        setStateAny: db.prepare(`UPDATE turns SET state = @state, job_id = COALESCE(@job, job_id), updated = @t WHERE key = @key
            AND state IN ('assembling', 'generating', 'tidying')`),
        save: db.prepare(`UPDATE turns SET state = 'saved', result = @result, lease_owner = NULL, error = NULL, updated = @t
            WHERE key = @key AND lease_owner = @owner AND state IN ('assembling', 'generating', 'tidying')`),
        retry: db.prepare(`UPDATE turns SET state = 'retrying', next_at = @next, lease_owner = NULL, lease_until = 0, error = @error,
            updated = @t WHERE key = @key AND state IN ('assembling', 'generating', 'tidying')`),
        fail: db.prepare(`UPDATE turns SET state = 'failed', lease_owner = NULL, lease_until = 0, error = @error, updated = @t
            WHERE key = @key AND state IN ('assembling', 'generating', 'tidying', 'queued', 'retrying')`),
        cancel: db.prepare(`UPDATE turns SET state = 'cancelled', lease_owner = NULL, lease_until = 0, updated = @t
            WHERE key = @key AND state IN ('queued', 'retrying', 'assembling', 'generating', 'tidying')`),
        expired: db.prepare(`SELECT * FROM turns WHERE state IN ('assembling', 'generating', 'tidying') AND lease_until < @t`),
        activeOfChat: db.prepare(`SELECT * FROM turns WHERE chat = ? AND state IN ('assembling', 'generating', 'tidying') LIMIT 1`),
        ofChat: db.prepare(`SELECT key, chat, cha, kind, input, state, attempt, next_at, job_id, error, created, updated FROM turns
            WHERE chat = ? AND (state NOT IN ('saved', 'failed', 'cancelled') OR updated >= ?) ORDER BY ord`),
        open: db.prepare(`SELECT key, chat, cha, kind, state FROM turns WHERE state NOT IN ('saved', 'failed', 'cancelled') ORDER BY ord`),
        nextWake: db.prepare(`SELECT MIN(next_at) AS t FROM turns WHERE state IN ('queued', 'retrying')`),
        lastSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM turn_events WHERE key = ?'),
        addEvent: db.prepare('INSERT INTO turn_events (key, seq, data) VALUES (?, ?, ?)'),
        eventsFrom: db.prepare('SELECT seq, data FROM turn_events WHERE key = ? AND seq >= ? ORDER BY seq LIMIT ?'),
        old: db.prepare(`SELECT key FROM turns WHERE state IN ('saved', 'failed', 'cancelled') AND updated < ?`),
        delEvents: db.prepare('DELETE FROM turn_events WHERE key = ?'),
        delTurn: db.prepare('DELETE FROM turns WHERE key = ?'),
    };

    const listeners = new Set();
    function emit(key, event) {
        const seq = q.lastSeq.get(key).seq + 1;
        q.addEvent.run(key, seq, JSON.stringify(event));
        for (const fn of listeners) {
            try { fn(key, seq, event); } catch { /* a listener's own problem */ }
        }
        return seq;
    }
    const view = (row) => row && {
        key: row.key, chat: row.chat, cha: row.cha, kind: row.kind, input: JSON.parse(row.input), state: row.state,
        attempt: row.attempt, nextAt: row.next_at || 0, jobId: row.job_id || null, error: row.error || null,
        created: row.created, updated: row.updated,
    };

    const createTx = db.transaction((t) => {
        const had = q.get.get(t.key);
        if (had) return { turn: view(had), created: false };
        q.insert.run({ ...t, t: now() });
        emit(t.key, { type: 'state', state: 'queued', attempt: 0 });
        return { turn: view(q.get.get(t.key)), created: true };
    });
    const leaseTx = db.transaction((owner) => {
        const t = now();
        const row = q.next.get({ t });
        if (!row) return null;
        q.lease.run({ key: row.key, owner, until: t + leaseMs, t });
        const leased = q.get.get(row.key);
        emit(row.key, { type: 'state', state: 'assembling', attempt: leased.attempt });
        return view(leased);
    });
    // the end of an attempt that did not save: try again after a backoff while attempts are left, else fail
    function endAttempt(row, error, retryable) {
        const t = now();
        if (retryable && row.attempt < maxAttempts) {
            const next = t + backoffMs(row.attempt);
            q.retry.run({ key: row.key, next, error: String(error).slice(0, 500), t });
            emit(row.key, { type: 'state', state: 'retrying', attempt: row.attempt, error: String(error).slice(0, 500), nextAt: next });
            return 'retrying';
        }
        q.fail.run({ key: row.key, error: String(error).slice(0, 500), t });
        emit(row.key, { type: 'state', state: 'failed', attempt: row.attempt, error: String(error).slice(0, 500) });
        return 'failed';
    }
    const finishTx = db.transaction((key, owner, outcome) => {
        const row = q.get.get(key);
        if (!row || row.lease_owner !== owner || !ACTIVE.includes(row.state)) return row ? row.state : null;
        if (outcome.ok) {
            q.save.run({ key, owner, result: outcome.result === undefined ? null : JSON.stringify(outcome.result), t: now() });
            emit(key, { type: 'state', state: 'saved', attempt: row.attempt });
            return 'saved';
        }
        return endAttempt(row, outcome.error || 'error', outcome.retryable !== false);
    });
    const expireTx = db.transaction(() => {
        const rows = q.expired.all({ t: now() });
        for (const row of rows) endAttempt(row, 'the worker stopped answering (lease ran out)', true);
        return rows.length;
    });
    const cancelTx = db.transaction((key) => {
        const row = q.get.get(key);
        if (!row || FINAL.includes(row.state)) return { state: row ? row.state : null, wasActive: false };
        q.cancel.run({ key, t: now() });
        emit(key, { type: 'state', state: 'cancelled', attempt: row.attempt });
        return { state: 'cancelled', wasActive: ACTIVE.includes(row.state), owner: row.lease_owner };
    });

    return {
        /** Makes the turn, or returns the one that key already has. Throws a TypeError for a malformed turn. */
        create({ key, chat, cha, kind = 'send', input = {} }) {
            if (typeof key !== 'string' || !KEY_RE.test(key)) throw new TypeError('bad turn key');
            if (typeof chat !== 'string' || !chat || key.slice(0, key.indexOf(':')) !== chat) throw new TypeError('the key must start with the chat id');
            if (typeof cha !== 'string' || !cha) throw new TypeError('no character');
            if (!KINDS.includes(kind)) throw new TypeError('bad kind');
            const text = JSON.stringify(input ?? {});
            if (text.length > 4000000) throw new TypeError('input too large');
            return createTx({ key, chat, cha, kind, input: text });
        },
        get(key) { return view(q.get.get(key)); },
        /** The chat's turns not finished, and those finished in the last `recentMs`. */
        ofChat(chat, recentMs = 10 * 60 * 1000) { return q.ofChat.all(chat, now() - recentMs).map(view); },
        open() { return q.open.all(); },
        result(key) { const row = q.get.get(key); return row?.result ? JSON.parse(row.result) : null; },
        /** The next turn to run (marked assembling, leased to `owner`), or null. */
        lease(owner) { return leaseTx(owner); },
        /** The worker is alive and still on this turn. False when the turn is no longer its own (cancelled, expired, taken). */
        renew(key, owner) { return q.renew.run({ key, owner, until: now() + leaseMs, t: now() }).changes === 1; },
        /** assembling -> generating -> tidying, by the lease holder (owner null: the stream job hook, which has no lease). */
        phase(key, owner, state, jobId = null) {
            if (!ACTIVE.includes(state)) throw new TypeError('bad phase');
            const row = q.get.get(key);
            if (!row || !ACTIVE.includes(row.state) || (row.state === state && (!jobId || row.job_id === jobId))) return false;
            const r = owner === null ? q.setStateAny.run({ key, state, job: jobId, t: now() }) : q.setState.run({ key, owner, state, job: jobId, t: now() });
            if (r.changes === 1) emit(key, { type: 'state', state, attempt: row.attempt, ...(jobId ? { jobId } : {}) });
            return r.changes === 1;
        },
        /** outcome: { ok: true, result } | { ok: false, error, retryable } */
        finish(key, owner, outcome) { return finishTx(key, owner, outcome); },
        expire() { return expireTx(); },
        cancel(key) { return cancelTx(key); },
        /** The active turn of a chat (the stream job hook maps "<chat>:<uuid>#n" to it). */
        activeOfChat(chat) { return view(q.activeOfChat.get(chat)); },
        /** When the next waiting turn may go (ms epoch), or 0. */
        nextWake() { return q.nextWake.get().t || 0; },
        eventsFrom(key, from = 1, limit = 500) {
            return q.eventsFrom.all(key, Math.max(1, from), limit).map((r) => ({ seq: r.seq, event: JSON.parse(r.data) }));
        },
        onEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        prune(before = now() - KEEP_MS) {
            const keys = q.old.all(before).map((r) => r.key);
            for (const key of keys) { q.delEvents.run(key); q.delTurn.run(key); }
            return keys.length;
        },
        close() { db.close(); },
    };
}

module.exports = { openTurnQueue, backoffMs, ACTIVE, WAITING, FINAL, KEY_RE };
