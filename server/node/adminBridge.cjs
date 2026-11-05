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

function mountAdmin(app, { auth, limiter, cacheDir, target = DEFAULT_TARGET, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, log = () => {}, globalJson = DEFAULT_GLOBAL_JSON }) {
    app.get('/api/admin', limiter, async (req, res) => {
        if (!await auth(req, res)) return
        const { status, body } = await getAdmin(req.query.card, { target, fetch, timeoutMs, cacheDir, log, globalJson })
        res.status(status).set('Cache-Control', 'no-store').send(body)
    })
}

module.exports = { mountAdmin, getAdmin, TIMEOUT_MS }
