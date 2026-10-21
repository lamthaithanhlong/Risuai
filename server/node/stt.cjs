// Speech to text on this Mac: POST /api/stt takes the audio the phone recorded and answers { text, language }.
// Nothing goes to a cloud: faster-whisper runs in one long-lived Python worker (stt_worker.py, JSON lines on stdin/stdout) so a
// turn does not pay the model load. Measured 2026-10-20 on this Mac (CPU int8, other work running): "turbo" (large-v3-turbo) got every
// word of two Vietnamese sentences and an English one (WER 0.00; small 0.07) in 6-8 s a clip, and 0.20 against small's 0.29 on a
// 37 s passage. Clips up to 60 s go to turbo; longer ones to small, greedy, so a 2-minute recording still ends inside the 60 s limit.
//
//   - one transcription at a time (a queue), 60 s for each, counted from when the worker has the clip; a stuck worker is killed
//     and the next request starts a fresh one;
//   - the worker starts on the first call (or POST /api/stt/warm, which the page sends when the mic is tapped, so the model loads
//     while the owner is still talking) and is stopped after IDLE_MS without a call, to give the memory back;
//   - the body is capped (MAX_BYTES, 10 MB: 2 minutes of AAC is well under 2 MB);
//   - no worker to run (no venv): 503 with { error: { code: 'unavailable' } }, and the page falls back to the browser's own
//     recogniser or says so.

const { spawn: nodeSpawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const EXT_BY_TYPE = {
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'webm', 'video/webm': 'webm', 'video/mp4': 'mp4',
    'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
};
const extFor = (contentType) => EXT_BY_TYPE[String(contentType || '').split(';')[0].trim().toLowerCase()] || 'bin';

const home = os.homedir();
const DEFAULTS = {
    python: path.join(home, '.risu-lan', 'stt-venv', 'bin', 'python'),
    script: path.join(__dirname, 'stt_worker.py'),
    args: ['turbo', 'small', '60'],
    tmpDir: path.join(os.tmpdir(), 'risu-stt'),
    maxBytes: 10 * 1024 * 1024,
    timeoutMs: 60000,
    loadTimeoutMs: 180000,
    idleMs: 15 * 60 * 1000,
};

class SttError extends Error {
    constructor(code, message) { super(message); this.code = code; }
}

function createStt(options = {}) {
    const o = { ...DEFAULTS, ...options };
    const spawn = o.spawn || nodeSpawn;
    let worker = null;          // { proc, ready: Promise, pending: Map<id, {resolve, reject}> }
    let nextId = 1;
    let queue = Promise.resolve();
    let idleTimer = null;
    let closed = false;

    function start() {
        if (worker) return worker;
        if (!o.spawn && !fs.existsSync(o.python)) {
            throw new SttError('unavailable', `no speech-to-text installed (expected ${o.python})`);
        }
        const proc = spawn(o.python, [o.script, ...o.args], { stdio: ['pipe', 'pipe', 'pipe'] });
        const w = { proc, pending: new Map(), dead: false };
        w.ready = new Promise((resolve, reject) => {
            const timer = setTimeout(() => { fail(new SttError('unavailable', 'the speech model did not load in time')); kill(w); }, o.loadTimeoutMs);
            timer.unref?.();
            w.onReady = () => { clearTimeout(timer); resolve(); };
            w.onFail = (e) => { clearTimeout(timer); reject(e); };
        });
        w.ready.catch(() => { /* surfaced to whoever awaits it */ });
        function fail(e) {
            w.dead = true;
            if (worker === w) worker = null;
            w.onFail(e);
            for (const p of w.pending.values()) p.reject(e);
            w.pending.clear();
        }
        w.fail = fail;
        readline.createInterface({ input: proc.stdout }).on('line', (line) => {
            let msg;
            try { msg = JSON.parse(line); } catch { return; }
            if (msg.ready) { w.onReady(); return; }
            const p = w.pending.get(msg.id);
            if (!p) return;
            w.pending.delete(msg.id);
            if (msg.ok) p.resolve(msg);
            else p.reject(new SttError('failed', msg.error || 'transcription failed'));
        });
        proc.stderr?.on('data', () => { /* model download progress and warnings; nothing to act on */ });
        proc.on('error', (e) => fail(new SttError('unavailable', 'cannot start the speech worker: ' + e.message)));
        proc.on('exit', (code) => fail(new SttError('failed', 'the speech worker stopped (exit ' + code + ')')));
        worker = w;
        return w;
    }
    function kill(w) {
        try { w.proc.kill('SIGKILL'); } catch { /* already gone */ }
        w.fail?.(new SttError('failed', 'the speech worker was stopped'));
    }
    function touch() {
        clearTimeout(idleTimer);
        if (closed) return;
        idleTimer = setTimeout(() => { if (worker) kill(worker); }, o.idleMs);
        idleTimer.unref?.();
    }

    /** Starts the worker (model load) without a clip; resolves when it is ready. */
    async function warm() {
        const w = start();
        touch();
        await w.ready;
    }

    function transcribe(audio, contentType, language) {
        const job = queue.then(() => run(audio, contentType, language));
        queue = job.catch(() => { /* the next request goes on */ });
        return job;
    }

    async function run(audio, contentType, language) {
        if (closed) throw new SttError('failed', 'speech-to-text is shut down');
        const w = start();
        touch();
        await w.ready;
        fs.mkdirSync(o.tmpDir, { recursive: true });
        const file = path.join(o.tmpDir, `${process.pid}-${Date.now()}-${nextId}.${extFor(contentType)}`);
        fs.writeFileSync(file, audio);
        const id = nextId++;
        let timer;
        try {
            const done = new Promise((resolve, reject) => {
                w.pending.set(id, { resolve, reject });
                w.proc.stdin.write(JSON.stringify({ id, path: file, language: language || 'auto' }) + '\n');
            });
            const limit = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new SttError('timeout', `no transcription within ${Math.round(o.timeoutMs / 1000)} s`));
                    kill(w);   // the worker is busy with this clip; a fresh one takes the next
                }, o.timeoutMs);
            });
            const msg = await Promise.race([done, limit]);
            return { text: String(msg.text || '').trim(), language: msg.language, seconds: msg.seconds, audioSeconds: msg.audio_s, model: msg.model };
        } finally {
            clearTimeout(timer);
            w.pending.delete(id);
            try { fs.unlinkSync(file); } catch { /* already gone */ }
            touch();
        }
    }

    function close() {
        closed = true;
        clearTimeout(idleTimer);
        if (worker) kill(worker);
    }

    return { transcribe, warm, close, maxBytes: o.maxBytes, isRunning: () => !!worker };
}

