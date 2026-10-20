#!/usr/bin/env node
// Measures how much the page stutters while it loads the save, sits idle, and opens the biggest chat — on a COPY of the live save.
//
//   node tests/acceptance/jank.mjs --dist <built client dir> [--label before] [--base <snapshot dir>] [--port 6111] [--idle 30]
//        [--cpu 4] (CPU throttling, a phone-class CPU) [--card <name part>] (the character to play; default the biggest)
//        [--turns 3] (played turns without a model: a streamed reply plus the story layer's edits) [--dump-global <name>]
//        [--other-page] (another page writes once before this page's first save, so that save is merged: the live state with two pages)
//
// Note: Playwright keeps the DevTools Network domain on, which copies every request body in the page; a 7 MB /api/write then costs
// the page ~11 ms (x4 throttled) that a plain browser does not pay (0 ms measured). `fetch` in the profile is mostly that.
//
// The client should be built with sourcemaps (`vite build --sourcemap --outDir <dir>`) so the CPU profile names source files.
// --base reuses a snapshot from an earlier run (same save for before/after); without it the live save is snapshotted (read only).
// Output: ~/.risu-story-work/jank/<label>.json (+ .cpuprofile) and a summary on stdout: long tasks (> 50 ms), frames longer than
// 50 ms, time to the home screen, and the functions that took the main thread during the long stretches.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import { copySave, freePort, liveServer, snapshotLive, startServer, storeBackend } from './lib/env.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
const argv = process.argv.slice(2)
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d }
const ROOT = path.join(os.homedir(), '.risu-story-work', 'jank')
const label = opt('--label', 'run')
const idleS = Number(opt('--idle', 30))

/** Busy stretches of the main thread from the profile's samples, and the functions inside the long ones. */
function analyseProfile(prof, mapPos) {
    const byId = new Map(prof.nodes.map((n) => [n.id, n]))
    // (program) is the engine outside JS (layout, paint, parsing) — counted as busy only next to JS, like (garbage collector)
    const idle = new Set(prof.nodes.filter((n) => n.callFrame.functionName === '(idle)').map((n) => n.id))
    let t = 0
    const runs = []
    let cur = null
    for (let i = 0; i < prof.samples.length; i++) {
        t += prof.timeDeltas[i] / 1000
        const id = prof.samples[i]
        const dt = (prof.timeDeltas[i + 1] ?? 0) / 1000
        if (idle.has(id)) { if (cur) { runs.push(cur); cur = null } continue }
        if (!cur) cur = { start: t, dur: 0, self: new Map() }
        cur.dur += dt
        const n = byId.get(id)
        const key = mapPos(n.callFrame)
        cur.self.set(key, (cur.self.get(key) ?? 0) + dt)
    }
    if (cur) runs.push(cur)
    const long = runs.filter((r) => r.dur > 50)
    const total = new Map()
    for (const r of long) for (const [k, v] of r.self) total.set(k, (total.get(k) ?? 0) + v)
    const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ fn: k, ms: Math.round(v) }))
    return {
        longRuns: long.map((r) => ({ at: Math.round(r.start), ms: Math.round(r.dur), top: top(r.self, 4) })),
        topInLong: top(total, 25),
    }
}

const stats = (xs) => {
    if (!xs.length) return null
    const v = [...xs].sort((a, b) => a - b)
    const q = (p) => Math.round(v[Math.min(v.length - 1, Math.floor(p * v.length))] * 10) / 10
    return { n: v.length, mean: Math.round(v.reduce((a, x) => a + x, 0) / v.length * 10) / 10, p50: q(0.5), p90: q(0.9), max: q(1) }
}

