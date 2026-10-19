'use strict'
// story.sqlite: the story the owner is playing, per chat, kept next to the save and in step with it.
//
// Why: the state of a story lives in chat variables inside one 6-8 MB binary save (chat.scriptstate, written by the cards' Lua with
// setChatVar: '$st_rank', '$led_ev', ...). Nothing outside the page can ask "where is the player, who is dead, what happened when",
// and nothing can check it. This file is a derived index of the save: rebuildable from it at any time, never written back into it.
//
// Per chat: the runes and panel variables (st_*), the ledger (led_mem -> memories, led_rel -> relations, led_ev -> timeline), the
// NPCs derived from them (names from relations and memory subjects, last seen time/place and dead or not from the timeline), and the
// history of every st_* and gm_* change (rank changes are checked against the timeline by story/canon.pl). Per character: its lore entries
// (title, keys, hash, canon flag).
//
// Sync (sync(bytes, rev)): after every stored write of database.bin. One transaction; a character block whose bytes did not change
// is skipped (hash), a chat whose variables did not change is skipped (hash), so the same file twice changes nothing.
//
// A chat deleted from the save is ARCHIVED, not deleted: deleted_at and deleted_rev are set and its rows stay, and a chat that comes
// back (a merge keeps a chat one page deleted while the other wrote in it; a restore) is un-archived. Why: it took premerge copies
// and dbSync manifests to tell when chat 4c9bb225 vanished on 2026-10-15 and again on 2026-10-19; with an archive that is one query
// (SELECT deleted_at, deleted_rev FROM chats), and the rows are kilobytes. Read APIs do not serve archived chats. Archived rows older
// than `archiveDays` (30) are dropped, so the index does not grow without end.

const crypto = require('crypto')
const { decodeSave, parseBlock } = require('./dbMerge.cjs')

const DAY = 24 * 60 * 60 * 1000
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16)
const hashBytes = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 16)

// words that mark a timeline line as a death of the name before them (passive or intransitive only: "X killed Y" kills Y, not X)
const DEATH = ['died', 'dies', 'is dead', 'was killed', 'were killed', 'was slain', 'perished', 'chết', 'tử trận', 'tử vong', 'bị giết', 'qua đời', 'hy sinh', 'đã chết']
const NOT_NPC = new Set(['tôi', 'ta', 'mình', 'i', 'me', 'we', 'us', 'you', 'ngươi', 'chúng tôi', 'chúng ta', 'mc', 'player', 'người chơi', 'self', '—', '-', ''])

function lines(v) {
    if (v === undefined || v === null || v === 'null') return []
    return String(v).split('\n').map((l) => l.trim()).filter(Boolean)
}
const parts = (l) => l.split('|').map((x) => x.trim())

/** st_* (the panel) and gm_* (the Game Master) keep their history; gm_prev / gm_at are the page's rollback bookkeeping */
const GM_BOOK = new Set(['gm_prev', 'gm_at', 'gm_beat_at', 'gm_path_at', 'gm_adv_at', 'gm_adv_prev'])
const keepsHistory = (k) => k.startsWith('st_') || (k.startsWith('gm_') && !GM_BOOK.has(k))

/** chat variables as the cards wrote them: scriptstate keys are '$' + name (src/ts/parser/chatVar.svelte.ts setChatVar) */
function chatVars(chat) {
    const out = {}
    for (const [k, v] of Object.entries(chat.scriptstate ?? {})) {
        if (!k.startsWith('$')) continue
        out[k.slice(1)] = v === null || v === undefined ? '' : String(v)
    }
    return out
}

function ledger(vars) {
    const memories = lines(vars.led_mem).map((l) => { const p = parts(l); return p.length > 1 ? { subject: p[0], text: p.slice(1).join(' | ') } : { subject: null, text: l } })
    const relations = lines(vars.led_rel).map((l) => { const p = parts(l); return { a: p[0] ?? '', b: p[1] ?? '', how: p.slice(2).join(' | ') } })
    const timeline = lines(vars.led_ev).map((l) => { const p = parts(l); return p.length > 1 ? { at: p[0], event: p.slice(1).join(' | ') } : { at: '', event: l } })
    return { memories, relations, timeline }
}

