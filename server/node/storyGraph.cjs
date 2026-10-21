'use strict'
// The librarian's knowledge graph, in story.sqlite next to storyStore's tables (one fact store, shared with the GM solver).
//
// Asked 2026-10-21: "librarian nên có công nghệ này: SQLite + FTS5, Vector Search, Knowledge Graph, Datalog, JSON Schema, RAG …
// Đặc biệt: Thủ thư nên có khả năng phân biệt sự thật, tin đồn, điều chưa biết và thông tin đã lỗi thời."
//
// What is here:
//   - the card's graph (story/graphs/<world>.json, drafted from the lore books by a model and checked by build/merge.cjs against
//     story/schema/lore-graph.schema.json): entities (person, faction, place, item, event) with every name they go by, and facts
//     (subject, relation, object) each with a STATUS: fact | rumor | unknown | outdated, a source (book:, turn:) and who knows it;
//   - the chat's own facts, rebuilt from the ledger the cards' Lua keeps (storyStore: led_rel, led_mem, led_ev) after every save:
//     a relation the story made, a memory of the player (a rumor when it says so: "nghe nói", "tin đồn", "heard"), a death, a move.
//     A death or a move makes the facts it ends OUTDATED from that turn on (kg_override), canon ones included;
//   - names found in a scene by FTS5 over every alias (Vietnamese and English, accents folded), then checked as whole words;
//   - facts(): the librarian's answer for a turn (story/schema/librarian-answer.schema.json): the facts about who and what the scene
//     names, each tagged, with whether the player's character knows it, and the lines the narrator reads;
//   - aspFacts() / query(): the same facts as ASP for clingo, with story/gm/graph.lp's Datalog (who here knows X, who controls a
//     place, what the player only heard as rumor, what follows from what, and with which status).
//
// Vector search was measured and is NOT used to pick lore (eval_recall.mjs, 2026-10-21, 1690 recorded helper picks): e5-small
// matched the helper's shelves 0.35 at 4 (chance 0.27) and its books 0.27 at 12 (chance 0.22); BM25 was at chance. Exact names are
// what local search does well, so FTS5 finds names here and the helper keeps picking books.
//
// Atoms (agreed with the GM solver, gmSolver.cjs): every name is an ASP string, lower-case NFC, the same as its person("…").
// dead/1 is an input of derive.lp; present/1 and need/1 are derived there: graph.lp reads them and never defines them.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { validate } = require('./jsonSchemaLite.cjs')
const { deathsIn, wordAt } = require('./storyStore.cjs')

const STORY_DIR = path.join(__dirname, 'story')
const GRAPH_DIR = path.join(STORY_DIR, 'graphs')
const GRAPH_LP = path.join(STORY_DIR, 'gm', 'graph.lp')
const SCHEMA = {
    graph: JSON.parse(fs.readFileSync(path.join(STORY_DIR, 'schema', 'lore-graph.schema.json'), 'utf8')),
    answer: JSON.parse(fs.readFileSync(path.join(STORY_DIR, 'schema', 'librarian-answer.schema.json'), 'utf8')),
}
const STATUSES = ['fact', 'rumor', 'unknown', 'outdated']
const PLAYER = 'player'

