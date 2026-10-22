'use strict'
// NPC psychology for the Game Master: who each person in the scene is (Big Five, how they speak, what they hide), how they see the
// player and each other (trust, affection, debt, grudge), what they feel after what just happened, and the one line the narrator reads
// about it (the "Subtext" line: abstract volitions, never the words of a secret). Lives in story.sqlite next to storyStore and the
// graph (same db handle), seeded per card from story/npcs/<world>.json (drafted from the lore graph by build/merge.cjs, checked
// against story/schema/npc-profile.schema.json).
//
// Two paths, one switch (appraise()):
//   A. the FAtiMA sidecar (server/sidecar/fatima, reached through opts.fatima = fatimaClient): OCC emotions and mood from the
//      toolkit's appraisal, over the same table;
//   B. appraiseLocal(): a pure JS fold of the same table (story/npcs/appraisal.json). Always present; answers when the sidecar is off,
//      not ready, slower than the budget, errs, or answers something that fails the shape check.
// Both return {npcs: [{id, rel: {q: {trust, affection, debt, grudge}}, emotions: [{type, intensity, target, sinceTurn}], mood, si}],
// source: 'fatima' | 'asp', ms}; story/gm/npc.lp decides from the atoms aspFacts() writes. clingo stays the one decision layer.
//
// The numbers are a FOLD of the chat's social ledger ($led_soc: "n | who | tag | whom", written by the bookkeeper), never incremented in
// place, so a reroll (the ledger lines go with the reply) or a second bookkeeper run (deduped on n, who, tag, whom) cannot count an
// act twice. The tables here are derived (rebuilt by syncChat) or per-turn records (npc_state, upserted): losing a write costs nothing.
//
// An act moves how the one acted upon sees the actor: rel(whom -> who). The deltas are modulated by the TARGET's Big Five (grudge
// grows faster in a disagreeable person, trust falls faster in a neurotic one, ...); see appraisal.json. Neutral traits are all 50,
// which is exactly the unmodulated table.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { validate } = require('./jsonSchemaLite.cjs')
const { worldOf, relOf } = require('./storyGraph.cjs')
const { wordAt } = require('./storyStore.cjs')

const NPC_DIR = path.join(__dirname, 'story', 'npcs')
const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, 'story', 'schema', 'npc-profile.schema.json'), 'utf8'))
const APPRAISAL = JSON.parse(fs.readFileSync(path.join(NPC_DIR, 'appraisal.json'), 'utf8'))

const PLAYER = 'player'
const DIMS = APPRAISAL.dims
const TAGS = Object.keys(APPRAISAL.tags)
const EMOTION_OF_TAG = Object.fromEntries(TAGS.map((t) => [t, APPRAISAL.tags[t].emotion]))
const EMOTIONS = ['joy', 'distress', 'hope', 'fear', 'pride', 'shame', 'admiration', 'reproach', 'gratitude', 'anger', 'gratification', 'remorse', 'love', 'hate']
const POSITIVE = new Set(['joy', 'hope', 'pride', 'admiration', 'gratitude', 'gratification', 'love'])
const TRAIT_KEYS = ['open', 'consc', 'extra', 'agree', 'neuro']
const ENGINES = ['auto', 'fatima', 'asp']
const WINDOW = 120            // ledger lines read (the page keeps the same many)
const RECENT_TURNS = 3        // recent/3 atoms: acts of the last 3 turns
const MAX_PRESENT = 6         // profiled people in one turn (grounding budget: 6 x 7 others x 4 dims)
const MAX_EMOTION_ATOMS = 20
const FATIMA_BUDGET_MS = 110  // the sidecar's deadline inside decide's 300 ms
const SUBTEXT_MAX = { npcs: 4, perNpc: 110, total: 520 }
/** how a ledger tag is written in Vietnamese (the bookkeeper may write the gloss): the words of appraisal.json */
const TAG_OF_WORD = new Map(TAGS.flatMap((t) => [[t, t], ...(APPRAISAL.tags[t].vi ?? []).map((w) => [w.normalize('NFC').toLowerCase(), t])]))

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16)
const lower = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
const str = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"'
const clamp = (x, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x))
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
const ms2 = (t0) => Math.round((performance.now() - t0) * 100) / 100
/** a trait object with the missing ones at 50 (neutral: every modulator is then 1) */
const traitsOf = (t) => Object.fromEntries(TRAIT_KEYS.map((k) => [k, num(t?.[k]) ?? 50]))

// ---- the table -----------------------------------------------------------------------------------------------------------------------
/** the factor on one delta by the TARGET's traits; only the direction the plan names is modulated, the other is as written */
function modOf(dim, delta, tr) {
    if (dim === 'grudge' && delta > 0) return 1.5 - tr.agree / 100
    if (dim === 'trust' && delta < 0) return 0.5 + tr.neuro / 100
    if (dim === 'affection' && delta > 0) return 0.5 + tr.extra / 100
    if (dim === 'debt' && delta > 0) return 0.6 + (tr.consc / 100) * 0.8
    return 1
}
/** clamp after each event, then Math.round (half up; a port must not round half to even: server/node/story/npcs/build/golden.json has a .5 case) */
const step = (v, d, m) => Math.round(clamp(v + d * m, 0, 100))

/**
 * Pure. seedRows: [{p, q, trust, affection, debt, grudge}] (p's view of q); events: [{who, tag, target}] in ledger order; profiles:
 * {id: traits} (an id without traits is neutral, 50 each). A pair no seed names starts at the table's default_seed. Returns
 * {p: {q: {trust, affection, debt, grudge}}}. An event (who, tag, target) moves rel(target -> who) by the tag's deltas, and
 * rel(who -> target).trust by mutual_trust; an unknown tag, an empty name or who === target is skipped.
 */
function foldRelations(seedRows, events, profiles = {}) {
    const rel = {}
    const cell = (p, q) => ((rel[p] ??= {})[q] ??= { ...APPRAISAL.default_seed })
    for (const r of seedRows ?? []) {
        if (!r || !r.p || !r.q || r.p === r.q) continue
        const c = cell(r.p, r.q)
        for (const d of DIMS) c[d] = clamp(Math.round(num(r[d]) ?? APPRAISAL.default_seed[d]), 0, 100)
    }
    for (const ev of events ?? []) {
        const t = APPRAISAL.tags[ev?.tag]
        if (!t || !ev.who || !ev.target || ev.who === ev.target) continue
        const tr = traitsOf(profiles[ev.target])
        const c = cell(ev.target, ev.who)
        for (const d of DIMS) c[d] = step(c[d], t[d], modOf(d, t[d], tr))
        if (t.mutual_trust) { const m = cell(ev.who, ev.target); m.trust = step(m.trust, t.mutual_trust, 1) }
    }
    return rel
}

