// Chat pictures drawn on the server, as their own pipeline (owner, 2026-10-20: "generate hình trong risu nên để 1 pipeline riêng biệt xử
// lý không theo pipeline của generate message"). A picture is a durable row in image-jobs.sqlite that no message turn waits for:
//
//   queued -> running -> done -> placed          (drawn; then put into its message by message id)
//                 \-> retrying -> queued ...     (a router failure: another try after a backoff, no concurrency slot held meanwhile)
//                 \-> error                      (out of attempts, or a refusal not worth retrying; the request is kept for "try again")
//   cancelled (Dừng) | orphan (drawn, but its message was never found within placeWindowMs; a page may still place it)
//
// * Asked by a page with a key (chat + message + slot): the same key finds the row again instead of making a second one (a request
//   that was sent twice, a turn that ran its trigger twice). A redraw uses a key of its own.
// * The request (router URL, key, models in fallback order, the body) is stored with the row, so queued and retrying rows survive a
//   restart: a row that was running goes back to the queue. It is cleared as soon as the picture is drawn or the row cancelled.
// * `limit` pictures are drawn at once (RISU_IMAGE_CONCURRENCY, default 2); the others wait their turn, oldest first.
// * Drawn: the router answers as a stream (progress every few seconds, the picture in the `done` event), the picture is resized to 360 px
//   WebP (cwebp, about 16 KB) and written as inlays/<id> through the save queue. Then `place` (server.cjs) puts `{{inlay::<id>}}` into
//   its message in the character file the server holds (remotes/<chaId>.local.bin, merged per page like database.bin: dbSync.cjs). The
//   message may not be saved yet (the page that asked saves it a little later): placement is tried again every sweepMs for
//   placeWindowMs. A page also polls its chat's rows (imageJobClient.ts) and puts a placed picture into the copy it holds.
// Finished rows are kept two days. Models: specs/images/PictureQueue.tla (TLC), imageJobs.test.ts, pictureQueueServer.test.ts.

const Database = require('better-sqlite3');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEEP_MS = 48 * 60 * 60 * 1000;
const MAX_SIDE = 360;
const DEFAULT_LIMIT = Math.max(1, Number.parseInt(process.env.RISU_IMAGE_CONCURRENCY || '', 10) || 2);
const PLACE_WINDOW_MS = 10 * 60 * 1000;
const SWEEP_MS = 2000;
const RECENT_MS = 10 * 60 * 1000;
// When no model could even be reached (the router is down, not a model saying no), wait longer before each new round: a
// 9router restart took ~90 s on 2026-10-15 and three jobs failed in it, each after one 8 s retry. Toxiproxy, 40 s outage:
// the job failed after 8.1 s before this, and finished after the router came back with it.
const DOWN_WAITS_MS = [8000, 15000, 30000, 45000];
const TRANSIENT = /terminated|timed? ?out|timeout|overloaded|temporar|unavailable|connection|socket|network|fetch failed|ECONN|EAI_AGAIN|bad gateway|gateway|\b5\d\d\b/i;

/** The picture from a streamed router answer (`event: done` carries {data:[{b64_json}]}), or a plain JSON answer. */
function parseImageStream(text, status = 200) {
    const ok = status >= 200 && status < 300;
    const trimmed = text.trimStart();
    if (trimmed.startsWith('{')) {
        try { const j = JSON.parse(trimmed); return j?.data?.[0]?.b64_json ? { b64: j.data[0].b64_json } : { error: j?.error?.message ?? JSON.stringify(j).slice(0, 300), status } } catch { /* not JSON */ }
    }
    let event = 'message', b64 = null, error = null;
    for (const line of text.split(/\r?\n/)) {
        if (line.startsWith('event:')) { event = line.slice(6).trim(); continue; }
        if (!line.startsWith('data:')) { if (line === '') event = 'message'; continue; }
        const payload = line.slice(5).trim();
        try {
            const j = JSON.parse(payload);
            if (j?.data?.[0]?.b64_json) b64 = j.data[0].b64_json;
            else if (event === 'error' || j?.error) error = j?.error?.message ?? j?.message ?? payload;
        } catch { if (event === 'error') error = payload; }
    }
    if (b64) return { b64 };
    if (error) return { error, status: ok ? 502 : status };
    if (!ok) return { error: text.slice(0, 300), status };
    return { error: 'picture stream ended without a picture (terminated)', status: 0 };
}

