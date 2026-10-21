// Measures what a story turn really sends. The turns run in the server's page, not in the Playwright page (play.mjs sees no request
// and __loreStats stays null there), so the numbers are taken where every request passes: a loopback proxy at the COPY's
// forceReplaceUrl that forwards each request to the router unchanged and counts the request's tokens (o200k, the app's own tokenizer)
// on the way: the whole request, the scene's lore message (books + facts, loreIndex.ts sceneLoreMessage) split into books and the
// librarian's tagged facts. One JSON line per request in `file`; summarise() folds them into the record.
import http from 'http'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { REPO } from './env.mjs'

const require = createRequire(import.meta.url)
const { get_encoding } = require(path.join(REPO, 'node_modules/@dqbd/tiktoken'))
const enc = get_encoding('o200k_base')
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('') : '')
export const tok = (s) => enc.encode(String(s ?? '')).length
const LORE_HEAD = /^system: \[Lore for this scene\]/
const FACTS_AT = /\n\n\[Facts the librarian checked for this scene\./

/** the token split of one chat-completions body */
export function splitRequest(body) {
    const msgs = Array.isArray(body?.messages) ? body.messages : []
    const out = { model: body?.model ?? null, messages: msgs.length, total: 0, lore: 0, books: 0, facts: 0, hasLore: false }
    for (const m of msgs) {
        const t = textOf(m.content)
        const n = tok(t)
        out.total += n
        if (m.role === 'user' && LORE_HEAD.test(t)) {
            out.hasLore = true
            out.lore += n
            const i = t.search(FACTS_AT)
            if (i >= 0) { out.facts += tok(t.slice(i + 2)); out.books += tok(t.slice(0, i)) } else out.books += n
        }
    }
    return out
}

export function startReqLog({ port = 0, upstream = 'http://localhost:20128', file }) {
    const server = http.createServer(async (req, res) => {
        const chunks = []
        for await (const c of req) chunks.push(c)
        const raw = Buffer.concat(chunks)
        const t0 = Date.now()
        let rec = null
        if (req.method === 'POST' && /\/chat\/completions$/.test(req.url ?? '')) { try { rec = splitRequest(JSON.parse(raw.toString('utf8'))) } catch { rec = null } }
        try {
            const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'content-length', 'connection'].includes(k)))
            const r = await fetch(upstream + req.url, { method: req.method, headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : raw })
            const h = {}
            r.headers.forEach((v, k) => { if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(k)) h[k] = v })
            res.writeHead(r.status, h)
            if (r.body) for await (const c of r.body) res.write(c)
            res.end()
            if (rec) fs.appendFileSync(file, JSON.stringify({ at: t0, ms: Date.now() - t0, status: r.status, ...rec }) + '\n')
        } catch (e) {
            res.writeHead(502, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: { message: `reqLog upstream: ${e.message}` } }))
            if (rec) fs.appendFileSync(file, JSON.stringify({ at: t0, ms: Date.now() - t0, status: 502, ...rec }) + '\n')
        }
    })
    return new Promise((resolve, reject) => {
        server.on('error', reject)
        server.listen(port, '127.0.0.1', () => resolve({ url: `http://localhost:${server.address().port}/v1/chat/completions`, close: () => new Promise((r) => { server.close(r); server.closeAllConnections() }) }))
    })
}

const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)

/** the log folded into a record: requests that carry the scene's lore message are the narrator's story/creation requests */
export function summarise(file) {
    if (!fs.existsSync(file)) return null
    const all = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.status === 200)
    const lore = all.filter((r) => r.hasLore)
    const col = (k) => lore.map((r) => r[k])
    const sorted = [...col('total')].sort((a, b) => a - b)
    return {
        requests: all.length, narrator: lore.length,
        meanTotal: mean(col('total')), medianTotal: sorted[Math.floor(sorted.length / 2)] ?? 0, maxTotal: sorted.at(-1) ?? 0,
        meanLore: mean(col('lore')), meanBooks: mean(col('books')), meanFacts: mean(col('facts')),
        factsInLore: lore.filter((r) => r.facts > 0).length,
        helperRequests: all.length - lore.length,
    }
}
