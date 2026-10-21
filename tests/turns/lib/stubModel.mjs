// A stand-in for the owner's model (9router / ChatGPT web), OpenAI chat-completions compatible, for measuring what happens to a turn
// when the page goes away. Streams its reply slowly so a turn has a "during"; every request is logged with its arrival and end time;
// faults are armed through POST /control: { failNext: 'reset' | '500' | 'none', streamMs, helperMs }.
//   reset: the next streamed reply sends a few chunks and then the socket is destroyed (the model dies mid-stream)
//   500:   the next streamed request is answered 500 at once
// The picture endpoint (POST .../images/generations, what the server's image jobs call, logged as kind 'image'):
//   { imageMs: ms a picture takes, imageFail: ['500' | 'cut' | 'ok', ...] consumed one per request, imageFailAlways: '500' | 'cut' | null }
//   500: answered 500 at once; cut: a progress event and then the stream ends without a picture (read as a temporary failure)
import http from 'http'
import zlib from 'zlib'

/** A valid size x size grey PNG (the server resizes it; a stub picture needs no model). */
export function stubPng(size = 64) {
    const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
    const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
    const chunk = (type, data) => { const t = Buffer.from(type, 'ascii'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]) }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 0
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size, 0x80)])
    const raw = Buffer.concat(Array.from({ length: size }, () => row))
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

export async function startStubModel({ port = 0, streamMs = 8000, helperMs = 300, reply = null } = {}) {
    const log = []
    const ctl = { failNext: [], streamMs, helperMs, imageMs: 500, imageFail: [], imageFailAlways: null }
    let n = 0
    const text = (i) => reply ?? `Câu trả lời số ${i}. Gió thổi qua con phố vắng, người đưa thư dừng lại trước cánh cửa thứ ba. ` +
        `Anh gõ hai lần, chờ, rồi gõ thêm một lần nữa. Bên trong có tiếng bước chân. Hết lượt ${i}.`
    const server = http.createServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/control') {
            let b = ''; for await (const c of req) b += c
            const j = JSON.parse(b || '{}')
            if (j.failNext) ctl.failNext.push(...[].concat(j.failNext))
            if (j.streamMs) ctl.streamMs = j.streamMs
            if (j.helperMs != null) ctl.helperMs = j.helperMs
            if (j.imageMs != null) ctl.imageMs = j.imageMs
            if (j.imageFail) ctl.imageFail.push(...[].concat(j.imageFail))
            if ('imageFailAlways' in j) ctl.imageFailAlways = j.imageFailAlways
            if (j.clear) { log.length = 0; ctl.failNext.length = 0; ctl.imageFail.length = 0; ctl.imageFailAlways = null }
            res.end('{}'); return
        }
        if (req.method === 'GET' && req.url === '/log') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(log)); return }
        if (req.method === 'POST' && /images\/generations/.test(req.url)) {
            let ib = ''; for await (const c of req) ib += c
            let body = {}; try { body = JSON.parse(ib) } catch { /* not json */ }
            const entry = { id: ++n, kind: 'image', at: Date.now(), end: null, outcome: null, lastUser: String(body.prompt ?? '').slice(0, 120), model: body.model }
            log.push(entry)
            req.on('close', () => { if (!entry.end) { entry.end = Date.now(); entry.outcome = entry.outcome ?? 'client-closed' } })
            const fault = ctl.imageFail.shift() ?? ctl.imageFailAlways ?? 'ok'
            if (fault === '500') { res.statusCode = 500; res.end('{"error":{"message":"stub image upstream 500"}}'); entry.end = Date.now(); entry.outcome = '500'; return }
            res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
            res.write('event: progress\ndata: {"stage":"response.created"}\n\n')
            await new Promise((r) => setTimeout(r, ctl.imageMs))
            if (res.destroyed) return
            if (fault === 'cut') { res.end(); entry.end = Date.now(); entry.outcome = 'cut'; return }
            res.end(`event: done\ndata: ${JSON.stringify({ data: [{ b64_json: stubPng().toString('base64') }] })}\n\n`)
            entry.end = Date.now(); entry.outcome = 'ok'
            return
        }
        if (req.method !== 'POST' || !/chat\/completions/.test(req.url)) { res.statusCode = 404; res.end(); return }
        let b = ''; for await (const c of req) b += c
        let body = {}; try { body = JSON.parse(b) } catch { /* not json */ }
        const id = ++n
        const first = typeof body.messages?.[0]?.content === 'string' ? body.messages[0].content : ''
        const kind = body.stream ? 'stream' : /lore|shelves|index/i.test(first.slice(0, 200)) ? 'lore-pick' : 'helper'
        const entry = { id, kind, at: Date.now(), end: null, outcome: null, lastUser: String([...(body.messages ?? [])].reverse().find((m) => m.role === 'user')?.content ?? '').slice(-160) }
        log.push(entry)
        req.on('close', () => { if (!entry.end) { entry.end = Date.now(); entry.outcome = entry.outcome ?? 'client-closed' } })
        if (!body.stream) {
            await new Promise((r) => setTimeout(r, ctl.helperMs))
            const content = kind === 'lore-pick' ? '1, 2' : 'OK'
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ id: 'x' + id, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }))
            entry.end = Date.now(); entry.outcome = 'ok'
            return
        }
        const fault = ctl.failNext.shift() ?? 'none'
        if (fault === '500') { res.statusCode = 500; res.end('{"error":{"message":"stub upstream 500"}}'); entry.end = Date.now(); entry.outcome = '500'; return }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
        const words = text(id).split(' ')
        const step = Math.max(10, Math.floor(ctl.streamMs / words.length))
        for (let i = 0; i < words.length; i++) {
            if (res.destroyed) return
            if (fault === 'reset' && i === Math.floor(words.length / 3)) { entry.end = Date.now(); entry.outcome = 'reset'; req.socket.destroy(); return }
            res.write(`data: ${JSON.stringify({ id: 'x' + id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: (i ? ' ' : '') + words[i] } }] })}\n\n`)
            await new Promise((r) => setTimeout(r, step))
        }
        res.write(`data: ${JSON.stringify({ id: 'x' + id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`)
        res.end('data: [DONE]\n\n')
        entry.end = Date.now(); entry.outcome = 'ok'
    })
    await new Promise((r) => server.listen(port, '127.0.0.1', r))
    return { port: server.address().port, log, ctl, close: () => new Promise((r) => server.close(r)) }
}