/** The server's `[Sync] trace` / `[Story] trace` lines (RISU_SYNC_TRACE=1): how each write was stored and its event-loop ms. */
function serverTrace(logFile) {
    const lines = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').split('\n') : []
    const writes = []
    const story = []
    for (const l of lines) {
        const m = /\[Sync\] trace how=(\S+) bytes=(\d+) onWrite=([\d.]+) merge=([\d.]+) queue=([\d.]+) handler=([\d.]+)/.exec(l)
        const d = /changed=(\d+) changedBytes=(\d+) names=(\S*)/.exec(l)
        if (m) writes.push({ how: m[1], bytes: +m[2], onWrite: +m[3], merge: +m[4], queue: +m[5], handler: +m[6], changed: d ? +d[1] : null, changedBytes: d ? +d[2] : null, names: d ? d[3] : null })
        const s = /\[Story\] trace sync=([\d.]+)/.exec(l)
        if (s) story.push(+s[1])
    }
    const how = {}
    for (const w of writes) how[w.how] = (how[w.how] ?? 0) + 1
    return { how, onWrite: stats(writes.map((w) => w.onWrite)), merge: stats(writes.map((w) => w.merge)), queue: stats(writes.map((w) => w.queue)),
        handler: stats(writes.map((w) => w.handler)), story: stats(story),
        bytes: stats(writes.map((w) => w.bytes)), changedBytes: stats(writes.filter((w) => w.changedBytes != null).map((w) => w.changedBytes)),
        changedBlocks: stats(writes.filter((w) => w.changed != null).map((w) => w.changed)), changedNames: [...new Set(writes.map((w) => w.names).filter(Boolean))], sync: lines.filter((l) => l.startsWith('[Sync]') && !l.includes(' trace ')).slice(-5) }
}

