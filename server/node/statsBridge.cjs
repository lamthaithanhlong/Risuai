// Saving stat and skill gains: the page posts the entries the card's panel exported ($stat_export, one per gain) to POST /api/stats here,
// and they go on to the asset manager (apocalypse-tham-hoa-zombie/tools/assets, 127.0.0.1:6110, POST /api/stats), which appends them to
// shared/stats/history.jsonl. Reading a persona's current stats comes back through assetsProxy.cjs (GET /api/assets/stats?persona=).
//
//   POST /api/stats   risu-auth required (the same checkAuth as every write route; a phone on the LAN is read-only and has no token)
//     body: an array of {stat, value, turn, time, persona}, or {entries: [...]}; 1..200 entries
//     200 {appended:n}   written (append-only: nothing is rewritten, so a resend only adds a line with the same value)
//     400 {error}        the store refused an entry (bad stat, value out of range, bad persona): the page drops that batch
//     502 {error}        the asset manager is down or answered 5xx: the page keeps the entries queued and retries next turn
//     504 {error}        no answer in 3 s: same, queue
// Logs say how many entries and the outcome, never the values.
const DEFAULT_TARGET = process.env.RISU_ASSETS_URL || 'http://127.0.0.1:6110'
const TIMEOUT_MS = 3000
const MAX_BATCH = 200

/** The entries list from what the page sent, or null when it is not a non-empty list of objects within the batch limit. */
function entriesOf(body) {
    const list = Array.isArray(body) ? body : (body && typeof body === 'object' && Array.isArray(body.entries) ? body.entries : null)
    if (!list || list.length < 1 || list.length > MAX_BATCH) return null
    if (!list.every((e) => e && typeof e === 'object' && !Array.isArray(e))) return null
    return list
}

/** -> {status, body}: what the route answers. Never throws. */
async function saveStats(body, { target = DEFAULT_TARGET, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, log = () => {} } = {}) {
    const entries = entriesOf(body)
    if (!entries) return { status: 400, body: { error: `send 1 to ${MAX_BATCH} stat entries` } }
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
        const r = await fetch(`${target}/api/stats`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }), signal: ctl.signal,
        })
        let data = null
        try { data = await r.json() } catch { /* not JSON */ }
        if (r.status === 200 && data && typeof data.appended === 'number') {
            log(`[Stats] ${data.appended} saved`)
            return { status: 200, body: { appended: data.appended } }
        }
        if (r.status >= 400 && r.status < 500) {
            log(`[Stats] ${entries.length} refused (${r.status})`)
            return { status: 400, body: { error: String(data?.error ?? 'the store refused the entries').slice(0, 300) } }
        }
        log(`[Stats] the asset manager answered ${r.status}`)
        return { status: 502, body: { error: 'the asset manager failed; the entries stay queued' } }
    } catch (e) {
        const timedOut = ctl.signal.aborted
        log(`[Stats] ${entries.length} entries: ${timedOut ? 'timeout' : 'unreachable'}`)
        return { status: timedOut ? 504 : 502, body: { error: timedOut ? 'the asset manager did not answer in time' : 'the asset manager is not running' } }
    } finally {
        clearTimeout(timer)
    }
}

function mountStats(app, { auth, limiter, target = DEFAULT_TARGET, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, log = () => {} }) {
    app.post('/api/stats', limiter, async (req, res) => {
        if (!await auth(req, res)) return
        const { status, body } = await saveStats(req.body, { target, fetch, timeoutMs, log })
        res.status(status).set('Cache-Control', 'no-store').send(body)
    })
}

module.exports = { mountStats, saveStats, entriesOf, MAX_BATCH, TIMEOUT_MS }
