// The narrator on ChatGPT web for an acceptance run (asked 2026-10-19: "sau này task test này nên cân nhắc cài chatgpt web trc
// rồi mới xài codex 9router"; the 9router `story` slot on Codex hit its usage limit twice in one task). ChatGPT web is reached
// only through the Codex Web GPT bridge as a `codex exec` turn (its HTTP port refuses a plain request), while the Risu page
// speaks OpenAI chat completions. This loopback shim sits where the COPY's settings point (forceReplaceUrl): a request for the
// narrator's model becomes one `codex exec` turn on a ChatGPT web model; every other request (the judge, the bookkeeper on
// another slot, the model list) goes to the 9router upstream unchanged. Needs the bridge's "Save chats in ChatGPT"
// (useSavedChats) since 2026-10-18: ChatGPT stopped offering the controls the bridge checks in a Temporary Chat.
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'

const SLOT_DIR = path.join(os.tmpdir(), 'risu-web-slots')   // shared with scripts/translate_lore_vi.py: ChatGPT web runs 5 turns at once

/** The chat as one prompt for a coding-agent turn: the app's messages in order, and only the next assistant message asked for. */
export function transcriptPrompt(messages) {
    const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('') : '')
    const body = messages.map((m) => `=== ${String(m.role).toUpperCase()} ===\n${text(m.content)}`).join('\n\n')
    return 'Chỉ làm đúng việc dưới đây và chỉ in kết quả, không dùng công cụ, không đọc file.\n\n'
        + 'This is not a coding task and no repository rules apply. You are the language model behind a chat app. Below is the whole'
        + ' request the app sent: SYSTEM messages are your instructions, USER and ASSISTANT messages are the conversation so far.'
        + ' Write ONLY the next ASSISTANT message, exactly as the instructions ask (language, blocks, format), and nothing else:'
        + ' no preface, no "=== ASSISTANT ===" header, no comment on the task.\n\n' + body + '\n\n=== ASSISTANT ===\n'
}

async function slot(n) {
    fs.mkdirSync(SLOT_DIR, { recursive: true })
    // a lock is a file created exclusively and removed after the turn; a stale one (older than 30 min) is taken over
    for (;;) {
        for (let i = 0; i < n; i++) {
            const f = path.join(SLOT_DIR, `shim-${i}.lock`)
            try { fs.writeFileSync(f, String(process.pid), { flag: 'wx' }); return () => fs.rmSync(f, { force: true }) } catch {
                try { if (Date.now() - fs.statSync(f).mtimeMs > 30 * 60_000) fs.rmSync(f, { force: true }) } catch { /* gone */ }
            }
        }
        await new Promise((r) => setTimeout(r, 2000))
    }
}

/** One `codex exec` turn on the web model; the reply text, or throws. */
export async function webTurn(prompt, { model = 'chatgpt-web/gpt-6-sol', effort = 'medium', slots = 5, timeoutMs = 15 * 60_000 } = {}) {
    const release = await slot(slots)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risu-web-'))
    try {
        const out = path.join(dir, 'out.txt')
        const args = ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-C', dir, '-m', model, '-c', `model_reasoning_effort="${effort}"`, '-o', out, '-']
        const log = await new Promise((resolve, reject) => {
            const p = spawn('codex', args, { stdio: ['pipe', 'pipe', 'pipe'] })
            let err = ''
            p.stdout.on('data', () => {}); p.stderr.on('data', (d) => { err = (err + d).slice(-4000) })
            const t = setTimeout(() => { p.kill('SIGTERM'); reject(new Error('codex exec timed out')) }, timeoutMs)
            p.on('error', (e) => { clearTimeout(t); reject(e) })
            p.on('close', (code) => { clearTimeout(t); resolve({ code, err }) })
            p.stdin.end(prompt)
        })
        const text = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : ''
        if (!text.trim()) throw new Error(`no reply (exit ${log.code}): ${log.err.split('\n').filter((l) => /error/i.test(l)).slice(-2).join(' | ').slice(0, 400)}`)
        return text.replace(/^\s*=== ASSISTANT ===\s*\n/, '')
    } finally {
        release()
        fs.rmSync(dir, { recursive: true, force: true })
    }
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }

/** Start the shim; resolves { url, close, stats }. `narrator`: the request model that goes to ChatGPT web (the COPY's active slot). */
export function startShim({ port = 20199, upstream = 'http://localhost:20128', narrator = 'story', web = {}, log = console.log, turn = webTurn } = {}) {
    const stats = { web: 0, webFailed: 0, proxied: 0 }
    const server = http.createServer(async (req, res) => {
        if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end() }
        const chunks = []
        for await (const c of req) chunks.push(c)
        const raw = Buffer.concat(chunks)
        let body = null
        if (req.method === 'POST' && /\/chat\/completions$/.test(req.url ?? '')) { try { body = JSON.parse(raw.toString('utf8')) } catch { body = null } }
        if (!body || body.model !== narrator) {
            stats.proxied++
            try {
                const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'content-length', 'connection'].includes(k)))
                const r = await fetch(upstream + req.url, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : raw })
                res.writeHead(r.status, { ...CORS, 'content-type': r.headers.get('content-type') ?? 'application/json' })
                if (r.body) for await (const c of r.body) res.write(c)
                return res.end()
            } catch (e) { res.writeHead(502, CORS); return res.end(JSON.stringify({ error: { message: `shim upstream: ${e.message}` } })) }
        }
        const id = 'chatcmpl-web-' + Date.now().toString(36)
        const stream = !!body.stream
        let ping = null
        if (stream) {
            res.writeHead(200, { ...CORS, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
            ping = setInterval(() => res.write(': waiting for ChatGPT web\n\n'), 10_000)
        }
        try {
            const t0 = Date.now()
            const text = await turn(transcriptPrompt(body.messages ?? []), web)
            stats.web++
            log(`[shim] web turn ${((Date.now() - t0) / 1000).toFixed(0)} s, ${text.length} chars`)
            if (stream) {
                clearInterval(ping)
                const chunk = (delta, finish = null) => `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: narrator, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
                res.write(chunk({ role: 'assistant', content: text })); res.write(chunk({}, 'stop')); res.write('data: [DONE]\n\n')
                return res.end()
            }
            res.writeHead(200, { ...CORS, 'content-type': 'application/json' })
            return res.end(JSON.stringify({ id, object: 'chat.completion', model: narrator, choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] }))
        } catch (e) {
            stats.webFailed++
            log(`[shim] web turn failed: ${e.message}`)
            clearInterval(ping)
            if (stream) { res.write(`data: ${JSON.stringify({ error: { message: `ChatGPT web: ${e.message}` } })}\n\n`); return res.end() }
            res.writeHead(502, { ...CORS, 'content-type': 'application/json' })
            return res.end(JSON.stringify({ error: { message: `ChatGPT web: ${e.message}` } }))
        }
    })
    return new Promise((resolve, reject) => {
        server.on('error', reject)
        server.listen(port, '127.0.0.1', () => resolve({ url: `http://localhost:${port}/v1/chat/completions`, stats, close: () => new Promise((r) => server.close(r)) }))
    })
}