async function sourceMapper(distDir) {
    const { SourceMapConsumer } = require(path.join(path.dirname(new URL(import.meta.url).pathname), '../../node_modules/source-map'))
    const cache = new Map()
    const consumer = async (url) => {
        if (cache.has(url)) return cache.get(url)
        let c = null
        const m = /\/assets\/([^?#]+\.js)/.exec(url)
        const f = m && path.join(distDir, 'assets', m[1] + '.map')
        if (f && fs.existsSync(f)) c = await new SourceMapConsumer(JSON.parse(fs.readFileSync(f, 'utf8')))
        cache.set(url, c)
        return c
    }
    return { consumer, map: (c, cf) => {
        if (!c) return `${cf.functionName || '(anon)'} ${cf.url ? path.basename(cf.url) : ''}`.trim()
        const p = c.originalPositionFor({ line: cf.lineNumber + 1, column: cf.columnNumber })
        const src = p.source ? p.source.replace(/^.*?(src\/|node_modules\/)/, '$1') : path.basename(cf.url)
        return `${p.name || cf.functionName || '(anon)'} ${src}:${p.line ?? '?'}`
    } }
}

async function main() {
    const dist = path.resolve(opt('--dist', ''))
    if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('--dist <built client dir> is required')
    fs.mkdirSync(ROOT, { recursive: true })
    const live = liveServer()
    const backend = storeBackend(live)
    let base = opt('--base')
    if (!base) { base = path.join(ROOT, '_base'); fs.rmSync(base, { recursive: true, force: true }); await snapshotLive(ROOT, { liveCwd: live?.cwd || undefined, backend }) }
    const runDir = path.join(ROOT, 'run-' + label)
    fs.rmSync(runDir, { recursive: true, force: true })
    fs.mkdirSync(runDir, { recursive: true })
    fs.symlinkSync(dist, path.join(runDir, 'dist'))
    const { dir, password } = copySave(runDir, base, 'copy')
    const port = await freePort(Number(opt('--port', 6111)))
    process.env.RISU_SYNC_TRACE = '1'          // the server logs where each write's event-loop time went (server.cjs /api/write)
    const server = await startServer(dir, port, { backend })
    const browser = await chromium.launch({ headless: true })
    const out = { label, dist, port, phases: {} }
    try {
        const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
        await ctx.addInitScript(() => {
            try { localStorage.setItem('tos4', 'true'); localStorage.setItem('dosync', 'avoid') } catch { /* private */ }
            const J = (globalThis.__jank = { long: [], loaf: [], gaps: [], frames: 0 })
            new PerformanceObserver((l) => { for (const e of l.getEntries()) J.long.push({ at: e.startTime, ms: e.duration }) }).observe({ type: 'longtask', buffered: true })
            try {
                new PerformanceObserver((l) => {
                    for (const e of l.getEntries()) J.loaf.push({ at: e.startTime, ms: e.duration, block: e.blockingDuration, scripts: (e.scripts || []).map((s) => ({ ms: Math.round(s.duration), fn: s.sourceFunctionName, url: (s.sourceURL || '').replace(/^.*\//, ''), pos: s.sourceCharPosition, inv: s.invoker })) })
                }).observe({ type: 'long-animation-frame', buffered: true })
            } catch { /* older engine */ }
            let last = performance.now()
            const f = (t) => { J.frames++; if (t - last > 50) J.gaps.push({ at: last, ms: t - last }); last = t; requestAnimationFrame(f) }
            requestAnimationFrame(f)
        })
        const page = await ctx.newPage()
        const net = []
        page.on('requestfinished', async (req) => {
            try {
                const u = new URL(req.url())
                if (u.port !== String(port)) return
                const z = await req.sizes()
                const sz = z.responseBodySize + z.requestBodySize
                net.push({ at: Date.now(), method: req.method(), path: u.pathname.replace(/[0-9a-f]{16,}/g, '<hex>'), bytes: sz, ms: Math.round(req.timing().responseEnd) })
            } catch { /* gone */ }
        })
        page.on('pageerror', (e) => console.log('[page]', String(e.message || e).slice(0, 200)))
        const cdp = await ctx.newCDPSession(page)
        await cdp.send('Profiler.enable')
        await cdp.send('Profiler.setSamplingInterval', { interval: 500 })
        await cdp.send('Profiler.start')
        const cpu = Number(opt('--cpu', 1))
        if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
        out.cpu = cpu
        const mark = async () => page.evaluate(() => performance.now()).catch(() => null)
        const t0 = Date.now()
        await page.goto(`http://localhost:${port}/`)
        await page.waitForSelector('text=Input your password', { timeout: 90000 })
        const tPw = await mark()
        await page.locator('#alert-input, input').first().fill(password)
        await page.getByRole('button', { name: 'OK' }).click()
        const tOk = await mark()
        await page.waitForSelector('text=My Stories', { timeout: 180000 })
        const tHome = await mark()
        await page.waitForFunction(() => !!globalThis.__pluginApis__?.getChar, null, { timeout: 60000 })
        const tApi = await mark()
        console.log(`[jank] home after ${Math.round(tHome - tOk)} ms from OK (${Math.round((Date.now() - t0) / 1000)} s wall)`)
        await page.waitForTimeout(idleS * 1000)
        const tIdleEnd = await mark()
        // the biggest character in the save (card + lore + chats), or the one --card names
        const big = await page.evaluate((want) => {
            const db = globalThis.__pluginApis__.getDatabase()
            let best = null
            for (const c of db.characters ?? []) {
                if (want && !c.name?.includes(want)) continue
                const bytes = JSON.stringify(c).length
                const n = (c.chats ?? []).reduce((a, ch) => a + (ch.message?.length ?? 0), 0)
                if (!best || bytes > best.bytes) best = { n, bytes, chatBytes: JSON.stringify(c.chats ?? []).length, chats: c.chats?.length ?? 0, name: c.name, chaId: c.chaId }
            }
            return best
        }, opt('--card', ''))
        out.bigChat = big
        let tOpen = null, tOpened = null
        if (big) {
            tOpen = await mark()
            // the harness never calls getChar inside a measured phase: it snapshots the whole database (its cost is not the app's)
            await page.getByText(big.name, { exact: false }).first().click({ timeout: 10000 }).catch(() => {})
            await page.waitForSelector('.risu-chat', { timeout: 60000 }).catch(() => {})
            tOpened = await mark()
            await page.waitForTimeout(10000)
        }
        const tPlay0 = await mark()
        if (big && !await page.evaluate((id) => globalThis.__pluginApis__.getChar()?.chaId === id, big.chaId)) throw new Error(`could not open ${big.name}`)
        const tPlay = await mark()
        const turns = Number(opt('--turns', 3))
        if (argv.includes('--other-page')) {
            // another page (a second tab, the phone) writes once: the first save of this page then goes through the merge, as on the
            // live server where the owner plays with more than one page open. The other page's write is this page's own file sent
            // under another tab id, just before it, so the merge takes nothing from the server.
            await page.evaluate(() => {
                const orig = window.fetch
                let done = false
                window.fetch = async (url, init) => {
                    if (!done && String(url).endsWith('/api/write') && init?.headers?.['file-path'] === '6461746162617365' + '2f6461746162617365' + '2e62696e') {
                        done = true
                        await orig(url, { ...init, headers: { ...init.headers, 'x-risu-tab': 'jank-other-page-0001' } })
                    }
                    return orig(url, init)
                }
            })
        }
        const tNet = Date.now()
        // a played turn, without a model: the player's line, a reply streamed in 50 ms chunks for 6 s, then the after-reply edits
        // the story layer makes (a script variable, the reply rewritten twice: translation, Future Plan cleanup)
        for (let k = 0; k < turns && big; k++) {
            await page.evaluate(async ([k, chaId]) => {
                const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
                const db = globalThis.__pluginApis__.getDatabase()
                const ch = db.characters.find((c) => c.chaId === chaId)
                const chat = ch.chats[ch.chatPage]
                chat.message.push({ role: 'user', data: `Tôi đi tiếp về phía cổng (lượt đo ${k}).`, time: Date.now() })
                await sleep(800)
                chat.message.push({ role: 'char', data: '', saying: ch.chaId, time: Date.now() })
                chat.isStreaming = true
                const msg = chat.message[chat.message.length - 1]
                let text = ''
                for (let i = 0; i < 120; i++) { text += 'Gió thổi qua con hẻm, ánh đèn vàng chập chờn. '; msg.data = text; await sleep(50) }
                chat.isStreaming = false
                await sleep(1000)
                chat.scriptstate = { ...(chat.scriptstate ?? {}), '$jank_turn': k }
                await sleep(700)
                msg.data = text + '\n\n[[GM]] ok'
                await sleep(700)
                msg.data = text
                await sleep(2500)
            }, [k, big.chaId])
        }
        const tEnd = await mark()
        const { profile } = await cdp.send('Profiler.stop')
        if (opt('--dump-global')) out.dump = await page.evaluate((k) => globalThis[k], opt('--dump-global'))
        const J = await page.evaluate(() => globalThis.__jank)
        fs.writeFileSync(path.join(ROOT, `${label}.cpuprofile`), JSON.stringify(profile))
        const phase = (a, b) => {
            const lt = J.long.filter((x) => x.at >= a && x.at < b)
            const gp = J.gaps.filter((x) => x.at >= a && x.at < b)
            return {
                ms: Math.round(b - a),
                longTasks: lt.length, longTaskMs: Math.round(lt.reduce((s, x) => s + x.ms, 0)), worstTask: Math.round(Math.max(0, ...lt.map((x) => x.ms))),
                blockingMs: Math.round(lt.reduce((s, x) => s + Math.max(0, x.ms - 50), 0)),
                frameGaps: gp.length, frameGapMs: Math.round(gp.reduce((s, x) => s + x.ms, 0)), worstGap: Math.round(Math.max(0, ...gp.map((x) => x.ms))),
            }
        }
        out.marks = { tPw, tOk, tHome, tApi, tIdleEnd, tOpen, tOpened, tEnd }
        out.phases.load = { ...phase(tOk, tApi), homeMs: Math.round(tHome - tOk) }
        out.phases.idle = phase(tApi, tIdleEnd)
        if (tOpen != null) out.phases.openChat = phase(tOpen, tPlay0)
        if (turns && big) {
            out.phases.play = phase(tPlay, tEnd)
            const writes = net.filter((x) => x.at >= tNet && x.method === 'POST')
            out.phases.play.writes = writes.length
            out.phases.play.writeKB = Math.round(writes.reduce((a, x) => a + x.bytes, 0) / 1024)
            out.phases.play.writePaths = [...new Set(writes.map((x) => x.path))]
            out.phases.play.writeLatency = stats(writes.map((x) => x.ms))
            out.phases.play.server = serverTrace(path.join(dir, 'server.log'))
        }
        out.net = net
        out.loaf = J.loaf.filter((x) => x.ms > 100).map((x) => ({ ...x, at: Math.round(x.at), ms: Math.round(x.ms), block: Math.round(x.block) }))
        const sm = await sourceMapper(dist)
        const consumers = new Map()
        for (const n of profile.nodes) if (n.callFrame.url && !consumers.has(n.callFrame.url)) consumers.set(n.callFrame.url, await sm.consumer(n.callFrame.url))
        out.profile = analyseProfile(profile, (cf) => sm.map(consumers.get(cf.url), cf))
        fs.writeFileSync(path.join(ROOT, `${label}.json`), JSON.stringify(out, null, 1))
        console.log(JSON.stringify({ phases: out.phases, bigChat: out.bigChat }, null, 1))
        console.log('[jank] top functions inside main-thread stretches > 50 ms:')
        for (const x of out.profile.topInLong.slice(0, 20)) console.log(`  ${String(x.ms).padStart(6)} ms  ${x.fn}`)
        console.log(`[jank] long stretches: ${out.profile.longRuns.map((r) => r.ms).join(', ')}`)
        console.log(`[jank] ${path.join(ROOT, label + '.json')}`)
    } finally {
        await browser.close().catch(() => {})
        await server.stop()
        fs.rmSync(runDir, { recursive: true, force: true })
    }
}

main().catch((e) => { console.error(e); process.exit(1) })
