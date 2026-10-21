'use strict'
// The Game Master's symbolic turn (asked 2026-10-21: "GM nên có ASP / Clingo để giải quyết ràng buộc, lựa chọn kết quả hợp lệ,
// Datalog suy luận từ dữ kiện, quan hệ, lịch sử … Prolog luật thế giới … PDDL lập kế hoạch nhiều bước cho NPC"). Before each turn's
// narrator request the page posts the chat's state, its last messages and this turn's dice (POST /api/story/decide); here:
//   1. facts: the chat's variables (panel, ledger, the GM's notes) and the last 4 messages, read here word by word (a need said,
//      negated or met; a name; a death in the timeline, by the canon rules' death words) into Datalog facts;
//   2. Datalog (story/gm/derive.lp, evaluated by clingo in the same run): the character's established needs, who is in the scene,
//      which threads can still move;
//   3. ASP (clingo, story/gm/core.lp + story/gm/<world>.lp): ONE turn event and one intent for each person in the scene, under hard
//      constraints (an offer or a lure only targets an established need; nobody acts where they are not or after death; no new event
//      two turns running; the dice's pace) and weak ones (the card's NEW, the arc's threads, the dice's focus);
//   4. PDDL (story/npc.domain.pddl): an absent enemy whose move is due gets a plan to reach the player, and this turn is its first step;
//   5. one or two lines for the GM note (gameMaster.ts gmNote), which hands the narrator that decision instead of open rules.
// Why: measured 2026-10-21 (Shadow Slave chat ee04f566), a stranger offered water to a character nobody had shown thirsty; the
// prompt rules that followed (NEED_RULE) only ask. Everything here fails soft and fast: no clingo, a slow turn (the budget
// is 300 ms) or a parse error -> {status: 'unavailable' | 'timeout' | 'error'} and the page keeps today's note.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const L = require('./storyLogic.cjs')
const pddl = require('./story/pddl.cjs')
const { ledger, deriveNpcs, deathsIn, wordAt } = require('./storyStore.cjs')

const GM_DIR = path.join(L.DIR, 'gm')
const BUDGET_MS = 300
/** the librarian's rules over its knowledge graph (storyGraph.cjs), loaded beside ours when the chat has a graph */
const GRAPH_LP = path.join(GM_DIR, 'graph.lp')
/** the GM's worlds (gameMaster.ts gmWorld) and their ASP file */
const WORLD_LP = { shadow_slave: 'shadow_slave.lp', lotm: 'lotm.lp', mailman: 'mailman.lp', zombie: 'zombie.lp', generic: 'generic.lp' }

const CLINGO_CANDIDATES = [process.env.RISU_CLINGO_PYTHON, path.join(os.homedir(), '.risu-lan/clingo-venv/bin/python')].filter(Boolean)
function findClingo() {
    for (const p of CLINGO_CANDIDATES) { try { fs.accessSync(p, fs.constants.X_OK); return p } catch {} }
    return null
}

