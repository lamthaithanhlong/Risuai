// Admin's reports to the Game Master: the page posts what the Admin module exported ($admin_report: a bug the persona reported with "@admin bug: ..."
// or one Admin detected) to POST /api/admin/report here, and it goes on to the asset manager (apocalypse-tham-hoa-zombie/tools/assets, 127.0.0.1:6110,
// POST /api/admin/report, admin_reports.py), which keeps shared/_roles/admin_reports.jsonl (merge, cap 500, idempotent by chat + turn + kind).
//
//   POST /api/admin/report   risu-auth required (the same checkAuth as every write route; a phone on the LAN is read-only and has no token)
//     body: {card, chat, turn, kind: bug|loop|deadline|dead_npc|mismatch, text}   only those fields go on
//     200 {added, merged, dup, lines}   400 {error} the store refused it (the page drops it)   502/504 the asset manager is down or slow (the page keeps it)
// Logs say the kind and the outcome, never the text.
const DEFAULT_TARGET = process.env.RISU_ASSETS_URL || 'http://127.0.0.1:6110'
const TIMEOUT_MS = 3000
const KEYS = ['card', 'chat', 'turn', 'kind', 'text']

/** The body the asset manager gets, only the known fields, or null when it is not an object with a kind and a text. */
function reportOf(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.kind !== 'string' || typeof body.text !== 'string') return null
    const out = {}
    for (const k of KEYS) if (body[k] !== undefined) out[k] = body[k]
    return out
}

/** -> {status, body}. Never throws. */
async function saveReport(body, { target = DEFAULT_TARGET, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, log = () => {} } = {}) {
    const clean = reportOf(body)
    if (!clean) return { status: 400, body: { error: 'send {card, chat, turn, kind, text}' } }
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
        const r = await fetch(`${target}/api/admin/report`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clean), signal: ctl.signal })
        let data = null
        try { data = await r.json() } catch { /* not JSON */ }
        if (r.status === 200 && data && typeof data.dup === 'boolean') { log(`[AdminReport] ${String(clean.kind).slice(0, 12)}: ${data.dup ? 'already had it' : data.merged ? 'merged' : 'added'}`); return { status: 200, body: data } }
        if (r.status >= 400 && r.status < 500) { log(`[AdminReport] refused (${r.status})`); return { status: 400, body: { error: String(data?.error ?? 'the store refused it').slice(0, 300) } } }
        log(`[AdminReport] the asset manager answered ${r.status}`)
        return { status: 502, body: { error: 'the asset manager failed' } }
    } catch (e) {
        const timedOut = ctl.signal.aborted
        log(`[AdminReport] ${timedOut ? 'timeout' : 'unreachable'}`)
        return { status: timedOut ? 504 : 502, body: { error: timedOut ? 'the asset manager did not answer in time' : 'the asset manager is not running' } }
    } finally {
        clearTimeout(timer)
    }
}

function mountAdminReport(app, { auth, limiter, target = DEFAULT_TARGET, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, log = () => {} }) {
    app.post('/api/admin/report', limiter, async (req, res) => {
        if (!await auth(req, res)) return
        const { status, body } = await saveReport(req.body, { target, fetch, timeoutMs, log })
        res.status(status).set('Cache-Control', 'no-store').send(body)
    })
}

module.exports = { mountAdminReport, saveReport, reportOf, TIMEOUT_MS }
