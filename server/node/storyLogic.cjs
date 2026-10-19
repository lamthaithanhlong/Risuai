'use strict'
// Logic over story.sqlite: Prolog canon checks (story/canon.pl, run by SWI-Prolog) and PDDL plans (story/shadow_slave.*.pddl, the
// planner in story/pddl.cjs). Everything here fails soft: no swipl, a timeout, a parse error -> {status: 'unavailable' | 'error'},
// never an exception into the request, never anything that touches the save or the game.
//
// The fact export is the contract with canon.pl (its header lists the facts). Dates and ranks are normalized here, in code with tests,
// so the rules compare atoms and numbers only.

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const pddl = require('./story/pddl.cjs')
const { DEATH } = require('./storyStore.cjs')

const DIR = path.join(__dirname, 'story')
const lower = (s) => String(s ?? '').normalize('NFC').toLowerCase()
const atom = (s) => "'" + lower(s).replace(/[\r\n\t]+/g, ' ').replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"

// ---- normalizing ---------------------------------------------------------------------------------------------------------------
const RANKS = [
    ['aspirant', /aspirant|ứng viên|người thách thức/],
    ['sleeper', /sleeper|người ngủ|kẻ ngủ|ngủ mơ/],
    ['awakened', /awakened|thức tỉnh/],
    ['ascended', /ascended|master|bậc thầy|thăng hoa/],
    ['transcendent', /transcendent|siêu việt|saint|thánh nhân/],
    ['supreme', /supreme|tối cao/],
    ['sacred', /sacred|linh thiêng/],
    ['divine', /divine|thần thánh/],
]
/** the Spell's Rank of a panel value ("Aspirant (Ứng viên)" -> aspirant), or the lower-cased text when it is none of them */
function normalizeRank(v) {
    const t = lower(v).trim()
    if (!t || t === 'null' || t === '—' || t === '-') return null
    for (const [name, re] of RANKS) if (re.test(t)) return name
    return t
}

// time of day, 1 (dawn) .. 8 (midnight); checked in this order so "nửa đêm" is not read as "đêm" and "giữa trưa" before "trưa"
const word = (alts) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'u')
const PARTS_U = [
    [8, word(['nửa đêm', 'midnight'])],
    [1, word(['bình minh', 'rạng sáng', 'rạng đông', 'dawn', 'sunrise', 'daybreak'])],
    [3, word(['giữa trưa', 'buổi trưa', 'trưa', 'noon', 'midday'])],
    [5, word(['hoàng hôn', 'chạng vạng', 'dusk', 'sunset', 'twilight'])],
    [6, word(['buổi tối', 'tối', 'evening'])],
    [7, word(['ban đêm', 'đêm', 'night'])],
    [4, word(['buổi chiều', 'chiều', 'afternoon'])],
    [2, word(['buổi sáng', 'sáng', 'morning'])],
]

/** {day: 'cal(N)' | 'count(N)' | 'unknown', part: 1..8 | 'unknown'} of a timeline date like "19/5/2026, đêm" or "Day 3, dusk" */
function dateKey(at) {
    const t = lower(at)
    let day = 'unknown'
    const cal = t.match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/)
    const cnt = t.match(/(?:day|ngày)\s+(\d{1,4})(?!\s*\/)/)
    if (cal) {
        const ms = Date.UTC(Number(cal[3]), Number(cal[2]) - 1, Number(cal[1]))
        if (Number.isFinite(ms)) day = `cal(${Math.round(ms / 86400000)})`
    } else if (cnt) day = `count(${Number(cnt[1])})`
    const seg = t.includes(',') ? t.slice(t.lastIndexOf(',') + 1) : t
    let part = 'unknown'
    for (const src of seg === t ? [t] : [seg, t]) {
        for (const [n, re] of PARTS_U) if (re.test(src)) { part = n; break }
        if (part !== 'unknown') break
    }
    return { day, part }
}

/** "12/1000" -> {x: 12, cap: 1000} */
function fragments(v) {
    const m = lower(v).match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/)
    if (!m) return null
    const n = (s) => Number(s.replace(/[.,]/g, ''))
    return { x: n(m[1]), cap: n(m[2]) }
}

// ---- facts -----------------------------------------------------------------------------------------------------------------------
/** the Prolog facts of one chat (canon.pl's header), as text; null when the chat is unknown or archived */
function factsFor(store, chatId) {
    const s = store.story(chatId)
    if (!s) return null
    const out = []
    s.timeline.forEach((e) => {
        const k = dateKey(e.at)
        out.push(`event(${e.pos + 1}, ${atom(e.at)}, ${k.day}, ${k.part}, ${atom(e.event)}).`)
        out.push(`event_seen(${e.pos + 1}, ${Number(e.first_rev) || 0}).`)
    })
    for (const h of store.history(chatId)) {
        if (h.key !== 'st_rank') continue
        const from = normalizeRank(h.old_value)
        const to = normalizeRank(h.new_value)
        if (from && to && from !== to) out.push(`rank_change(${Number(h.rev) || 0}, ${atom(from)}, ${atom(to)}).`)
    }
    for (const n of s.npcs) out.push(`npc(${atom(n.name)}).`)
    for (let i = 1; i <= 10; i++) {
        const v = s.state['st_mem' + i]
        if (!v) continue
        const name = v.split('|')[0].trim()
        if (name) out.push(`mem_slot(${i}, ${atom(name)}).`)
    }
    const f = fragments(s.state.st_frag)
    if (f && Number.isFinite(f.x) && Number.isFinite(f.cap)) out.push(`fragments(${f.x}, ${f.cap}).`)
    const c = lower(s.state.st_cores).match(/^\s*(\d+)/)
    if (c) out.push(`cores(${Number(c[1])}).`)
    return out.join('\n') + '\n'
}

