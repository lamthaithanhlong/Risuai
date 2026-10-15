// Chat pictures drawn on the server, as jobs (the picture no longer depends on the page that asked for it staying open).
//
// A page posts the request (router URL, key, models in fallback order, the image body); the server asks the router as a stream
// (progress every few seconds, the picture in the `done` event), tries the next model when one fails, resizes the picture to
// 360 px WebP (cwebp, about 16 KB) and writes it as inlays/<id> through the save queue, then marks the job done with that id.
// The page polls the job; a page that was closed meanwhile finds the finished job at its next start and puts the picture in
// the message it was meant for (src/ts/process/imageJobClient.ts). Finished jobs are kept two days.
//
// The router key is kept in memory only, never in SQLite: a job that was running when the server stopped is marked
// "interrupted" at the next start, and the page asks again.

const Database = require('better-sqlite3');
const { randomUUID } = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEEP_MS = 48 * 60 * 60 * 1000;
const MAX_SIDE = 360;
const MAX_RUNNING = 2;
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

function openImageJobs({ dbFile, writeInlay, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), convert = toSmallWebp, now = Date.now, log = console.error }) {
    const db = new Database(dbFile);
    db.pragma('journal_mode = WAL');
    db.exec(`
        CREATE TABLE IF NOT EXISTS image_jobs (
            id TEXT PRIMARY KEY,
            status TEXT NOT NULL,           -- queued | running | done | error | interrupted
            target TEXT,                    -- JSON from the page: which chat and message the picture belongs to
            inlay_id TEXT,
            model TEXT,
            error TEXT,
            acked INTEGER NOT NULL DEFAULT 0,
            created INTEGER NOT NULL,
            updated INTEGER NOT NULL
        );
    `);
    const q = {
        insert: db.prepare('INSERT INTO image_jobs (id, status, target, created, updated) VALUES (?, ?, ?, ?, ?)'),
        set: db.prepare('UPDATE image_jobs SET status = ?, inlay_id = ?, model = ?, error = ?, updated = ? WHERE id = ?'),
        get: db.prepare('SELECT * FROM image_jobs WHERE id = ?'),
        unacked: db.prepare("SELECT * FROM image_jobs WHERE acked = 0 AND status IN ('done', 'error', 'interrupted') ORDER BY created"),
        ack: db.prepare('UPDATE image_jobs SET acked = 1, updated = ? WHERE id = ?'),
        interrupt: db.prepare("UPDATE image_jobs SET status = 'interrupted', error = 'the server stopped while drawing', updated = ? WHERE status IN ('queued', 'running')"),
        prune: db.prepare('DELETE FROM image_jobs WHERE updated < ?'),
    };
    // which message a job is for, so a newer job for the same message supersedes an older one (TLC, docs/specs/ImageJobs.tla:
    // without it a slow older picture finishing after a redraw replaced the newer one)
    if (!db.prepare("SELECT 1 FROM pragma_table_info('image_jobs') WHERE name = 'target_key'").get()) {
        db.exec('ALTER TABLE image_jobs ADD COLUMN target_key TEXT');
    }
    q.insert = db.prepare('INSERT INTO image_jobs (id, status, target, target_key, created, updated) VALUES (?, ?, ?, ?, ?, ?)');
    q.newer = db.prepare('SELECT 1 FROM image_jobs WHERE target_key = ? AND rowid > (SELECT rowid FROM image_jobs WHERE id = ?) LIMIT 1');
    q.interrupt.run(now());

    const waiting = [];          // { id, req } — the request (with its key) never leaves memory
    let running = 0;

    async function draw(job) {
        const { url, key, models, body } = job.req;
        const chain = models && models.length ? models : [undefined];
        let failures = [];
        for (let round = 1; round <= 1 + DOWN_WAITS_MS.length; round++) {
            failures = [];
            let shortest = null;
            let unreachable = 0;
            for (const model of chain) {
                let result;
                try {
                    const res = await fetchImpl(url, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(key ? { authorization: 'Bearer ' + key } : {}) },
                        body: JSON.stringify(model ? { ...body, model } : body),
                        signal: AbortSignal.timeout(180000),
                    });
                    result = parseImageStream(await res.text(), res.status);
                } catch (e) {
                    result = { error: `request failed: ${e?.message || e}`, status: 0 };
                }
                if (result.b64) return { b64: result.b64, model: model ?? '' };
                failures.push(`${model ?? '(default)'}: ${String(result.error).slice(0, 140)}`);
                if (result.status === 0 && /^request failed: /.test(String(result.error))) unreachable += 1;
                const wait = retryDelayMs(result);
                if (wait !== null && (shortest === null || wait < shortest)) shortest = wait;
            }
            const routerDown = unreachable === chain.length;
            if (shortest === null || round > DOWN_WAITS_MS.length || (!routerDown && round >= 2)) break;
            await sleep(routerDown ? DOWN_WAITS_MS[round - 1] : shortest);
        }
        throw new Error('Image generation failed on every model: ' + failures.join(' | '));
    }

    async function runOne(job) {
        q.set.run('running', null, null, null, now(), job.id);
        try {
            const { b64, model } = await draw(job);
            const small = await convert(Buffer.from(b64, 'base64'));
            const inlayId = randomUUID();
            await writeInlay(inlayId, small);
            q.set.run('done', inlayId, model, null, now(), job.id);
        } catch (e) {
            log(`[ImageJobs] ${job.id}: ${e?.message || e}`);
            q.set.run('error', null, null, String(e?.message || e).slice(0, 600), now(), job.id);
        }
    }

    function pump() {
        while (running < MAX_RUNNING && waiting.length) {
            const job = waiting.shift();
            running++;
            runOne(job).finally(() => { running--; pump(); });
        }
    }

    const targetKey = (t) => t ? [t.charId, t.chatId ?? `#${t.chatIndex}`, t.messageId ?? `#${t.messageIndex}`].join('|') : null;
    const view = (row) => row && ({
        id: row.id, status: row.status, inlayId: row.inlay_id, model: row.model, error: row.error,
        target: row.target ? JSON.parse(row.target) : null, created: row.created,
        superseded: !!(row.target_key && q.newer.get(row.target_key, row.id)),
    });

    return {
        /** Queues a picture. req = { url, key?, models: string[], body } (body without model); target = where it belongs. */
        submit(req, target) {
            if (!req || typeof req.url !== 'string' || !/^https?:\/\//.test(req.url) || !req.body || typeof req.body.prompt !== 'string') {
                throw new Error('bad image job request');
            }
            const id = randomUUID();
            q.insert.run(id, 'queued', target ? JSON.stringify(target) : null, targetKey(target), now(), now());
            waiting.push({ id, req: { url: req.url, key: req.key, models: (req.models || []).filter((m) => typeof m === 'string' && m), body: req.body } });
            pump();
            return id;
        },
        get: (id) => view(q.get.get(id)),
        /** Finished jobs no page has taken yet (a page that was closed picks these up at its next start). */
        unacked: () => q.unacked.all().map(view),
        ack: (id) => q.ack.run(now(), id).changes > 0,
        prune: () => q.prune.run(now() - KEEP_MS).changes,
        idle: () => running === 0 && waiting.length === 0,
        close: () => db.close(),
    };
}

module.exports = { openImageJobs, parseImageStream, retryDelayMs, pngSize, toSmallWebp, KEEP_MS };
