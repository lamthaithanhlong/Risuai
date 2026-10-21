#!/usr/bin/env node
// Where picture generation sits in a message turn (owner, 2026-10-20: "generate hình trong risu nên để 1 pipeline riêng biệt xử lý
// không theo pipeline của generate message"). A lean copy of the live save on its own port (leanSave.mjs: ~7 MB, not the 1 GB store),
// the owner's model AND picture router both replaced by a local stub (tests/turns/lib/stubModel.mjs; the picture endpoint answers
// slowly or with a 500 on command), the real client in headless Chromium, the Async turn worker on (--sync: the page runs its own turn).
// Every reply the stub writes carries a "[[img: ...]]" line, so the card's Lua (imagegen.lua, onOutput) asks for a picture.
// Scenarios, each on a New Chat of the Infinite Mailman card:
//   ok       the picture takes 2 s
//   slow     the picture takes --img seconds (default 90, what a real one takes)
//   fail     every picture request answers 500
//   twomsg   the picture takes --img seconds; a second message is sent the moment the first reply is in the chat
// Per scenario it prints when the reply reached the SERVER's chat, when the picture did, when the turn row said saved, when the second
// turn was accepted and answered, and the picture job rows.
//   node tests/images/repro.mjs [--scenarios ok,slow,fail,twomsg] [--img 90] [--sync] [--build | --dist <built client dir>] [--live <dir of the live server>] [--port 6311]
// (--dist and --live let a throwaway worktree of one commit run against the live save: its client built apart, its server code)
import fs from 'fs'
import path from 'path'
import os from 'os'
import { buildClient, copySave, freePort, newRunDir, REPO } from '../acceptance/lib/env.mjs'
import { startServer } from '../acceptance/lib/env.mjs'
import { Player } from '../acceptance/lib/play.mjs'
import { startStubModel } from '../turns/lib/stubModel.mjs'
import { leanSnapshot, patchRoot, serverChat, rows } from '../turns/lib/leanSave.mjs'

const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const SCEN = opt('--scenarios', 'ok,slow,fail,twomsg').split(',')
const IMG_MS = Number(opt('--img', '90')) * 1000
const CARD = { id: 'aa7f021d-b690-4f02-8e64-9e28aa0aff01', name: 'Infinite Mailman' }
const REPLY = 'Cánh cửa mở ra và mùi ẩm mốc tràn vào hành lang. [[img: a narrow rainy corridor at night, a lone postman holding a parcel under a red paper lantern]] Anh bước vào trong, tiếng bước chân vang lên sau lưng. Hết lượt.'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const ctl = (stub, body) => fetch(`http://127.0.0.1:${stub.port}/control`, { method: 'POST', body: JSON.stringify(body) })