// ---- Prolog --------------------------------------------------------------------------------------------------------------------
const SWIPL_CANDIDATES = [process.env.RISU_SWIPL, '/opt/homebrew/bin/swipl', '/usr/local/bin/swipl', '/usr/bin/swipl'].filter(Boolean)
function findSwipl() {
    for (const p of SWIPL_CANDIDATES) { try { fs.accessSync(p, fs.constants.X_OK); return p } catch {} }
    return null
}

/** runs rules over facts with SWI-Prolog; resolves {status: 'ok', violations} | {status: 'unavailable' | 'error', reason} */
function runProlog(factsText, opts = {}) {
    const swipl = opts.swipl === undefined ? findSwipl() : opts.swipl
    if (!swipl) return Promise.resolve({ status: 'unavailable', reason: 'SWI-Prolog (swipl) is not installed' })
    const rules = opts.rules ?? path.join(DIR, 'canon.pl')
    const timeoutMs = opts.timeoutMs ?? 5000
    return new Promise((resolve) => {
        let out = ''
        let err = ''
        let done = false
        const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r) } }
        let child
        try {
            child = spawn(swipl, ['-q', path.join(DIR, 'runner.pl'), '--rules', rules, '--facts', '-', '--timeout', String(Math.max(1, Math.ceil(timeoutMs / 1000)))], { stdio: ['pipe', 'pipe', 'pipe'] })
        } catch (e) {
            return finish({ status: 'unavailable', reason: e.message })
        }
        const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} finish({ status: 'error', reason: 'timeout' }) }, timeoutMs + 2000)
        child.on('error', (e) => finish({ status: 'unavailable', reason: e.message }))
        child.stdout.on('data', (d) => { out += d })
        child.stderr.on('data', (d) => { err += d })
        child.on('close', () => {
            const line = out.trim().split('\n').pop() || ''
            try {
                const j = JSON.parse(line)
                if (j.ok) finish({ status: 'ok', facts: j.facts, violations: j.violations })
                else finish({ status: 'error', reason: j.error })
            } catch {
                finish({ status: 'error', reason: (err || out || 'no output').trim().slice(0, 300) })
            }
        })
        child.stdin.on('error', () => {})
        child.stdin.end(factsText)
    })
}

async function check(store, chatId, opts = {}) {
    const facts = factsFor(store, chatId)
    if (facts === null) return { status: 'not_found' }
    const r = await runProlog(facts, opts)
    return { ...r, chatId }
}

/** one short line for the prompt, or '' when there is nothing to say */
function promptLine(result, max = 3) {
    if (!result || result.status !== 'ok' || !result.violations?.length) return ''
    const say = {
        rank_without_event: (d) => `Rank changed ${d.from} -> ${d.to} with no Nightmare or Gateway in the timeline`,
        dead_npc_acts: (d) => `${d.npc} died (${d.died_at}) but acts later (${d.acts_at})`,
        timeline_backwards: (d) => `timeline date "${d.later}" comes before "${d.earlier}"`,
        memory_in_two_slots: (d) => `Memory "${d.memory}" is in slots ${d.slot} and ${d.other_slot}`,
        fragments_over_capacity: (d) => `${d.fragments} Soul Fragments exceed the core capacity ${d.capacity}`,
        fragment_cap_mismatch: (d) => `the fragment counter shows /${d.shown}, the cores hold ${d.expected}`,
    }
    const parts = result.violations.slice(0, max).map((v) => (say[v.rule] ? say[v.rule](v.detail) : v.rule))
    return `[Story consistency check: ${parts.join('; ')}. Correct this in the story without mentioning the check.]`
}

// ---- PDDL ----------------------------------------------------------------------------------------------------------------------
const domainText = () => fs.readFileSync(path.join(DIR, 'shadow_slave.domain.pddl'), 'utf8')
const worldText = () => fs.readFileSync(path.join(DIR, 'shadow_slave.world.pddl'), 'utf8')