/** Wait before the next round, in ms, or null when the failure is not worth waiting for (same rule as imageRetry.ts). */
function retryDelayMs(failure) {
    const m = /reset after\s+(\d+)\s*(s|m|h)?/i.exec(failure.error || '');
    if (m) {
        const s = Number(m[1]) * (m[2]?.toLowerCase() === 'h' ? 3600 : m[2]?.toLowerCase() === 'm' ? 60 : 1);
        return s <= 60 ? (s + 3) * 1000 : null;
    }
    if (failure.status === 0 || failure.status === 429 || failure.status >= 500) return 8000;
    return TRANSIENT.test(failure.error || '') ? 8000 : null;
}

/** PNG width/height from its header, or null. */
function pngSize(buf) {
    if (buf.length < 24 || buf[0] !== 0x89 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** A 360 px WebP of the picture with cwebp; the original bytes when cwebp is missing or fails (the picture is never dropped). */
function toSmallWebp(bytes, cwebp = 'cwebp') {
    return new Promise((resolve) => {
        const size = pngSize(bytes);
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-img-'));
        const src = path.join(dir, 'in.png'), out = path.join(dir, 'out.webp');
        fs.writeFileSync(src, bytes);
        const resize = !size ? [] : size.w >= size.h ? ['-resize', String(Math.min(MAX_SIDE, size.w)), '0'] : ['-resize', '0', String(Math.min(MAX_SIDE, size.h))];
        execFile(cwebp, ['-quiet', '-q', '80', ...resize, src, '-o', out], { timeout: 30000 }, (err) => {
            let result = bytes;
            if (!err) { try { result = fs.readFileSync(out); } catch { /* keep the original */ } }
            fs.rmSync(dir, { recursive: true, force: true });
            resolve(result);
        });
    });
}

function openImageJobs({
    dbFile, writeInlay, place = null, fetchImpl = fetch, convert = toSmallWebp, now = Date.now, log = console.error,
    limit = DEFAULT_LIMIT, placeWindowMs = PLACE_WINDOW_MS, sweepMs = SWEEP_MS, downWaitsMs = DOWN_WAITS_MS,
    timers = true,                      // false: no background timers; a test drives the queue with pump() and sweep() on its own clock
}) {
    const db = new Database(dbFile);
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS image_jobs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,           -- queued | running | retrying | done | placed | error | orphan | cancelled | interrupted (old rows)
            target TEXT,                    -- JSON from the page: which chat and message the picture belongs to
            inlay_id TEXT,
            model TEXT,
            error TEXT,
            acked INTEGER NOT NULL DEFAULT 0,
            created INTEGER NOT NULL,
            updated INTEGER NOT NULL
        );
    `);
    const columns = new Set(db.prepare("SELECT name FROM pragma_table_info('image_jobs')").all().map((r) => r.name));
    for (const [name, ddl] of [
        ['target_key', 'TEXT'],                         // which message (and slot) a job is for: a newer job for it supersedes an older one
        ['idem', 'TEXT'],                               // the page's key: chat + message + slot (+ a nonce for a redraw); one row per key
        ['req', 'TEXT'],                                // the request JSON while the job can still run; NULL once drawn or cancelled
        ['attempt', 'INTEGER NOT NULL DEFAULT 0'],      // tries started
        ['next_at', 'INTEGER NOT NULL DEFAULT 0'],      // a retrying job is due at this time (ms)
        ['chat_id', 'TEXT'],                            // for listing a chat's pictures
        ['drawn_at', 'INTEGER'],
        ['placed_at', 'INTEGER'],
    ]) if (!columns.has(name)) db.exec(`ALTER TABLE image_jobs ADD COLUMN ${name} ${ddl}`);
    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS image_jobs_idem ON image_jobs (idem) WHERE idem IS NOT NULL;
        CREATE INDEX IF NOT EXISTS image_jobs_chat ON image_jobs (chat_id);
        CREATE INDEX IF NOT EXISTS image_jobs_status ON image_jobs (status, next_at);
    `);
    const OPEN = "('queued', 'running', 'retrying')";
    const q = {
        insert: db.prepare('INSERT INTO image_jobs (id, status, target, target_key, idem, req, chat_id, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
        get: db.prepare('SELECT * FROM image_jobs WHERE id = ?'),
        byIdem: db.prepare('SELECT * FROM image_jobs WHERE idem = ?'),
        due: db.prepare(`SELECT * FROM image_jobs WHERE status IN ('queued', 'retrying') AND next_at <= ? AND req IS NOT NULL ORDER BY created, rowid LIMIT 1`),
        nextDue: db.prepare(`SELECT MIN(next_at) AS t FROM image_jobs WHERE status = 'retrying' AND req IS NOT NULL`),
        start: db.prepare(`UPDATE image_jobs SET status = 'running', attempt = attempt + 1, updated = ? WHERE id = ? AND status IN ('queued', 'retrying')`),
        retry: db.prepare(`UPDATE image_jobs SET status = 'retrying', next_at = ?, error = ?, updated = ? WHERE id = ? AND status = 'running'`),
        fail: db.prepare(`UPDATE image_jobs SET status = 'error', error = ?, updated = ? WHERE id = ? AND status = 'running'`),
        drawn: db.prepare(`UPDATE image_jobs SET status = 'done', inlay_id = ?, model = ?, error = NULL, req = NULL, drawn_at = ?, updated = ? WHERE id = ? AND status = 'running'`),
        placed: db.prepare(`UPDATE image_jobs SET status = 'placed', placed_at = ?, updated = ? WHERE id = ? AND status = 'done'`),
        orphan: db.prepare(`UPDATE image_jobs SET status = 'orphan', updated = ? WHERE id = ? AND status = 'done'`),
        // only keyed jobs are placed by the server: a page of the version before the picture queue (no key) waits for `done` and places the picture itself
        unplaced: db.prepare(`SELECT * FROM image_jobs WHERE status = 'done' AND idem IS NOT NULL ORDER BY created`),
        cancel: db.prepare(`UPDATE image_jobs SET status = 'cancelled', req = NULL, updated = ? WHERE id = ? AND status IN ('queued', 'running', 'retrying', 'error')`),
        requeue: db.prepare(`UPDATE image_jobs SET status = 'queued', attempt = 0, next_at = 0, error = NULL, updated = ? WHERE id = ? AND status = 'error' AND req IS NOT NULL`),
        // A picture the server placed stays listed for recentMs, whoever took it: every page that has the chat open puts it into its own
        // copy (the phone and the Mac each); one that was done on the server only (not placed) waits for the first page to take it.
        unacked: db.prepare(`SELECT * FROM image_jobs WHERE (acked = 0 AND status IN ('done', 'orphan', 'error', 'interrupted')) OR (status = 'placed' AND placed_at > ?) ORDER BY created, rowid`),
        forChat: db.prepare(`SELECT * FROM image_jobs WHERE chat_id = ? AND (status IN ('queued', 'running', 'retrying', 'error') OR (acked = 0 AND status IN ('done', 'orphan')) OR (status = 'placed' AND placed_at > ?)) ORDER BY created, rowid`),
        openOfChat: db.prepare(`SELECT * FROM image_jobs WHERE chat_id = ? AND status IN ${OPEN} AND created >= ? ORDER BY created`),
        placedSince: db.prepare(`SELECT * FROM image_jobs WHERE chat_id = ? AND status = 'placed' AND placed_at >= ? ORDER BY created, rowid`),
        ack: db.prepare('UPDATE image_jobs SET acked = 1, updated = ? WHERE id = ?'),
        // a row that has no stored request cannot run again (rows of the version before this one, which kept the key in memory only)
        interrupt: db.prepare(`UPDATE image_jobs SET status = 'interrupted', error = 'the server stopped while drawing', updated = ? WHERE status IN ${OPEN} AND req IS NULL`),
        resume: db.prepare(`UPDATE image_jobs SET status = 'queued', next_at = 0, updated = ? WHERE status = 'running'`),
        prune: db.prepare(`DELETE FROM image_jobs WHERE updated < ? AND status NOT IN ${OPEN}`),
        newer: db.prepare('SELECT 1 FROM image_jobs WHERE target_key = ? AND rowid > (SELECT rowid FROM image_jobs WHERE id = ?) LIMIT 1'),
    };
    q.interrupt.run(now());
    const resumed = q.resume.run(now()).changes;
    if (resumed) log(`[ImageJobs] ${resumed} picture(s) that were being drawn when the server stopped go back to the queue`);

    const running = new Map();     // id -> AbortController of a job being drawn now
    let wake = null;               // the timer of the earliest retrying job
    let closed = false;

    /** One pass over the model chain. The picture, or why none of the models gave one and how long to wait before another pass. */
    async function drawOnce(req, signal) {
        const { url, key, models, body } = req;
        const chain = models && models.length ? models : [undefined];
        const failures = [];
        let shortest = null;
        let unreachable = 0;
        for (const model of chain) {
            let result;
            try {
                const res = await fetchImpl(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(key ? { authorization: 'Bearer ' + key } : {}) },
                    body: JSON.stringify(model ? { ...body, model } : body),
                    signal: AbortSignal.any([AbortSignal.timeout(180000), signal]),
                });
                result = parseImageStream(await res.text(), res.status);
            } catch (e) {
                result = { error: `request failed: ${e?.message || e}`, status: 0 };
            }
            if (signal.aborted) return { cancelled: true };
            if (result.b64) return { b64: result.b64, model: model ?? '' };
            failures.push(`${model ?? '(default)'}: ${String(result.error).slice(0, 140)}`);
            if (result.status === 0 && /^request failed: /.test(String(result.error))) unreachable += 1;
            const wait = retryDelayMs(result);
            if (wait !== null && (shortest === null || wait < shortest)) shortest = wait;
        }
        return { failures, routerDown: unreachable === chain.length, shortest };
    }

    async function runOne(row) {
        const id = row.id;
        const controller = new AbortController();
        running.set(id, controller);
        try {
            const req = JSON.parse(row.req);
            const attempt = row.attempt + 1;
            const out = await drawOnce(req, controller.signal);
            if (out.cancelled) return;
            if (out.b64) {
                const small = await convert(Buffer.from(out.b64, 'base64'));
                const inlayId = randomUUID();
                await writeInlay(inlayId, small);
                q.drawn.run(inlayId, out.model, now(), now(), id);
                await tryPlace(id);
                return;
            }
            const message = 'Image generation failed on every model: ' + out.failures.join(' | ');
            // the router down (no model reachable at all) is waited out longer: a 9router restart took ~90 s on 2026-10-15 and three jobs
            // failed in it, each after one 8 s retry. A model that answers with an error gets one more pass.
            const maxAttempts = out.routerDown ? 1 + downWaitsMs.length : 2;
            const wait = out.routerDown ? downWaitsMs[attempt - 1] : out.shortest;
            if (wait !== null && wait !== undefined && attempt < maxAttempts) {
                log(`[ImageJobs] ${id}: attempt ${attempt} failed, again in ${Math.round(wait / 1000)} s: ${message.slice(0, 200)}`);
                q.retry.run(now() + wait, message.slice(0, 600), now(), id);
            } else {
                log(`[ImageJobs] ${id}: ${message}`);
                q.fail.run(message.slice(0, 600), now(), id);
            }
        } catch (e) {
            if (controller.signal.aborted) return;
            log(`[ImageJobs] ${id}: ${e?.message || e}`);
            q.fail.run(String(e?.message || e).slice(0, 600), now(), id);
        } finally {
            running.delete(id);
        }
    }

    function arm() {
        if (!timers || closed) return;
        if (wake) { clearTimeout(wake); wake = null; }
        const t = q.nextDue.get().t;
        if (t == null) return;
        wake = setTimeout(() => { wake = null; pump(); }, Math.max(0, t - now()) + 5);
        wake.unref?.();
    }

    /** Starts every job that is due while there is room. */
    function pump() {
        if (closed) return;
        while (running.size < limit) {
            const row = q.due.get(now());
            if (!row) break;
            if (!q.start.run(now(), row.id).changes) break;
            runOne({ ...row, attempt: row.attempt }).finally(() => pump());
        }
        arm();
    }

    /** Puts a drawn picture into its message on the server. 'placed' | 'wait' (its message is not in the file yet) | 'unsupported'. */
    async function tryPlace(id) {
        const row = q.get.get(id);
        if (!row || row.status !== 'done' || !row.inlay_id || !place || !row.idem) return 'unsupported';
        let outcome;
        try {
            outcome = await place(row.target ? JSON.parse(row.target) : null, row.inlay_id);
        } catch (e) {
            log(`[ImageJobs] ${id}: placing failed: ${e?.message || e}`);
            return 'wait';
        }
        if (outcome === 'placed' || outcome === 'already') {
            q.placed.run(now(), now(), id);
            return 'placed';
        }
        return outcome === 'unsupported' ? 'unsupported' : 'wait';
    }

    /** Pictures drawn but not yet in their message: try again; past placeWindowMs the server stops (a page may still place it). */
    async function sweep() {
        for (const row of q.unplaced.all()) {
            if (now() - (row.drawn_at ?? row.updated) > placeWindowMs) { q.orphan.run(now(), row.id); continue; }
            await tryPlace(row.id);
        }
    }

    const targetKey = (t) => t ? [t.charId, t.chatId ?? `#${t.chatIndex}`, t.messageId ?? `#${t.messageIndex}`, t.slot ?? 'main'].join('|') : null;
    const view = (row) => row && ({
        id: row.id, status: row.status, inlayId: row.inlay_id, model: row.model, error: row.error,
        target: row.target ? JSON.parse(row.target) : null, created: row.created, updated: row.updated,
        attempt: row.attempt, nextAt: row.status === 'retrying' ? row.next_at : 0,
        superseded: !!(row.target_key && q.newer.get(row.target_key, row.id)),
    });

    let sweeper = null;
    if (timers) {
        sweeper = setInterval(() => { sweep().catch((e) => log(`[ImageJobs] sweep: ${e?.message || e}`)); }, sweepMs);
        sweeper.unref?.();
        setImmediate(pump);
    }

    return {
        /**
         * Queues a picture. req = { url, key?, models: string[], body } (body without model); target = where it belongs; opts.key makes
         * it idempotent: the same key finds the row that was filed for it, in whatever state it is. { id, existing }.
         */
        enqueue(req, target, opts = {}) {
            if (!req || typeof req.url !== 'string' || !/^https?:\/\//.test(req.url) || !req.body || typeof req.body.prompt !== 'string') {
                throw new Error('bad image job request');
            }
            const idem = typeof opts.key === 'string' && opts.key ? opts.key.slice(0, 400) : null;
            if (idem) {
                const found = q.byIdem.get(idem);
                if (found) return { id: found.id, existing: true };
            }
            const id = randomUUID();
            const stored = JSON.stringify({ url: req.url, key: req.key, models: (req.models || []).filter((m) => typeof m === 'string' && m), body: req.body });
            q.insert.run(id, 'queued', target ? JSON.stringify(target) : null, targetKey(target), idem, stored, target?.chatId ?? null, now(), now());
            pump();
            return { id, existing: false };
        },
        submit(req, target) { return this.enqueue(req, target).id; },
        get: (id) => view(q.get.get(id)),
        /** The pictures of one chat: open ones, failed ones, drawn ones no page has taken yet, and ones placed in the last `recentMs`. */
        forChat: (chatId, recentMs = RECENT_MS) => q.forChat.all(chatId, now() - recentMs).map(view),
        /** Pictures placed in a chat since `since` (ms): what a copy of the chat made before then is missing (turn results). */
        placedSince: (chatId, since) => q.placedSince.all(chatId, since).map(view),
        /** Finished jobs a page has not dealt with (a page that was closed picks these up at its next start). */
        unacked: (recentMs = RECENT_MS) => q.unacked.all(now() - recentMs).map(view),
        ack: (id) => q.ack.run(now(), id).changes > 0,
        /** Stops a job (a running one is aborted). */
        cancel(id) {
            const changed = q.cancel.run(now(), id).changes > 0;
            running.get(id)?.abort();
            return changed;
        },
        /**
         * A turn was undone (its reply thrown away): the pictures asked for it since `since` that are not drawn yet and whose message
         * `isSaved` says is not in the chat file are stopped. Returns how many.
         */
        cancelUnsaved(chatId, since, isSaved) {
            let n = 0;
            for (const row of q.openOfChat.all(chatId, since)) {
                if (row.target && isSaved(JSON.parse(row.target))) continue;
                if (this.cancel(row.id)) n++;
            }
            return n;
        },
        /** Another go at a job that ended in error. */
        retry(id) {
            const changed = q.requeue.run(now(), id).changes > 0;
            if (changed) pump();
            return changed;
        },
        prune: () => q.prune.run(now() - KEEP_MS).changes,
        pump, sweep,
        idle: () => running.size === 0 && !q.due.get(now()),
        close() { closed = true; if (wake) clearTimeout(wake); if (sweeper) clearInterval(sweeper); for (const c of running.values()) c.abort(); db.close(); },
    };
}

module.exports = { openImageJobs, parseImageStream, retryDelayMs, pngSize, toSmallWebp, KEEP_MS };
