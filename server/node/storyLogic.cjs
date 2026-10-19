'use strict'
// Logic over story.sqlite: Prolog canon checks and PDDL plans, for every story card. Everything here fails soft: no swipl, a timeout,
// a parse error -> {status: 'unavailable' | 'error'}, never an exception into the request, never anything that touches the save.
//
// Which rules and which planning domain apply is the chat's world profile (storyWorlds.cjs), picked from its card: the generic rules
// of story/canon.pl plus the world's story/worlds/<world>.pl, and the world's story/<world>.domain.pddl (+ .world.pddl). A card that
// is none of the known worlds gets the generic profile.
//
// The fact export is the contract with the rules files (their headers list the facts). Dates and ranks are normalized here and in
// the profiles, in code with tests, so the rules compare atoms and numbers only.

const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')
const pddl = require('./story/pddl.cjs')
const { DEATH } = require('./storyStore.cjs')
const worlds = require('./storyWorlds.cjs')

const DIR = path.join(__dirname, 'story')
const lower = (s) => String(s ?? '').normalize('NFC').toLowerCase()
const atom = (s) => "'" + lower(s).replace(/[\r\n\t]+/g, ' ').replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"

// ---- normalizing ---------------------------------------------------------------------------------------------------------------
/** the Shadow Slave Rank of a panel value ("Aspirant (Ứng viên)" -> aspirant); other worlds normalize through their profile */
const normalizeRank = (v) => worlds.shadowSlave.normalizeRank(v)

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

const fragments = worlds.fragments

// ---- world -------------------------------------------------------------------------------------------------------------------
/** the world profile of a chat (storyWorlds.pickProfile over its card name, lore titles and panel keys): {profile, score, why} */
function profileFor(store, chatId) {
    const s = typeof chatId === 'string' ? store.story(chatId) : chatId
    if (!s) return null
    const loreTitles = s.chat.char_id ? store.lore(s.chat.char_id).map((l) => l.title) : []
    return worlds.pickProfile({ name: s.chat.character, loreTitles, keys: Object.keys(s.state) })
}
/** the rules files of a world, in load order: the generic canon, then the world's own */
const rulesFor = (profile) => [path.join(DIR, 'canon.pl'), ...(profile?.rules ?? []).map((f) => path.join(DIR, 'worlds', f))]

// ---- facts -----------------------------------------------------------------------------------------------------------------------
/** the Prolog facts of one chat for its world (canon.pl's and the world file's headers), as text; null when unknown or archived */
function factsFor(store, chatId, profile) {
    const s = store.story(chatId)
    if (!s) return null
    const prof = profile ?? profileFor(store, s).profile
    const hist = store.history(chatId)
    const out = []
    s.timeline.forEach((e) => {
        const k = dateKey(e.at)
        out.push(`event(${e.pos + 1}, ${atom(e.at)}, ${k.day}, ${k.part}, ${atom(e.event)}).`)
        out.push(`event_seen(${e.pos + 1}, ${Number(e.first_rev) || 0}).`)
    })
    prof.ranks.forEach(([id], i) => out.push(`rank_level(${atom(id)}, ${i}).`))
    for (const h of hist) {
        if (h.key !== prof.rankKey) continue
        const from = prof.normalizeRank(h.old_value) ?? prof.emptyRank
        const to = prof.normalizeRank(h.new_value) ?? prof.emptyRank
        if (from && to && from !== to) out.push(`rank_change(${Number(h.rev) || 0}, ${atom(from)}, ${atom(to)}).`)
    }
    for (const n of s.npcs) out.push(`npc(${atom(n.name)}).`)
    for (const g of prof.slotGroups) {
        for (let i = 1; i <= g.n; i++) {
            const v = s.state[g.prefix + i]
            if (worlds.isEmpty(v)) continue
            const name = worlds.nameOf(v)
            if (name) out.push(`slot(${atom(g.group)}, ${i}, ${atom(name)}).`)
        }
    }
    out.push(...prof.facts({ st: s.state, hist, atom, story: s, firstRev: Number(store.chatRow(chatId)?.first_rev) }))
    return out.join('\n') + '\n'
}

// ---- Prolog --------------------------------------------------------------------------------------------------------------------
const SWIPL_CANDIDATES = [process.env.RISU_SWIPL, '/opt/homebrew/bin/swipl', '/usr/local/bin/swipl', '/usr/bin/swipl'].filter(Boolean)
function findSwipl() {
    for (const p of SWIPL_CANDIDATES) { try { fs.accessSync(p, fs.constants.X_OK); return p } catch {} }
    return null
}

/**
 * runs rules over facts with SWI-Prolog; resolves {status: 'ok', violations} | {status: 'unavailable' | 'error', reason}.
 * opts.rules: a rules file or a list (loaded in order); otherwise the generic canon plus opts.world's file ('generic' by default).
 */
