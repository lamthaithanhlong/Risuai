#!/usr/bin/env node
// Acceptance playtest of the story cards through the REAL Risu app, played the way the owner plays (asked 2026-10-19: "Chú làm sao
// 3 truyện hoàn chỉnh gameplay system và lore cháu chỉ vào chơi"). Per story: a copy of the live save, a second server on another
// port, headless Chromium on the built client; a step-by-step creation run ("Hard. Từng bước.", 3 answers) and a surprise run
// ("Hard. Surprise me." → look answer → "Được" → ~20 Vietnamese turns: pauses, actions, one impossible/dictated action, NPCs,
// danger, travel). Then each reply is scored (lib/score.mjs), sampled replies are judged for canon by the owner's model
// (lib/judge.mjs), and a scorecard per story plus a summary are written.
//
//   node tests/acceptance/run.mjs --story ss|lotm|mailman|zombie|all     play and score (default all, the stories in parallel)
//     --turns 20         story turns after the yes          --serial       one story at a time
//     --no-build         serve the repo's dist as it is     --no-judge     skip the model judge
//     --judge-model M    the judge's model (default: the DeepSeek slot, owner 2026-10-21); claude:sonnet / claude:haiku run a lean
//                        `claude -p` on the subscription instead (judge.mjs askClaude); a failed or refused one falls back to DeepSeek
//     --port 6101        first port for the copies          --store files|sqlite   override the live server's store
//     --out DIR          default ~/.backend-review/work/risu-acceptance/<YYYY-MM-DD>
//     --narrator web     the narrator on ChatGPT web (lib/webShim.mjs, through the Codex Web GPT bridge) instead of the
//                        COPY's 9router slot; the judge stays on 9router (default: router)
//     --narrator-slot S  the COPY plays on the model slot named S (e.g. codex) whatever slot the live save has active
//     --max-context N    DIAGNOSTIC: the COPY's maxContext set to N (to measure what sits behind a context blocker); the
//                        scorecards say so, and the default out dir gets a -diag suffix
//     --lore-forward M   on | off | shadow: the COPY's loreForward (the GM names the shelves, loreIndex.ts); shadow keeps the live librarian
//                        and logs what the GM's answer would have loaded ($lore_shadow). Not diagnostic: the scorecards are comparable.
//     --lore-budget P    the COPY's card gets loreSettings.tokenBudget scaled to P percent (70 = cut 30%); the live card keeps its budget
//     --gm-solver off    the COPY's gmSolver=false: the GM's note keeps its open rules (the symbolic solver is skipped); "on" leaves it as it is
//     --base-from RUN    take the snapshot from RUN/_base of an earlier run (an APFS clone: no new disk, and two runs start from the same save)
//     --keep-runs        do not remove the earlier runs under ~/.risu-story-work/acceptance (another session may still need a copy)
//     --dump-requests    write each narrator and lore-helper request body to OUT/requests/<story>/ (the prompt cache's shared prefix)
//     --script FILE      play FILE's turns instead of the story's own ({"ss": [{"kind": "action", "text": "…"}], …}), no
//                        step-by-step run; each turn waits for the bookkeeper and records the panel after it (turn.after)
//   node tests/acceptance/run.mjs --rescore DIR [--rejudge]    recompute the scorecards from DIR/<story>.json (--rejudge: ask the judge again)
//   node --test tests/acceptance/score.check.mjs               the scorer's own checks
//
// Setup once: (cd tests/acceptance && npm install && npx playwright install chromium).
// Never touches the live server (:6001) or the real save: the save is snapshotted read-only into ~/.risu-story-work/acceptance/<stamp>
// (only the newest run is kept: --rejudge needs that run's copy) and the owner's settings are used from the copy as they are. Outputs are not committed.
import fs from 'fs'
import { execFileSync } from 'child_process'
import os from 'os'
import path from 'path'
import { STORIES, STORY_KEYS, planOf } from './stories.mjs'
import { buildClient, copySave, freePort, liveServer, newRunDir, pruneRuns, snapshotLive, startServer, storeBackend } from './lib/env.mjs'
import { Player } from './lib/play.mjs'
import { modelSettings, patchCopyCardBudget, patchCopyRoot, redact } from './lib/save.mjs'
import { asksDuocChua, asksLook, scoreStory, oneLine } from './lib/score.mjs'
import { judgeRecord, isClaudeModel } from './lib/judge.mjs'
import { startShim } from './lib/webShim.mjs'
import { storyMarkdown, summaryMarkdown } from './lib/report.mjs'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const today = new Date().toLocaleDateString('sv-SE')
const SCRIPT = opt('--script') ? JSON.parse(fs.readFileSync(opt('--script'), 'utf8')) : null
const LORE_FORWARD = opt('--lore-forward') ? { loreForward: opt('--lore-forward') !== 'off', loreForwardShadow: opt('--lore-forward') === 'shadow' } : null
const LORE_BUDGET = opt('--lore-budget') ? Number(opt('--lore-budget')) : null
if (LORE_BUDGET !== null && !(LORE_BUDGET > 0 && LORE_BUDGET <= 200)) throw new Error('--lore-budget wants a percent between 1 and 200')
const GM_SOLVER = opt('--gm-solver') === 'off' ? { gmSolver: false } : null
const DIAG = opt('--max-context') ? { maxContext: Number(opt('--max-context')) } : null
const OUT = opt('--out', path.join(os.homedir(), '.backend-review/work/risu-acceptance', today + (DIAG ? '-diag' : '')))

