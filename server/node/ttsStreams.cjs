// Message TTS as one plain audio/mpeg stream, for an <audio> element (so it keeps playing when the iPhone screen locks or the
// app is switched: Web Audio stops there, an element playing an HTTP stream does not, and it gets lock-screen controls).
//
// The page sets <audio src="/api/tts/stream/<uuid>"> and calls play() inside the tap, then POSTs the text and voice (with the
// usual risu-auth) to the same URL. A media GET cannot send headers, so the unguessable uuid is the capability:
//   - registered by an authenticated POST, valid for ttlMs (60 s) until a GET claims it;
//   - the GET may come first: it waits up to waitMs (20 s) for the registration, then 404;
//   - one registration, one synthesis: a second POST for the same id is refused (409), and the stream is dropped lingerMs after
//     it finished (or idleMs after the last reader left while it was still being made), so the uuid stops working.
//
// The TTS server sends frames ('A' + 4-byte big-endian length + a complete MP3 file; 'E' = error). Each chunk is its own file
// (ID3v2 header, a silent Xing/Info frame, the audio, maybe an ID3v1 tag): joined as they are, every chunk after the first would
// put a tag and a silent frame in the middle of the stream. They are stripped here and the frames sent back to back.
//
// Range: WebKit probes with `Range: bytes=0-1` and may resume with `bytes=N-`. The bytes made so far are kept for the stream's
// life, so a range the server has is answered with 206; a start at 0 while the audio is still being made is answered with the
// whole growing stream as 200 (a server may ignore a Range header; Icecast does the same and Safari plays it as a live stream).
// Once the stream is complete the length is known and every range gets an exact 206 (the lock screen can scrub).

const crypto = require('crypto');

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Splits the TTS server's byte stream into frames; the stream may cut a frame anywhere. */
class FrameParser {
    constructor() { this.buf = Buffer.alloc(0); }
    push(piece) {
        this.buf = this.buf.length ? Buffer.concat([this.buf, piece]) : Buffer.from(piece);
        const out = [];
        while (this.buf.length >= 5) {
            const len = this.buf.readUInt32BE(1);
            if (this.buf.length < 5 + len) break;
            out.push({ kind: this.buf[0] === 0x45 ? 'error' : 'audio', data: this.buf.subarray(5, 5 + len) });
            this.buf = this.buf.subarray(5 + len);
        }
        return out;
    }
}

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Size in bytes of the Layer III frame that starts at `b[at]`, or 0 when there is none there. */
function mp3FrameSize(b, at) {
    if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return 0;
    const version = (b[at + 1] >> 3) & 3;            // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5, 1 = reserved
    const layer = (b[at + 1] >> 1) & 3;              // 1 = Layer III
    const bi = b[at + 2] >> 4, si = (b[at + 2] >> 2) & 3, pad = (b[at + 2] >> 1) & 1;
    if (version === 1 || layer !== 1 || bi === 0 || bi === 15 || si === 3) return 0;
    const rate = SAMPLE_RATES[version][si];
    const kbps = (version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[bi];
    return Math.floor((version === 3 ? 144000 : 72000) * kbps / rate) + pad;
}

/** One MP3 file without its ID3v2 header, its ID3v1 tag and its Xing/Info frame: only the audio frames. */
function stripMp3(file) {
    let start = 0, end = file.length;
    if (end >= 10 && file.toString('latin1', 0, 3) === 'ID3') {          // ID3v2: 10 bytes + a syncsafe size (+10 with a footer)
        const size = ((file[6] & 0x7f) << 21) | ((file[7] & 0x7f) << 14) | ((file[8] & 0x7f) << 7) | (file[9] & 0x7f);
        start = Math.min(end, 10 + size + ((file[5] & 0x10) ? 10 : 0));
    }
    if (end - start >= 128 && file.toString('latin1', end - 128, end - 125) === 'TAG') end -= 128;
    // the silent first frame the encoder writes: "Xing" or "Info" inside it
    const first = mp3FrameSize(file, start);
    if (first && start + first <= end) {
        const head = file.toString('latin1', start, Math.min(end, start + 4 + 40));
        if (head.includes('Xing') || head.includes('Info')) start += first;
    }
    return file.subarray(start, end);
}

function parseRange(header, total) {
    if (typeof header !== 'string') return null;
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!m || (m[1] === '' && m[2] === '')) return null;
    if (m[1] === '') return total == null ? null : { start: Math.max(0, total - Number(m[2])), end: total - 1, suffix: true };
    return { start: Number(m[1]), end: m[2] === '' ? null : Number(m[2]) };
}