/**
 * Pure. What each person feels `now` after the acts done to them: an act at turn k gives its tag's emotion at its base intensity,
 * halved each later turn (a neurotic person, neuro >= 60, keeps 0.7 of it), the same emotion about the same person adding up, gone
 * under 2: two to four turns of after-effect. mood = (positive - negative intensities) / 2 clamped to -10..10. Acts after `now`
 * (a turn a reroll took back) do not count. Returns {id: {mood, emotions: [{type, intensity, target, sinceTurn}]}}.
 */
function emotionsLocal(events, now, profiles = {}) {
    const acc = new Map()       // id -> Map('type|actor' -> {type, target, sum, since})
    for (const ev of events ?? []) {
        const t = APPRAISAL.tags[ev?.tag]
        const k = Number(ev?.turn)
        if (!t || !ev.who || !ev.target || ev.who === ev.target || !Number.isFinite(k) || k > now) continue
        const decay = traitsOf(profiles[ev.target]).neuro >= 60 ? 0.7 : 0.5
        const m = acc.get(ev.target) ?? new Map()
        acc.set(ev.target, m)
        const key = `${t.emotion}|${ev.who}`
        const e = m.get(key) ?? { type: t.emotion, target: ev.who, sum: 0, since: k }
        e.sum += t.intensity * decay ** (now - k)
        e.since = Math.max(e.since, k)
        m.set(key, e)
    }
    const out = {}
    for (const [id, m] of acc) {
        const emotions = [...m.values()].filter((e) => e.sum >= 2).map((e) => ({ type: e.type, intensity: clamp(Math.round(e.sum), 1, 10), target: e.target, sinceTurn: e.since }))
            .sort((a, b) => b.intensity - a.intensity || a.type.localeCompare(b.type) || a.target.localeCompare(b.target))
        if (!emotions.length) continue
        const net = emotions.reduce((s, e) => s + (POSITIVE.has(e.type) ? e.intensity : -e.intensity), 0)
        out[id] = { mood: clamp(net / 2, -10, 10), emotions }
    }
    return out
}

/**
 * Pure. The path-B answer for a payload (the POST /appraise body: {world, turn, present, npcs: [{id, traits, seed: {q: {...}}, ...}],
 * events}): the fold, the after-effects, mood; si is not produced here (npc.lp treats it as optional).
 */
function appraiseLocal(payload) {
    const t0 = performance.now()
    const npcs = payload?.npcs ?? []
    const profiles = Object.fromEntries(npcs.map((n) => [n.id, n.traits]))
    const seedRows = npcs.flatMap((n) => Object.entries(n.seed ?? {}).map(([q, v]) => ({ p: n.id, q, ...v })))
    const events = payload?.events ?? []
    const rel = foldRelations(seedRows, events, profiles)
    const emo = emotionsLocal(events, Number(payload?.turn ?? 0), profiles)
    return {
        npcs: npcs.map((n) => ({ id: n.id, rel: rel[n.id] ?? {}, emotions: emo[n.id]?.emotions ?? [], mood: emo[n.id]?.mood ?? 0, si: {} })),
        source: 'asp', ms: ms2(t0),
    }
}

// ---- the social ledger ($led_soc) --------------------------------------------------------------------------------------------------
/**
 * Parses the chat's $led_soc ("n | who | tag | whom", one act a line) from the chat variables (an object with led_soc, or '$led_soc'):
 * [{turn, who, tag, target, pos}]. A line with a turn that is no number, an unknown tag (the Vietnamese gloss counts), an empty name
 * or who === whom is dropped; the same (n, who, tag, whom) twice is one act; only the last WINDOW acts are kept.
 */