function runProlog(factsText, opts = {}) {
    const swipl = opts.swipl === undefined ? findSwipl() : opts.swipl
    if (!swipl) return Promise.resolve({ status: 'unavailable', reason: 'SWI-Prolog (swipl) is not installed' })
    const rules = opts.rules === undefined ? rulesFor(worlds.byId(opts.world ?? 'generic')) : [].concat(opts.rules)
    const timeoutMs = opts.timeoutMs ?? 5000
    return new Promise((resolve) => {
        let out = ''
        let err = ''
        let done = false
        const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r) } }
        let child
        try {
            child = spawn(swipl, ['-q', path.join(DIR, 'runner.pl'), ...rules.flatMap((r) => ['--rules', r]), '--facts', '-', '--timeout', String(Math.max(1, Math.ceil(timeoutMs / 1000)))], { stdio: ['pipe', 'pipe', 'pipe'] })
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
    const s = store.story(chatId)
    if (!s) return { status: 'not_found' }
    const picked = profileFor(store, s)
    const facts = factsFor(store, chatId, picked.profile)
    const r = await runProlog(facts, { rules: rulesFor(picked.profile), ...opts })
    return { ...r, chatId, world: picked.profile.id, world_why: picked.why }
}

// the generic rules, worded with the world's terms (its rank word, its advancement event, its slot labels)
const GENERIC_SAY = {
    rank_without_event: (p, d) => `${p.rankWord} changed ${p.showRank(d.from)} -> ${p.showRank(d.to)} with no ${p.advancement} in the timeline`,
    rank_skipped: (p, d) => `${p.rankWord} jumped ${p.showRank(d.from)} -> ${p.showRank(d.to)}, skipping a step`,
    rank_lowered: (p, d) => `${p.rankWord} fell ${p.showRank(d.from)} -> ${p.showRank(d.to)}`,
    dead_npc_acts: (p, d) => `${d.npc} died (${d.died_at}) but acts later (${d.acts_at})`,
    timeline_backwards: (p, d) => `timeline date "${d.later}" comes before "${d.earlier}"`,
}
function sayOne(p, v) {
    if (GENERIC_SAY[v.rule]) return GENERIC_SAY[v.rule](p, v.detail)
    if (p.say[v.rule]) return p.say[v.rule](v.detail)
    const two = /^(.+)_in_two_slots$/.exec(v.rule)
    if (two) {
        const g = p.slotGroups.find((x) => x.group === two[1])
        const label = g ? g.label : two[1][0].toUpperCase() + two[1].slice(1)
        return `${label} "${v.detail[two[1]]}" is in slots ${v.detail.slot} and ${v.detail.other_slot}`
    }
    return v.rule
}

/** one short line for the prompt, or '' when there is nothing to say; worded for result.world (generic when absent) */
function promptLine(result, max = 3) {
    if (!result || result.status !== 'ok' || !result.violations?.length) return ''
    const p = worlds.byId(result.world ?? 'generic')
    const parts = result.violations.slice(0, max).map((v) => sayOne(p, v))
    return `[Story consistency check: ${parts.join('; ')}. Correct this in the story without mentioning the check.]`
}

// ---- PDDL ----------------------------------------------------------------------------------------------------------------------
const readStory = (f) => fs.readFileSync(path.join(DIR, f), 'utf8')

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