const lower = (s) => String(s ?? '').normalize('NFC').toLowerCase()
const isLetter = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch)
/** positions where `name` occurs in `text` as a whole word (both lower-cased) */
function wordAt(text, name) {
    const out = []
    if (!name) return out
    for (let i = text.indexOf(name); i >= 0; i = text.indexOf(name, i + 1)) {
        if (!isLetter(text[i - 1]) && !isLetter(text[i + name.length])) out.push(i)
    }
    return out
}
/** the npc names a death word in this line applies to: the nearest name before the word */
function deathsIn(text, names) {
    const t = lower(text)
    const dead = new Set()
    for (const w of DEATH) {
        for (let q = t.indexOf(w); q >= 0; q = t.indexOf(w, q + 1)) {
            let best = null
            let bestPos = -1
            for (const n of names) for (const p of wordAt(t, n)) if (p < q && p > bestPos) { best = n; bestPos = p }
            if (best) dead.add(best)
        }
    }
    return dead
}

/** NPCs of a chat: names from relations and memory subjects, minus the player; last seen and status from the timeline */
function deriveNpcs(vars, led, places) {
    const player = new Set([lower(vars.st_name), lower(vars.st_truename)].filter(Boolean))
    const names = new Map()   // lower -> shown
    const add = (n, source) => {
        const shown = String(n ?? '').trim()
        const key = lower(shown)
        if (NOT_NPC.has(key) || player.has(key) || key.length < 2) return
        if (!names.has(key)) names.set(key, { name: shown, sources: new Set() })
        names.get(key).sources.add(source)
    }
    for (const r of led.relations) { add(r.a, 'relation'); add(r.b, 'relation') }
    for (const m of led.memories) if (m.subject) add(m.subject, 'memory')
    const keys = [...names.keys()]
    const out = []
    for (const [key, info] of names) {
        let last = null
        let dead = false
        led.timeline.forEach((e, i) => {
            const t = lower(e.event)
            if (!wordAt(t, key).length) return
            last = { i, e }
            if (deathsIn(e.event, keys).has(key)) dead = true
        })
        let place = null
        if (last) {
            const t = lower(last.e.event)
            for (const p of places) if (p && wordAt(t, lower(p)).length) { place = p; break }
        }
        out.push({
            name: info.name,
            status: dead ? 'dead' : last ? 'seen' : 'known',
            last_seen_at: last ? last.e.at : null,
            last_seen_place: place,
            last_event: last ? last.e.event : null,
            source: [...info.sources].sort().join(','),
        })
    }
    return out
}

const CANON_TITLE = /^\s*(region|canon)\b/i
const CANON_MARK = '[Checked against the novel claim by claim'   // fate-simulator/build.py puts it on every regions/*.md card