const lower = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
const lines = (v) => String(v ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
const head = (l) => String(l ?? '').split('|')[0].trim()
const isDash = (v) => /^(-|—|none|null)?$/i.test(String(v ?? '').trim())
/** an ASP string */
const str = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"'
const LANDED = /^(done|paid|landed|given|received|happened|resolved|xong|rồi|đã\s)/i
const due = (v) => lines(v).filter((l) => { const w = l.split('|').slice(1).map((x) => x.trim()).filter(Boolean); return !(w.length && LANDED.test(w.at(-1))) })
/** a message as the rules read it: no [[blocks]], no markup, the end kept */
const plain = (t, n = 1500) => { const s = lower(String(t ?? '').replace(/\[\[[A-Z_]+[\s\S]*?(\]\]|$)/g, ' ').replace(/<[^>]+>/g, ' ').replace(/[*_#>`]/g, ' ')); return s.length > n ? s.slice(-n) : s }
const PANEL_NEED_KEY = /^st_(condition|health|hp|body|wounds?|status|state|injur|infection)/

/** the GM's open threads: [{id, kind, text, name}] (ids are ASP atoms) */
function threadsOf(v) {
    const out = []
    const arc = String(v.gm_arc ?? '').split('|').map((x) => x.trim())
    if (arc[1]) out.push({ id: 'antagonist', kind: 'antagonist', text: arc[1], name: arc[1] })
    if (arc[2]) out.push({ id: 'goal', kind: 'goal', text: arc[2], name: arc[2] })
    lines(v.gm_threats).forEach((t, i) => out.push({ id: `threat${i + 1}`, kind: 'threat', text: t, name: head(t) }))
    lines(v.gm_enemies).forEach((t, i) => out.push({ id: `enemy${i + 1}`, kind: 'enemy', text: t, name: head(t) }))
    if (!isDash(head(v.gm_path))) out.push({ id: 'side', kind: 'side', text: v.gm_path, name: head(v.gm_path) })
    return out
}

/** the thread the app's dice put in focus (gameMaster.ts rollGm's surface) */
function focusOf(surface, threads) {
    const s = String(surface ?? '')
    if (/^the antagonist/.test(s)) return 'antagonist'
    if (/^the goal/.test(s)) return 'goal'
    if (/^the (path|side) \(/.test(s)) return threads.some((t) => t.id === 'side') ? 'side' : null
    const q = /^the (threat|enemy) "(.*)"$/.exec(s)
    if (q) return threads.find((t) => t.kind === q[1] && lower(t.name) === lower(q[2]))?.id ?? null
    return null
}

/** where the player is, for a world whose Kind lists depend on it */
function whereOf(world, v) {
    if (world === 'mailman') return isDash(v.st_world) || /thực tại|hiện thực|reality|trái đất|trung quốc|china/i.test(v.st_world) ? 'reality' : 'world'
    if (world === 'zombie') return /chung cư|căn hộ|căn \d|tầng|nhà|căn cứ|base|apartment|home/i.test(v.st_place ?? '') ? 'base' : 'city'
    return null
}

// ---- reading the words (the Datalog's facts; its rules are story/gm/derive.lp) -------------------------------------------------
/** the words that say the character has a need, in the cards' two languages */
const NEEDS = {
    thirst: ['khát', 'khô họng', 'khô cổ', 'cổ họng khô', 'tìm nước', 'mất nước', 'thirst', 'thirsty', 'parched', 'dehydrated'],
    hunger: ['đói', 'bụng réo', 'chưa ăn gì', 'tìm đồ ăn', 'tìm thức ăn', 'hunger', 'hungry', 'starving'],
    wound: ['bị thương', 'vết thương', 'chảy máu', 'bị cào', 'vết cào', 'gãy tay', 'gãy chân', 'gãy xương', 'bầm tím', 'wound', 'wounded', 'injured', 'injury', 'bleeding'],
    exhausted: ['kiệt sức', 'mệt', 'mệt lả', 'exhausted', 'tired'],
    cold: ['lạnh cóng', 'rét run', 'run vì lạnh', 'freezing'],
    sick: ['sốt', 'ốm', 'bệnh', 'fever', 'sick'],
    lost: ['lạc đường', 'lạc lối', 'không biết đường', 'lost my way', 'got lost'],
    money: ['hết tiền', 'không có tiền', 'túng tiền', 'cần tiền', 'broke', 'penniless'],
    shelter: ['không có chỗ ngủ', 'tìm chỗ trú', 'vô gia cư', 'nowhere to sleep', 'homeless'],
}
/** a longer word that holds a need word and is not that need ("khát vọng" is a hope, "bệnh viện" a hospital) */
const NOT_NEED = ['khát vọng', 'khát khao', 'khát máu', 'bệnh viện', 'bệnh nhân', 'sốt ruột', 'sốt sắng']
/** a word just before the need that says it is not there */
const NEGATION = ['không', 'chẳng', 'chưa', 'hết', 'đỡ', 'không còn', 'not', 'no longer', 'never']
/** a later message that says the need was met */
const MET = { thirst: ['uống', 'drank', 'drinks'], hunger: ['ăn no', 'đã ăn', 'ate'], wound: ['băng bó', 'băng lại', 'bandaged', 'lành'], exhausted: ['ngủ một giấc', 'nghỉ ngơi', 'rested'] }

/** the needs a text says the character has (un-negated, not inside a longer word that means something else) */
function needsIn(t) {
    const out = new Set()
    for (const [need, words] of Object.entries(NEEDS)) {
        for (const w of words) {
            for (const at of wordAt(t, w)) {
                if (NOT_NEED.some((x) => { const i = x.indexOf(w); return i >= 0 && t.slice(at - i, at - i + x.length) === x })) continue
                if (NEGATION.some((n) => t.slice(Math.max(0, at - n.length - 1), at) === n + ' ')) continue
                out.add(need)
            }
        }
    }
    return out
}
const metIn = (t, need) => (MET[need] ?? []).some((w) => wordAt(t, w).length > 0) && !needsIn(t).has(need)

/**
 * The facts of a turn for story/gm/derive.lp (the words read here: needs, names, deaths), and what they were built from.
 * The deaths are the story index's own (storyStore.cjs deathsIn over the timeline, the canon rules' death words).
 */
function featureFacts(input, places = []) {
    const v = input.vars ?? {}
    const out = []
    const led = ledger(v)
    const threads = threadsOf(v)
    const persons = new Map()
    for (const n of deriveNpcs(v, led, [...places, v.st_place].filter(Boolean))) persons.set(lower(n.name), n)
    for (const t of threads) if (['antagonist', 'threat', 'enemy'].includes(t.kind) && lower(t.name).length >= 2 && !persons.has(lower(t.name))) persons.set(lower(t.name), { name: t.name })
    for (const m of [v.st_name, v.st_truename].filter((x) => !isDash(x)).map(lower)) persons.delete(m)
    const keys = [...persons.keys()]
    const dead = new Set()
    for (const e of led.timeline) for (const d of deathsIn(e.event, keys)) dead.add(d)
    const msgs = (input.messages ?? []).slice(-4).reverse().map((m) => plain(m.text))
    const here = lower(v.st_place)
    for (const [k, n] of persons) {
        out.push(`person(${str(k)}).`)
        if (dead.has(k) || n.status === 'dead') out.push(`dead(${str(k)}).`)
        if (here && n.last_seen_place && lower(n.last_seen_place) === here) out.push(`seen_here(${str(k)}).`)
        msgs.forEach((t, i) => { if (wordAt(t, k).length) out.push(`named(${str(k)}, ${i}).`) })
    }
    for (const [k, x] of Object.entries(v)) if (PANEL_NEED_KEY.test(k) && !isDash(x)) for (const n of needsIn(plain(x, 400))) out.push(`panel_need(${n}).`)
    msgs.forEach((t, i) => {
        for (const n of needsIn(t)) out.push(`said_need(${n}, ${i}).`)
        for (const n of Object.keys(MET)) if (metIn(t, n)) out.push(`resolved(${n}, ${i}).`)
    })
    for (const t of threads) for (const k of keys) if (wordAt(lower(t.text), k).length) out.push(`actor(${t.id}, ${str(k)}).`)
    return { text: [...new Set(out)].join('\n') + '\n', threads, names: Object.fromEntries([...persons].map(([k, n]) => [k, n.name])), timeline: led.timeline.length }
}

/** The ASP facts of a turn: the dice, the GM's machine (scene, combat) and the threads. */
function aspFacts(input, threads, extra = {}) {
    const dice = input.dice ?? {}
    const v = input.vars ?? {}
    const out = [`phase(${input.phase === 'seed' ? 'seed' : 'run'}).`]
    if (['quiet', 'build', 'advance', 'escalate'].includes(dice.pace)) out.push(`pace(${dice.pace}).`)
    if (dice.cardNew) out.push('card_new.')
    if (input.prevNew) out.push('prev_new.')
    const costs = due(v.gm_consequences_due)
    costs.forEach((c, i) => out.push(`due(cons${i + 1}).`))
    if (dice.consequence && costs.length) out.push('consequence_roll.')
    if (dice.firstOrder) out.push('first_order.')
    if (['fight', 'aftermath', 'peace'].includes(input.mode?.combat)) out.push(`combat(${input.mode.combat}).`)
    if (['still', 'travel', 'rest'].includes(input.mode?.scene)) out.push(`scene(${input.mode.scene}).`)
    for (const t of threads) {
        out.push(`thread(${t.id}, ${t.kind}).`)
        if (['antagonist', 'goal', 'threat'].includes(t.kind)) out.push(`arc(${t.id}).`)
        if (t.kind === 'side') out.push(`side(${t.id}).`)
        if (['antagonist', 'threat', 'enemy'].includes(t.kind)) out.push(`hostile_thread(${t.id}).`)
    }
    const focus = focusOf(dice.surface, threads)
    if (focus) out.push(`focus(${focus}).`)
    if (/^the side \(/.test(String(dice.surface ?? '')) && threads.some((t) => t.id === 'side')) out.push('side_focus(side).')
    for (const k of input.kinds ?? []) out.push(`rolled_text(${str(lower(k).replace(/[.\s]+$/, ''))}).`)
    const stance = STANCE[lower(input.stance)]
    if (stance) out.push(`stance(${stance}).`)
    if (extra.timeline > 0 || lines(v.gm_past).length || costs.length) out.push('done_before.')
    const where = whereOf(input.world, v)
    if (where) out.push(`where(${where}).`)
    return out.join('\n') + '\n'
}
const STANCE = { hostile: 'hostile', wary: 'wary', indifferent: 'indifferent', 'needs help': 'needs_help', 'wants to use the character': 'wants_to_use', friendly: 'friendly', 'hiding something': 'hiding', frightened: 'frightened' }

// ---- clingo ---------------------------------------------------------------------------------------------------------------------------
/** a clingo symbol as text -> {name, args} | string | number */
function parseTerm(s) {
    let i = 0
    function term() {
        if (s[i] === '"') {
            let out = ''
            for (i++; i < s.length && s[i] !== '"'; i++) out += s[i] === '\\' ? s[++i] : s[i]
            i++
            return out
        }
        let name = ''
        while (i < s.length && /[A-Za-z0-9_\-]/.test(s[i])) name += s[i++]
        if (s[i] !== '(') return /^-?\d+$/.test(name) ? Number(name) : { name, args: [] }
        i++
        const args = []
        while (s[i] !== ')') { args.push(term()); if (s[i] === ',') i++ }
        i++
        return { name, args }
    }
    return term()
}

/** runs clingo over the program files and the facts; resolves {status: 'ok', atoms, optimal} | {status, reason} */
function runClingo(files, factsText, opts = {}) {
    const py = opts.python === undefined ? findClingo() : opts.python
    if (!py) return Promise.resolve({ status: 'unavailable', reason: 'clingo is not installed (python -m venv ~/.risu-lan/clingo-venv && pip install clingo)' })
    const timeoutMs = opts.timeoutMs ?? 2000
    return new Promise((resolve) => {
        let out = '', err = '', done = false
        const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r) } }
        let child
        try {
            child = spawn(py, ['-I', '-m', 'clingo', ...files, '-', '--outf=2', '-W', 'none', '--opt-mode=opt'], { stdio: ['pipe', 'pipe', 'pipe'] })
        } catch (e) {
            return finish({ status: 'unavailable', reason: e.message })
        }
        const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} finish({ status: 'timeout', reason: 'clingo timeout' }) }, timeoutMs)
        child.on('error', (e) => finish({ status: 'unavailable', reason: e.message }))
        child.stdout.on('data', (d) => { out += d })
        child.stderr.on('data', (d) => { err += d })
        child.on('close', () => {
            try {
                const j = JSON.parse(out)
                const w = j.Call?.at(-1)?.Witnesses?.at(-1)
                if (!w) return finish({ status: 'unsat', reason: j.Result })
                finish({ status: 'ok', atoms: w.Value.map(parseTerm), optimal: j.Result === 'OPTIMUM FOUND', costs: w.Costs ?? [] })
            } catch {
                finish({ status: 'error', reason: (err || out || 'no output').trim().slice(0, 300) })
            }
        })
        child.stdin.on('error', () => {})
        child.stdin.end(factsText)
    })
}

/** the answer set as a decision */
function decisionOf(atoms) {
    const d = { turn: null, acts: [], onstage: [], offstage: [], approach: [], intents: [], needs: [], present: [], dead: [], hostile: [], knowsHere: [] }
    for (const a of atoms) {
        if (a.name === 'turn') d.turn = a.args[0]
        else if (a.name === 'need') d.needs.push(a.args[0].name)
        else if (a.name === 'present') d.present.push(a.args[0])
        else if (a.name === 'dead') d.dead.push(a.args[0])
        else if (a.name === 'hostile') d.hostile.push(a.args[0])
        else if (a.name === 'acts') d.acts.push(a.args[1])
        else if (a.name === 'onstage') d.onstage.push(a.args[0])
        else if (a.name === 'offstage') d.offstage.push(a.args[0])
        else if (a.name === 'approach') d.approach.push(a.args[0])
        else if (a.name === 'intent') {
            const arg = a.args[1].args[0]
            const tell = a.args[1].name === 'tell'
            d.intents.push({ who: typeof a.args[0] === 'string' ? a.args[0] : a.args[0].name, what: a.args[1].name, need: tell ? null : arg?.name ?? null, fact: tell ? String(typeof arg === 'object' ? arg.name : arg) : null })
        } else if (a.name === 'knows_here') d.knowsHere.push({ who: a.args[0], fact: String(typeof a.args[1] === 'object' ? a.args[1].name : a.args[1]), as: a.args[2]?.name })
    }
    d.needs.sort(); d.present.sort(); d.dead.sort()
    d.intents.sort((x, y) => (x.who === 'newcomer') - (y.who === 'newcomer') || x.who.localeCompare(y.who))
    return d
}

/** The event is a new one (the pace clock and the card's "never two in a row" count it). */
const isNewEvent = (turn) => !!turn && ['advance', 'escalate', 'new', 'order'].includes(turn.name)

// ---- PDDL: an absent enemy's approach ----------------------------------------------------------------------------------------------
const NPC_DOMAIN = () => fs.readFileSync(path.join(L.DIR, 'npc.domain.pddl'), 'utf8')

/** The steps an absent person takes to reach the player: the world's place graph from the story index when the chat is there, else
 *  two places (theirs and the player's). [] when there is no way, null when nothing is known of where they are. */
function approachPlan(store, chatId, who, input) {
    const v = input.vars ?? {}
    const npc = deriveNpcs(v, ledger(v), [v.st_place].filter(Boolean)).find((n) => lower(n.name) === lower(who))
    let places = [], connected = [], here = null, there = null
    let p = null
    try { p = store && chatId && store.story(chatId) ? L.problemFor(store, chatId) : null } catch { p = null }
    if (p && p.init && p.objects?.place?.length) {
        places = [...p.objects.place]
        connected = p.init.filter((a) => a[0] === 'connected').map((a) => [a[1], a[2]])
        here = p.here
        const al = p.aliases ?? []
        const kinds = new Set(places)
        if (npc?.last_seen_place) there = L.objectFor(npc.last_seen_place, al, kinds)
    }
    if (!here || !there) {
        // the chat's own two places: theirs (or "away") and the player's
        places = ['away', 'here']
        connected = [['away', 'here'], ['here', 'away']]
        here = 'here'
        there = 'away'
    }
    if (there === here) return { steps: [], from: there }
    const person = 'npc'
    const init = [...connected.map(([a, b]) => `(connected ${a} ${b})`), `(person-at ${person} ${there})`, `(player-at ${here})`]
    const problem = `(define (problem approach) (:domain npc-moves)\n  (:objects ${places.join(' ')} - place ${person} - person)\n  (:init ${init.join(' ')})\n  (:goal (near ${person})))\n`
    const r = pddl.solve({ domain: NPC_DOMAIN(), problem, goal: `(near ${person})`, search: 'bfs', maxExpansions: 5000, timeoutMs: 50 })
    if (!r.ok) return null
    const name = (o) => (o === 'away' ? 'where they are' : o === 'here' ? "the player's place" : o.replace(/-/g, ' '))
    return { from: name(there), steps: r.plan.map((s) => { const t = s.replace(/[()]/g, '').split(/\s+/); return t[0] === 'move' ? name(t[3]) : 'face to face' }) }
}

// ---- the line -----------------------------------------------------------------------------------------------------------------------
const q = (s) => `“${String(s).slice(0, 120)}”`
const NEED_WORD = { thirst: 'thirst', hunger: 'hunger', wound: 'a wound', exhausted: 'exhaustion', cold: 'cold', sick: 'sickness', lost: 'being lost', money: 'no money', shelter: 'no shelter' }
const INTENT = {
    oppose: 'opposes the player',
    own: 'goes about their own business (no offer)',
    watch: 'watches and keeps their distance',
    help: 'is willing to help, without being asked to bargain',
    ask_help: 'needs help for their own trouble',
}
function intentText(i, ctx = {}) {
    if (i.what === 'tell') {
        const f = ctx.told?.get(i.fact)
        const as = ctx.knowsHere?.find((k) => k.who === i.who && k.fact === i.fact)?.as
        const hearsay = as === 'rumor' || f?.status === 'rumor'
        return `may tell the player what they know: ${f ? q(f.text) : 'something they know'}${hearsay ? ' (only as hearsay, a rumour they heard: never as a fact)' : ''}`
    }
    if (i.what === 'offer') return `offers help with the character's ${NEED_WORD[i.need] ?? i.need} (stated already)`
    if (i.what === 'lure') return `baits the character with their ${NEED_WORD[i.need] ?? i.need} (stated already), for their own ends`
    return INTENT[i.what] ?? i.what
}

/** The decision in one or two lines for the GM note ('' when there is nothing to say). */
function lineOf(dec, ctx) {
    const { threads, kindText, stance, needs, prevNew, plans, phase } = ctx
    const shown = (p) => q(ctx.names?.[p] ?? p)
    const tname = (id) => { const t = threads.find((x) => x.id === id); return t ? (t.kind === 'goal' ? 'the goal' : t.kind === 'side' ? `the side ${q(t.name)}` : q(t.name)) : id }
    const t = dec.turn
    const who = dec.acts[0]
    const off = !!who && !dec.onstage.includes(who)
    const road = off && plans[who]?.steps?.length ? ` (their road: ${[plans[who].from, ...plans[who].steps].join(' → ')}; this turn only the first step)` : ''
    const away = off ? `; ${shown(who)} is not here: only a sign, news or their approach shows, they do not appear${road}` : ''
    const th = (x) => tname(x.args[0].name)
    let ev = ''
    if (!t || t.name === 'seed') ev = ''
    else if (t.name === 'quiet') ev = `QUIET: no new trouble, the player's choice plays out${prevNew ? ' (the last reply already brought something new)' : ''}.`
    else if (t.name === 'build') ev = `BUILD: no new event; ${th(t)} creeps closer, a sign at most${away}.${prevNew ? ' The last reply already brought something new.' : ''}`
    else if (t.name === 'advance') ev = off ? `ADVANCE off-stage: ${th(t)} makes the next move away from the scene${away}.` : `ADVANCE: ${th(t)} makes the next move here, with a clear challenge.`
    else if (t.name === 'escalate') ev = off ? `ESCALATE off-stage: ${th(t)} raises the stakes away from the scene${away}.` : `ESCALATE: ${th(t)} hits here and the stakes rise.`
    else if (t.name === 'order') ev = `the side's first order or test comes due now.`
    else if (t.name === 'land') ev = `a due consequence lands now: ${q(head(due(ctx.vars.gm_consequences_due)[Number(t.args[0].name.replace(/\D/g, '')) - 1] ?? ''))}; no other new trouble.`
    else if (t.name === 'new') ev = `at the next natural pause something new surfaces: ${kindText ?? t.args[0].name}${stance ? `, ${stance}` : ''} (the card's die), a hook in the prose, this reply's one new trouble.`
    const people = dec.intents.map((i) => `${i.who === 'newcomer' ? 'the newcomer' : shown(i.who)} ${intentText(i, { told: ctx.told, knowsHere: dec.knowsHere })}`)
    const need = needs.length
        ? `The character's stated needs: ${needs.map((n) => NEED_WORD[n] ?? n).join(', ')}; an offer, bait or bargain may only target these.`
        : 'The character has stated no need (no thirst, hunger, wound, being lost): nobody offers water, food, care or a way, and nobody bargains with one.'
    const first = ev ? `This turn (decided, follow it): ${ev}` : ''
    const second = [people.length ? `People in the scene: ${people.join('; ')}.` : '', need].filter(Boolean).join(' ')
    if (phase === 'seed') return second
    return [first, second].filter(Boolean).join('\n')
}

/** The graph's ASP facts for a chat and each fact's text ({text, texts: Map fid -> {text, status}}), or null when it has none. */
function graphFacts(graph, chatId, story, ids) {
    try {
        const text = graph.aspFacts(chatId, story, { ids })
        if (!/\bfact\(/.test(text)) return null
        const texts = new Map()
        const world = graph.chatWorld(chatId)
        if (world) for (const f of graph.factsAbout(world, chatId, [...ids, 'player'], story?.chat?.messages ?? 0)) texts.set(String(f.fid), { text: f.text, status: f.status })
        return { text, texts }
    } catch {
        return null
    }
}

/**
 * The turn's decision. input = {chatId, world, phase, vars, messages: [{role, text}], dice: {pace, surface, consequence, cardNew,
 * firstOrder}, prevNew, kinds: [rolled Kind texts], stance}. Resolves {status: 'ok', decision, line, newEvent, ms} or
 * {status: 'unavailable' | 'timeout' | 'error' | 'unsat', reason, ms}.
 */
async function decide(input, opts = {}) {
    const t0 = Date.now()
    const budget = opts.budgetMs ?? BUDGET_MS
    const left = () => budget - (Date.now() - t0)
    const fail = (r) => ({ ...r, ms: Date.now() - t0 })
    const world = WORLD_LP[input?.world] ? input.world : 'generic'
    const inp = { ...input, world }
    const store = opts.store ?? null
    let places = []
    let s = null
    try {
        s = store && /^[A-Za-z0-9-]{1,80}$/.test(String(input?.chatId ?? '')) ? store.story(input.chatId) : null
        if (s?.chat?.char_id) places = store.lore(s.chat.char_id).filter((l) => l.canon && /^\s*region/i.test(l.title)).flatMap((l) => String(l.keys).split(',').map((k) => k.trim()).filter((k) => k.length >= 4))
    } catch { places = [] }
    const ff = featureFacts(inp, places)
    // the librarian's knowledge graph (storyGraph.cjs): the facts touching the people of this chat, and who knows them
    const g = s && opts.graph ? graphFacts(opts.graph, input.chatId, s, Object.keys(ff.names)) : null
    const facts = ff.text + aspFacts(inp, ff.threads, { timeline: ff.timeline }) + (g ? g.text + '\n' : '')
    const files = [path.join(GM_DIR, 'derive.lp'), ...(g ? [GRAPH_LP] : []), path.join(GM_DIR, 'core.lp'), path.join(GM_DIR, WORLD_LP[world])]
    const cr = await runClingo(files, facts, { timeoutMs: Math.max(10, left()), python: opts.python })
    if (cr.status !== 'ok') return fail({ status: cr.status, reason: `clingo: ${cr.reason}` })
    const decision = decisionOf(cr.atoms)
    const plans = {}
    for (const who of decision.approach) {
        try { const pl = approachPlan(store, input.chatId, who, inp); if (pl) plans[who] = pl } catch {}
    }
    const kindAtom = decision.turn?.name === 'new' ? decision.turn.args[0].name : null
    const kindText = kindAtom ? kindTextOf(world, kindAtom) : null
    const stance = decision.intents.some((i) => i.who === 'newcomer') && STANCE[lower(input.stance)] ? lower(input.stance) : null
    const line = lineOf(decision, { threads: ff.threads, kindText, stance, needs: decision.needs, prevNew: !!input.prevNew, plans, phase: inp.phase, vars: inp.vars ?? {}, names: ff.names, told: g?.texts ?? new Map() })
    return { status: 'ok', world, decision, needs: decision.needs, present: decision.present, dead: decision.dead, plans, newEvent: isNewEvent(decision.turn), line, optimal: cr.optimal, ms: Date.now() - t0, facts: opts.withFacts ? facts : undefined }
}

const kindTexts = new Map()
function kindTextOf(world, atom) {
    if (!kindTexts.has(world)) {
        const m = new Map()
        try { for (const x of fs.readFileSync(path.join(GM_DIR, WORLD_LP[world]), 'utf8').matchAll(/kind_text\((\w+),\s*"([^"]*)"\)/g)) m.set(x[1], x[2]) } catch {}
        kindTexts.set(world, m)
    }
    return kindTexts.get(world).get(atom) ?? null
}

/** one solve at server start, so the first turn does not pay for cold files */
function warm() {
    return decide({ world: 'generic', phase: 'run', vars: {}, messages: [{ role: 'user', text: 'warm' }], dice: { pace: 'quiet' } }, { budgetMs: 5000 }).catch(() => null)
}

module.exports = { decide, warm, featureFacts, needsIn, aspFacts, runClingo, findClingo, parseTerm, decisionOf, lineOf, approachPlan, threadsOf, focusOf, whereOf, isNewEvent, graphFacts, BUDGET_MS, WORLD_LP, GM_DIR, GRAPH_LP }
