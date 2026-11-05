// Global Admin: the page asks GET /api/admin?card=<id> here and it goes on to the asset manager (apocalypse-tham-hoa-zombie/tools/assets,
// 127.0.0.1:6110, GET /api/admin, read-only), which composes shared/characters/admin.md (CARDS: global) for that card. Every good
// answer is kept on disk (<save>.admin-cache/<card>.json, atomic), so when the asset manager is down the page still gets the last
// good copy, marked stale. The page never waits more than its own 1.5 s for this (src/ts/process/adminGlobal.ts).
//
//   GET /api/admin?card=<id>   risu-auth required
//     200 {card, enabled, assets, guide, text, sha}                    fresh from the asset manager
//     200 {..., stale: true, cachedAt}                                 the asset manager failed, the last good copy
//     400 {error}                                                      a bad card id
//     200 {..., enabled: false, stale: true, offList: true}            no answer and no copy, but global.json (read from disk,
//                                                                      RISU_ADMIN_GLOBAL_JSON) lists the card as off: it stays off
//     502 {error, offKnown}                                            no answer and no copy: the page uses its built-in Admin core,
//                                                                      except for a card it has once seen off. offKnown is true only
//                                                                      when global.json was read and does not list the card; a missing
//                                                                      or unreadable global.json says false (the off state is unknown,
//                                                                      and the page keeps a once-off card closed: fail-closed)
//
//   POST /api/admin/switch {card, off: true|false}   risu-auth required, at most SWITCH_PER_MIN per minute
//     goes on to the asset manager's POST /api/admin/switch (loopback, writes global.json "off" for that card; ids in its "locked"
//     list refuse with 403). On 200 the bridge asks GET /api/admin for that card again so its disk copy says the new state at once
//     (a failed refresh of a card switched OFF writes an off copy; one switched ON keeps the old copy until the next good answer:
//     fail-closed). -> 200 {ok, card, enabled, locked:false, off, admin}; 400 bad id/body; 403 {locked:true}; 429; 502/504.
// Logs say the card, the outcome and the text's sha, never the text.
const fs = require('fs')
const path = require('path')
const { atomicWriteFile } = require('./atomicWrite.cjs')

const DEFAULT_TARGET = process.env.RISU_ASSETS_URL || 'http://127.0.0.1:6110'
const TIMEOUT_MS = 1500
const CARD_RE = /^[a-z0-9-]{0,40}$/
const DEFAULT_GLOBAL_JSON = process.env.RISU_ADMIN_GLOBAL_JSON || path.join(require('os').homedir(), 'Downloads/apocalypse-tham-hoa-zombie/shared/_roles/global.json')

/** The off list of shared/_roles/global.json read from disk ({"off": [...]}); null when it is missing, unreadable or not JSON (unknown). */
function offList(file) {
    try { return new Set(((JSON.parse(fs.readFileSync(file, 'utf8')) || {}).off || []).map(String)) } catch { return null }
}

const valid = (d) => !!d && typeof d === 'object' && Array.isArray(d.assets) && typeof d.text === 'string'
const fileOf = (cacheDir, card) => path.join(cacheDir, `${card || '_none'}.json`)

function readCopy(cacheDir, card) {
    try {
        const d = JSON.parse(fs.readFileSync(fileOf(cacheDir, card), 'utf8'))
        return valid(d.payload) ? d : null
    } catch { return null }
}

/** -> {status, body}. Never throws. */
async function getAdmin(card, { target = DEFAULT_TARGET, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, cacheDir, log = () => {}, now = () => new Date(), globalJson = DEFAULT_GLOBAL_JSON } = {}) {
    card = String(card ?? '')
    if (!CARD_RE.test(card)) return { status: 400, body: { error: 'card: lowercase letters, digits and dashes, at most 40' } }
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    let why
    try {
        const r = await fetch(`${target}/api/admin?card=${encodeURIComponent(card)}`, { signal: ctl.signal })
        let data = null
        try { data = await r.json() } catch { /* not JSON */ }
        if (r.status === 200 && valid(data)) {
            if (cacheDir) {
                try {
                    fs.mkdirSync(cacheDir, { recursive: true })
                    await atomicWriteFile(fileOf(cacheDir, card), JSON.stringify({ cachedAt: now().toISOString(), payload: data }))
                } catch (e) { log(`[Admin] ${card || '-'}: copy not written (${e.code ?? e.message})`) }
            }
            log(`[Admin] ${card || '-'}: fresh sha=${String(data.sha ?? '').slice(0, 8)}`)
            return { status: 200, body: data }
        }
        why = `the asset manager answered ${r.status}`
    } catch {
        why = ctl.signal.aborted ? 'the asset manager did not answer in time' : 'the asset manager is not running'
    } finally {
        clearTimeout(timer)
    }
    const copy = cacheDir ? readCopy(cacheDir, card) : null
    if (copy) {
        log(`[Admin] ${card || '-'}: ${why}, serving the copy from ${copy.cachedAt}`)
        return { status: 200, body: { ...copy.payload, stale: true, cachedAt: copy.cachedAt } }
    }
    const off = globalJson ? offList(globalJson) : null
    if (off && off.has(card)) {
        log(`[Admin] ${card || '-'}: ${why} and no copy, off in global.json`)
        return { status: 200, body: { card, enabled: false, assets: [], guide: '', text: '', stale: true, offList: true } }
    }
    log(`[Admin] ${card || '-'}: ${why} and no copy, the page uses its built-in Admin`)
    return { status: 502, body: { error: `${why}; no copy of Admin`, offKnown: !!off } }
}

