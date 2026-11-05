#!/usr/bin/env node
// Smoke check for a built client before it goes live: node scripts/distSmoke.mjs <dist-dir> [--port N] [--timeout-s N]
// Serves the dist from the repo's own server (fresh scratch dir, no owner data) and opens it in headless Chromium.
// PASS (exit 0): the page reaches the app (password prompt: "Input your password", or "Set your password" on the fresh scratch save; or "My Stories") within the timeout and the
// "Legal documents not configured" screen is absent. FAIL (exit 1): one line "FAIL: <reason>" on stdout.
// Why: a client built without VITE_RISU_LEGAL_CONFIGURED=TRUE shows the legal screen instead of the app; the turn worker then
// never gets a chat screen ("the chat screen did not open"). Never touches the live server or any save.
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import { startServer, freePort, REPO } from '../tests/acceptance/lib/env.mjs'

const require = createRequire(import.meta.url)
const LEGAL = 'Legal documents not configured'

export async function distSmoke(distDir, { port = null, timeoutMs = 60000 } = {}) {
    const dist = path.resolve(distDir)
    if (!fs.existsSync(path.join(dist, 'index.html'))) return { ok: false, reason: `${dist} has no index.html` }
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-smoke-'))
    let server = null, browser = null
    try {
        fs.symlinkSync(dist, path.join(scratch, 'dist'))
        fs.mkdirSync(path.join(scratch, 'save'))
        port = port ?? await freePort(6260)
        if (port === 6001 || port === 6110) return { ok: false, reason: `refusing live port ${port}` }
        server = await startServer(scratch, port, { log: () => {} })
        let chromium
        try { chromium = require(path.join(REPO, 'tests/acceptance/node_modules/playwright')).chromium } catch { chromium = require('playwright').chromium }
        browser = await chromium.launch({ headless: true })
        const page = await (await browser.newContext()).newPage()
        const errors = []
        page.on('response', (r) => { if (r.status() >= 400 && r.url().includes(`:${port}/`)) errors.push(`${r.status()} ${new URL(r.url()).pathname}`) })
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
        const t0 = Date.now()
        while (Date.now() - t0 < timeoutMs) {
            const text = await page.evaluate(() => document.body?.innerText || '').catch(() => '')
            if (text.includes(LEGAL)) return { ok: false, reason: `the app page shows the legal screen ("${LEGAL}"): dist was built without VITE_RISU_LEGAL_CONFIGURED=TRUE` }
            if (/Input your password|Set your password|My Stories/.test(text)) return { ok: true, reason: 'the page reached the app (' + (/My Stories/.test(text) ? 'My Stories' : 'password prompt') + ')' }
            await new Promise((r) => setTimeout(r, 500))
        }
        return { ok: false, reason: `the app page did not load within ${timeoutMs / 1000} s (no password prompt, no My Stories)` + (errors.length ? '; HTTP errors: ' + errors.slice(0, 3).join(', ') : '') }
    } catch (e) {
        return { ok: false, reason: 'smoke check broke: ' + String(e?.message || e).slice(0, 200) }
    } finally {
        if (browser) await browser.close().catch(() => {})
        if (server) await server.stop()
        fs.rmSync(scratch, { recursive: true, force: true })
    }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href) {
    const args = process.argv.slice(2)
    const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args.splice(i, 2)[1] : null }
    const port = opt('--port'), ts = opt('--timeout-s')
    if (!args[0]) { console.log('FAIL: usage: node scripts/distSmoke.mjs <dist-dir> [--port N] [--timeout-s N]'); process.exit(1) }
    const r = await distSmoke(args[0], { port: port ? Number(port) : null, timeoutMs: ts ? Number(ts) * 1000 : 60000 })
    console.log(`${r.ok ? 'PASS' : 'FAIL'}: ${r.reason}`)
    process.exit(r.ok ? 0 : 1)
}