const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16)
const lower = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()
/** lower-case without accents (đ -> d): how FTS5's remove_diacritics sees a word */
const fold = (s) => lower(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
const str = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ') + '"'
const lines = (v) => String(v ?? '').split('\n').map((l) => l.trim()).filter(Boolean)

/** the card's world, by the same words as gameMaster.ts gmWorld (name + lore titles) */
function worldOf(name, titles = []) {
    const text = `${name ?? ''}\n${titles.join('\n')}`
    if (/shadow slave|nô lệ bóng tối|nightmare engine|forgotten shore/i.test(text)) return 'shadow_slave'
    if (/lord of (the )?myster|quỷ bí|beyonder potion|pathways and sequences/i.test(text)) return 'lotm'
    if (/infinite mailman|người đưa thư|delivery world|stamp book/i.test(text)) return 'mailman'
    if (/thảm họa zombie|hacker system|hệ thống hacker|outbreak engine/i.test(text)) return 'zombie'
    return 'generic'
}

// ---- reading the ledger's words ------------------------------------------------------------------------------------------------------
/** a line that says it was only heard, said or guessed: a rumor, not a fact */
const RUMOR = /\b(rumou?rs?|rumou?red|heard that|they say|it is said|allegedly|supposedly|unconfirmed|whisper(s|ed)?)\b|tin đồn|nghe nói|nghe đồn|đồn rằng|người ta (nói|đồn|bảo)|chưa (được )?xác (nhận|minh)|nghe kể|có tin|lời đồn/i
/** a line that says nobody knows (yet) */
const UNKNOWN = /\b(unknown|nobody knows|no one knows|a mystery|unclear)\b|chưa (ai )?biết|không (ai )?(rõ|biết)|chưa rõ|bí ẩn|là ai\s*\?|\?\s*$/i
const statusOfText = (t) => (RUMOR.test(t) ? 'rumor' : UNKNOWN.test(t) ? 'unknown' : 'fact')
/** a ledger relation's words -> a graph relation */
const REL_WORDS = [
    ['enemy_of', /enem|rival|hate|hostile|hunt|kẻ thù|thù|đối thủ|địch|ghét|săn/i],
    ['ally_of', /ally|allied|friend|partner|trust|đồng minh|bạn|tin tưởng|cộng sự|đồng đội/i],
    ['member_of', /member|joined|belongs|thành viên|gia nhập|thuộc|người của/i],
    ['serves', /serv|follow|subordinate|phục vụ|thuộc hạ|cấp dưới|theo hầu/i],
    ['mentor_of', /mentor|teach|master of|thầy|sư phụ|dạy/i],
    ['loves', /love|lover|yêu|người yêu|thích/i],
    ['kin_of', /brother|sister|father|mother|son|daughter|family|kin|anh trai|em gái|chị|cha|mẹ|con|gia đình|họ hàng/i],
    ['owns', /owes|debt|nợ/i],
]
const relOf = (how) => REL_WORDS.find(([, re]) => re.test(how))?.[0] ?? 'knows'
/** a timeline line that moves someone somewhere: "X went to P", "X đến P" (the place is matched against known places) */
const MOVE = /\b(went|goes|left for|moved|arrived|reached|fled|returned)\b|đi (đến|tới|về)|đến|tới|rời|chạy (đến|tới|về)|trở về|về (lại )?/i

function openStoryGraph(opts) {
    const db = opts.db
    const graphDir = opts.graphDir ?? GRAPH_DIR
    const log = opts.log ?? (() => {})
    db.exec(`
        CREATE TABLE IF NOT EXISTS kg_meta (world TEXT PRIMARY KEY, hash TEXT, built TEXT, entities INTEGER, facts INTEGER, loaded_at INTEGER);
        CREATE TABLE IF NOT EXISTS kg_entity (world TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('person','faction','place','item','event')),
            name TEXT NOT NULL, chat TEXT NOT NULL DEFAULT '', PRIMARY KEY (world, chat, id));
        CREATE TABLE IF NOT EXISTS kg_alias (world TEXT NOT NULL, chat TEXT NOT NULL DEFAULT '', id TEXT NOT NULL, alias TEXT NOT NULL, PRIMARY KEY (world, chat, alias, id));
        CREATE VIRTUAL TABLE IF NOT EXISTS kg_alias_fts USING fts5(world UNINDEXED, chat UNINDEXED, id UNINDEXED, alias, tokenize = 'unicode61 remove_diacritics 2');
        CREATE TABLE IF NOT EXISTS kg_fact (fid INTEGER PRIMARY KEY, world TEXT NOT NULL, chat TEXT NOT NULL DEFAULT '', s TEXT NOT NULL, r TEXT NOT NULL, o TEXT,
            status TEXT NOT NULL CHECK (status IN ('fact','rumor','unknown','outdated')), text TEXT NOT NULL, source TEXT NOT NULL,
            valid_from INTEGER NOT NULL DEFAULT 0, valid_to INTEGER, until TEXT, origin TEXT);
        CREATE INDEX IF NOT EXISTS kg_fact_s ON kg_fact (world, s);
        CREATE INDEX IF NOT EXISTS kg_fact_o ON kg_fact (world, o);
        CREATE UNIQUE INDEX IF NOT EXISTS kg_fact_origin ON kg_fact (chat, origin) WHERE origin IS NOT NULL;
        CREATE TABLE IF NOT EXISTS kg_knows (fid INTEGER NOT NULL, chat TEXT NOT NULL DEFAULT '', who TEXT NOT NULL, as_status TEXT NOT NULL CHECK (as_status IN ('fact','rumor')),
            since INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (fid, chat, who));
        CREATE TABLE IF NOT EXISTS kg_override (chat TEXT NOT NULL, fid INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('fact','rumor','unknown','outdated')),
            valid_to INTEGER, until TEXT, origin TEXT NOT NULL, PRIMARY KEY (chat, fid));
        CREATE TABLE IF NOT EXISTS kg_seen (chat TEXT NOT NULL, origin TEXT NOT NULL, turn INTEGER NOT NULL, PRIMARY KEY (chat, origin));
        CREATE TABLE IF NOT EXISTS kg_chat (chat TEXT PRIMARY KEY, stamp TEXT, world TEXT, synced_at INTEGER);
    `)

    // ---- the card's graph ------------------------------------------------------------------------------------------------------------
    const loaded = new Map()   // world -> hash checked this process
    /** loads story/graphs/<world>.json into the tables when it changed; false when there is none or it fails the schema */
    function loadWorld(world) {
        const file = path.join(graphDir, `${world}.json`)
        let text
        try { text = fs.readFileSync(file, 'utf8') } catch { return false }
        const hash = sha(text)
        if (loaded.get(world) === hash) return true
        const meta = db.prepare('SELECT hash FROM kg_meta WHERE world = ?').get(world)
        if (meta?.hash === hash) { loaded.set(world, hash); return true }
        let g
        try { g = JSON.parse(text) } catch (e) { log(`graph ${world}: ${e.message}`); return false }
        const errors = validate(SCHEMA.graph, g)
        if (errors.length) { log(`graph ${world}: ${errors.length} schema errors, first: ${errors[0]}`); return false }
        db.transaction(() => {
            // card rows go; the chats' own rows stay (their overrides point at card fids, which are rebuilt: drop those too and
            // let the next sync of each chat write them again)
            const cardFids = db.prepare("SELECT fid FROM kg_fact WHERE world = ? AND chat = ''").all(world).map((r) => r.fid)
            const delOv = db.prepare('DELETE FROM kg_override WHERE fid = ?')
            const delKn = db.prepare("DELETE FROM kg_knows WHERE fid = ? AND chat = ''")
            for (const fid of cardFids) { delOv.run(fid); delKn.run(fid) }
            db.prepare("DELETE FROM kg_fact WHERE world = ? AND chat = ''").run(world)
            db.prepare("DELETE FROM kg_entity WHERE world = ? AND chat = ''").run(world)
            db.prepare("DELETE FROM kg_alias WHERE world = ? AND chat = ''").run(world)
            db.prepare("DELETE FROM kg_alias_fts WHERE world = ? AND chat = ''").run(world)
            const ent = db.prepare("INSERT OR IGNORE INTO kg_entity (world, id, kind, name, chat) VALUES (?, ?, ?, ?, '')")
            for (const e of g.entities) {
                ent.run(world, e.id, e.kind, e.name)
                for (const a of new Set([e.name, e.id, ...(e.aliases ?? [])])) addAlias(world, '', e.id, a)
            }
            const fact = db.prepare("INSERT INTO kg_fact (world, chat, s, r, o, status, text, source, valid_from, until) VALUES (?, '', ?, ?, ?, ?, ?, ?, 0, ?)")
            const knows = db.prepare("INSERT OR IGNORE INTO kg_knows (fid, chat, who, as_status, since) VALUES (?, '', ?, ?, 0)")
            for (const f of g.facts) {
                const fid = fact.run(world, f.s, f.r, f.o ?? null, f.status, f.text, f.source, f.until ?? null).lastInsertRowid
                for (const k of f.known_by ?? []) knows.run(fid, k.who, k.as)
            }
            db.prepare('INSERT OR REPLACE INTO kg_meta (world, hash, built, entities, facts, loaded_at) VALUES (?, ?, ?, ?, ?, ?)').run(world, hash, g.built ?? null, g.entities.length, g.facts.length, Date.now())
        })()
        loaded.set(world, hash)
        log(`graph ${world}: ${g.entities.length} entities, ${g.facts.length} facts`)
        return true
    }
    const aliasIns = () => db.prepare('INSERT OR IGNORE INTO kg_alias (world, chat, id, alias) VALUES (?, ?, ?, ?)')
    let _alias = null, _fts = null
    function addAlias(world, chat, id, alias) {
        const a = lower(alias)
        if ([...a].length < 2) return
        _alias ??= aliasIns()
        _fts ??= db.prepare('INSERT INTO kg_alias_fts (world, chat, id, alias) VALUES (?, ?, ?, ?)')
        if (_alias.run(world, chat, id, a).changes) _fts.run(world, chat, id, a)
    }

    // ---- names in a text (FTS5, then whole words) -----------------------------------------------------------------------------------------
    const ftsQ = db.prepare("SELECT DISTINCT id, alias FROM kg_alias_fts WHERE kg_alias_fts MATCH ? AND world = ? AND chat IN ('', ?) LIMIT 400")
    /**
     * Entity ids named in `text`, the most recently named first: FTS5 finds aliases sharing a word with it (accents folded), a
     * whole-word check keeps the real ones, and a name inside a longer name that was hit ("city" in "dark city") does not count.
     */
    function namedIn(world, chat, text) {
        const orig = String(text ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
        const t = orig.toLowerCase()
        // a one-word name in plain letters is also a common word somewhere ("song" is Vietnamese, "echo", "memory", "hope"): it
        // counts only written with a capital, as a name is (measured 2026-10-21: those three were "named" in most Shadow Slave turns)
        const plainWord = (a) => /^[a-z0-9'-]+$/.test(a)
        const capital = (at) => orig[at] !== undefined && orig[at] !== orig[at].toLowerCase()
        // the words of the END of the text when it is long: the latest message names the scene (the first 300 dropped it, 2026-10-21)
        const words = [...new Set((fold(text).match(/[\p{L}\p{N}]{3,}/gu) ?? []).reverse())].slice(0, 400)
        if (!words.length) return []
        const rows = []
        for (let i = 0; i < words.length; i += 60) {
            try { rows.push(...ftsQ.all(words.slice(i, i + 60).map((w) => `"${w}"`).join(' OR '), world, chat ?? '')) } catch {}
        }
        const spans = []
        for (const r of rows) {
            if ([...r.alias].length < 3) continue
            // the whole alias as written (accents count: FTS5 folds them to find candidates, "Lâm" is still not "lam")
            for (const at of wordAt(t, r.alias)) if (!plainWord(r.alias) || capital(at)) spans.push({ id: r.id, at, end: at + r.alias.length })
        }
        const kept = spans.filter((x) => !spans.some((y) => y !== x && y.at <= x.at && y.end >= x.end && y.end - y.at > x.end - x.at))
        const last = new Map()
        for (const x of kept) last.set(x.id, Math.max(last.get(x.id) ?? -1, x.at))
        return [...last.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
    }

    // ---- a chat's own facts, from its ledger ----------------------------------------------------------------------------------------------------
    /**
     * Rebuilds the chat's rows from its story (storyStore.story): everything is derived again, so an edited or rerolled ledger line
     * takes its fact with it; the turn a line was first seen is kept (kg_seen), so valid_from and valid_to do not move.
     */
    function syncChat(chatId, story, charName, loreTitles = []) {
        if (!story) return null
        const world = worldOf(charName ?? story.chat?.character, loreTitles)
        const haveCard = loadWorld(world)
        const turn = story.chat?.messages ?? 0
        const st = story.state ?? {}
        const seenRows = new Map(db.prepare('SELECT origin, turn FROM kg_seen WHERE chat = ?').all(chatId).map((r) => [r.origin, r.turn]))
        // the turn a line was first seen, kept across rebuilds (kg_seen); never after now (a reroll took that turn back), and a line
        // that left the ledger forgets it, so written again later it is a new event (specs/story/graph/GraphSync.tla)
        const firstSeen = (origin) => {
            if (!seenRows.has(origin) || seenRows.get(origin) > turn) { seenRows.set(origin, turn); newSeen.push(origin) }
            used.add(origin)
            return seenRows.get(origin)
        }
        const used = new Set()
        const newSeen = []
        const player = lower(st.st_name)
        const stats = { facts: 0, overrides: 0, world, card: haveCard }
        db.transaction(() => {
            db.prepare('DELETE FROM kg_knows WHERE chat = ?').run(chatId)
            db.prepare('DELETE FROM kg_override WHERE chat = ?').run(chatId)
            db.prepare('DELETE FROM kg_fact WHERE chat = ?').run(chatId)
            db.prepare('DELETE FROM kg_entity WHERE chat = ?').run(chatId)
            db.prepare('DELETE FROM kg_alias WHERE chat = ?').run(chatId)
            db.prepare('DELETE FROM kg_alias_fts WHERE chat = ?').run(chatId)
            const ent = db.prepare('INSERT OR IGNORE INTO kg_entity (world, id, kind, name, chat) VALUES (?, ?, ?, ?, ?)')
            const known = db.prepare("SELECT id FROM kg_alias WHERE world = ? AND chat IN ('', ?) AND alias = ? LIMIT 1")
            /** a name in the ledger -> an entity id: a known alias, else a person of this chat */
            const idOf = (name, kind = 'person') => {
                const n = lower(name)
                if (!n || n.length < 2) return null
                if (player && (n === player || n === lower(st.st_truename))) return PLAYER
                const hit = known.get(world, chatId, n)
                if (hit) return hit.id
                ent.run(world, n, kind, String(name).trim(), chatId)
                addAlias(world, chatId, n, name)
                return n
            }
            ent.run(world, PLAYER, 'person', st.st_name || 'player', chatId)
            if (player) addAlias(world, chatId, PLAYER, st.st_name)
            const fact = db.prepare('INSERT INTO kg_fact (world, chat, s, r, o, status, text, source, valid_from, valid_to, until, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            const knows = db.prepare('INSERT OR REPLACE INTO kg_knows (fid, chat, who, as_status, since) VALUES (?, ?, ?, ?, ?)')
            const put = (f, knowers) => {
                const from = firstSeen(f.origin)
                const fid = fact.run(world, chatId, f.s, f.r, f.o ?? null, f.status, f.text, `turn:${from}`, from, null, null, f.origin).lastInsertRowid
                for (const [who, as] of knowers) knows.run(fid, chatId, who, as, from)
                stats.facts++
                return fid
            }
            // relations: "A | B | how"
            for (const r of story.relations ?? []) {
                const a = idOf(r.a), b = idOf(r.b)
                if (!a || !b || a === b) continue
                const how = String(r.how ?? '')
                const status = statusOfText(how)
                put({ s: a, r: relOf(how), o: b, status: status === 'unknown' ? 'fact' : status, text: `${r.a} — ${r.b}: ${how}`.slice(0, 400), origin: 'rel:' + sha(`${r.a}|${r.b}|${how}`) },
                    [[PLAYER, status === 'rumor' ? 'rumor' : 'fact'], ...(status === 'rumor' ? [] : [[a, 'fact'], [b, 'fact']])])
            }
            // memories: "subject | what the player remembers"
            for (const m of story.memories ?? []) {
                const s = m.subject ? idOf(m.subject) : PLAYER
                if (!s) continue
                const status = statusOfText(m.text)
                put({ s, r: 'note', o: null, status, text: (m.subject ? `${m.subject}: ${m.text}` : m.text).slice(0, 400), origin: 'mem:' + sha(`${m.subject}|${m.text}`) },
                    status === 'unknown' ? [] : [[PLAYER, status === 'rumor' ? 'rumor' : 'fact']])
            }
            // the timeline: deaths (storyStore's DEATH words) and moves; each ends what it ends from the turn it was first seen
            const npcNames = (story.npcs ?? []).map((n) => lower(n.name))
            const places = db.prepare("SELECT DISTINCT a.alias, a.id FROM kg_alias a JOIN kg_entity e ON e.world = a.world AND e.id = a.id AND e.chat = a.chat WHERE a.world = ? AND a.chat IN ('', ?) AND e.kind = 'place' AND length(a.alias) >= 3").all(world, chatId)
            const ends = []      // [entity, rels[], until, turn, origin]
            for (const e of story.timeline ?? []) {
                const text = String(e.event ?? '')
                const origin = 'ev:' + sha(`${e.at}|${text}`)
                const t = lower(text)
                for (const name of deathsIn(text, npcNames)) {
                    const id = idOf(name)
                    if (!id) continue
                    const o2 = origin + ':dead:' + id
                    put({ s: id, r: 'status', o: 'dead', status: 'fact', text: `${e.at ? e.at + ': ' : ''}${text}`.slice(0, 400), origin: o2 }, [[PLAYER, 'fact']])
                    ends.push([id, ['located_at', 'member_of', 'leads', 'controls', 'serves', 'status'], `${name} died (${e.at || 'timeline'})`, seenRows.get(o2), o2])
                }
                if (MOVE.test(text)) {
                    const place = places.filter((p) => wordAt(t, p.alias).length).sort((a, b) => b.alias.length - a.alias.length)[0]
                    if (!place) continue
                    for (const name of npcNames) {
                        const at = wordAt(t, name)
                        if (!at.length || at[0] > t.indexOf(place.alias)) continue
                        const id = idOf(name)
                        const o2 = origin + ':at:' + id
                        put({ s: id, r: 'located_at', o: place.id, status: 'fact', text: `${e.at ? e.at + ': ' : ''}${text}`.slice(0, 400), origin: o2 }, [[PLAYER, 'fact']])
                        ends.push([id, ['located_at'], `${name} was seen at ${place.alias} (${e.at || 'timeline'})`, seenRows.get(o2), o2, place.id])
                    }
                }
            }
            // where the player is now (the panel)
            if (st.st_place) {
                const t = lower(st.st_place)
                const place = places.filter((p) => wordAt(t, p.alias).length).sort((a, b) => b.alias.length - a.alias.length)[0]
                if (place) put({ s: PLAYER, r: 'located_at', o: place.id, status: 'fact', text: `${st.st_name || 'The player'} is at ${st.st_place}`.slice(0, 400), origin: 'place:' + sha(place.id) }, [[PLAYER, 'fact']])
            }
            // what a death or a move ends: earlier facts of that person (card or chat) become outdated from that turn
            const ov = db.prepare('INSERT OR REPLACE INTO kg_override (chat, fid, status, valid_to, until, origin) VALUES (?, ?, ?, ?, ?, ?)')
            for (const [id, rels, until, at, origin, keepPlace] of ends) {
                const rows = db.prepare(`SELECT fid, r, o, chat, valid_from, origin FROM kg_fact WHERE world = ? AND chat IN ('', ?) AND s = ? AND r IN (${rels.map(() => '?').join(',')})`).all(world, chatId, id, ...rels)
                for (const f of rows) {
                    if (f.origin === origin) continue
                    if (f.r === 'status' && f.o === 'dead') continue
                    if (keepPlace && f.o === keepPlace) continue
                    if (f.chat && f.valid_from > at) continue           // a later fact is not ended by an earlier event
                    if (f.chat) db.prepare('UPDATE kg_fact SET valid_to = ?, until = ? WHERE fid = ? AND (valid_to IS NULL OR valid_to > ?)').run(at, until, f.fid, at)
                    else ov.run(chatId, f.fid, 'outdated', at, until, origin)
                    stats.overrides++
                }
            }
            const seen = db.prepare('INSERT OR REPLACE INTO kg_seen (chat, origin, turn) VALUES (?, ?, ?)')
            for (const o of newSeen) seen.run(chatId, o, seenRows.get(o))
            const gone = db.prepare('DELETE FROM kg_seen WHERE chat = ? AND origin = ?')
            for (const o of seenRows.keys()) if (!used.has(o)) gone.run(chatId, o)
        })()
        return stats
    }

    // ---- reading -------------------------------------------------------------------------------------------------------------------
    /** the facts touching these entities, with this chat's view of them: effective status, until, who knows */
    function factsAbout(world, chat, ids, now) {
        if (!ids.length) return []
        const q = ids.map(() => '?').join(',')
        const rows = db.prepare(`SELECT f.*, ov.status AS ov_status, ov.valid_to AS ov_to, ov.until AS ov_until FROM kg_fact f
            LEFT JOIN kg_override ov ON ov.fid = f.fid AND ov.chat = ?
            WHERE f.world = ? AND f.chat IN ('', ?) AND (f.s IN (${q}) OR f.o IN (${q}))`).all(chat, world, chat, ...ids, ...ids)
        const kn = db.prepare("SELECT who, as_status FROM kg_knows WHERE fid = ? AND chat IN ('', ?)")
        return rows.map((f) => {
            const validTo = f.ov_to ?? f.valid_to
            const ended = validTo !== null && validTo !== undefined && validTo <= now
            // an override counts from its turn on: asked about an earlier turn, the fact stands as it was
            const status = ended ? 'outdated' : (f.ov_status && (f.ov_to === null || f.ov_to === undefined) ? f.ov_status : f.status)
            const known = kn.all(f.fid, chat).map((k) => ({ who: k.who, as: k.as_status }))
            const p = known.find((k) => k.who === PLAYER)
            return { fid: f.fid, s: f.s, r: f.r, o: f.o, status, text: f.text, source: f.source, until: ended ? (f.ov_until ?? f.until ?? null) : status === 'outdated' ? f.until : null,
                known_by: known.filter((k) => k.who !== PLAYER), player_knows: p ? p.as : 'no', chat: !!f.chat, valid_from: f.valid_from }
        })
    }
    const chatWorldOf = (chatId) => db.prepare('SELECT world FROM kg_chat WHERE chat = ?').get(chatId)?.world ?? null
    const entityRow = db.prepare("SELECT id, kind, name FROM kg_entity WHERE world = ? AND id = ? AND chat IN ('', ?) ORDER BY chat DESC LIMIT 1")

    /**
     * The librarian's answer for a turn: the scene's text (the last messages and the player's), the people the GM put in the scene.
     * Facts are ranked: this chat's own first, then what is not plainly a fact (rumor, unknown, outdated: the distinctions the
     * narrator must keep), then canon facts between two named things, then the rest; at most `max` facts and `maxTokens` tokens.
     */
    function facts(chatId, story, input = {}) {
        const t0 = Date.now()
        const world = input.world ?? chatWorldOf(chatId) ?? worldOf(input.charName ?? story?.chat?.character, input.loreTitles ?? [])
        if (!loadWorld(world) && !story) return { status: 'unavailable', reason: `no graph for ${world}`, world, now: 0, entities: [], facts: [] }
        const now = input.now ?? story?.chat?.messages ?? 0
        const names = new Map()
        const nameOf = (id) => { if (!names.has(id)) names.set(id, id === PLAYER ? "the player's character" : entityRow.get(world, id, chatId)?.name ?? id); return names.get(id) }
        const named = namedIn(world, chatId, input.text ?? '')
        const present = (input.present ?? []).map(lower).filter(Boolean)
        const ids = [...new Set([...named, ...present])].slice(0, 10)
        const all = factsAbout(world, chatId, [...ids, PLAYER], now)
        // relevance, measured on 164 recorded narrator turns (2026-10-21): ranking rumor/unknown/outdated first filled the block with
        // the rumors of hub entities; only 1-41% of the facts named anything the real reply named. Now: this chat's own facts, then
        // by how recently the scene named a side (the latest message first), both sides in the scene first, the status only breaks
        // ties, and at most PER_ENTITY facts hang on one entity.
        const rankOf = (id) => { const i = ids.indexOf(id); return i < 0 ? (id === PLAYER ? ids.length : 99) : i }
        const anchor = (f) => (rankOf(f.s) <= rankOf(f.o) ? f.s : f.o)
        const score = (f) => (f.chat ? -100 : 0) + Math.min(rankOf(f.s), rankOf(f.o)) - (rankOf(f.s) < 99 && rankOf(f.o) < 99 && f.o !== PLAYER && f.s !== PLAYER ? 1.5 : 0) - (f.status !== 'fact' ? 0.3 : 0)
        const order = all.filter((f) => (f.s !== PLAYER || f.chat) && !(f.s === PLAYER && f.r === 'located_at' && f.status === 'outdated')).sort((a, b) => score(a) - score(b) || b.valid_from - a.valid_from || a.fid - b.fid)
        const max = input.max ?? 16, maxTokens = input.maxTokens ?? 450, perEntity = input.perEntity ?? 3
        const out = []
        const per = new Map()
        let tokens = 0
        for (const f of order) {
            const k = anchor(f)
            if (!f.chat && (per.get(k) ?? 0) >= perEntity) continue
            const tk = Math.ceil(lineOf(f, nameOf).length / 3.9)
            if (out.length >= max) break
            if (tokens + tk > maxTokens) continue
            out.push(f); tokens += tk
            per.set(k, (per.get(k) ?? 0) + 1)
        }
        const entities = ids.map((id) => entityRow.get(world, id, chatId)).filter(Boolean).map((e) => ({ id: e.id, kind: e.kind, name: e.name, why: named.includes(e.id) ? 'named' : 'present' }))
        const facts = out.map(({ chat, valid_from, ...f }) => f)
        const text = linesOf(facts, nameOf)
        const ans = { status: 'ok', world, now, ms: Date.now() - t0, entities, facts, lines: text, tokens: Math.ceil(text.length / 3.9) }
        const errors = validate(SCHEMA.answer, ans)
        if (errors.length) return { status: 'error', reason: errors[0], world, now, entities: [], facts: [] }
        return ans
    }
    /** the facts as ASP (story/gm/graph.lp reads them); `ids` limits them to what touches those entities (all when empty) */
    function aspFacts(chatId, story, input = {}) {
        const world = input.world ?? chatWorldOf(chatId) ?? worldOf(input.charName ?? story?.chat?.character, input.loreTitles ?? [])
        loadWorld(world)
        const now = input.now ?? story?.chat?.messages ?? 0
        const ids = input.ids?.length ? input.ids : namedIn(world, chatId, input.text ?? '')
        const fs_ = factsAbout(world, chatId, [...new Set([...ids, PLAYER])], now)
        const out = [`now(${now}).`]
        const ents = new Set()
        for (const f of fs_) {
            out.push(`fact(${f.fid}, ${str(f.s)}, ${f.r}, ${f.o === null ? 'none' : str(lower(f.o))}, ${f.status}).`)
            for (const k of f.known_by) out.push(`knows(${str(k.who)}, ${f.fid}, ${k.as}).`)
            if (f.player_knows !== 'no') out.push(`knows(${str(PLAYER)}, ${f.fid}, ${f.player_knows}).`)
            ents.add(f.s); if (f.o) ents.add(f.o)
        }
        const q = db.prepare("SELECT id, kind FROM kg_entity WHERE world = ? AND id = ? AND chat IN ('', ?) LIMIT 1")
        for (const id of ents) { const e = q.get(world, id, chatId); if (e) out.push(`entity(${str(e.id)}, ${e.kind}).`) }
        return out.join('\n')
    }

    /**
     * The Datalog questions of story/gm/graph.lp over the facts touching the scene: who here knows what, who rules a place, who is a
     * foe of whom (derived, with the weakest status of what it rests on), what the player only heard. {status, ms, answers} where
     * answers maps each shown predicate to its tuples; clingo missing or slow -> {status: 'unavailable' | 'timeout'}.
     */
    async function query(chatId, story, input = {}) {
        const t0 = Date.now()
        const { runClingo } = require('./gmSolver.cjs')
        const present = (input.present ?? []).map(lower).filter(Boolean)
        const text = aspFacts(chatId, story, { ...input, ids: input.ids ?? [] }) + '\n' + present.map((p) => `present(${str(p)}).`).join('\n')
        const r = await runClingo([GRAPH_LP], text, { timeoutMs: input.timeoutMs ?? 1500 })
        if (r.status !== 'ok') return { status: r.status, reason: r.reason, ms: Date.now() - t0 }
        const answers = {}
        // a string comes back as a JS string, a constant as {name}, a number as a number (gmSolver.cjs parseTerm)
        for (const a of r.atoms) (answers[a.name] ??= []).push((a.args ?? []).map((x) => (x && typeof x === 'object' ? x.name : x)))
        return { status: 'ok', ms: Date.now() - t0, answers }
    }

    /**
     * After every storyStore.sync: each live chat whose ledger or length changed since the graph last read it (vars_hash + messages
     * + the card graph's hash) is rebuilt. Returns {chats, ms}. Never throws: a failing chat is logged and skipped.
     */
    const worldCache = new Map()
    function syncAll(store) {
        const t0 = Date.now()
        let n = 0
        const rows = db.prepare('SELECT c.chat_id, c.char_id, c.vars_hash, c.messages, ch.name FROM chats c LEFT JOIN characters ch ON ch.char_id = c.char_id WHERE c.deleted_at IS NULL').all()
        const prev = new Map(db.prepare('SELECT chat, stamp FROM kg_chat').all().map((r) => [r.chat, r.stamp]))
        for (const r of rows) {
            try {
                if (!worldCache.has(r.char_id)) worldCache.set(r.char_id, worldOf(r.name, store.lore(r.char_id).map((l) => l.title ?? '')))
                const world = worldCache.get(r.char_id)
                loadWorld(world)
                const stamp = `${r.vars_hash}|${r.messages}|${loaded.get(world) ?? '-'}`
                if (prev.get(r.chat_id) === stamp) continue
                syncChat(r.chat_id, store.story(r.chat_id), r.name, store.lore(r.char_id).map((l) => l.title ?? ''))
                db.prepare('INSERT OR REPLACE INTO kg_chat (chat, stamp, world, synced_at) VALUES (?, ?, ?, ?)').run(r.chat_id, stamp, world, Date.now())
                n++
            } catch (e) {
                log(`graph sync ${r.chat_id}: ${e.message}`)
            }
        }
        return { chats: n, ms: Date.now() - t0 }
    }
    /** the world of a chat's card (as syncAll saw it) */
    const chatWorld = (chatId) => db.prepare('SELECT world FROM kg_chat WHERE chat = ?').get(chatId)?.world ?? null

    function close() {}
    return { syncAll, chatWorld, loadWorld, namedIn, syncChat, facts, factsAbout, aspFacts, query, worldOf, close }
}

// ---- what the narrator reads ------------------------------------------------------------------------------------------------------------
const TAG = { fact: 'FACT', rumor: 'RUMOR', unknown: 'UNKNOWN', outdated: 'OUTDATED' }
function lineOf(f, nameOf = (id) => id) {
    const who = f.known_by?.length ? ` Known to: ${f.known_by.map((k) => nameOf(k.who) + (k.as === 'rumor' ? ' (as rumor)' : '')).join(', ')}.` : ''
    const pk = f.player_knows === 'fact' ? ' The player\'s character knows it.' : f.player_knows === 'rumor' ? ' The player\'s character only heard it.' : ''
    const until = f.status === 'outdated' && f.until ? ` (no longer: ${f.until})` : ''
    return `- ${TAG[f.status]} · ${f.text}${until}${who}${pk}`
}
const HEADER = '[Facts the librarian checked for this scene. FACT: true in the story. RUMOR: only said or believed; people may repeat it, the narration never states it as true. UNKNOWN: nobody in the story knows it; do not reveal it. OUTDATED: was true, no longer is. A character knows only what is marked as known to them or what they saw; the player\'s character knows only what is marked so or what happened in front of them.]'
/** the block the narrator reads; '' when there are no facts */
function linesOf(facts, nameOf) {
    if (!facts.length) return ''
    return [HEADER, ...facts.map((f) => lineOf(f, nameOf))].join('\n')
}

module.exports = { openStoryGraph, worldOf, statusOfText, relOf, linesOf, lineOf, HEADER, fold, GRAPH_LP, PLAYER, STATUSES }