const SWITCH_CARD_RE = /^[a-z0-9-]{1,40}$/   // CARD_RE, not empty
const SWITCH_PER_MIN = 20

/** A sliding one-minute window for the switch (on top of the server's limiter): -> true when this call may go on. */
function switchLimiter(max = SWITCH_PER_MIN, now = () => Date.now()) {
    const hits = []
    return () => {
        const t = now()
        while (hits.length && t - hits[0] >= 60_000) hits.shift()
        if (hits.length >= max) return false
        hits.push(t)
        return true
    }
}

/** -> {status, body}. Never throws. */
async function switchAdmin(body, { target = DEFAULT_TARGET, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, cacheDir, log = () => {}, now = () => new Date(), globalJson = DEFAULT_GLOBAL_JSON } = {}) {
    const card = body && typeof body === 'object' ? body.card : undefined
    const off = body && typeof body === 'object' ? body.off : undefined
    if (typeof card !== 'string' || !SWITCH_CARD_RE.test(card)) return { status: 400, body: { error: 'card: lowercase letters, digits and dashes, 1 to 40' } }
    if (typeof off !== 'boolean') return { status: 400, body: { error: 'off: true or false' } }
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    let r, data = null
    try {
        r = await fetch(`${target}/api/admin/switch`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card, off }), signal: ctl.signal })
        try { data = await r.json() } catch { /* not JSON */ }
    } catch {
        const timedOut = ctl.signal.aborted
        log(`[Admin] ${card}: switch ${off ? 'off' : 'on'} not done (${timedOut ? 'timeout' : 'unreachable'})`)
        return { status: timedOut ? 504 : 502, body: { error: timedOut ? 'the asset manager did not answer in time' : 'the asset manager is not running' } }
    } finally {
        clearTimeout(timer)
    }
    if (r.status === 403 && data?.locked === true) {
        log(`[Admin] ${card}: switch refused, locked`)
        return { status: 403, body: { error: String(data.error ?? 'locked').slice(0, 300), locked: true, card } }
    }
    if (r.status !== 200 || !data || data.ok !== true) {
        log(`[Admin] ${card}: switch refused (${r.status})`)
        const status = r.status >= 400 && r.status < 500 ? 400 : 502
        return { status, body: { error: String(data?.error ?? `the asset manager answered ${r.status}`).slice(0, 300) } }
    }
    log(`[Admin] ${card}: switched ${off ? 'off' : 'on'}`)
    // the bridge's own copy follows at once: ask again (fresh answers are written to the disk copy by getAdmin)
    const again = await getAdmin(card, { target, fetch, timeoutMs, cacheDir, log, now, globalJson })
    let admin = again.status === 200 && !again.body.stale ? again.body : null
    if (!admin && off && cacheDir) {
        admin = { card, enabled: false, assets: [], guide: '', text: '', sha: '', locked: false }
        try {
            fs.mkdirSync(cacheDir, { recursive: true })
            await atomicWriteFile(fileOf(cacheDir, card), JSON.stringify({ cachedAt: now().toISOString(), payload: admin }))
        } catch (e) { log(`[Admin] ${card}: off copy not written (${e.code ?? e.message})`) }
    }
    return { status: 200, body: { ok: true, card, enabled: !off, locked: false, off: Array.isArray(data.off) ? data.off : [], admin } }
}

function mountAdmin(app, { auth, limiter, cacheDir, target = DEFAULT_TARGET, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, log = () => {}, globalJson = DEFAULT_GLOBAL_JSON }) {
    app.get('/api/admin', limiter, async (req, res) => {
        if (!await auth(req, res)) return
        const { status, body } = await getAdmin(req.query.card, { target, fetch, timeoutMs, cacheDir, log, globalJson })
        res.status(status).set('Cache-Control', 'no-store').send(body)
    })
    const mayWrite = switchLimiter()
    app.post('/api/admin/switch', limiter, async (req, res) => {
        if (!await auth(req, res)) return
        if (!mayWrite()) return res.status(429).set('Cache-Control', 'no-store').send({ error: 'too many switches; wait a minute' })
        const { status, body } = await switchAdmin(req.body, { target, fetch, timeoutMs, cacheDir, log, globalJson })
        res.status(status).set('Cache-Control', 'no-store').send(body)
    })
}

module.exports = { mountAdmin, getAdmin, switchAdmin, switchLimiter, SWITCH_PER_MIN, TIMEOUT_MS }