async function main() {
    const stub = await startStubModel({ streamMs: 6000, helperMs: 500, reply: REPLY })
    const runDir = newRunDir()
    log('run', runDir)
    if (opt('--dist', '')) fs.symlinkSync(path.resolve(opt('--dist', '')), path.join(runDir, 'dist'))
    else buildClient(runDir, { noBuild: !argv.includes('--build') })
    const base = await leanSnapshot(runDir, { liveCwd: opt('--live', REPO) })
    const { dir, password } = copySave(runDir, base, 'pics')
    fs.rmSync(base, { recursive: true, force: true })
    patchRoot(dir, {
        forceReplaceUrl: `http://127.0.0.1:${stub.port}/v1/chat/completions`,
        jevGuard: { enabled: false }, jevReferee: false, gameMaster: false, autoTranslate: false,
        asyncTurns: !argv.includes('--sync'),
        // the picture router is the stub too: never the owner's real one, never his model names
        sdProvider: 'openai-compat',
        openaiCompatImage: { url: `http://127.0.0.1:${stub.port}/v1/images/generations`, key: 'stub-key', model: 'stub-image', size: '256x256', quality: 'low', style: '', fallbackModels: '' },
    }, log)
    process.env.RISU_UPSTREAM_REMAP = JSON.stringify({ 'http://localhost:20128': `http://127.0.0.1:${stub.port}`, 'http://127.0.0.1:20128': `http://127.0.0.1:${stub.port}` })
    process.env.RISU_ASYNC_TURNS = argv.includes('--sync') ? '0' : '1'
    const port = await freePort(Number(opt('--port', '6311')))
    const server = await startServer(dir, port, { backend: 'sqlite' })
    const results = {}
    const p = new Player({ port, password, outDir: runDir, label: 'pics', log })
    p.base = `http://phone.localhost:${port}`
    try {
        await p.open().catch(async (e) => {
            await p.page.screenshot({ path: path.join(runDir, 'open-failed.png') }).catch(() => {})
            const txt = await p.page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => '')
            log('open failed; the page says:', JSON.stringify(txt), '\nserver log tail:\n' + fs.readFileSync(path.join(dir, 'server.log'), 'utf8').split('\n').slice(-15).join('\n'))
            argv.push('--keep')
            throw e
        })
        const stubUrl = `http://127.0.0.1:${stub.port}/`
        const okTarget = (t) => t.startsWith(stubUrl) || /^http:\/\/(localhost|127\.0\.0\.1):20128\//.test(t)
        await p.ctx.route('**/proxy-stream-jobs', async (route) => {
            let target = ''
            try { target = JSON.parse(route.request().postData() || '{}').url || '' } catch { /* not json */ }
            if (route.request().method() === 'POST' && !okTarget(target)) { log('REFUSED a model request to', target); return route.abort() }
            return route.continue()
        })
        await p.ctx.route('**/api/image-jobs', async (route) => {
            let target = ''
            try { target = JSON.parse(route.request().postData() || '{}').request?.url || '' } catch { /* not json */ }
            if (route.request().method() === 'POST' && !okTarget(target)) { log('REFUSED a picture request to', target); return route.abort() }
            return route.continue()
        })
        await p.selectCard(CARD.id, CARD.name)
        for (const s of SCEN) {
            await ctl(stub, { clear: true })
            await ctl(stub, s === 'ok' ? { imageMs: 2000 } : s === 'fail' ? { imageMs: 300, imageFailAlways: '500' } : { imageMs: IMG_MS })
            for (let i = 0; i < 3 && (await p.state().catch(() => null))?.chaId !== CARD.id; i++) { await sleep(3000); await p.selectCard(CARD.id, CARD.name).catch(() => {}) }
            const chat = await p.newChat()
            const t0 = Date.now()
            const r = { scenario: s, imageMs: s === 'ok' ? 2000 : IMG_MS }
            const turnRows = () => rows(path.join(dir, 'turns.sqlite'), 'SELECT key, state, attempt, created, updated FROM turns WHERE chat = ? ORDER BY ord', chat.chatId)
            const jobRows = () => rows(path.join(dir, 'image-jobs.sqlite'), 'SELECT * FROM image_jobs ORDER BY created').filter((j) => { try { return JSON.parse(j.target ?? 'null')?.chatId === chat.chatId } catch { return false } })
            const OPEN = ['queued', 'running', 'retrying']
            r.timeline = []
            let lastSig = ''
            const tick = () => {
                const m = serverChat(dir, CARD.id, chat.chatId) ?? []
                // the replies are the character messages after the player's first message (the first character message is the greeting)
                const firstUser = m.findIndex((x) => x.role === 'user')
                // (a reply still streaming is saved with the words so far: a reply counts once it has a sentence)
                const chars = firstUser < 0 ? [] : m.slice(firstUser).filter((x) => x.role === 'char' && x.data.trim().length > 60)
                const at = () => Date.now() - t0
                if (chars[0] && r.replyOnServer == null) r.replyOnServer = at()
                if (chars[0] && /\{\{inlay::/.test(chars[0].data) && r.pictureOnServer == null) r.pictureOnServer = at()
                if (chars[1] && r.reply2OnServer == null) r.reply2OnServer = at()
                for (const t of turnRows()) {
                    r.turns ??= {}
                    r.turns[t.key.slice(-4)] ??= {}
                    const e = r.turns[t.key.slice(-4)]
                    e.accepted ??= t.created - t0
                    if (t.state === 'saved' && e.saved == null) e.saved = t.updated - t0
                    e.state = t.state; e.attempt = t.attempt
                }
                const sig = JSON.stringify([turnRows().map((t) => t.state + t.attempt), jobRows().map((j) => j.status), chars.length, chars.map((c) => /\{\{inlay::/.test(c.data))])
                if (sig !== lastSig) { lastSig = sig; r.timeline.push({ at: at(), turns: turnRows().map((t) => `${t.state}#${t.attempt}`), jobs: jobRows().map((j) => j.status), replies: chars.length, picInReply: chars.map((c) => /\{\{inlay::/.test(c.data)) }) }
            }
            await p.page.locator('textarea.text-input-area').fill(`Tôi gõ cửa (${s}).`)
            await p.page.locator('.button-icon-send').click()
            let sent2 = false
            const until = Date.now() + (s === 'twomsg' ? IMG_MS + 240000 : IMG_MS + 150000)
            while (Date.now() < until) {
                await sleep(500)
                try { tick() } catch { /* mid-write */ }
                if (s === 'twomsg' && !sent2 && r.replyOnServer != null) {
                    sent2 = true
                    r.secondSentAt = Date.now() - t0
                    await p.page.locator('textarea.text-input-area').fill('Tôi gõ thêm lần nữa.').catch(() => {})
                    await p.page.locator('.button-icon-send').click({ timeout: 5000 }).catch((e) => { r.secondSendError = String(e.message).slice(0, 100) })
                }
                const jobs = jobRows(), turns = turnRows()
                const turnsFinal = turns.length > 0 && turns.every((t) => ['saved', 'failed', 'cancelled'].includes(t.state)) && (s !== 'twomsg' || turns.length >= 2)
                if (turnsFinal && jobs.length > 0 && !jobs.some((j) => OPEN.includes(j.status)) && Date.now() - t0 > 3000) break
            }
            await sleep(3000)
            try { tick() } catch { /* mid-write */ }
            r.imageJobs = jobRows().map((j) => ({ status: j.status, attempt: j.attempt, error: (j.error ?? '').slice(0, 80), endedAt: j.updated - t0 }))
            r.serverLog = fs.readFileSync(path.join(dir, 'server.log'), 'utf8').split('\n').filter((l) => /\[Turns\] turn|ImageJobs|page console|page error/.test(l) && !/leased/.test(l)).slice(-12).map((l) => l.slice(0, 200))
            r.stub = stub.log.map((e) => ({ kind: e.kind, at: e.at - t0, end: e.end ? e.end - t0 : null, outcome: e.outcome }))
            r.finalChat = (serverChat(dir, CARD.id, chat.chatId) ?? []).map((m) => `${m.role}: ${m.data.replace(/\s+/g, ' ').slice(0, 70)}`)
            results[s] = r
            log(JSON.stringify(r, null, 1))
        }
    } finally {
        fs.writeFileSync(path.join(runDir, 'repro.json'), JSON.stringify(results, null, 1))
        await p.close(); await server.stop(); await stub.close()
        const keep = path.join(os.homedir(), '.backend-review/work/risu-images', `repro-${argv.includes('--sync') ? 'sync-' : ''}${path.basename(runDir)}.json`)
        fs.mkdirSync(path.dirname(keep), { recursive: true })
        fs.copyFileSync(path.join(runDir, 'repro.json'), keep)
        if (!argv.includes('--keep')) fs.rmSync(runDir, { recursive: true, force: true })
        log('results ->', keep)
    }
}
main().catch((e) => { console.error(e); process.exit(1) })