/** RUN/_base as an APFS clone of an earlier run's _base: no new disk, and both runs start from the same save. */
function cloneBase(fromRun, runDir) {
    const from = path.join(fromRun, '_base')
    const b = path.join(runDir, '_base')
    fs.mkdirSync(b, { recursive: true })
    for (const n of fs.readdirSync(from)) execFileSync('cp', ['-cR', path.join(from, n), path.join(b, n)])
    console.log(`[env] snapshot cloned from ${from}`)
    return b
}

function writeRecord(file, rec) { fs.writeFileSync(file, redact(JSON.stringify(rec, null, 1))) }

async function rescore(dir) {
    const results = []
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'))
    for (const key of STORY_KEYS) {
        const f = path.join(dir, `${key}.json`)
        if (!fs.existsSync(f)) continue
        const rec = JSON.parse(fs.readFileSync(f, 'utf8'))
        rec.binaryItem = STORIES[key].binaryItem ?? null       // the story's current definition, not the one the run stored
        if (flag('--rejudge') && rec.play?.turns?.length) {
            // the copy may be gone; a Claude judge needs none of its settings (the DeepSeek fallback then has no router to ask)
            let ms = { slots: [], url: null, key: null, requestModel: null }
            try { ms = modelSettings(path.join(rec.copyDir ?? path.join(meta.runDir, key), 'save'), rec.store) } catch (e) { if (!isClaudeModel(opt('--judge-model', ''))) throw e }
            const deepseek = ms.slots.find((x) => /deepseek/i.test(x.name))?.req
            console.log(`[${key}] judging again ...`)
            rec.judge = await judgeRecord(rec, STORIES[key], { url: ms.url, key: ms.key, model: opt('--judge-model', deepseek ?? 'main-deepseek'), fallback: deepseek }, console.log)
            fs.writeFileSync(f, redact(JSON.stringify(rec, null, 1)))
        }
        const checks = scoreStory(rec, rec.judge ?? {})
        fs.writeFileSync(path.join(dir, `${key}.md`), storyMarkdown(rec, checks))
        results.push({ title: rec.title, checks, file: path.join(dir, `${key}.md`), blocked: rec.blocked })
    }
    fs.writeFileSync(path.join(dir, 'summary.md'), summaryMarkdown(meta.date, results, meta))
    console.log(`rescored ${results.length} stories in ${dir}`)
}

/** one played turn as the record keeps it */
async function snap(player, label, phase, kind, text, res) {
    const s = await player.state()
    const dom = await player.dom()
    const idx = s.messages.length - 1
    const last = s.messages[idx]
    const d = dom.find((x) => x.idx === idx)
    const main = (res.net ?? []).filter((n) => n.kind === 'main').at(-1)
    return {
        label, phase, kind, text, ok: res.ok && last?.role === 'char', ms: res.ms, timeout: !!res.timeout, errors: res.errors,
        reply: last?.role === 'char' ? last.data : '', shown: last?.role === 'char' ? (d?.prose ?? '') : '',
        panel: d?.panel ?? null, images: d?.images ?? [], vars: s.vars, raw: main?.response ?? null, lore: s.lore ?? null,
        net: (res.net ?? []).map((n) => ({ ...n, response: undefined })),
    }
}

