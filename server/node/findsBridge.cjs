// Saving a find: the page posts a record the narrator wrote ([[FIND|...]]) to POST /api/finds here, and it goes on to the asset
// manager (apocalypse-tham-hoa-zombie/tools/assets, 127.0.0.1:6110, POST /api/finds), which dedupes it and writes shared/finds/<id>.json.
//
//   POST /api/finds   risu-auth required (the same checkAuth as every write route; a phone on the LAN is read-only and has no token)
//     body: the record without found_at / fingerprint (any the page sends are dropped: the store stamps them)
//     200 {created:boolean, record}     saved, or the same find was already there (created:false, the existing record)
//     400 {error}                       the store refused the record (bad field, too long): retrying will not help, the page drops it
//     502 {error}                       the asset manager is down or answered 5xx: the page queues the find and retries next turn
//     504 {error}                       no answer in 3 s: same, queue
// Logs say the find's id and the outcome, never its text.
const DEFAULT_TARGET = process.env.RISU_ASSETS_URL || 'http://127.0.0.1:6110'
const TIMEOUT_MS = 3000
const DROPPED = ['found_at', 'fingerprint']

/** The record as the store wants it: a plain object with the page's stamps removed, or null when it is not an object. */
function cleanRecord(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null
    const out = { ...body }
    for (const k of DROPPED) delete out[k]
    return out
}

const idOf = (r) => (r && typeof r.id === 'string' ? r.id.slice(0, 80).replace(/[^a-z0-9-]/gi, '?') : '?')

/** -> {status, body}: what the route answers. Never throws. */
async function saveFind(body, { target = DEFAULT_TARGET, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, log = () => {} } = {}) {
    const rec = cleanRecord(body)
    if (!rec) return { status: 400, body: { error: 'a find is a JSON object' } }
    const id = idOf(rec)
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
        const r = await fetch(`${target}/api/finds`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec), signal: ctl.signal,
        })
        let data = null
        try { data = await r.json() } catch { /* not JSON */ }
        if (r.status === 200 && data && typeof data === 'object' && 'record' in data) {
            log(`[Finds] ${id}: ${data.created ? 'saved' : 'already known'}`)
            return { status: 200, body: { created: !!data.created, record: data.record } }
        }
        if (r.status >= 400 && r.status < 500) {
            log(`[Finds] ${id}: refused (${r.status})`)
            return { status: 400, body: { error: String(data?.error ?? 'the store refused the find').slice(0, 300) } }
        }
        log(`[Finds] ${id}: the asset manager answered ${r.status}`)
        return { status: 502, body: { error: 'the asset manager failed; the find stays queued' } }
    } catch (e) {
        const timedOut = ctl.signal.aborted
        log(`[Finds] ${id}: ${timedOut ? 'timeout' : 'unreachable'}`)
        return { status: timedOut ? 504 : 502, body: { error: timedOut ? 'the asset manager did not answer in time' : 'the asset manager is not running' } }
    } finally {
        clearTimeout(timer)
    }
}

function mountFinds(app, { auth, limiter, target = DEFAULT_TARGET, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, log = () => {} }) {
    app.post('/api/finds', limiter, async (req, res) => {
        if (!await auth(req, res)) return
        const { status, body } = await saveFind(req.body, { target, fetch, timeoutMs, log })
        res.status(status).set('Cache-Control', 'no-store').send(body)
    })
}

module.exports = { mountFinds, saveFind, cleanRecord, TIMEOUT_MS }