const LANGUAGES = new Set(['vi', 'en', 'auto']);

/**
 * Mounts POST /api/stt and POST /api/stt/warm. `auth(req, res)` answers false after it has replied (like checkAuth).
 * The body is the audio bytes themselves, content-type passed through (audio/mp4 from WebKit, audio/webm elsewhere).
 */
function mountStt(app, { express, stt, auth, limiter }) {
    const guard = async (req, res, next) => { if (await auth(req, res)) next(); };
    const raw = express.raw({ type: () => true, limit: stt.maxBytes });
    app.post('/api/stt/warm', limiter, guard, async (req, res) => {
        try { await stt.warm(); res.send({ ok: true }); } catch (e) { sendError(res, e); }
    });
    app.post('/api/stt', limiter, guard, raw, async (req, res) => {
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) { res.status(400).send({ error: { code: 'empty', message: 'the body is empty: send the audio bytes' } }); return; }
        if (body.length > stt.maxBytes) { res.status(413).send({ error: { code: 'too_large', message: `the audio is over ${Math.round(stt.maxBytes / 1048576)} MB` } }); return; }
        const type = String(req.headers['content-type'] || '');
        if (!/^(audio|video)\//i.test(type) && !/^application\/octet-stream/i.test(type)) {
            res.status(415).send({ error: { code: 'bad_type', message: 'send audio (audio/mp4, audio/webm, audio/wav ...)' } });
            return;
        }
        const wanted = String(req.headers['x-stt-language'] || '').toLowerCase();
        try {
            const out = await stt.transcribe(body, type, LANGUAGES.has(wanted) ? wanted : 'auto');
            res.send(out);
        } catch (e) { sendError(res, e); }
    });
    // express.raw refuses an oversized body with its own error: answer it in the same JSON shape
    app.use('/api/stt', (err, req, res, next) => {
        if (err && (err.type === 'entity.too.large' || err.status === 413)) {
            res.status(413).send({ error: { code: 'too_large', message: `the audio is over ${Math.round(stt.maxBytes / 1048576)} MB` } });
            return;
        }
        next(err);
    });
}

function sendError(res, e) {
    const code = e instanceof SttError ? e.code : 'failed';
    const status = code === 'unavailable' ? 503 : code === 'timeout' ? 504 : 500;
    res.status(status).send({ error: { code, message: String(e?.message || e) } });
}

module.exports = { createStt, mountStt, extFor, SttError };