/**
 * open(req, signal) → async iterable of Buffers: the TTS server's framed byte stream for {model, voice, input}.
 */
function createTtsStreams({ open, ttlMs = 60000, waitMs = 20000, lingerMs = 20000, idleMs = 15000, maxPlaceholders = 32 }) {
    const streams = new Map();

    function drop(e) {
        if (e.dropped) return;
        e.dropped = true;
        clearTimeout(e.timer);
        e.ctrl?.abort();
        streams.delete(e.id);
        for (const w of [...e.waiters]) w();
    }
    // the stream's clock: unclaimed → ttlMs from registration; claimed but nobody reading → idleMs (lingerMs once complete)
    function arm(e) {
        clearTimeout(e.timer);
        if (e.dropped) return;
        let ms = null;
        if (!e.registered) ms = waitMs;
        else if (!e.claimed) ms = ttlMs - (Date.now() - e.registeredAt);
        else if (e.readers === 0) ms = e.state === 'running' ? idleMs : lingerMs;
        if (ms == null) return;
        e.timer = setTimeout(() => drop(e), Math.max(1, ms));
        e.timer.unref?.();
    }
    function wake(e) { for (const w of [...e.waiters]) w(); }

    function entry(id) {
        let e = streams.get(id);
        if (e) return e;
        e = { id, registered: false, claimed: false, readers: 0, state: 'waiting', parts: [], length: 0, error: null, waiters: new Set(), ctrl: null, timer: null, registeredAt: 0, dropped: false };
        streams.set(id, e);
        return e;
    }
    const waitFor = (e) => new Promise((resolve) => { const w = () => { e.waiters.delete(w); resolve(); }; e.waiters.add(w); });

    async function run(e, req) {
        e.ctrl = new AbortController();
        e.state = 'running';
        const parser = new FrameParser();
        try {
            for await (const piece of open(req, e.ctrl.signal)) {
                for (const f of parser.push(Buffer.from(piece))) {
                    if (f.kind === 'error') throw new Error(f.data.toString('utf8') || 'TTS error');
                    const audio = Buffer.from(stripMp3(f.data));
                    if (audio.length) { e.parts.push(audio); e.length += audio.length; wake(e); }
                }
            }
            e.state = 'done';
        } catch (err) {
            if (e.dropped) return;
            e.state = 'error';
            e.error = String(err?.message || err);
        }
        if (e.dropped) return;
        if (e.state === 'done' && e.length === 0) { e.state = 'error'; e.error = 'the TTS server sent no audio'; }
        arm(e);
        wake(e);
    }

    /** The authenticated POST: the stream starts being made now, whether or not the GET has arrived. */
    function register(id, req) {
        if (!ID_RE.test(id)) return { ok: false, status: 400, error: 'bad stream id' };
        const existing = streams.get(id);
        if (existing?.registered) return { ok: false, status: 409, error: 'stream already registered' };
        if (!existing) {
            const placeholders = [...streams.values()].filter((s) => !s.registered).length;
            if (placeholders >= maxPlaceholders) return { ok: false, status: 429, error: 'too many pending streams' };
        }
        const e = existing ?? entry(id);
        e.registered = true;
        e.registeredAt = Date.now();
        void run(e, req);
        arm(e);
        wake(e);
        return { ok: true, status: 202 };
    }

    function stop(id) {
        const e = streams.get(id);
        if (!e) return false;
        drop(e);
        return true;
    }

    function readFrom(e, offset, max = Infinity) {
        const out = [];
        let pos = 0, got = 0;
        for (const p of e.parts) {
            if (pos + p.length > offset && got < max) {
                const from = Math.max(0, offset - pos);
                const piece = p.subarray(from, Math.min(p.length, from + (max - got)));
                out.push(piece); got += piece.length;
            }
            pos += p.length;
            if (got >= max) break;
        }
        return Buffer.concat(out);
    }

    /** The GET (no auth: the uuid is the capability). */
    async function serve(id, req, res) {
        if (!ID_RE.test(id)) { res.status(404).end(); return; }
        const existing = streams.get(id);
        if (!existing) {
            const placeholders = [...streams.values()].filter((s) => !s.registered).length;
            if (placeholders >= maxPlaceholders) { res.status(429).end(); return; }
        }
        const e = existing ?? entry(id);
        e.readers++;
        e.claimed = e.claimed || e.registered;
        arm(e);
        let closed = false;
        const onClose = () => {
            if (closed) return;
            closed = true;
            e.readers = Math.max(0, e.readers - 1);
            wake(e);
            if (!e.dropped) arm(e);
        };
        res.on('close', onClose);
        try {
            if (!e.registered) {                          // the GET got here before the POST: wait for the registration
                while (!e.registered && !e.dropped && !closed) await waitFor(e);        // arm() drops a placeholder after waitMs
                if (closed) return;
                if (!e.registered) { res.status(404).end(); return; }
            }
            e.claimed = true;
            arm(e);
            if (e.dropped) { res.status(404).end(); return; }

            // first bytes (or the failure) before any header: a stream that never starts is a 502, not an empty 200
            while (e.length === 0 && e.state === 'running' && !e.dropped && !closed) await waitFor(e);
            if (closed) return;
            if (e.dropped) { res.status(404).end(); return; }
            if (e.length === 0) { res.status(502).setHeader('cache-control', 'no-store'); res.send({ error: { message: e.error || 'TTS failed' } }); return; }

            const complete = e.state === 'done';
            const total = complete ? e.length : null;
            const range = parseRange(req.headers.range, total);
            res.setHeader('content-type', 'audio/mpeg');
            res.setHeader('cache-control', 'no-store');
            res.setHeader('accept-ranges', 'bytes');
            res.setHeader('x-accel-buffering', 'no');
            let offset = 0, last = null;
            if (range && total != null && range.start >= total) {
                res.status(416).setHeader('content-range', `bytes */${total}`); res.end(); return;
            }
            if (range && (range.start > 0 || total != null)) {
                // a start past what is made yet: wait for it (the element resumed ahead of the synthesis)
                while (range.start >= e.length && e.state === 'running' && !e.dropped && !closed) await waitFor(e);
                if (closed || e.dropped) { if (!closed) res.status(404).end(); return; }
                if (range.start >= e.length) { res.status(416).setHeader('content-range', `bytes */${e.length}`); res.end(); return; }
                const known = e.state === 'done' ? e.length : null;
                offset = range.start;
                last = range.end == null ? null : Math.min(range.end, (known ?? Infinity) - 1);
                const to = last ?? (known != null ? known - 1 : null);
                res.status(206).setHeader('content-range', to != null ? `bytes ${offset}-${to}/${known ?? '*'}` : `bytes ${offset}-/*`);
                if (known != null && to != null) res.setHeader('content-length', String(to - offset + 1));
            } else if (total != null) {
                res.setHeader('content-length', String(total));
            }
            res.flushHeaders?.();
            // stream: the bytes made so far, then the rest as it arrives
            for (;;) {
                if (closed || e.dropped) break;
                const wanted = last == null ? Infinity : last + 1 - offset;
                if (wanted <= 0) break;
                const piece = readFrom(e, offset, wanted);
                if (piece.length) {
                    offset += piece.length;
                    if (!res.write(piece)) await new Promise((r) => { res.once('drain', r); res.once('close', r); });
                    continue;
                }
                if (e.state !== 'running') break;
                await waitFor(e);
            }
            if (!closed) res.end();
        } finally {
            res.off('close', onClose);
            onClose();
        }
    }

    return { register, serve, stop, size: () => streams.size, has: (id) => streams.has(id), _status: (id) => streams.get(id)?.state ?? null };
}

module.exports = { createTtsStreams, FrameParser, stripMp3, mp3FrameSize, parseRange };