function socialEvents(vars) {
    const raw = typeof vars === 'string' ? vars : vars?.led_soc ?? vars?.$led_soc ?? ''
    const seen = new Set()
    const out = []
    for (const l of String(raw ?? '').split('\n')) {
        const p = l.split('|').map((x) => x.trim())
        if (p.length < 4) continue
        const turn = /^\d+$/.test(p[0]) ? Number(p[0]) : null
        const tag = TAG_OF_WORD.get(lower(p[2]))
        const who = lower(p[1]), target = lower(p[3])
        if (turn === null || !tag || !who || !target || who === target) continue
        const key = `${turn}|${who}|${tag}|${target}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({ turn, who, tag, target })
    }
    return out.slice(-WINDOW).map((e, pos) => ({ ...e, pos }))
}

// ---- strangers -------------------------------------------------------------------------------------------------------------------------
/** how important a stranger is next to the card's people (the Subtext names the most important first) */
const STRANGER_IMPORTANCE = 20
/**
 * The profile of a named person of the chat the card has no profile for ("Martin Vale", invented by the narrator): neutral traits
 * (50 each), plain speech, the table's default_seed toward everyone (seedPairs), and never a secret or an agenda, because nobody
 * wrote one: has_secret/has_agenda stay false, so the narrator is never told a stranger "keeps something back".
 */
function strangerOf(id, name) {
    return { id, name: String(name ?? id), importance: STRANGER_IMPORTANCE, traits: Object.fromEntries(TRAIT_KEYS.map((k) => [k, 50])), speech: 'plain', wantsSay: null, wantsHide: null, hideFid: null, tags: ['stranger'], source: 'stranger', hasSecret: false, hasAgenda: false }
}
/** a companion of the player's persona outranks the strangers of the scene and sits with a card's minor people */
const COMPANION_IMPORTANCE = 60
/**
 * The profile of a companion the player's persona names ("Evelyn — Linh Hồn Dẫn Lối", the page's decideCompanions) when the card has
 * none: a stranger's neutral traits and no secret, but tagged 'companion', so seedPairs starts them close to the player
 * (APPRAISAL.companion_seed) and npc.lp has them want to help. Measured 2026-10-22 (Mailman): as a stranger Evelyn was neutral and
 * "made small talk" through a bear chase.
 */
function companionOf(id, name) {
    return { ...strangerOf(id, name), importance: COMPANION_IMPORTANCE, tags: ['companion'], source: 'companion' }
}
const isCompanion = (p) => !!p?.tags?.includes('companion')

// ---- names -----------------------------------------------------------------------------------------------------------------------------
const HONORIFIC = /^(ông|bà|anh|chị|cô|chú|lão|mr|mrs|ms)\.?\s+(?=\S)/u
const trimName = (s) => lower(s).replace(/^["'“”‘’«»(\[]+|["'“”‘’«».,;:!?)\]]+$/gu, '').trim()

function openNpcPsych(opts = {}) {
    const db = opts.db
    const npcDir = opts.npcDir ?? NPC_DIR
    const log = opts.log ?? (() => {})
    const engine = ENGINES.includes(opts.engine) ? opts.engine : 'auto'
    const fatima = opts.fatima ?? null
    const budgetMs = opts.fatimaBudgetMs ?? FATIMA_BUDGET_MS
    db.exec(`
        CREATE TABLE IF NOT EXISTS npc_meta (world TEXT PRIMARY KEY, hash TEXT, built TEXT, npcs INTEGER, pairs INTEGER, loaded_at INTEGER);
        CREATE TABLE IF NOT EXISTS npc_profile (world TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, importance INTEGER NOT NULL DEFAULT 50,
            open INTEGER NOT NULL DEFAULT 50 CHECK (open BETWEEN 0 AND 100), consc INTEGER NOT NULL DEFAULT 50 CHECK (consc BETWEEN 0 AND 100),
            extra INTEGER NOT NULL DEFAULT 50 CHECK (extra BETWEEN 0 AND 100), agree INTEGER NOT NULL DEFAULT 50 CHECK (agree BETWEEN 0 AND 100),
            neuro INTEGER NOT NULL DEFAULT 50 CHECK (neuro BETWEEN 0 AND 100),
            speech TEXT NOT NULL, wants_say TEXT, wants_hide TEXT, hide_fid INTEGER, tags TEXT NOT NULL DEFAULT '[]', source TEXT,
            PRIMARY KEY (world, id));
        CREATE TABLE IF NOT EXISTS npc_alias (world TEXT NOT NULL, id TEXT NOT NULL, alias TEXT NOT NULL, PRIMARY KEY (world, alias, id));
        CREATE TABLE IF NOT EXISTS npc_rel_seed (world TEXT NOT NULL, p TEXT NOT NULL, q TEXT NOT NULL, trust INTEGER NOT NULL, affection INTEGER NOT NULL,
            debt INTEGER NOT NULL, grudge INTEGER NOT NULL, why TEXT, PRIMARY KEY (world, p, q), CHECK (p <> q),
            CHECK (trust BETWEEN 0 AND 100), CHECK (affection BETWEEN 0 AND 100), CHECK (debt BETWEEN 0 AND 100), CHECK (grudge BETWEEN 0 AND 100));
        CREATE TABLE IF NOT EXISTS npc_soc (chat TEXT NOT NULL, turn INTEGER NOT NULL, pos INTEGER NOT NULL, who TEXT NOT NULL, tag TEXT NOT NULL, target TEXT NOT NULL,
            origin TEXT NOT NULL, PRIMARY KEY (chat, origin));
        CREATE TABLE IF NOT EXISTS npc_rel (chat TEXT NOT NULL, p TEXT NOT NULL, q TEXT NOT NULL, trust INTEGER, affection INTEGER, debt INTEGER, grudge INTEGER,
            events INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (chat, p, q), CHECK (p <> q));
        CREATE TABLE IF NOT EXISTS npc_state (chat TEXT NOT NULL, turn INTEGER NOT NULL, npc TEXT NOT NULL, source TEXT NOT NULL CHECK (source IN ('fatima','asp')),
            mood REAL, emotions TEXT NOT NULL DEFAULT '[]', rel TEXT NOT NULL DEFAULT '{}', si TEXT NOT NULL DEFAULT '{}',
            action TEXT, demeanor TEXT, subtext TEXT, ms INTEGER, at INTEGER, PRIMARY KEY (chat, turn, npc));
        CREATE INDEX IF NOT EXISTS npc_state_chat ON npc_state (chat, turn);
    `)

    // ---- the card's seeds ----------------------------------------------------------------------------------------------------------
    const loaded = new Map()    // world -> hash checked this process
    const caches = new Map()    // world -> {profiles: Map id -> profile, seeds: Map 'p\0q' -> row, alias: Map alias -> Set ids, first: Map token -> Set ids}
    /** story/npcs/<world>.json into the tables when it changed; false when there is none or it fails the schema or the pair rules */
    function loadWorld(world) {
        const file = path.join(npcDir, `${world}.json`)
        let text
        try { text = fs.readFileSync(file, 'utf8') } catch { return false }
        const hash = sha(text)
        if (loaded.get(world) === hash) return true
        const meta = db.prepare('SELECT hash FROM npc_meta WHERE world = ?').get(world)
        if (meta?.hash === hash) { loaded.set(world, hash); return true }
        let f
        try { f = JSON.parse(text) } catch (e) { log(`npc ${world}: ${e.message}`); return false }
        const errors = [...validate(SCHEMA, f), ...seedErrors(f)]
        if (errors.length) { log(`npc ${world}: ${errors.length} errors, first: ${errors[0]}`); return false }
        db.transaction(() => {
            for (const t of ['npc_profile', 'npc_alias', 'npc_rel_seed']) db.prepare(`DELETE FROM ${t} WHERE world = ?`).run(world)
            const prof = db.prepare('INSERT INTO npc_profile (world, id, name, importance, open, consc, extra, agree, neuro, speech, wants_say, wants_hide, hide_fid, tags, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            const alias = db.prepare('INSERT OR IGNORE INTO npc_alias (world, id, alias) VALUES (?, ?, ?)')
            for (const n of f.npcs) {
                const t = n.traits
                prof.run(world, n.id, n.name, n.importance, t.open, t.consc, t.extra, t.agree, t.neuro, n.speech, n.wants_to_say ?? null, n.wants_to_hide ?? null, n.hide_fid ?? null, JSON.stringify(n.tags ?? []), n.source ?? null)
                for (const a of new Set([n.id, n.name, ...(n.aliases ?? [])])) if ([...lower(a)].length >= 2) alias.run(world, n.id, lower(a))
            }
            const seed = db.prepare('INSERT INTO npc_rel_seed (world, p, q, trust, affection, debt, grudge, why) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            for (const r of f.relations) seed.run(world, r.p, r.q, r.trust, r.affection, r.debt, r.grudge, r.why ?? null)
            db.prepare('INSERT OR REPLACE INTO npc_meta (world, hash, built, npcs, pairs, loaded_at) VALUES (?, ?, ?, ?, ?, ?)').run(world, hash, f.built ?? null, f.npcs.length, f.relations.length, Date.now())
        })()
        loaded.set(world, hash)
        caches.delete(world); propers.delete(world)
        log(`npc ${world}: ${f.npcs.length} profiles, ${f.relations.length} pairs`)
        return true
    }
    /** the world's rows as objects (from the tables, so a process that found them already loaded has them too) */
    function cacheOf(world) {
        let c = caches.get(world)
        if (c) return c
        c = { profiles: new Map(), seeds: new Map(), alias: new Map(), first: new Map() }
        for (const r of db.prepare('SELECT * FROM npc_profile WHERE world = ?').all(world)) {
            c.profiles.set(r.id, {
                id: r.id, name: r.name, importance: r.importance, traits: { open: r.open, consc: r.consc, extra: r.extra, agree: r.agree, neuro: r.neuro },
                speech: r.speech, wantsSay: r.wants_say, wantsHide: r.wants_hide, hideFid: r.hide_fid, tags: JSON.parse(r.tags || '[]'), source: r.source,
                hasSecret: !!r.wants_hide, hasAgenda: !!r.wants_say,
            })
        }
        for (const r of db.prepare('SELECT p, q, trust, affection, debt, grudge, why FROM npc_rel_seed WHERE world = ?').all(world)) c.seeds.set(`${r.p}\u0000${r.q}`, r)
        for (const r of db.prepare('SELECT id, alias FROM npc_alias WHERE world = ?').all(world)) {
            if (!c.alias.has(r.alias)) c.alias.set(r.alias, new Set())
            c.alias.get(r.alias).add(r.id)
            const tok = r.alias.split(' ')[0]
            if (r.alias.includes(' ') && [...tok].length >= 3) { if (!c.first.has(tok)) c.first.set(tok, new Set()); c.first.get(tok).add(r.id) }
        }
        caches.set(world, c)
        return c
    }
    /** a profile as loadWorld stored it (call loadWorld(world) first: this does not read the file), or null */
    const profileOf = (world, id) => cacheOf(world).profiles.get(id) ?? null

    // ---- names -> ids -----------------------------------------------------------------------------------------------------------------
    let kgQ = null     // prepared on first use: the graph's tables may not exist (graph off) when this opens
    const kgHit = (world, chat, alias) => {
        kgQ ??= db.prepare("SELECT DISTINCT a.id FROM kg_alias a JOIN kg_entity e ON e.world = a.world AND e.id = a.id AND e.chat = a.chat WHERE a.world = ? AND a.chat IN ('', ?) AND a.alias = ? AND e.kind = 'person'")
        return kgQ.all(world, chat, alias).map((r) => r.id)
    }
    /** several ids for one name: the profiled one with the most importance, else the first */
    function pick(world, ids) {
        if (ids.length <= 1) return ids[0] ?? null
        const c = cacheOf(world)
        return [...ids].sort((a, b) => (c.profiles.get(b)?.importance ?? -1) - (c.profiles.get(a)?.importance ?? -1) || a.localeCompare(b))[0]
    }
    /**
     * A name the ledger or the reply wrote -> an id. NFC and lower case first; the player (by 'player', the panel's full name, true
     * name, or the first name of the full name) is 'player'; then the graph's own aliases (kg_alias: world + chat, persons only), then
     * this card's npc_alias, each tried as written and then without a leading honorific (ông, bà, anh, chị, cô, chú, lão, mr, mrs,
     * ms); last, a first word that names exactly one profile. Null when none does. st = the chat's panel variables.
     */
    function resolveId(world, chatId, name, st = {}) {
        const n = trimName(name)
        if (!n) return null
        const base = n.replace(HONORIFIC, '')
        const player = lower(st?.st_name), truename = lower(st?.st_truename)
        const cands = [...new Set([n, base])].filter((x) => x.length >= 1)
        for (const c of cands) {
            if (c === PLAYER || (player && (c === player || c === truename || (c.length >= 3 && player.startsWith(c + ' '))))) return PLAYER
            let hit = []
            try { hit = kgHit(world, chatId ?? '', c) } catch { /* the graph's tables are not there */ }
            if (hit.length) return pick(world, hit)
            const al = cacheOf(world).alias.get(c)
            if (al?.size) return pick(world, [...al])
        }
        const first = cacheOf(world).first.get(base)
        if (first?.size === 1) return [...first][0]
        return null
    }
    /**
     * The card's profiled people the texts name (lower-cased text, as gmSolver's plain() gives): [{id, alias}], one per id, the longest
     * alias of an id that a text holds as a whole word. Aliases under 3 letters are not looked for (too many false hits in prose).
     */
    const propers = new Map()     // world -> the aliases the seed writes as a proper name
    /** the seed's names and aliases that are written capitalised ("Old Neil", "Changing Star"): a lower-case alias in the seed is a
     *  description ("không gian", "lão bà", "old woman in the kitchen") and in prose it is an ordinary word, never a sign the person is there */
    function properOf(world) {
        if (propers.has(world)) return propers.get(world)
        let set = null
        try {
            const f = JSON.parse(fs.readFileSync(path.join(npcDir, `${world}.json`), 'utf8'))
            set = new Map(f.npcs.flatMap((n) => [n.name, ...(n.aliases ?? [])]).map((a) => String(a ?? '').normalize('NFC').trim()).filter((a) => /(^|\s)\p{Lu}/u.test(a)).map((a) => [lower(a), a]))
        } catch { set = null }
        propers.set(world, set)
        return set
    }
    function namedIn(world, texts) {
        const c = cacheOf(world)
        const proper = properOf(world)
        const best = new Map()
        const ts = (texts ?? []).map((t) => String(t ?? '').normalize('NFC'))
        for (const [alias, set] of c.alias) {
            // case-sensitive on the seed's own spelling: "hy vọng" in prose is a word ("hope"), "Hy Vọng" is the person (measured
            // 2026-10-21, acceptance ss: Hope stood in a scene nobody named her in); an unreadable seed falls back to lower case
            const spelling = proper ? proper.get(alias) : null
            if ([...alias].length < 3 || (proper && !spelling)) continue
            if (!ts.some((t) => (spelling ? wordAt(t, spelling) : wordAt(t.toLowerCase(), alias)).length)) continue
            const id = pick(world, [...set])
            if (id && (!best.has(id) || [...alias].length > [...best.get(id)].length)) best.set(id, alias)
        }
        return [...best].map(([id, alias]) => ({ id, alias })).sort((a, b) => a.id.localeCompare(b.id))
    }
    /** ledger acts with their names resolved; a name that is nobody known stays as written (lower case): counted, but it has no profile */
    function resolveEvents(world, chatId, events, st) {
        const memo = new Map()
        const id = (x) => { if (!memo.has(x)) memo.set(x, resolveId(world, chatId, x, st) ?? x); return memo.get(x) }
        return events.map((e) => ({ ...e, who: id(e.who), target: id(e.target) })).filter((e) => e.who !== e.target)
    }

    // ---- seeds ---------------------------------------------------------------------------------------------------------------------------
    const ALLY = new Set(['ally_of', 'loves', 'kin_of', 'mentor_of'])
    /**
     * How each profiled person in `ids` (the most important `max`) sees each of `ids` and the player at the start: the card's seed row;
     * else the ledger's (relations = [{a, b, how}], ids already resolved: enemy words give grudge 60 / trust 10, ally words trust 60 /
     * affection 50, both ways); else the table's default. Rows: [{p, q, trust, affection, debt, grudge, from}]. A person with no profile
     * gets no row (never a default for someone nobody described).
     */
    function seedPairs(world, ids, relations = [], { max = MAX_PRESENT, strangers = new Map() } = {}) {
        const c = cacheOf(world)
        const all = [...new Set((ids ?? []).filter(Boolean))]
        const prof = (id) => c.profiles.get(id) ?? strangers.get(id)
        const ps = all.filter((id) => prof(id)).sort((a, b) => prof(b).importance - prof(a).importance || a.localeCompare(b)).slice(0, max)
        const led = new Map()
        for (const r of relations ?? []) {
            if (!r?.a || !r?.b || r.a === r.b) continue
            const kind = relOf(String(r.how ?? ''))
            const seed = kind === 'enemy_of' ? APPRAISAL.ledger_seed.enemy : ALLY.has(kind) ? APPRAISAL.ledger_seed.ally : null
            if (!seed) continue
            for (const k of [`${r.a}\u0000${r.b}`, `${r.b}\u0000${r.a}`]) if (!led.has(k)) led.set(k, seed)
        }
        const rows = []
        for (const p of ps) {
            for (const q of [...new Set([...all, PLAYER])]) {
                if (q === p) continue
                const k = `${p}\u0000${q}`
                const s = c.seeds.get(k), l = led.get(k)
                const close = q === PLAYER && !c.profiles.has(p) && isCompanion(strangers.get(p))
                const src = s ? { v: s, from: 'seed' } : l ? { v: l, from: 'ledger' } : close ? { v: APPRAISAL.companion_seed, from: 'companion' } : { v: APPRAISAL.default_seed, from: 'default' }
                rows.push({ p, q, trust: src.v.trust, affection: src.v.affection, debt: src.v.debt, grudge: src.v.grudge, from: src.from })
            }
        }
        return rows
    }

    // ---- the switch -------------------------------------------------------------------------------------------------------------------
    /** the POST /appraise body (plan section 10) for the present people who have a profile */
    function buildPayload(input) {
        const world = input.world
        const present = [...new Set((input.present ?? []).map(lower).filter((x) => x && x !== PLAYER))]
        // a stranger (or the persona's companion) only where the card has nobody by that id (a profile always wins)
        const strangers = new Map((input.strangers ?? []).filter((x) => x?.id && present.includes(lower(x.id)) && !profileOf(world, lower(x.id))).map((x) => [lower(x.id), (x.companion ? companionOf : strangerOf)(lower(x.id), x.name)]))
        const rows = seedPairs(world, present, input.relations ?? [], { strangers })
        const ps = [...new Set(rows.map((r) => r.p))]
        const npcs = ps.map((id) => {
            const pr = profileOf(world, id) ?? strangers.get(id)
            const seed = {}
            for (const r of rows) if (r.p === id) seed[r.q] = { trust: r.trust, affection: r.affection, debt: r.debt, grudge: r.grudge }
            return { id, name: pr.name, traits: pr.traits, importance: pr.importance, speech: pr.speech, tags: pr.tags, hasSecret: pr.hasSecret, hasAgenda: pr.hasAgenda, seed }
        })
        const events = (input.events ?? []).map((e) => ({ turn: Number(e.turn), who: e.who, tag: e.tag, target: e.target }))
        return { chatId: input.chatId ?? null, world, turn: Number(input.turn ?? 0), present, npcs, events }
    }
    /** the profile's own fields ride along on each answered person (aspFacts and subtextOf read them; the sidecar does not send them) */
    const withProfile = (answer, payload) => answer.map((a) => { const n = payload.npcs.find((x) => x.id === a.id); return { ...a, name: n.name, importance: n.importance, speech: n.speech, traits: n.traits, tags: n.tags, hasSecret: n.hasSecret, hasAgenda: n.hasAgenda } })

    /**
     * The sidecar's answer, checked: every person asked for is there, every id is one the payload knows, numbers are numbers (clamped:
     * dims 0..100, intensity and si 0..10, mood -10..10), emotion types are OCC names. Returns the cleaned list, or null.
     */
    function checkShape(r, payload) {
        if (!r || !Array.isArray(r.npcs) || !r.npcs.length) return null
        const known = new Set([PLAYER, ...payload.present, ...payload.npcs.map((n) => n.id), ...payload.events.flatMap((e) => [e.who, e.target]), ...payload.npcs.flatMap((n) => Object.keys(n.seed))])
        const out = []
        for (const a of r.npcs) {
            if (!a || typeof a.id !== 'string' || !payload.npcs.some((n) => n.id === a.id)) return null
            const mood = num(a.mood)
            if (mood === null || !Array.isArray(a.emotions ?? [])) return null
            const emotions = []
            for (const e of a.emotions ?? []) {
                const i = num(e?.intensity)
                if (i === null || !EMOTIONS.includes(e.type) || !known.has(e.target)) return null
                emotions.push({ type: e.type, intensity: clamp(i, 0, 10), target: e.target, sinceTurn: num(e.sinceTurn) ?? payload.turn })
            }
            const si = {}
            for (const [q, v] of Object.entries(a.si ?? {})) { if (!known.has(q) || num(v) === null) return null; si[q] = clamp(v, 0, 10) }
            const rel = {}
            for (const [q, v] of Object.entries(a.rel ?? {})) {
                if (!known.has(q)) return null
                rel[q] = {}
                for (const d of DIMS) { if (num(v?.[d]) === null) return null; rel[q][d] = Math.round(clamp(v[d], 0, 100)) }
            }
            out.push({ id: a.id, rel, emotions, mood: clamp(mood, -10, 10), si })
        }
        return payload.npcs.every((n) => out.some((a) => a.id === n.id)) ? out : null
    }
    const withDeadline = (p, ms) => new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`no answer in ${ms} ms`)), ms)
        p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
    })

    const counts = { calls: 0, fatima: 0, asp: 0, fell: 0 }
    const times = { fatima: [], asp: [] }
    const keep = (src, ms) => { const a = times[src]; a.push(ms); if (a.length > 200) a.shift() }
    /**
     * input = {chatId, world, turn, present: [ids], events: [{turn, who, tag, target}] (ids resolved), relations?: [{a, b, how}]}.
     * Engine 'asp' answers with appraiseLocal. 'auto' | 'fatima': when opts.fatima is ready, the sidecar gets the payload and `budget`
     * ms (default 110); its answer must pass checkShape; a timeout, an error, a bad shape or a client that is not ready falls to
     * appraiseLocal and says why ({why}). Returns {npcs, source: 'fatima' | 'asp', ms, world, why?}; no profiled person present ->
     * {npcs: []}. Never throws.
     */
    async function appraise(input, o = {}) {
        const t0 = performance.now()
        counts.calls++
        let payload
        try {
            loadWorld(input.world)
            payload = buildPayload(input)
        } catch (e) {
            log(`npc appraise ${input?.world}: ${e.message}`)
            return { npcs: [], source: 'asp', ms: ms2(t0), world: input?.world, why: e.message }
        }
        if (!payload.npcs.length) return { npcs: [], source: 'asp', ms: ms2(t0), world: input.world }
        const mode = ENGINES.includes(o.engine) ? o.engine : engine
        let why = null
        if (mode !== 'asp') {
            if (fatima?.ready?.()) {
                const budget = o.budgetMs ?? budgetMs
                try {
                    const r = await withDeadline(Promise.resolve().then(() => fatima.appraise(payload, budget)), budget)
                    const npcs = checkShape(r, payload)
                    if (npcs) {
                        const ms = ms2(t0)
                        counts.fatima++; keep('fatima', ms)
                        return { npcs: withProfile(npcs, payload), source: 'fatima', ms, world: input.world }
                    }
                    why = 'bad shape'
                } catch (e) { why = e?.message ?? String(e) }
            } else why = 'sidecar not ready'
            counts.fell++
        }
        const local = appraiseLocal(payload)
        const ms = ms2(t0)
        counts.asp++; keep('asp', ms)
        return { npcs: withProfile(local.npcs, payload), source: 'asp', ms, world: input.world, ...(why ? { why } : {}) }
    }

    // ---- what clingo reads --------------------------------------------------------------------------------------------------------------
    /**
     * The atoms of story/gm/npc.lp for an appraise() result: for each answered person who is in `present` and has a profile (the result
     * carries it; ctx.world finds it otherwise): npc/1, trait/3, rel/4 toward present people and the player, emotion/3 (the 20
     * strongest), mood/2 (rounded), si/3, has_secret/1, has_agenda/1 (booleans: the text of a secret or an agenda is never exported),
     * and recent/3 for the acts of the last 3 turns that touch such a person (ctx.turn, default the latest act). '' when none.
     */
    function aspFacts(result, present, ctx = {}) {
        const here = new Set((present ?? []).map(lower))
        const near = new Set([...here, PLAYER])
        const out = []
        const emo = []
        const ids = new Set()
        for (const n of result?.npcs ?? []) {
            const prof = n.traits ? n : ctx.world ? profileOf(ctx.world, n.id) : null
            if (!prof?.traits || !here.has(n.id)) continue
            ids.add(n.id)
            const P = str(n.id)
            out.push(`npc(${P}).`)
            if (isCompanion(prof)) out.push(`companion(${P}).`)
            for (const k of TRAIT_KEYS) out.push(`trait(${P}, ${k}, ${Math.round(clamp(num(prof.traits[k]) ?? 50))}).`)
            for (const [q, r] of Object.entries(n.rel ?? {})) {
                if (!near.has(q) || q === n.id) continue
                for (const d of DIMS) if (num(r?.[d]) !== null) out.push(`rel(${P}, ${str(q)}, ${d}, ${Math.round(clamp(r[d]))}).`)
            }
            for (const e of n.emotions ?? []) if (EMOTIONS.includes(e.type) && Math.round(e.intensity) >= 1) emo.push({ i: Math.min(10, Math.round(e.intensity)), a: `emotion(${P}, ${e.type}, ${Math.min(10, Math.round(e.intensity))}).` })
            if (num(n.mood) !== null) out.push(`mood(${P}, ${Math.round(clamp(n.mood, -10, 10))}).`)
            for (const [q, v] of Object.entries(n.si ?? {})) if (near.has(q) && q !== n.id && num(v) !== null) out.push(`si(${P}, ${str(q)}, ${Math.round(clamp(v, 0, 10))}).`)
            if (prof.hasSecret) out.push(`has_secret(${P}).`)
            if (prof.hasAgenda) out.push(`has_agenda(${P}).`)
        }
        if (!ids.size) return ''
        out.push(...[...new Map(emo.map((e) => [e.a, e])).values()].sort((a, b) => b.i - a.i || a.a.localeCompare(b.a)).slice(0, MAX_EMOTION_ATOMS).map((e) => e.a))
        const evs = (ctx.events ?? []).filter((e) => TAGS.includes(e.tag))
        const now = Number.isFinite(ctx.turn) ? ctx.turn : evs.reduce((m, e) => Math.max(m, Number(e.turn) || 0), 0)
        for (const e of evs.filter((x) => Number(x.turn) > now - RECENT_TURNS && Number(x.turn) <= now && (ids.has(x.who) || ids.has(x.target))).slice(-30)) out.push(`recent(${str(e.who)}, ${e.tag}, ${str(e.target)}).`)
        return [...new Set(out)].join('\n')
    }

    // ---- what the narrator reads --------------------------------------------------------------------------------------------------------
    /** [id, value] pairs, {id: value}, or ids -> Map id -> [values] (the shape of gmSolver's decision is another worker's: take either) */
    function grouped(x) {
        const m = new Map()
        const unwrap = (v) => (v && typeof v === 'object' && 'name' in v ? v.name : v)
        const add = (k, v) => { k = lower(unwrap(k)); if (!m.has(k)) m.set(k, []); if (v !== undefined) m.get(k).push(String(unwrap(v))) }
        if (x instanceof Map) for (const [k, v] of x) for (const w of [].concat(v)) add(k, w)
        else if (x instanceof Set) for (const k of x) add(k)
        else if (Array.isArray(x)) for (const e of x) { if (Array.isArray(e)) add(e[0], e[1]); else add(e) }
        else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) for (const w of [].concat(v)) add(k, w)
        return m
    }
    const WANT_ORDER = ['reconcile', 'keep_distance', 'refuse', 'help', 'confide', 'insult', 'threaten', 'flirt', 'conceal_affection', 'forgive']
    const WANT_PHRASE = { reconcile: 'wants to reconcile', keep_distance: 'wants distance', refuse: 'wants to refuse', help: 'wants to help', confide: 'wants to open up', insult: 'wants to lash out', threaten: 'wants to threaten', flirt: 'drawn to the character', conceal_affection: 'wants to hide how much they care', forgive: 'wants to let the grudge go' }
    const ACT_PHRASE = { small_talk: 'makes small talk', reconcile: 'moves to reconcile', refuse: 'refuses', keep_distance: 'keeps distance', insult: 'lashes out', flirt: 'flirts', confide: 'opens up', threaten: 'threatens', help: 'offers help', conceal_affection: 'hides how much they care', forgive: 'lets the grudge go' }
    /** what a person who wants the very act they take reads as, where "and says so" would be wrong (hiding is not saying) */
    const SAME_PHRASE = { conceal_affection: 'wants to hide how much they care, and does', forgive: 'wants to let the grudge go, and does, quietly' }
    const SPEECH_PHRASE = { cold: 'speaks coldly', warm: 'speaks warmly', blunt: 'speaks bluntly', formal: 'speaks formally', playful: 'speaks playfully', timid: 'speaks timidly', mocking: 'speaks mockingly', terse: 'speaks tersely' }
    const SUBTEXT_HEAD = 'Subtext (hidden drives; show them through action, tone and what is left unsaid, never state them): '
    /** one fragment per person with a social action, by importance: [{id, text}] (what subtextOf joins and persist stores) */
    function subtextParts(decision, result, names, max = SUBTEXT_MAX.npcs) {
        const action = grouped(decision?.social), demeanor = grouped(decision?.demeanor), wants = grouped(decision?.wants), silent = grouped(decision?.mayStay)
        const nameOf = (id, fallback) => (names instanceof Map ? names.get(id) : names?.[id]) ?? fallback ?? id
        const people = [...(result?.npcs ?? [])].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || a.id.localeCompare(b.id))
        const out = []
        for (const n of people) {
            const act = action.get(n.id)?.[0]
            if (!act || !ACT_PHRASE[act]) continue
            const want = WANT_ORDER.find((w) => wants.get(n.id)?.includes(w))
            const head = want ? (want === act ? SAME_PHRASE[want] ?? `${WANT_PHRASE[want]} and says so` : `${WANT_PHRASE[want]} but ${ACT_PHRASE[act]}`) : ACT_PHRASE[act]
            const dem = demeanor.get(n.id)?.[0]
            const speech = SPEECH_PHRASE[n.speech]
            // small talk is the solver's default, not a drive: wanting nothing, neutral, plain spoken and holding nothing back says nothing,
            // and "makes small talk" made the narrator give them a filler line every turn (Mailman 2026-10-22: Evelyn, the persona's
            // companion with no card profile, read the bear chase back to the player)
            if (act === 'small_talk' && !want && (!dem || dem === 'neutral') && !speech && !silent.has(n.id) && !n.hasAgenda && !n.hasSecret) continue
            // the optional tails, dropped from the end of the list until the fragment fits
            const tails = [dem ? (speech ? `${dem}, ${speech}` : dem) : speech ?? null, silent.has(n.id) ? 'may stay silent' : null, n.hasAgenda && act !== 'confide' ? 'has something unsaid' : null, n.hasSecret ? 'keeps something back' : null].filter(Boolean)
            const nm = [...String(nameOf(n.id, n.name))].slice(0, 30).join('')
            const build = (t) => `“${nm}” ${[head, ...t].join('; ')}.`
            let text = build(tails)
            for (let k = tails.length; [...text].length > SUBTEXT_MAX.perNpc && k > 0; k--) text = build(tails.slice(0, k - 1))
            if ([...text].length > SUBTEXT_MAX.perNpc) text = [...text].slice(0, SUBTEXT_MAX.perNpc - 1).join('') + '.'
            out.push({ id: n.id, text })
            if (out.length >= max) break
        }
        return out
    }
    /**
     * The "Subtext:" line (plan section 8): abstract volitions from the solver's answer set and the phrase tables, never a number, a
     * trait or the words of wants_to_say / wants_to_hide. decision = {social, demeanor, wants, mayStay}: [id, value] pairs or
     * {id: value} (mayStay: ids). At most `max` people (4), 110 characters each, 520 in all; '' when nobody has a social action.
     */
    function subtextOf(decision, result, names, max = SUBTEXT_MAX.npcs) {
        const parts = subtextParts(decision, result, names, max)
        let line = SUBTEXT_HEAD.trimEnd()
        let n = 0
        for (const p of parts) {
            if ([...line].length + 1 + [...p.text].length > SUBTEXT_MAX.total) break
            line += ' ' + p.text
            n++
        }
        return n ? line : ''
    }

    // ---- records -------------------------------------------------------------------------------------------------------------------------
    const putState = db.prepare(`INSERT INTO npc_state (chat, turn, npc, source, mood, emotions, rel, si, action, demeanor, subtext, ms, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (chat, turn, npc) DO UPDATE SET source = excluded.source, mood = excluded.mood, emotions = excluded.emotions, rel = excluded.rel, si = excluded.si,
            action = excluded.action, demeanor = excluded.demeanor, subtext = excluded.subtext, ms = excluded.ms, at = excluded.at`)
    /**
     * What the narrator was given for (chat, turn), one row per person: upserted, so a reroll of the same turn overwrites (and the
     * people the reroll no longer has are removed). decision as in subtextOf.
     */
    function persist(chatId, turn, result, decision, source, ms) {
        const parts = new Map(subtextParts(decision, result, null, 99).map((p) => [p.id, p.text]))
        const action = grouped(decision?.social), demeanor = grouped(decision?.demeanor)
        const at = Date.now()
        db.transaction(() => {
            const ids = (result?.npcs ?? []).map((n) => n.id)
            db.prepare(`DELETE FROM npc_state WHERE chat = ? AND turn = ? AND npc NOT IN (${ids.map(() => '?').join(',') || "''"})`).run(chatId, turn, ...ids)
            for (const n of result?.npcs ?? []) {
                putState.run(chatId, turn, n.id, source === 'fatima' ? 'fatima' : 'asp', num(n.mood), JSON.stringify(n.emotions ?? []), JSON.stringify(n.rel ?? {}), JSON.stringify(n.si ?? {}),
                    action.get(n.id)?.[0] ?? null, demeanor.get(n.id)?.[0] ?? null, parts.get(n.id) ?? null, Math.round(ms ?? result?.ms ?? 0), at)
            }
        })()
    }
    /** what a chat's acts did, for /api/story/:id: {relations: [{p, q, trust, affection, debt, grudge, events}], events: [{turn, pos, who, tag, target}]} */
    function relationsOf(chatId) {
        return {
            relations: db.prepare('SELECT p, q, trust, affection, debt, grudge, events FROM npc_rel WHERE chat = ? ORDER BY p, q').all(chatId),
            events: db.prepare('SELECT turn, pos, who, tag, target FROM npc_soc WHERE chat = ? ORDER BY pos').all(chatId),
        }
    }
    /** the persisted people of one turn (the latest when turn is not given): [{npc, turn, source, mood, emotions, rel, si, action, demeanor, subtext, ms}] */
    function stateOf(chatId, turn) {
        const t = turn ?? db.prepare('SELECT MAX(turn) AS t FROM npc_state WHERE chat = ?').get(chatId)?.t
        if (t === null || t === undefined) return []
        return db.prepare('SELECT * FROM npc_state WHERE chat = ? AND turn = ? ORDER BY npc').all(chatId, t)
            .map((r) => ({ ...r, emotions: JSON.parse(r.emotions), rel: JSON.parse(r.rel), si: JSON.parse(r.si) }))
    }

    // ---- the derived index ------------------------------------------------------------------------------------------------------------------
    /**
     * Rebuilds a chat's npc_soc and npc_rel from its ledger (story = storyStore.story(chatId) with `led_soc`, here or in story.state:
     * everything is derived again, so a line that left the ledger takes its rows with it). npc_rel is the path-B fold of the whole
     * window: the deterministic numbers, for inspection (npc_state keeps what the narrator was given). {world, events, pairs}.
     */
    function syncChat(chatId, story, charName, loreTitles = []) {
        if (!story) return null
        const world = worldOf(charName ?? story.chat?.character, loreTitles)
        loadWorld(world)
        const st = story.state ?? {}
        const events = resolveEvents(world, chatId, socialEvents({ led_soc: story.led_soc ?? st.led_soc ?? '' }), st)
        const c = cacheOf(world)
        const relations = (story.relations ?? []).map((r) => ({ a: resolveId(world, chatId, r.a, st), b: resolveId(world, chatId, r.b, st), how: r.how })).filter((r) => r.a && r.b)
        const people = [...new Set(events.flatMap((e) => [e.who, e.target]))]
        const rel = foldRelations(seedPairs(world, people, relations, { max: 999 }), events, Object.fromEntries(people.filter((id) => c.profiles.has(id)).map((id) => [id, c.profiles.get(id).traits])))
        const seen = new Map()     // 'p\0q' -> acts that moved it
        for (const e of events) {
            const t = APPRAISAL.tags[e.tag]
            seen.set(`${e.target}\u0000${e.who}`, (seen.get(`${e.target}\u0000${e.who}`) ?? 0) + 1)
            if (t.mutual_trust) seen.set(`${e.who}\u0000${e.target}`, (seen.get(`${e.who}\u0000${e.target}`) ?? 0) + 1)
        }
        let pairs = 0
        db.transaction(() => {
            db.prepare('DELETE FROM npc_soc WHERE chat = ?').run(chatId)
            db.prepare('DELETE FROM npc_rel WHERE chat = ?').run(chatId)
            const soc = db.prepare('INSERT OR REPLACE INTO npc_soc (chat, turn, pos, who, tag, target, origin) VALUES (?, ?, ?, ?, ?, ?, ?)')
            for (const e of events) soc.run(chatId, e.turn, e.pos, e.who, e.tag, e.target, 'soc:' + sha(`${e.turn}|${e.who}|${e.tag}|${e.target}|${e.pos}`))
            const put = db.prepare('INSERT INTO npc_rel (chat, p, q, trust, affection, debt, grudge, events) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            for (const [p, row] of Object.entries(rel)) for (const [q, r] of Object.entries(row)) { put.run(chatId, p, q, r.trust, r.affection, r.debt, r.grudge, seen.get(`${p}\u0000${q}`) ?? 0); pairs++ }
        })()
        return { world, events: events.length, pairs }
    }
    const stamps = new Map()      // chat -> the state syncAll last read (this process; a restart rebuilds each chat once: it is a few ms of JS)
    /**
     * After every storyStore.sync: each live chat whose variables, length or seed file changed since the last read is rebuilt, the rows
     * of chats no longer in the store go. Returns {chats, ms}. Never throws: a failing chat is logged and skipped.
     */
    function syncAll(store) {
        const t0 = Date.now()
        let n = 0
        const rows = db.prepare('SELECT c.chat_id, c.char_id, c.vars_hash, c.messages, ch.name FROM chats c LEFT JOIN characters ch ON ch.char_id = c.char_id WHERE c.deleted_at IS NULL').all()
        const worlds = new Map()
        for (const r of rows) {
            try {
                if (!worlds.has(r.char_id)) worlds.set(r.char_id, worldOf(r.name, store.lore(r.char_id).map((l) => l.title ?? '')))
                const world = worlds.get(r.char_id)
                loadWorld(world)
                const stamp = `${r.vars_hash}|${r.messages}|${loaded.get(world) ?? '-'}`
                if (stamps.get(r.chat_id) === stamp) continue
                syncChat(r.chat_id, store.story(r.chat_id), r.name, store.lore(r.char_id).map((l) => l.title ?? ''))
                stamps.set(r.chat_id, stamp)
                n++
            } catch (e) {
                log(`npc sync ${r.chat_id}: ${e.message}`)
            }
        }
        for (const t of ['npc_soc', 'npc_rel', 'npc_state']) db.prepare(`DELETE FROM ${t} WHERE chat NOT IN (SELECT chat_id FROM chats)`).run()
        return { chats: n, ms: Date.now() - t0 }
    }

    const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null)
    /** {engine, calls, fatima, asp, fell (turns the sidecar was wanted but did not answer), p50/p95 per source, worlds} for the log and /api */
    function stats() {
        return {
            engine, ...counts,
            fatimaMs: { p50: pct(times.fatima, 0.5), p95: pct(times.fatima, 0.95) }, aspMs: { p50: pct(times.asp, 0.5), p95: pct(times.asp, 0.95) },
            worlds: Object.fromEntries(db.prepare('SELECT world, npcs, pairs FROM npc_meta').all().map((r) => [r.world, { npcs: r.npcs, pairs: r.pairs }])),
        }
    }
    function close() {}
    return { loadWorld, profileOf, resolveId, namedIn, socialEvents, seedPairs, foldRelations, emotionsLocal, appraiseLocal, appraise, aspFacts, subtextOf, persist, relationsOf, stateOf, syncChat, syncAll, stats, close, engine }
}

/**
 * What the schema cannot say about a seed file (also run by build/merge.cjs): npc ids unique, the player never an npc, every relation
 * from an npc of the file to an npc of the file or the player, no p === q, no (p, q) twice. [] = fine.
 */
function seedErrors(f) {
    const out = []
    const ids = new Set()
    for (const n of f?.npcs ?? []) {
        if (n.id === PLAYER) out.push(`npc "${PLAYER}": the player's persona is never an npc`)
        if (ids.has(n.id)) out.push(`npc "${n.id}": listed twice`)
        ids.add(n.id)
    }
    const pairs = new Set()
    for (const r of f?.relations ?? []) {
        const at = `relation ${r.p} -> ${r.q}`
        if (r.p === r.q) out.push(`${at}: p and q are the same`)
        if (!ids.has(r.p)) out.push(`${at}: p is no npc of this file`)
        if (r.q !== PLAYER && !ids.has(r.q)) out.push(`${at}: q is no npc of this file and not "${PLAYER}"`)
        if (pairs.has(`${r.p}\u0000${r.q}`)) out.push(`${at}: listed twice`)
        pairs.add(`${r.p}\u0000${r.q}`)
    }
    return out
}

module.exports = { openNpcPsych, strangerOf, companionOf, seedErrors, APPRAISAL, SCHEMA, TAGS, DIMS, EMOTION_OF_TAG, EMOTIONS, TRAIT_KEYS, ENGINES, SUBTEXT_MAX, PLAYER, clamp, modOf, foldRelations, emotionsLocal, appraiseLocal, socialEvents }