function openStoryStore(opts) {
    const Database = require('better-sqlite3')
    const now = opts.now ?? Date.now
    const archiveDays = opts.archiveDays ?? 30
    const log = opts.log ?? (() => {})
    const db = new Database(opts.dbFile)
    db.pragma('journal_mode = WAL')
    db.exec(`
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS characters (char_id TEXT PRIMARY KEY, block TEXT NOT NULL, name TEXT, block_hash TEXT, lore_hash TEXT,
            updated INTEGER, deleted_at INTEGER, deleted_rev INTEGER);
        CREATE TABLE IF NOT EXISTS chats (chat_id TEXT PRIMARY KEY, char_id TEXT NOT NULL, name TEXT, messages INTEGER, last_message_at INTEGER,
            vars_hash TEXT, first_rev INTEGER, synced_rev INTEGER, updated INTEGER, deleted_at INTEGER, deleted_rev INTEGER);
        CREATE INDEX IF NOT EXISTS chats_char ON chats (char_id);
        CREATE TABLE IF NOT EXISTS state (chat_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT, updated_rev INTEGER, PRIMARY KEY (chat_id, key));
        CREATE TABLE IF NOT EXISTS state_history (chat_id TEXT NOT NULL, key TEXT NOT NULL, rev INTEGER NOT NULL, old_value TEXT, new_value TEXT,
            at INTEGER, PRIMARY KEY (chat_id, key, rev));
        CREATE TABLE IF NOT EXISTS memories (chat_id TEXT NOT NULL, pos INTEGER NOT NULL, subject TEXT, text TEXT, first_rev INTEGER, PRIMARY KEY (chat_id, pos));
        CREATE TABLE IF NOT EXISTS relations (chat_id TEXT NOT NULL, pos INTEGER NOT NULL, a TEXT, b TEXT, how TEXT, first_rev INTEGER, PRIMARY KEY (chat_id, pos));
        CREATE TABLE IF NOT EXISTS timeline (chat_id TEXT NOT NULL, pos INTEGER NOT NULL, at TEXT, event TEXT, first_rev INTEGER, PRIMARY KEY (chat_id, pos));
        CREATE TABLE IF NOT EXISTS npcs (chat_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT, last_seen_at TEXT, last_seen_place TEXT,
            last_event TEXT, source TEXT, PRIMARY KEY (chat_id, name));
        CREATE TABLE IF NOT EXISTS lore (char_id TEXT NOT NULL, idx INTEGER NOT NULL, title TEXT, keys TEXT, hash TEXT, canon INTEGER, PRIMARY KEY (char_id, idx));
    `)
    const q = {
        getChar: db.prepare('SELECT * FROM characters WHERE block = ?'),
        liveChars: db.prepare('SELECT char_id, block FROM characters WHERE deleted_at IS NULL'),
        putChar: db.prepare(`INSERT INTO characters (char_id, block, name, block_hash, lore_hash, updated, deleted_at, deleted_rev) VALUES (@char_id, @block, @name, @block_hash, @lore_hash, @updated, NULL, NULL)
            ON CONFLICT(char_id) DO UPDATE SET block = @block, name = @name, block_hash = @block_hash, lore_hash = @lore_hash, updated = @updated, deleted_at = NULL, deleted_rev = NULL`),
        archiveChar: db.prepare('UPDATE characters SET deleted_at = ?, deleted_rev = ? WHERE char_id = ? AND deleted_at IS NULL'),
        getChat: db.prepare('SELECT * FROM chats WHERE chat_id = ?'),
        liveChatsOf: db.prepare('SELECT chat_id FROM chats WHERE char_id = ? AND deleted_at IS NULL'),
        putChat: db.prepare(`INSERT INTO chats (chat_id, char_id, name, messages, last_message_at, vars_hash, first_rev, synced_rev, updated) VALUES (@chat_id, @char_id, @name, @messages, @last_message_at, @vars_hash, @rev, @rev, @updated)
            ON CONFLICT(chat_id) DO UPDATE SET char_id = @char_id, name = @name, messages = @messages, last_message_at = @last_message_at, vars_hash = @vars_hash, synced_rev = @rev, updated = @updated, deleted_at = NULL, deleted_rev = NULL`),
        touchChat: db.prepare('UPDATE chats SET name = ?, messages = ?, last_message_at = ?, synced_rev = ?, deleted_at = NULL, deleted_rev = NULL WHERE chat_id = ?'),
        archiveChat: db.prepare('UPDATE chats SET deleted_at = ?, deleted_rev = ? WHERE chat_id = ? AND deleted_at IS NULL'),
        stateOf: db.prepare('SELECT key, value FROM state WHERE chat_id = ?'),
        putState: db.prepare('INSERT OR REPLACE INTO state (chat_id, key, value, updated_rev) VALUES (?, ?, ?, ?)'),
        delState: db.prepare('DELETE FROM state WHERE chat_id = ? AND key = ?'),
        putHistory: db.prepare('INSERT OR REPLACE INTO state_history (chat_id, key, rev, old_value, new_value, at) VALUES (?, ?, ?, ?, ?, ?)'),
        oldLines: (table) => db.prepare(`SELECT * FROM ${table} WHERE chat_id = ?`),
        clear: (table) => db.prepare(`DELETE FROM ${table} WHERE chat_id = ?`),
        putMem: db.prepare('INSERT INTO memories (chat_id, pos, subject, text, first_rev) VALUES (?, ?, ?, ?, ?)'),
        putRel: db.prepare('INSERT INTO relations (chat_id, pos, a, b, how, first_rev) VALUES (?, ?, ?, ?, ?, ?)'),
        putEv: db.prepare('INSERT INTO timeline (chat_id, pos, at, event, first_rev) VALUES (?, ?, ?, ?, ?)'),
        putNpc: db.prepare('INSERT INTO npcs (chat_id, name, status, last_seen_at, last_seen_place, last_event, source) VALUES (?, ?, ?, ?, ?, ?, ?)'),
        delLore: db.prepare('DELETE FROM lore WHERE char_id = ?'),
        putLore: db.prepare('INSERT INTO lore (char_id, idx, title, keys, hash, canon) VALUES (?, ?, ?, ?, ?, ?)'),
        regionKeys: db.prepare("SELECT keys FROM lore WHERE char_id = ? AND canon = 1 AND title LIKE 'Region%'"),
        setMeta: db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)'),
        oldArchived: db.prepare('SELECT chat_id FROM chats WHERE deleted_at IS NOT NULL AND deleted_at < ?'),
    }
    const childTables = ['state', 'state_history', 'memories', 'relations', 'timeline', 'npcs']
    const clears = Object.fromEntries([...childTables, 'chats'].map((t) => [t, t === 'chats' ? db.prepare('DELETE FROM chats WHERE chat_id = ?') : q.clear(t)]))
    const olds = { memories: q.oldLines('memories'), relations: q.oldLines('relations'), timeline: q.oldLines('timeline') }

    /** first_rev of each line: kept from the previous rows when the same line is still there (same text, matched once each) */
    function carry(prev, rows, keyOf, rev) {
        const pool = new Map()
        for (const p of prev) { const k = keyOf(p); if (!pool.has(k)) pool.set(k, []); pool.get(k).push(p.first_rev) }
        return rows.map((r) => { const l = pool.get(keyOf(r)); return l && l.length ? l.shift() : rev })
    }

    function syncLore(charId, lore) {
        const list = Array.isArray(lore) ? lore : []
        q.delLore.run(charId)
        list.forEach((e, i) => {
            const title = String(e?.comment ?? '')
            const keys = String(e?.key ?? '')
            const content = String(e?.content ?? '')
            const canon = CANON_TITLE.test(title) || content.startsWith(CANON_MARK) ? 1 : 0
            q.putLore.run(charId, i, title, keys, sha(`${title}\u0000${keys}\u0000${content}`), canon)
        })
    }

    function placesOf(charId, vars) {
        const out = []
        for (const r of q.regionKeys.all(charId)) for (const k of String(r.keys).split(',')) if (k.trim().length >= 4) out.push(k.trim())
        if (vars.st_place) out.push(vars.st_place)
        return out
    }

    function syncChat(charId, chat, rev, t) {
        const vars = chatVars(chat)
        const varsHash = sha(JSON.stringify(Object.entries(vars).sort()))
        const msgs = Array.isArray(chat.message) ? chat.message : []
        const lastAt = msgs.reduce((m, x) => (typeof x?.time === 'number' && x.time > m ? x.time : m), 0) || null
        const row = q.getChat.get(chat.id)
        if (row && row.vars_hash === varsHash && row.char_id === charId) {
            if (row.deleted_at !== null || row.messages !== msgs.length || row.name !== (chat.name ?? null)) q.touchChat.run(chat.name ?? null, msgs.length, lastAt, rev, chat.id)
            return false
        }
        q.putChat.run({ chat_id: chat.id, char_id: charId, name: chat.name ?? null, messages: msgs.length, last_message_at: lastAt, vars_hash: varsHash, rev, updated: t })
        // panel variables: every st_* change is kept with its revision (rank changes are checked against the timeline), and every
        // change of the Game Master's state (gm_*: the player's arc, side, enemies; src/ts/process/gameMaster.ts) for a long chat
        const before = new Map(q.stateOf.all(chat.id).map((r) => [r.key, r.value]))
        for (const [k, v] of Object.entries(vars)) {
            if (k.startsWith('led_')) continue
            if (before.get(k) === v) continue
            if (keepsHistory(k) && row) q.putHistory.run(chat.id, k, rev, before.has(k) ? before.get(k) : null, v, t)
            q.putState.run(chat.id, k, v, rev)
        }
        for (const k of before.keys()) if (!(k in vars)) q.delState.run(chat.id, k)
        // the ledger, line by line
        const led = ledger(vars)
        const pm = olds.memories.all(chat.id), pr = olds.relations.all(chat.id), pe = olds.timeline.all(chat.id)
        const fm = carry(pm, led.memories, (x) => `${x.subject}|${x.text}`, rev)
        const fr = carry(pr, led.relations, (x) => `${x.a}|${x.b}|${x.how}`, rev)
        const fe = carry(pe, led.timeline, (x) => `${x.at}|${x.event}`, rev)
        for (const tb of ['memories', 'relations', 'timeline', 'npcs']) clears[tb].run(chat.id)
        led.memories.forEach((m, i) => q.putMem.run(chat.id, i, m.subject, m.text, fm[i]))
        led.relations.forEach((r, i) => q.putRel.run(chat.id, i, r.a, r.b, r.how, fr[i]))
        led.timeline.forEach((e, i) => q.putEv.run(chat.id, i, e.at, e.event, fe[i]))
        for (const n of deriveNpcs(vars, led, placesOf(charId, vars))) q.putNpc.run(chat.id, n.name, n.status, n.last_seen_at, n.last_seen_place, n.last_event, n.source)
        return true
    }

    /**
     * Brings the index in step with one stored version of the save. Returns what changed. Never throws on a save it cannot read
     * (the caller stores the write anyway); it reports {error}.
     */
    const syncTx = db.transaction((blocks, rev, t) => {
        const report = { characters: 0, chats: 0, archived: 0, restored: 0, skipped: 0 }
        const present = new Set(blocks.map((b) => b.name))
        const seenChars = new Set()
        for (const b of blocks) {
            const prev = q.getChar.get(b.name)
            const h = hashBytes(b.data)
            if (prev && prev.block_hash === h && prev.deleted_at === null) { seenChars.add(prev.char_id); report.skipped++; continue }
            const v = parseBlock(b)
            if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.chaId !== 'string' || !Array.isArray(v.chats)) continue
            const charId = v.chaId
            seenChars.add(charId)
            report.characters++
            const loreHash = sha(JSON.stringify((v.globalLore ?? []).map((e) => [e?.comment, e?.key, e?.content])))
            const old = db.prepare('SELECT lore_hash, deleted_at FROM characters WHERE char_id = ?').get(charId)
            q.putChar.run({ char_id: charId, block: b.name, name: v.name ?? null, block_hash: h, lore_hash: loreHash, updated: t })
            if (!old || old.lore_hash !== loreHash) syncLore(charId, v.globalLore)
            const ids = new Set()
            for (const chat of v.chats) {
                if (!chat || typeof chat.id !== 'string') continue
                ids.add(chat.id)
                const was = q.getChat.get(chat.id)
                if (syncChat(charId, chat, rev, t)) report.chats++
                if (was && was.deleted_at !== null) { report.restored++; log(`story: chat ${chat.id.slice(0, 8)} is back (rev ${rev})`) }
            }
            for (const r of q.liveChatsOf.all(charId)) {
                if (!ids.has(r.chat_id)) { q.archiveChat.run(t, rev, r.chat_id); report.archived++; log(`story: chat ${r.chat_id.slice(0, 8)} left the save (rev ${rev}), archived`) }
            }
        }
        // a character whose block is gone from the save: it and its chats are archived (a block that is there but unreadable, e.g. a
        // remote character, is not "gone")
        for (const c of q.liveChars.all()) {
            if (seenChars.has(c.char_id) || present.has(c.block)) continue
            q.archiveChar.run(t, rev, c.char_id)
            for (const r of q.liveChatsOf.all(c.char_id)) { q.archiveChat.run(t, rev, r.chat_id); report.archived++ }
        }
        for (const r of q.oldArchived.all(t - archiveDays * DAY)) for (const tb of [...childTables, 'chats']) clears[tb].run(r.chat_id)
        q.setMeta.run('rev', String(rev ?? ''))
        q.setMeta.run('synced_at', String(t))
        return report
    })

    function sync(bytes, rev) {
        let blocks
        try {
            blocks = decodeSave(bytes)
        } catch (error) {
            return { error: error.message }
        }
        return syncTx(blocks, rev ?? null, now())
    }

    // ---- reads ---------------------------------------------------------------------------------------------------------------------
    const rd = {
        chat: db.prepare('SELECT c.*, ch.name AS character FROM chats c LEFT JOIN characters ch ON ch.char_id = c.char_id WHERE c.chat_id = ?'),
        state: db.prepare('SELECT key, value, updated_rev FROM state WHERE chat_id = ? ORDER BY key'),
        npcs: db.prepare('SELECT name, status, last_seen_at, last_seen_place, last_event, source FROM npcs WHERE chat_id = ? ORDER BY name'),
        timeline: db.prepare('SELECT pos, at, event, first_rev FROM timeline WHERE chat_id = ? ORDER BY pos'),
        memories: db.prepare('SELECT pos, subject, text, first_rev FROM memories WHERE chat_id = ? ORDER BY pos'),
        relations: db.prepare('SELECT pos, a, b, how, first_rev FROM relations WHERE chat_id = ? ORDER BY pos'),
        history: db.prepare('SELECT key, rev, old_value, new_value, at FROM state_history WHERE chat_id = ? ORDER BY rev, key'),
        lore: db.prepare('SELECT idx, title, keys, hash, canon FROM lore WHERE char_id = ? ORDER BY idx'),
    }
    /** the story of a live chat, or null (unknown or archived) */
    function story(chatId) {
        const c = rd.chat.get(chatId)
        if (!c || c.deleted_at !== null) return null
        const state = {}
        for (const r of rd.state.all(chatId)) state[r.key] = r.value
        return {
            chat: { id: c.chat_id, name: c.name, character: c.character, char_id: c.char_id, messages: c.messages, last_message_at: c.last_message_at, synced_rev: c.synced_rev },
            state,
            npcs: rd.npcs.all(chatId),
            timeline: rd.timeline.all(chatId),
            memories: rd.memories.all(chatId),
            relations: rd.relations.all(chatId),
        }
    }
    const history = (chatId) => rd.history.all(chatId)
    const lore = (charId) => rd.lore.all(charId)
    const chatRow = (chatId) => db.prepare('SELECT * FROM chats WHERE chat_id = ?').get(chatId) ?? null
    const close = () => db.close()
    return { sync, story, history, lore, chatRow, close, db }
}

module.exports = { openStoryStore, chatVars, keepsHistory, ledger, deriveNpcs, deathsIn, wordAt, DEATH }
