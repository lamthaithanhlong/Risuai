#!/usr/bin/env node
// What happens to a turn when the phone page goes away (owner, 2026-10-20: "dùng đợi generate mở app khác thì ws bị ngắt").
// A copy of the live save on its own port, its model pointed at a local stub (lib/stubModel.mjs), the real client in headless Chromium.
// Scenarios (each on a New Chat of the Infinite Mailman card):
//   freeze  send, then the page is frozen 60 s the way iOS freezes a backgrounded tab (CDP Page.setWebLifecycleState frozen)
//   kill    send, then the page is closed (storage kept, as when iOS discards the tab) for 60 s, then opened again
//   double  two sends 300 ms apart
//   reset   the model dies mid-stream on the first try
// Prints, per scenario, when the model got the narrator request, when the reply reached the SERVER's save, and what the chat holds.
//   node tests/turns/repro.mjs [--scenarios freeze,kill,double,reset] [--away 60] [--build] [--port 6301]
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { createRequire } from 'module'
import { buildClient, copySave, freePort, newRunDir, snapshotLive, startServer, REPO } from '../acceptance/lib/env.mjs'
import { Player } from '../acceptance/lib/play.mjs'
import { startStubModel } from './lib/stubModel.mjs'

const require = createRequire(import.meta.url)
const { decodeSave, parseBlock } = require(path.join(REPO, 'server/node/dbMerge.cjs'))
const argv = process.argv.slice(2)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const SCEN = opt('--scenarios', 'freeze,kill,double,reset').split(',')
const AWAY = Number(opt('--away', '60')) * 1000
const CARD = { id: 'aa7f021d-b690-4f02-8e64-9e28aa0aff01', name: 'Infinite Mailman' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

const DB_KEY = Buffer.from('database/database.bin', 'utf-8').toString('hex').toLowerCase()
/**
 * Patch the copy's root settings where a reader finds them: a database.bin still waiting in the copied write queue is what the page
 * loads (saveQueue.cjs), so patching only the store (acceptance/lib/save.mjs patchCopyRoot) left the page on the owner's real model.
 */
function patchRoot(dir, patch) {
    if (!/\.risu-story-work\/acceptance\//.test(dir)) throw new Error('not an acceptance copy: ' + dir)
    const Database = require(path.join(REPO, 'node_modules/better-sqlite3'))
    const { encodeSave, serializeBlock } = require(path.join(REPO, 'server/node/dbMerge.cjs'))
    const fix = (bytes) => {
        const blocks = decodeSave(bytes)
        const i = blocks.findIndex((b) => b.name === 'root')
        const root = Object.assign(parseBlock(blocks[i]), patch)
        // a bot preset carries its own URL and the page applies it (database.svelte.ts setPreset): patch every one
        for (const pr of root.botPresets ?? []) if (patch.forceReplaceUrl && pr && 'forceReplaceUrl' in pr) pr.forceReplaceUrl = patch.forceReplaceUrl
        blocks[i] = serializeBlock(blocks[i].type, blocks[i].comp, 'root', root)
        return encodeSave(blocks)
    }
    const store = new Database(path.join(dir, 'save.store.sqlite'))
    const queue = new Database(path.join(dir, 'save.queue.sqlite'))
    try {
        const queued = queue.prepare("SELECT data FROM pending WHERE key = ? AND op = 'write'").get(DB_KEY)?.data
        const stored = store.prepare('SELECT data FROM files WHERE key = ?').get(DB_KEY)?.data
        if (queued) queue.prepare('UPDATE pending SET data = ? WHERE key = ?').run(fix(queued), DB_KEY)
        const b = fix(stored)
        // the store checks each file against its sha256: a row patched without it reads as corrupt and the page falls back to a
        // dbbackup (with the owner's real model in it)
        const sha = crypto.createHash('sha256').update(b).digest('hex')
        const r = store.prepare('UPDATE files SET data = ?, size = ?, sha256 = ?, mtime = ? WHERE key = ?').run(b, b.length, sha, Date.now(), DB_KEY)
        if (r.changes !== 1) throw new Error('database.bin not found in the copy store')
        log('patched root', queued ? '(queue + store)' : '(store)')
    } finally { store.close(); queue.close() }
}

/** A file as the SERVER has it (the copy's queue first: a write still in it is what a reader gets, saveQueue.cjs), or null. */
function serverFile(dir, name) {
    const Database = require(path.join(REPO, 'node_modules/better-sqlite3'))
    const key = Buffer.from(name, 'utf-8').toString('hex').toLowerCase()
    let bytes
    const q = path.join(dir, 'save.queue.sqlite')
    if (fs.existsSync(q)) {
        const d = new Database(q, { readonly: true })
        try { bytes = d.prepare("SELECT data FROM pending WHERE key = ? AND op = 'write'").get(key)?.data } catch { /* other schema */ } finally { d.close() }
    }
    if (!bytes) { const d = new Database(path.join(dir, 'save.store.sqlite'), { readonly: true }); try { bytes = d.prepare('SELECT data FROM files WHERE key = ?').get(key)?.data } finally { d.close() } }
    return bytes ?? null
}

/**
 * The chat as the SERVER has it (the store of the copy), not as the page holds it. With enableRemoteSaving (the live save) the card is
 * a REMOTE block in database.bin and its chats are in remotes/<chaId>.local.bin.
 */
function serverChat(dir, chatId) {
    const block = decodeSave(serverFile(dir, 'database/database.bin')).find((b) => b.name === CARD.id)
    const remote = block.type === 6 ? serverFile(dir, `remotes/${CARD.id}.local.bin`) : null
    const card = remote ? JSON.parse(Buffer.from(remote).toString('utf8')) : parseBlock(block)
    const chat = card.chats.find((c) => c.id === chatId)
    return chat ? chat.message.map((m) => ({ role: m.role, data: String(m.data).slice(0, 60), id: m.chatId })) : null
}

async function main() {
    const stub = await startStubModel({ streamMs: 15000, helperMs: 4000 })
    const runDir = newRunDir()
    log('run', runDir)
    buildClient(runDir, { noBuild: !argv.includes('--build') })
    const base = await snapshotLive(runDir, { backend: 'sqlite' })
    const { dir, password } = copySave(runDir, base, 'turns')
    patchRoot(dir, {
        forceReplaceUrl: `http://127.0.0.1:${stub.port}/v1/chat/completions`,
        jevGuard: JSON.stringify({ enabled: false }), jevReferee: false, gameMaster: false, autoTranslate: false,
    })
    fs.rmSync(path.join(base), { recursive: true, force: true })     // the copy is all we need; keep the disk free
    // the copy's server sends every request for the owner's router to the stub (server.cjs RISU_UPSTREAM_REMAP): the copied save's
    // plugins call the router by its own URL whatever the settings say
    process.env.RISU_UPSTREAM_REMAP = JSON.stringify({ 'http://localhost:20128': `http://127.0.0.1:${stub.port}`, 'http://127.0.0.1:20128': `http://127.0.0.1:${stub.port}` })
    // Async turn on for the copy's pages unless --sync (server.cjs RISU_ASYNC_TURNS: the default of a page that never set it)
    process.env.RISU_ASYNC_TURNS = argv.includes('--sync') ? '0' : '1'
    const port = await freePort(Number(opt('--port', '6301')))
    const server = await startServer(dir, port, { backend: 'sqlite' })
    const results = {}
    const offStub = []
    const p = new Player({ port, password, outDir: runDir, label: 'turns', log })
    // *.localhost is loopback and a secure context in Chromium, but not "localhost" to the app (localNetwork.ts
    // isPageRemoteFromLocalhost): the page then routes every model request through the server, as the iPhone does
    p.base = `http://phone.localhost:${port}`
    try {
        await p.open()
        // every model request of the copy must go to the stub: anything else is refused before it leaves (the owner's real model)
        const stubUrl = `http://127.0.0.1:${stub.port}/`
        await p.ctx.route('**/proxy-stream-jobs', async (route) => {
            let target = ''
            try { target = JSON.parse(route.request().postData() || '{}').url || '' } catch { /* not json */ }
            if (route.request().method() === 'POST' && !target.startsWith(stubUrl) && !/^http:\/\/(localhost|127\.0\.0\.1):20128\//.test(target)) { log('REFUSED a model request to', target); offStub.push(target); return route.abort() }
            return route.continue()
        })
        await p.ctx.route('**/proxy2', (route) => {
            let target = ''
            try { target = decodeURIComponent(route.request().headers()['risu-url'] || '') } catch { /* none */ }
            if (/completions|\/responses|systemone/.test(target) && !target.startsWith(stubUrl) && !/^http:\/\/(localhost|127\.0\.0\.1):20128\//.test(target)) { log('REFUSED a /proxy2 model request to', target); offStub.push(target); return route.abort() }
            return route.continue()
        })
        await p.selectCard(CARD.id, CARD.name)
        for (const s of SCEN) {
            await fetch(`http://127.0.0.1:${stub.port}/control`, { method: 'POST', body: JSON.stringify({ clear: true }) })
            // the page opened again after "kill" may be on the home screen, or still loading the save
            for (let i = 0; i < 3 && (await p.state().catch(() => null))?.chaId !== CARD.id; i++) {
                await sleep(3000)
                await p.selectCard(CARD.id, CARD.name).catch((e) => log('select:', e.message.slice(0, 120)))
            }
            const chat = await p.newChat()
            const t0 = Date.now()
            const r = { scenario: s }
            // --trace: the chat as the server has it, every second (what each page loads)
            let lastSig = ''
            const tracer = argv.includes('--trace') ? setInterval(() => {
                try {
                    const m = serverChat(dir, chat.chatId)
                    const sig = JSON.stringify((m ?? []).map((x) => x.role[0] + ':' + x.id.slice(0, 4) + ':' + x.data.length))
                    if (sig !== lastSig) { lastSig = sig; log('server chat', Date.now() - t0, sig) }
                } catch (e) { /* mid-write */ }
            }, 250) : null
            if (s === 'reset') await fetch(`http://127.0.0.1:${stub.port}/control`, { method: 'POST', body: JSON.stringify({ failNext: 'reset' }) })
            await p.page.locator('textarea.text-input-area').fill(`Tôi gõ cửa (${s}).`)
            await p.page.locator('.button-icon-send').click()
            if (s === 'double') {
                await sleep(300)
                await p.page.locator('textarea.text-input-area').fill('Tôi gõ thêm lần nữa.')
                await p.page.locator('.button-icon-send').click()
            }
            if (s === 'freeze') {
                await sleep(300)
                // iOS suspends a backgrounded tab: no script runs and its connections die. Page.setWebLifecycleState 'frozen' is not
                // that (measured: fetch callbacks went on and the turn finished while "frozen"), so: the debugger stops every script,
                // and the network is cut, for as long as the player is away
                const cdp = await p.ctx.newCDPSession(p.page)
                await cdp.send('Network.enable')
                await cdp.send('Debugger.enable')
                await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
                await cdp.send('Debugger.pause')
                log('suspended (scripts paused, offline)'); await sleep(AWAY)
                r.serverDuringAway = serverChat(dir, chat.chatId)
                r.modelDuringAway = stub.log.map((e) => ({ kind: e.kind, at: e.at - t0, outcome: e.outcome }))
                await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
                await cdp.send('Debugger.resume')
                await cdp.send('Debugger.disable')
                log('back')
            }
            if (s === 'kill') {
                await sleep(300)
                r.modelBeforeClose = stub.log.map((e) => e.kind)
                await p.page.close()
                log('page closed'); await sleep(AWAY)
                r.serverDuringAway = serverChat(dir, chat.chatId)
                r.modelDuringAway = stub.log.map((e) => ({ kind: e.kind, at: e.at - t0, outcome: e.outcome }))
                p.page = await p.ctx.newPage()
                await p.page.goto(p.base + '/')
                await p.page.waitForFunction(() => !!globalThis.__pluginApis__?.getChar, null, { timeout: 120000 })
                log('page opened again')
                if ((await p.state())?.chaId !== CARD.id) await p.selectCard(CARD.id, CARD.name).catch((e) => log('select after reopen:', e.message))
            }
            // wait for the chat to settle
            let st = null
            for (let i = 0; i < 90; i++) {
                await sleep(2000)
                const err = await Promise.race([p.takeError(), sleep(5000).then(() => '')]).catch(() => '')
                if (err) (r.errors ??= []).push(err.slice(0, 200))
                st = await Promise.race([p.state(), sleep(10000).then(() => null)])
                if (i % 5 === 0) log(s, 'waiting', i, st?.messages?.length, stub.log.map((e) => e.kind + ':' + (e.outcome ?? 'open')).join(' '), (r.errors ?? []).length)
                if (st?.chatId === chat.chatId && !(await p.busy()) && st.messages.at(-1)?.role === 'char' && !st.isStreaming && st.messages.length >= (s === 'double' ? 4 : 2)) break
            }
            r.msSettled = Date.now() - t0
            if (tracer) clearInterval(tracer)
            if (!stub.log.length && st?.messages?.at(-1)?.role === 'char') throw new Error('a reply came without the stub model being asked: the copy is not on the stub, stopping')
            r.model = stub.log.map((e) => ({ kind: e.kind, at: e.at - t0, end: e.end ? e.end - t0 : null, outcome: e.outcome }))
            r.pageChat = st?.chatId === chat.chatId ? st.messages.map((m) => `${m.role}: ${m.data.slice(0, 50)}`) : `(page shows chat ${st?.chatId})`
            r.input = await p.page.locator('textarea.text-input-area').inputValue().catch(() => null)
            await sleep(3000)
            r.serverAfter = serverChat(dir, chat.chatId)
            results[s] = r
            log(JSON.stringify(r, null, 1))
        }
    } finally {
        fs.writeFileSync(path.join(runDir, 'repro.json'), JSON.stringify(results, null, 1))
        await p.close(); await server.stop(); await stub.close()
        // the copy (~1.6 GB) goes when the run ends: the disk runs near full (it filled once, mid-run). The results are kept.
        const keep = path.join(os.homedir(), '.backend-review/work/risu-turns', `repro-${path.basename(runDir)}.json`)
        fs.mkdirSync(path.dirname(keep), { recursive: true })
        fs.copyFileSync(path.join(runDir, 'repro.json'), keep)
        if (!argv.includes('--keep')) fs.rmSync(runDir, { recursive: true, force: true })
        log('results ->', keep)
    }
}
main().catch((e) => { console.error(e); process.exit(1) })
