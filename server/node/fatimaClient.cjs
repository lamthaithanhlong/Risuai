'use strict'
// The FAtiMA sidecar's client (plan risu-npc-psych, section 10). server/sidecar/fatima is a .NET process that turns the NPCs' profiles and the
// chat's social events (the bookkeeper's ledger) into OCC emotions, mood, relationships and social importance. This module is the only thing
// in the server that knows it exists:
//   - it spawns the sidecar (`dotnet Fatima.Sidecar.dll`, FATIMA_PORT=0, a fresh FATIMA_TOKEN per spawn), reads `FATIMA_READY <port>` from its
//     stdout within 15 s, checks GET /health and posts one tiny /appraise so the JIT is paid before the first turn;
//   - it restarts it when it dies: 1, 2, 4, 8, 16, 30 s apart; more than 5 restarts in 10 minutes open the circuit for 10 minutes;
//   - appraise() has a hard deadline (AbortController). A timeout or a 5xx counts toward a second breaker: 3 in a row open it, and after 30 s
//     one probe call is let through (half-open). Open means ready() is false and appraise() throws at once: the caller (npcPsych.appraise)
//     answers from the local fold (path B) and never waits for a sick sidecar.
//   - RISU_FATIMA_URL=http://127.0.0.1:PORT attaches to a sidecar somebody else started (tests, a stub): no spawn, no supervision, the token
//     comes from FATIMA_TOKEN.
// Everything that can throw is a plain Error with a `code`: NOT_READY, CIRCUIT_OPEN, TIMEOUT, HTTP_5XX, UNKNOWN_TAG (422), BAD_REQUEST (other 4xx),
// BAD_BODY. The caller does not branch on it except for logs.

const path = require('path')
const crypto = require('crypto')

const DEFAULT_DLL = path.join(__dirname, '../sidecar/fatima/bin/Release/net10.0/Fatima.Sidecar.dll')
const DEFAULT_DOTNET = '/opt/homebrew/bin/dotnet'   // launchd's PATH has no dotnet
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000]
const READY_RE = /^FATIMA_READY (\d+)\s*$/

const err = (code, msg) => Object.assign(new Error(msg || code), { code })

function percentile(sorted, q) {
    if (!sorted.length) return 0
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1))]
}

