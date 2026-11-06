// The persona's skill and item storage and skill slots, kept in the global store (the asset manager, apocalypse-tham-hoa-zombie/tools/assets,
// 127.0.0.1:6110, persona_store.py) and reached through here with risu-auth on every route, GET included (the storage is the owner's, and a
// phone on the LAN has no token). The Admin engine passes the persona's Level every time; the store computes rank, open slots and the limits.
//
//   GET  /api/persona?persona=&level=     -> 200 {persona, level, rank, slots_open, max_storage, stat_cap, stat_caps, skills, items, slots, skill_count, item_count}
//   POST /api/persona/loot     {persona, kind: skill|item, entry, level}   entry: {id, name, tier, source?, mastery? (skill) | qty? (item)}
//        200 {ok:true, added:'new'|'merged', entry, view} | {ok:false, reason:'full', max_storage, count}  (a full store is unchanged)
//   POST /api/persona/delete   {persona, kind, id, level?}               200 {ok:true, unequipped: slot|null, view?} | {ok:false, reason:'not_found'}
//   POST /api/persona/equip    {persona, slot, skillId, level}           200 {ok:true, slot, replaced, view} | {ok:false, reason:'slot_locked'|'no_such_skill'|'already_equipped'}
//   POST /api/persona/unequip  {persona, slot, level?}                   200 {ok:true, slot, was, view?}
//   400 {error}  the store refused the request as malformed (the page drops it)   502/504  the asset manager is down or slow (the page may retry)
// Only the fields listed above go on (anything else is cut), and only persona and level go on from a GET's query. Logs name the route and the
// outcome, never ids or values.
const DEFAULT_TARGET = process.env.RISU_ASSETS_URL || 'http://127.0.0.1:6110'
const TIMEOUT_MS = 3000

const FIELDS = {
    loot: ['persona', 'kind', 'entry', 'level'],
    delete: ['persona', 'kind', 'id', 'level'],
    equip: ['persona', 'slot', 'skillId', 'level'],
    unequip: ['persona', 'slot', 'level'],
}

/** The body the asset manager gets: only the known fields of that route, or null when it is not a plain object. */
function personaBodyOf(route, body) {
    if (!FIELDS[route] || !body || typeof body !== 'object' || Array.isArray(body)) return null
    const out = {}
    for (const k of FIELDS[route]) if (body[k] !== undefined) out[k] = body[k]
    return out
}

async function relay(url, init, label, { fetch, timeoutMs, log }) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
        const r = await fetch(url, { ...init, signal: ctl.signal })
        let data = null
        try { data = await r.json() } catch { /* not JSON */ }
        if (r.status === 200 && data && typeof data === 'object') { log(`[Persona] ${label} ${data.ok === false ? 'refused: ' + String(data.reason).slice(0, 20) : 'ok'}`); return { status: 200, body: data } }
        if (r.status >= 400 && r.status < 500) { log(`[Persona] ${label} refused (${r.status})`); return { status: 400, body: { error: String(data?.error ?? 'the store refused it').slice(0, 300) } } }
        log(`[Persona] ${label}: the asset manager answered ${r.status}`)
        return { status: 502, body: { error: 'the asset manager failed' } }
    } catch (e) {
        const timedOut = ctl.signal.aborted
        log(`[Persona] ${label} ${timedOut ? 'timeout' : 'unreachable'}`)
        return { status: timedOut ? 504 : 502, body: { error: timedOut ? 'the asset manager did not answer in time' : 'the asset manager is not running' } }
    } finally {
        clearTimeout(timer)
    }
}

/** -> {status, body}. Never throws. */
async function postPersona(route, body, { target = DEFAULT_TARGET, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, log = () => {} } = {}) {
    const clean = personaBodyOf(route, body)
    if (!clean) return { status: 400, body: { error: `send {${(FIELDS[route] || []).join(', ')}}` } }
    return relay(`${target}/api/persona/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(clean) }, route, { fetch, timeoutMs, log })
}

/** GET: persona and level from the query, as text (the store checks them), nothing else goes on. */
async function getPersona(query, { target = DEFAULT_TARGET, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, log = () => {} } = {}) {
    const q = new URLSearchParams()
    for (const k of ['persona', 'level']) if (typeof query?.[k] === 'string') q.set(k, query[k])
    return relay(`${target}/api/persona?${q}`, { method: 'GET' }, 'view', { fetch, timeoutMs, log })
}

function mountPersona(app, { auth, limiter, target = DEFAULT_TARGET, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS, log = () => {} }) {
    const send = (res, { status, body }) => res.status(status).set('Cache-Control', 'no-store').send(body)
    app.get('/api/persona', limiter, async (req, res) => {
        if (!await auth(req, res)) return
        send(res, await getPersona(req.query, { target, fetch, timeoutMs, log }))
    })
    for (const route of Object.keys(FIELDS)) {
        app.post(`/api/persona/${route}`, limiter, async (req, res) => {
            if (!await auth(req, res)) return
            send(res, await postPersona(route, req.body, { target, fetch, timeoutMs, log }))
        })
    }
}

module.exports = { mountPersona, postPersona, getPersona, personaBodyOf, FIELDS, TIMEOUT_MS }