async function playStory(key, ctx) {
    const story = STORIES[key]
    const log = (m) => console.log(`[${key}] ${m}`)
    const t0 = Date.now()
    const planRule = (() => { try { return /\[💡Kế hoạch\|/.test(fs.readFileSync(path.join(story.src, 'main_description.md'), 'utf8')) } catch { return false } })()
    const rec = { persona: ctx.persona ?? '', planRule, story: key, title: story.title, binaryItem: story.binaryItem ?? null, side: story.side ? { text: story.side.text, match: story.side.match.source } : null, date: ctx.date, port: ctx.port, store: ctx.backend, build: ctx.build, model: ctx.model, voice: story.voice ? { ...story.voice, unbracketed: story.voice.unbracketed?.source ?? null } : null, blocked: [] }
    const recFile = path.join(OUT, `${key}.json`)
    const { dir, password } = copySave(ctx.runDir, ctx.base, key, { log })
    rec.copyDir = dir
    if (ctx.slot) {
        // the request goes out with customProxyRequestModel, and the app's slot watcher (modelSlotsRuntime) detaches a slot whose
        // fields disagree with it: setting activeModelSlot alone left the copy on the live save's model
        const was = patchCopyRoot(path.join(dir, 'save'), ctx.backend, { activeModelSlot: ctx.slot.id, aiModel: ctx.slot.model, customProxyRequestModel: ctx.slot.req })
        rec.narratorSlot = `slot "${ctx.slot.name}" (${ctx.slot.req}); the live save has ${was.activeModelSlot === ctx.slot.id ? 'the same' : 'another'} slot active`
        log(rec.narratorSlot)
    }
    if (ctx.web) {
        const was = patchCopyRoot(path.join(dir, 'save'), ctx.backend, { forceReplaceUrl: ctx.web.url })
        rec.narrator = `ChatGPT web (${ctx.web.model}, effort ${ctx.web.effort}) through ${ctx.web.url} for requests to "${ctx.web.narrator}"; the copy's URL was ${was.forceReplaceUrl || 'the default'}`
        log(rec.narrator)
    }
    if (LORE_FORWARD) {
        patchCopyRoot(path.join(dir, 'save'), ctx.backend, LORE_FORWARD)
        rec.loreForward = opt('--lore-forward')
        log(`lore forward: ${rec.loreForward}`)
    }
    if (LORE_BUDGET !== null) {
        const b = patchCopyCardBudget(path.join(dir, 'save'), ctx.backend, story.cardId, LORE_BUDGET)
        rec.loreBudget = { percent: LORE_BUDGET, ...b }
        log(`lore token budget: ${b.before} -> ${b.after} (${LORE_BUDGET}%)`)
    }
    if (GM_SOLVER) {
        patchCopyRoot(path.join(dir, 'save'), ctx.backend, GM_SOLVER)
        rec.gmSolver = 'off'
        log('gm solver: off')
    }
    if (DIAG) {
        const was = patchCopyRoot(path.join(dir, 'save'), ctx.backend, DIAG)
        rec.diagnostic = `copy settings changed for this run: ${Object.entries(DIAG).map(([k, v]) => `${k} ${was[k]} -> ${v}`).join(', ')} (the owner's real save keeps ${JSON.stringify(was)})`
        log(rec.diagnostic)
    }
    const server = await startServer(dir, ctx.port, { backend: ctx.backend, log })
    const player = new Player({ port: ctx.port, password, outDir: path.join(OUT, 'shots'), label: key, log, dumpDir: flag('--dump-requests') ? path.join(OUT, 'requests', key) : null, factsLog: path.join(dir, 'facts.jsonl') })
    let failsInRow = 0
    const play1 = async (run, label, phase, kind, text) => {
        log(`${label} ${kind}: ${oneLine(text, 70)}`)
        const res = await player.turn(text)
        const t = await snap(player, label, phase, kind, text, res)
        // the bookkeeper answers after the reply (not awaited by the page): its panel writes land a few seconds later
        if (SCRIPT) { await player.page.waitForTimeout(15000); t.after = (await player.state())?.vars ?? null }
        run.turns.push(t)
        failsInRow = t.ok ? 0 : failsInRow + 1
        log(`${label} ${t.ok ? 'ok' : 'NO REPLY'} ${Math.round(t.ms / 1000)} s ${t.ok ? '— ' + oneLine(t.shown || t.reply, 90) : (t.errors.at(-1)?.error ?? (t.timeout ? 'timeout' : ''))}`)
        writeRecord(recFile, rec)
        if (failsInRow >= 2) throw new Error(`two turns in a row got no reply (last: ${oneLine(t.errors.at(-1)?.error ?? 'timeout', 200)})`)
        return t
    }
    try {
        await player.open()
        await player.selectCard(story.cardId, story.nameMatch)
        log(`card selected (${story.cardId.slice(0, 8)})`)

        // run 1: step by step, up to the given number of answers (it stops at the record: no yes is given here). A run that
        // stops answering is recorded and the surprise run still gets its own chance.
        rec.steps = { chatId: SCRIPT ? null : (await player.newChat()).chatId, turns: [] }
        if (!SCRIPT) try {
            let s = await play1(rec.steps, 's1', 'creation', 'creation', 'Hard. Từng bước.')
            for (let i = 0; i < story.stepAnswers.length && !asksDuocChua(s.reply); i++) s = await play1(rec.steps, `s${i + 2}`, 'creation', 'creation', story.stepAnswers[i])
        } catch (e) {
            rec.blocked.push(`step-by-step run: ${e.message || e}`)
            log(`blocked (step-by-step run): ${e.message || e}`)
            failsInRow = 0
        }
        let t

        // run 2: surprise me, then the look answer, the yes, and the story
        rec.play = { chatId: (await player.newChat()).chatId, turns: [] }
        let n = 1
        t = await play1(rec.play, `t${n++}`, 'creation', 'creation', 'Hard. Surprise me.')
        if (asksLook(t.reply)) t = await play1(rec.play, `t${n++}`, 'creation', 'creation', story.lookAnswer)
        for (let i = 0; i < 2 && t.ok && !asksDuocChua(t.reply); i++) t = await play1(rec.play, `t${n++}`, 'creation', 'creation', 'Cho tôi xem lại cả hồ sơ nhân vật.')
        t = await play1(rec.play, `t${n++}`, 'yes', 'yes', 'Được')
        await player.shot('after-yes')
        for (const turn of SCRIPT ? SCRIPT[key] ?? [] : planOf(story, ctx.turns)) {
            const x = await play1(rec.play, `t${n++}`, 'story', turn.kind, turn.text)
            if (turn.kind === 'impossible') await player.shot(`${x.label}-impossible`)
        }
    } catch (e) {
        rec.blocked.push(String(e.message || e))
        log(`blocked: ${e.message || e}`)
    }
    try {
        // pictures are drawn after the reply: give them a minute, then read the whole chat as the player sees it
        await player.page?.waitForTimeout(60000)
        rec.final = { dom: await player.domAll(), state: await player.state() }
        rec.final.state.messages = rec.final.state.messages.map((m) => ({ role: m.role, len: m.data.length }))
        await player.page?.waitForTimeout(5000)
        if (rec.play?.chatId) {
            rec.final.check = await player.storyApi(rec.play.chatId, 'check')
            const st = await player.storyApi(rec.play.chatId, '')
            rec.final.story = { status: st.status, http: st.http, npcs: (st.npcs ?? []).length, timeline: (st.timeline ?? []).length, world: st.world }
        }
        await player.shot('final')
    } catch (e) { rec.blocked.push(`final read: ${e.message || e}`) }
    await player.close()
    await server.stop()
    rec.ms = Date.now() - t0
    if (!flag('--no-judge') && rec.play?.turns?.length) {
        log('judging ...')
        try { rec.judge = await judgeRecord(rec, story, ctx.judgeCfg, log) } catch (e) { rec.judge = { error: String(e.message || e) } }
    }
    writeRecord(recFile, rec)
    const checks = scoreStory(rec, rec.judge ?? {})
    const file = path.join(OUT, `${key}.md`)
    fs.writeFileSync(file, storyMarkdown(rec, checks))
    log(`scorecard ${file}`)
    return { title: story.title, checks, file, blocked: rec.blocked }
}

async function main() {
    if (flag('--rescore')) return rescore(opt('--rescore', OUT))
    const which = opt('--story', 'all')
    const keys = which === 'all' ? STORY_KEYS : which.split(',')
    for (const k of keys) if (!STORIES[k]) throw new Error(`unknown story "${k}" (${STORY_KEYS.join(", ")}, all)`)
    fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true })
    if (!flag('--keep-runs')) pruneRuns()
    const runDir = newRunDir()
    const live = liveServer()
    const backend = storeBackend(live, opt('--store'))
    console.log(`[env] live server ${live ? `pid ${live.pid} in ${live.cwd}` : 'not running'}; copy uses the ${backend} store`)
    const build = flag('--no-build') ? "the repo's dist" : 'built from the working tree at ' + new Date().toISOString().slice(0, 16)
    buildClient(runDir, { noBuild: flag('--no-build') })
    const base = opt('--base-from') ? cloneBase(opt('--base-from'), runDir) : await snapshotLive(runDir, { liveCwd: live?.cwd || undefined, backend })
    const ms = modelSettings(path.join(base, 'save'), backend)
    // the owner may have another slot active on the live server; the run can pin the narrator to a named one (copy only)
    const slot = opt('--narrator-slot') ? ms.slots.find((x) => x.name === opt('--narrator-slot')) : null
    if (opt('--narrator-slot') && !slot) throw new Error(`no model slot named "${opt('--narrator-slot')}" (have: ${ms.slots.map((x) => x.name).join(', ')})`)
    if (slot) { ms.slot = slot.name; ms.requestModel = slot.req }
    const model = { aiModel: ms.aiModel, slot: ms.slot, requestModel: ms.requestModel, url: ms.url, gameMaster: ms.gameMaster, jevReferee: ms.jevReferee, autoTranslate: ms.autoTranslate }
    // the judge is the DeepSeek slot; --judge-model picks another (claude:sonnet: the subscription, judge.mjs askClaude); a failed one falls back to DeepSeek
    const deepseek = ms.slots.find((x) => /deepseek/i.test(x.name))?.req
    // the judge uses the narrator's model only when that is the router's; on ChatGPT web it takes the DeepSeek slot
    const narratorWeb = opt('--narrator', 'router') === 'web'
    const judgeCfg = { url: ms.url, key: ms.key, model: opt('--judge-model', deepseek ?? 'main-deepseek'), fallback: deepseek }
    let shim = null, web = null
    if (narratorWeb) {
        web = { model: opt('--web-model', 'chatgpt-web/gpt-6-sol'), effort: opt('--web-effort', 'medium'), narrator: ms.requestModel }
        shim = await startShim({ port: Number(opt('--shim-port', 20199)), upstream: new URL(ms.url).origin, narrator: ms.requestModel, web: { model: web.model, effort: web.effort } })
        web.url = shim.url
        console.log(`[env] narrator "${ms.requestModel}" goes to ChatGPT web (${web.model}) through ${shim.url}`)
    }
    const meta = { date: today, command: 'node tests/acceptance/run.mjs ' + argv.join(' '), runDir, store: backend, build, model: web ? `ChatGPT web ${web.model} (effort ${web.effort}) for "${ms.requestModel}"` : `${ms.slot} → ${ms.requestModel}` }
    fs.writeFileSync(path.join(OUT, 'run.json'), JSON.stringify(meta, null, 1))
    const turns = Number(opt('--turns', 20))
    let port = Number(opt('--port', 6101))
    const ctxs = []
    for (const k of keys) { port = await freePort(port); ctxs.push([k, { runDir, base, backend, build, model, judgeCfg, turns, date: today, port, web, slot, persona: ms.persona }]); port++ }
    const results = []
    if (flag('--serial')) for (const [k, c] of ctxs) results.push(await playStory(k, c).catch((e) => ({ title: STORIES[k].title, error: String(e.message || e) })))
    else results.push(...await Promise.all(ctxs.map(([k, c]) => playStory(k, c).catch((e) => ({ title: STORIES[k].title, error: String(e.message || e) })))))
    // the summary covers every story scored in OUT today, so `--story lotm` after an `all` run keeps the other two in it
    const byKey = Object.fromEntries(ctxs.map(([k], i) => [k, results[i]]))
    for (const k of STORY_KEYS) {
        const f = path.join(OUT, `${k}.json`)
        if (byKey[k] || !fs.existsSync(f)) continue
        const rec = JSON.parse(fs.readFileSync(f, 'utf8'))
        byKey[k] = { title: rec.title, checks: scoreStory(rec, rec.judge ?? {}), file: path.join(OUT, `${k}.md`), blocked: rec.blocked }
    }
    fs.writeFileSync(path.join(OUT, 'summary.md'), summaryMarkdown(today, STORY_KEYS.filter((k) => byKey[k]).map((k) => byKey[k]), meta))
    console.log(`\nsummary: ${path.join(OUT, 'summary.md')}`)
    if (shim) { console.log(`[shim] ${JSON.stringify(shim.stats)}`); await shim.close() }
}

main().catch((e) => { console.error(e); process.exit(1) })