function aliases(world) {
    const out = []
    for (const m of world.matchAll(/^;\s*alias\s+([a-z0-9-]+)\s*:\s*(.+)$/gm)) for (const a of m[2].split(',')) if (a.trim()) out.push([lower(a.trim()), m[1]])
    return out.sort((a, b) => b[0].length - a[0].length)
}
function objectFor(text, al, kinds) {
    const t = lower(text)
    for (const [a, obj] of al) {
        if (!kinds.has(obj)) continue
        const i = t.indexOf(a)
        if (i >= 0 && !/[\p{L}\p{N}]/u.test(t[i - 1] ?? '') && !/[\p{L}\p{N}]/u.test(t[i + a.length] ?? '')) return obj
    }
    return null
}
const sexp = (x) => (Array.isArray(x) ? `(${x.map(sexp).join(' ')})` : x)

/** the planning problem of a chat: the world file plus where the player is, their Rank, who they met, who is dead */
function problemFor(store, chatId) {
    const s = store.story(chatId)
    if (!s) return null
    const world = worldText()
    const d = pddl.parseDomain(domainText())
    const w = pddl.parseProblem(world, d)
    const al = aliases(world)
    const of = (type) => new Set(w.objects.filter((o) => o.type === type).map((o) => o.name))
    const places = of('place'), people = of('person'), factions = of('faction')
    const objects = [...w.objects]
    const init = w.init.map((a) => [...a])
    const notes = []
    const st = s.state
    const rank = normalizeRank(st.st_rank)
    if (['aspirant', 'sleeper', 'awakened', 'ascended'].includes(rank)) init.push([rank])
    else if (rank && ['transcendent', 'supreme', 'sacred', 'divine'].includes(rank)) init.push(['ascended'])
    else notes.push(`rank ${st.st_rank ? `"${st.st_rank}" is not one the domain knows` : 'is not set'}`)
    const nightmareWords = /thử thách|ác mộng|nightmare/
    if (rank === 'aspirant' && nightmareWords.test(lower(st.st_date) + ' ' + lower(st.st_place))) init.push(['in-nightmare'])
    if (/kiệt sức|exhausted|kiệt quệ/.test(lower(st.st_condition))) init.push(['exhausted'])
    let here = st.st_place ? objectFor(st.st_place, al, places) : null
    if (!here) {
        here = 'here'
        objects.push({ name: 'here', type: 'place' })
        const realmDream = rank === 'sleeper'
        init.push([realmDream ? 'dream' : 'waking', 'here'], ['safe', 'here'], ['shelter', 'here'])
        const hubs = realmDream ? ['labyrinth', 'dark-city'] : ['outskirts']
        for (const h of hubs) if (places.has(h)) init.push(['connected', 'here', h], ['connected', h, 'here'])
        notes.push(`place "${st.st_place ?? ''}" is not on the map: planned from "here", next to ${hubs.join(', ')}`)
    }
    init.push(['at', here])
    for (const n of s.npcs) {
        const p = objectFor(n.name, al, people)
        if (!p) continue
        if (n.status === 'dead') init.push(['dead', p])
        else if (n.source.includes('relation')) init.push(['met', p])
    }
    const fac = st.st_faction ? objectFor(st.st_faction, al, factions) : null
    if (fac) init.push(['member', fac], ['in-faction'])
    const seen = new Set()
    const uniq = init.filter((a) => { const k = a.join(' '); if (seen.has(k)) return false; seen.add(k); return true })
    const byType = new Map()
    for (const o of objects) { if (!byType.has(o.type)) byType.set(o.type, []); byType.get(o.type).push(o.name) }
    const text = `(define (problem story) (:domain ${d.name})\n  (:objects ${[...byType].map(([t, ns]) => `${ns.join(' ')} - ${t}`).join(' ')})\n  (:init ${uniq.map(sexp).join(' ')})\n  (:goal (and)))\n`
    return { text, here, rank, notes }
}

/** a plan from where the chat's story is to `goal` (PDDL), or why there is none */
function plan(store, chatId, goal, opts = {}) {
    if (typeof goal !== 'string' || !goal.trim().startsWith('(') || goal.length > 2000) return { status: 'error', reason: 'goal must be a PDDL formula, e.g. (awakened) or (and (met nephis) (at bright-castle))' }
    let p
    try {
        p = problemFor(store, chatId)
    } catch (e) {
        return { status: 'error', reason: e.message }
    }
    if (!p) return { status: 'not_found' }
    const r = pddl.solve({ domain: domainText(), problem: p.text, goal, search: opts.search ?? 'bfs', maxExpansions: opts.maxExpansions ?? 100000, timeoutMs: opts.timeoutMs ?? 3000 })
    const base = { chatId, from: { place: p.here, rank: p.rank }, notes: p.notes }
    if (r.ok) return { status: 'ok', ...base, plan: r.plan, expanded: r.expanded }
    if (r.reason === 'parse') return { status: 'error', ...base, reason: r.error }
    return { status: r.reason === 'unsolvable' ? 'impossible' : 'gave_up', ...base, reason: r.reason, expanded: r.expanded }
}

module.exports = { normalizeRank, dateKey, fragments, factsFor, runProlog, check, promptLine, problemFor, plan, findSwipl, DEATH }