// PDDL words an object must not be named
const RESERVED = new Set(['and', 'not', 'or', 'either', 'object', 'here', 'define', 'domain', 'problem', 'forall', 'exists', 'when'])
/** an object name for a story word: "Thành Phố Bóng Tối" -> thanh-pho-bong-toi */
function slug(name, taken) {
    let b = worlds.fold(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'x'
    if (/^\d/.test(b) || RESERVED.has(b)) b = 'x-' + b
    let n = b
    for (let i = 2; taken.has(n); i++) n = `${b}-${i}`
    taken.add(n)
    return n
}

/**
 * The generic world of a chat no known world fits: its places (the panel's place, where each NPC was last seen, the card's Region
 * lore keys that its timeline uses), all reachable from one another, and its NPCs where they were last seen. Returns the world as
 * {objects, init, aliases} in the shape the known worlds' files parse to.
 */
function genericWorld(store, s) {
    const taken = new Set()
    const places = new Map()   // lower name -> object
    const addPlace = (n) => { const k = lower(n).trim(); if (k && !places.has(k)) places.set(k, slug(n, taken)) }
    if (!worlds.isEmpty(s.state.st_place)) addPlace(s.state.st_place)
    for (const n of s.npcs) if (n.last_seen_place) addPlace(n.last_seen_place)
    const tl = s.timeline.map((e) => lower(e.event)).join('\n')
    for (const r of store.lore(s.chat.char_id).filter((l) => l.canon && /^\s*region/i.test(l.title))) {
        for (const k of String(r.keys).split(',').map((x) => x.trim()).filter((x) => x.length >= 4)) if (tl.includes(lower(k))) addPlace(k)
    }
    const people = new Map()
    for (const n of s.npcs) people.set(lower(n.name), slug(n.name, taken))
    const objects = [...[...places.values()].map((name) => ({ name, type: 'place' })), ...[...people.values()].map((name) => ({ name, type: 'person' }))]
    const init = []
    const ps = [...places.values()]
    for (const a of ps) for (const b of ps) if (a !== b) init.push(['connected', a, b])
    for (const n of s.npcs) if (n.last_seen_place) init.push(['person-at', people.get(lower(n.name)), places.get(lower(n.last_seen_place).trim())])
    const al = [...[...places].map(([k, o]) => [k, o]), ...[...people].map(([k, o]) => [k, o])].sort((a, b) => b[0].length - a[0].length)
    return { objects, init, aliases: al }
}

/** the planning problem of a chat: its world (file or built from the chat) plus where the player is, their rank, who they met, who is dead */
function problemFor(store, chatId) {
    const s = store.story(chatId)
    if (!s) return null
    const prof = profileFor(store, s).profile
    const domainText = readStory(prof.pddl.domain)
    const d = pddl.parseDomain(domainText)
    let w, al
    if (prof.pddl.world) {
        const world = readStory(prof.pddl.world)
        w = pddl.parseProblem(world, d)
        al = aliases(world)
    } else {
        w = genericWorld(store, s)
        al = w.aliases
    }
    const of = (type) => new Set(w.objects.filter((o) => o.type === type).map((o) => o.name))
    const places = of('place'), people = of('person'), factions = of('faction')
    const objects = [...w.objects]
    const init = w.init.map((a) => [...a])
    const notes = []
    const st = s.state
    const rank = prof.normalizeRank(st[prof.rankKey]) ?? prof.emptyRank
    const place = {}
    if (prof.pddl.init) prof.pddl.init({ st, rank, init, notes, place, story: s })
    let here = null
    if (!prof.pddl.noPlace) {
        here = st.st_place ? objectFor(st.st_place, al, places) : null
        if (!here) {
            here = 'here'
            objects.push({ name: 'here', type: 'place' })
            const u = place.unknown ?? { facts: () => [], hubs: [...places] }
            init.push(...u.facts('here'))
            const hubs = u.hubs.filter((h) => places.has(h))
            for (const h of hubs) init.push(['connected', 'here', h], ['connected', h, 'here'])
            notes.push(`place "${st.st_place ?? ''}" is not on the map: planned from "here", next to ${hubs.join(', ') || 'nothing'}`)
        }
        init.push(['at', here])
    }
    for (const n of s.npcs) {
        const p = objectFor(n.name, al, people)
        if (!p) continue
        if (n.status === 'dead') init.push(['dead', p])
        else if (n.source.includes('relation')) init.push(['met', p])
    }
    const fac = st.st_faction && !worlds.isEmpty(st.st_faction) ? objectFor(st.st_faction, al, factions) : null
    if (fac) {
        init.push(['member', fac])
        if (d.predicates.has('in-faction')) init.push(['in-faction'])
    }
    const seen = new Set()
    const uniq = init.filter((a) => { const k = a.join(' '); if (seen.has(k)) return false; seen.add(k); return true })
    const byType = new Map()
    for (const o of objects) { if (!byType.has(o.type)) byType.set(o.type, []); byType.get(o.type).push(o.name) }
    const text = `(define (problem story) (:domain ${d.name})\n  (:objects ${[...byType].map(([t, ns]) => `${ns.join(' ')} - ${t}`).join(' ')})\n  (:init ${uniq.map(sexp).join(' ')})\n  (:goal (and)))\n`
    return { text, domain: domainText, world: prof.id, here, rank, notes, objects: Object.fromEntries(byType) }
}

/** a plan from where the chat's story is to `goal` (PDDL), or why there is none */
function plan(store, chatId, goal, opts = {}) {
    if (typeof goal !== 'string' || !goal.trim().startsWith('(') || goal.length > 2000) return { status: 'error', reason: 'goal must be a PDDL formula, e.g. (awakened), (seq s8), (mid-rank) or (and (met nephis) (at bright-castle))' }
    let p
    try {
        p = problemFor(store, chatId)
    } catch (e) {
        return { status: 'error', reason: e.message }
    }
    if (!p) return { status: 'not_found' }
    const r = pddl.solve({ domain: p.domain, problem: p.text, goal, search: opts.search ?? 'bfs', maxExpansions: opts.maxExpansions ?? 100000, timeoutMs: opts.timeoutMs ?? 3000 })
    const base = { chatId, world: p.world, from: { place: p.here, rank: p.rank }, notes: p.notes, objects: p.objects }
    if (r.ok) return { status: 'ok', ...base, plan: r.plan, expanded: r.expanded }
    if (r.reason === 'parse') return { status: 'error', ...base, reason: r.error }
    return { status: r.reason === 'unsolvable' ? 'impossible' : 'gave_up', ...base, reason: r.reason, expanded: r.expanded }
}

module.exports = { normalizeRank, dateKey, fragments, profileFor, rulesFor, factsFor, runProlog, check, promptLine, problemFor, plan, findSwipl, DEATH }