function createFatimaClient(opts = {}) {
    const dotnet = opts.dotnet || process.env.RISU_DOTNET || DEFAULT_DOTNET
    const dll = opts.dll || process.env.RISU_FATIMA_DLL || DEFAULT_DLL
    const log = opts.log || ((...a) => console.log('[Fatima]', ...a))
    const spawnFn = opts.spawn || require('child_process').spawn
    const fetchFn = opts.fetch || ((...a) => globalThis.fetch(...a))
    const now = opts.now || (() => Date.now())
    const timeoutMs = opts.timeoutMs ?? 110
    const readyTimeoutMs = opts.readyTimeoutMs ?? 15000
    const backoffMs = opts.backoffMs || BACKOFF_MS
    const stableMs = opts.stableMs ?? 60000                 // up this long and the next death starts the backoff from 1 s again
    const maxRestarts = opts.maxRestarts ?? 5
    const restartWindowMs = opts.restartWindowMs ?? 10 * 60 * 1000
    const circuitMs = opts.circuitMs ?? 10 * 60 * 1000
    const breakAfter = opts.breakAfter ?? 3
    const halfOpenMs = opts.halfOpenMs ?? 30000
    const appraisalPath = opts.appraisalPath || process.env.FATIMA_APPRAISAL || ''
    const externalUrl = opts.url !== undefined ? opts.url : process.env.RISU_FATIMA_URL || ''
    const doWarm = opts.warm ?? !externalUrl                // an attached sidecar is somebody else's: its JIT is not ours to pay
    const token = externalUrl ? (opts.token ?? process.env.FATIMA_TOKEN ?? '') : crypto.randomBytes(16).toString('hex')

    let child = null
    let baseUrl = externalUrl ? String(externalUrl).replace(/\/+$/, '') : ''
    let isReady = false          // the sidecar answers (process up, READY seen, health ok)
    let readyAt = 0
    let stopping = false
    let started = null
    let restartTimer = null
    let restartIdx = 0           // position in the backoff list
    let restartTimes = []        // when the sidecar was restarted, inside the window
    let circuitUntil = 0         // the restart circuit: no spawn until then
    let circuitLogged = false
    let breakerOpenedAt = 0      // the call breaker: 0 = closed
    let consecutiveFails = 0
    let probing = false
    let restarts = 0
    let calls = 0
    let okCalls = 0
    let timeouts = 0
    let errors = 0
    let lastError = ''
    const lat = []               // client-side round trips of the last 200 good calls
    const exitHook = () => { try { child?.kill('SIGKILL') } catch { /* gone */ } }

    const headers = () => ({ 'content-type': 'application/json', 'x-fatima-token': token })

    // fetch with a deadline that also covers reading the body
    async function http(method, url, body, ms) {
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), ms)
        try {
            const res = await fetchFn(baseUrl + url, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body), signal: ac.signal })
            let data = null
            try { data = await res.json() } catch { if (res.ok) throw err('BAD_BODY', `fatima ${url}: answer is not JSON`) }
            return { status: res.status, ok: res.ok, data }
        } catch (e) {
            if (e?.name === 'AbortError' || ac.signal.aborted) throw err('TIMEOUT', `fatima ${url}: no answer in ${ms} ms`)
            throw e
        } finally { clearTimeout(timer) }
    }

    async function health() {
        if (!baseUrl) throw err('NOT_READY', 'fatima: no sidecar address yet')
        const r = await http('GET', '/health', undefined, 2000)
        if (!r.ok) throw err('HTTP_5XX', `fatima /health: ${r.status}`)
        return r.data || {}
    }

    // The first calls of a .NET process pay for the JIT: one tiny turn up front so the first real one does not.
    async function warm() {
        if (!doWarm) return
        const body = {
            chatId: '__warm', world: 'warm', turn: 2, present: ['a', 'b'],
            npcs: ['a', 'b'].map((id) => ({ id, name: id, traits: { open: 50, consc: 50, extra: 50, agree: 50, neuro: 50 }, importance: 1, speech: 'plain', tags: [], hasSecret: false, hasAgenda: false, seed: {} })),
            events: [{ turn: 1, who: 'player', tag: 'help', target: 'a' }, { turn: 2, who: 'a', tag: 'insult', target: 'b' }],
        }
        try {
            const r = await http('POST', '/appraise', body, 5000)
            if (!r.ok) log(`warm call failed (not fatal): ${r.status} ${r.data?.error || ''}`.trim())
            await http('POST', '/reset', { chatId: '__warm' }, 2000)
        } catch (e) { log('warm call failed (not fatal):', e.message) }
    }

    function closeBreaker() { breakerOpenedAt = 0; consecutiveFails = 0; probing = false }

    function noteFailure(e) {
        errors++
        lastError = e.message
        if (e.code === 'TIMEOUT') timeouts++
        consecutiveFails++
        if (!breakerOpenedAt && consecutiveFails >= breakAfter) {
            breakerOpenedAt = now()
            log(`circuit open: ${consecutiveFails} timeouts/5xx in a row (last: ${e.message}); half-open in ${Math.round(halfOpenMs / 1000)} s`)
        } else if (breakerOpenedAt) breakerOpenedAt = now()   // the probe failed: the clock starts again
    }

    function breakerBlocks() {
        if (!breakerOpenedAt) return false
        return !(now() - breakerOpenedAt >= halfOpenMs && !probing)
    }

    function ready() {
        if (stopping || !isReady) return false
        if (!externalUrl && now() < circuitUntil) return false
        return !breakerBlocks()
    }

    // ---- the supervised child ----

    function clearRestart() { if (restartTimer) { clearTimeout(restartTimer); restartTimer = null } }

    function scheduleRestart(why) {
        if (stopping || restartTimer) return
        const t = now()
        restartTimes = restartTimes.filter((x) => t - x < restartWindowMs)
        if (restartTimes.length >= maxRestarts) {
            circuitUntil = t + circuitMs
            restartTimes = []
            restartIdx = 0
            if (!circuitLogged) log(`circuit open for ${Math.round(circuitMs / 60000)} min: ${maxRestarts + 1} deaths in ${Math.round(restartWindowMs / 60000)} min (${why}); NPC psychology uses the local fold`)
            circuitLogged = true
            restartTimer = setTimeout(() => { restartTimer = null; circuitLogged = false; spawnChild() }, circuitMs)
            restartTimer.unref?.()
            return
        }
        const wait = backoffMs[Math.min(restartIdx, backoffMs.length - 1)]
        restartIdx++
        restartTimes.push(t)
        restarts++
        log(`restart in ${wait} ms (${why})`)
        restartTimer = setTimeout(() => { restartTimer = null; spawnChild() }, wait)
        restartTimer.unref?.()
    }

    function spawnChild() {
        if (stopping) return Promise.resolve(false)
        isReady = false
        const env = { ...process.env, FATIMA_PORT: '0', FATIMA_TOKEN: token, DOTNET_CLI_TELEMETRY_OPTOUT: '1', FATIMA_PARENT_PID: String(process.pid) }
        if (appraisalPath) env.FATIMA_APPRAISAL = appraisalPath
        let proc
        try {
            proc = spawnFn(dotnet, [dll], { env, stdio: ['ignore', 'pipe', 'pipe'] })
        } catch (e) {
            log('spawn failed:', e.message)
            scheduleRestart('spawn failed')
            return Promise.resolve(false)
        }
        child = proc
        let outBuf = ''
        let done = false

        const settle = new Promise((resolve) => {
            const finish = (ok) => { if (!done) { done = true; clearTimeout(readyTimer); resolve(ok) } }
            const readyTimer = setTimeout(() => {
                if (done) return
                log(`no FATIMA_READY within ${readyTimeoutMs} ms: killing it`)
                try { proc.kill('SIGKILL') } catch { /* gone */ }
                finish(false)
            }, readyTimeoutMs)
            proc.stdout?.on('data', async (chunk) => {
                outBuf += chunk.toString()
                let nl
                while ((nl = outBuf.indexOf('\n')) >= 0) {
                    const line = outBuf.slice(0, nl).replace(/\r$/, '')
                    outBuf = outBuf.slice(nl + 1)
                    const m = READY_RE.exec(line)
                    if (m && !done && child === proc) {
                        baseUrl = `http://127.0.0.1:${m[1]}`
                        try {
                            await health()
                            isReady = true
                            readyAt = now()
                            closeBreaker()
                            await warm()
                            log(`ready on ${baseUrl} (pid ${proc.pid})`)
                            finish(true)
                        } catch (e) {
                            log('health check failed:', e.message)
                            try { proc.kill('SIGKILL') } catch { /* gone */ }
                            finish(false)
                        }
                    }
                }
            })
            proc.stderr?.on('data', (c) => { const s = c.toString().trim(); if (s) log('stderr:', s.slice(0, 400)) })
            proc.on('error', (e) => { log('process error:', e.message); finish(false) })
            proc.on('exit', (code, sig) => {
                if (child === proc) {
                    child = null
                    const wasReady = isReady
                    const upFor = readyAt ? now() - readyAt : 0
                    isReady = false
                    if (wasReady && upFor >= stableMs) restartIdx = 0
                    if (!stopping) scheduleRestart(`exited ${sig || code}${wasReady ? ' while ready' : ' before ready'}`)
                }
                finish(false)
            })
        })
        return settle
    }

    // attached to a sidecar somebody else runs: look until it answers (the backoff list, no circuit: nothing here is ours to restart)
    async function attach() {
        try {
            await health()
            isReady = true
            readyAt = now()
            closeBreaker()
            await warm()
            log(`attached to ${baseUrl}`)
            return true
        } catch (e) {
            isReady = false
            if (stopping) return false
            const wait = backoffMs[Math.min(restartIdx, backoffMs.length - 1)]
            restartIdx++
            log(`no sidecar at ${baseUrl} (${e.message}); looking again in ${wait} ms`)
            restartTimer = setTimeout(() => { restartTimer = null; attach() }, wait)
            restartTimer.unref?.()
            return false
        }
    }

    function start() {
        if (started) return started
        stopping = false
        process.once('exit', exitHook)
        started = externalUrl ? attach() : spawnChild()
        return started
    }

    function stop() {
        stopping = true
        isReady = false
        clearRestart()
        process.removeListener('exit', exitHook)
        const proc = child
        child = null
        started = null
        if (!proc) return Promise.resolve()
        return new Promise((resolve) => {
            let gone = false
            const finish = () => { if (!gone) { gone = true; clearTimeout(hard); resolve() } }
            const hard = setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* gone */ } finish() }, 2000)
            hard.unref?.()
            proc.once?.('exit', finish)
            try { proc.kill('SIGTERM') } catch { finish() }
        })
    }

    // ---- the call ----

    async function appraise(payload, budgetMs) {
        if (!ready()) throw err(breakerBlocks() ? 'CIRCUIT_OPEN' : 'NOT_READY', breakerBlocks() ? 'fatima: circuit open' : 'fatima: not ready')
        const probe = !!breakerOpenedAt
        if (probe) probing = true
        calls++
        const t0 = now()
        const ms = Math.max(1, Math.round(budgetMs || timeoutMs))
        let r
        try {
            r = await http('POST', '/appraise', payload, ms)
        } catch (e) {
            noteFailure(e)   // a timeout, or the socket refused: the process is gone or wedged
            probing = false
            throw e
        }
        probing = false
        if (r.status >= 500) {
            const e = err('HTTP_5XX', `fatima /appraise: ${r.status} ${r.data?.error || ''}`.trim())
            noteFailure(e)
            throw e
        }
        if (r.status === 422) {
            errors++
            lastError = `422 ${r.data?.error || ''}`
            closeBreakerIfProbe(probe)
            throw err('UNKNOWN_TAG', `fatima /appraise: 422 ${r.data?.error || ''}`.trim())
        }
        if (!r.ok) {
            errors++
            lastError = `${r.status} ${r.data?.error || ''}`
            closeBreakerIfProbe(probe)
            throw err('BAD_REQUEST', `fatima /appraise: ${r.status} ${r.data?.error || ''}`.trim())
        }
        okCalls++
        closeBreaker()
        lat.push(now() - t0)
        if (lat.length > 200) lat.shift()
        return r.data
    }

    // the sidecar answered (it is alive, the request was wrong): a half-open probe has done its job
    function closeBreakerIfProbe(probe) { if (probe) closeBreaker(); else consecutiveFails = 0 }

    function stats() {
        const sorted = [...lat].sort((a, b) => a - b)
        const t = now()
        return {
            state: stopping || !started ? 'stopped' : isReady ? 'ready' : t < circuitUntil ? 'open' : child || externalUrl ? 'starting' : 'restarting',
            breaker: !breakerOpenedAt ? 'closed' : breakerBlocks() ? 'open' : 'half-open',
            attached: !!externalUrl,
            url: baseUrl || null,
            pid: child?.pid ?? null,
            restarts, calls, ok: okCalls, timeouts, errors, lastError,
            p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95),
        }
    }

    return { start, stop, health, appraise, ready, stats, warm }
}

module.exports = { createFatimaClient, BACKOFF_MS, DEFAULT_DLL, DEFAULT_DOTNET }
