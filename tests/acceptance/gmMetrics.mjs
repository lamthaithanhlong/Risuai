#!/usr/bin/env node
// Counts, over an acceptance run's records (run.mjs OUT/<story>.json), what the GM's solver is meant to keep out (2026-10-21):
//   invented   an NPC's offer, bait or bargain on a need the story had not established before the turn (thirst, hunger, a wound, being
//              lost, no shelter, no money): the Shadow Slave water lure. Established = the panel's condition before the turn or the last
//              4 messages, read with the solver's own word lists (gmSolver.cjs needsIn).
//   dead       an NPC the timeline recorded dead before the turn speaks or acts in the reply (not as a body, a grave, a memory)
//   absent     an NPC last seen at another place speaks or acts in the reply with no arrival, and the player did not seek them
//   newTwice   two story turns in a row asked for a new event (the pace clock's advance mark or the card's NEW mark on both)
//   beatTwice  the beat's step rose on two story turns in a row (the bookkeeper writes a step only when a new event arrived)
// The first three are word heuristics: every candidate is printed with its sentence so it can be read, and the totals say "flagged".
//   node tests/acceptance/gmMetrics.mjs DIR [DIR2]     one run, or two side by side (before, after)
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const G = require('../../server/node/gmSolver.cjs')
const { ledger, deriveNpcs, deathsIn, wordAt } = require('../../server/node/storyStore.cjs')

const lower = (s) => String(s ?? '').normalize('NFC').toLowerCase()
const plain = (t) => lower(String(t ?? '').replace(/\[\[[A-Z_]+[\s\S]*?(\]\]|$)/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\[💡[^\]]*\]/g, ' '))
const words = (alts) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'iu')
const OFFER = words('cho|đưa|mời|tặng|chỉ cho|chỉ chỗ|dẫn|đổi|đổi lấy|bán|chia|giúp|biếu|offer|offers|give|gives|show you|trade|share|sell')
const NEED_OBJ = {
    thirst: words('nước uống|bình nước|ngụm nước|chỗ có nước|nguồn nước|nước sạch|giếng|water'),
    hunger: words('đồ ăn|thức ăn|bánh mì|miếng bánh|ổ bánh|cơm|bát cháo|khẩu phần|miếng thịt|food|bread|meal'),
    wound: words('thuốc|băng bó|băng vải|chữa|thuốc men|cầm máu|medicine|bandage|heal'),
    lost: words('chỉ đường|dẫn đường|lối ra|đường ra|đường về|the way'),
    shelter: words('chỗ ngủ|chỗ trú|chỗ nghỉ|mái che|shelter|a bed'),
}
const REMAINS = words('xác|thi thể|mộ|tang|chôn|tiếng vọng|tưởng nhớ|nhớ về|nhớ lại|ký ức|corpse|body|grave|buried|remember|memory')
const ACTS = words('nói|đáp|hỏi|cười|gật|bước|quay|nhìn|lên tiếng|thì thầm|hét|rút|chém|đưa|says|said|asks|smiles|steps|turns|looks')
const ARRIVE = words('đến|tới|xuất hiện|bước vào|trở lại|quay lại|tìm đến|chạy tới|arrives|appears|came|comes|enters')
const sentences = (t) => plain(t).split(/(?<=[.!?…"”])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
const stepOf = (beat) => { const n = /\d+/.exec(String(beat ?? '').split('|')[0]); return n ? Number(n[0]) : null }
const num = (x) => (x === undefined || x === null || x === '' ? -1 : Number(x))

function storyMetrics(rec) {
    const turns = rec.play?.turns ?? []
    const out = { story: rec.story, turns: 0, invented: [], dead: [], absent: [], newTwice: 0, beatTwice: 0, askedNew: 0 }
    let replies = 0
    let prevAsked = false, prevBeatUp = false
    let prevVars = {}
    const history = []   // [{role, text}]
    for (const t of turns) {
        const before = replies
        if (t.ok) replies++
        if (t.phase !== 'story' || !t.ok) { history.push({ role: 'user', text: t.text }, { role: 'char', text: t.reply }); prevVars = t.vars ?? prevVars; continue }
        out.turns++
        const v = t.vars ?? {}
        const pv = prevVars
        // the window the solver reads: the panel before the turn and the last 4 messages, the player's turn included
        const window = [...history.slice(-3), { role: 'user', text: t.text }]
        const established = new Set()
        for (const [k, x] of Object.entries(pv)) if (/^st_(condition|health|hp|body|wounds?|status|state|injur|infection)/.test(k)) for (const n of G.needsIn(plain(x))) established.add(n)
        for (const m of window) for (const n of G.needsIn(plain(m.text))) established.add(n)
        const pcNames = [pv.st_name, v.st_name].filter(Boolean).map(lower)
        for (const s of sentences(t.reply)) {
            if (!OFFER.test(s)) continue
            for (const [need, re] of Object.entries(NEED_OBJ)) {
                if (!re.test(s) || established.has(need)) continue
                const giver = s.slice(0, s.search(OFFER))
                if (pcNames.some((p) => p && giver.includes(p.split(' ')[0])) || /^(tôi|ta|mình|i)\b/.test(giver.trim())) continue
                out.invented.push({ turn: t.label, need, sentence: s.slice(0, 220) })
            }
        }
        // people before the turn: dead, and where they were last seen
        const led = ledger(pv)
        const npcs = deriveNpcs(pv, led, [pv.st_place].filter(Boolean))
        const names = npcs.map((n) => lower(n.name)).filter((n) => n.length >= 3 && !pcNames.includes(n))
        const dead = new Set()
        for (const e of led.timeline) for (const d of deathsIn(e.event, names)) dead.add(d)
        const player = plain(t.text)
        for (const s of sentences(t.reply)) {
            for (const n of names) {
                if (!wordAt(s, n).length || !ACTS.test(s)) continue
                if (dead.has(n) && !REMAINS.test(s)) out.dead.push({ turn: t.label, who: n, sentence: s.slice(0, 220) })
                const np = npcs.find((x) => lower(x.name) === n)
                if (!dead.has(n) && np?.last_seen_place && pv.st_place && lower(np.last_seen_place) !== lower(pv.st_place)
                    && !ARRIVE.test(s) && !wordAt(player, n).length && !wordAt(plain(history.at(-1)?.text), n).length) out.absent.push({ turn: t.label, who: n, sentence: s.slice(0, 220) })
            }
        }
        // the request asked for a new event: the pace clock's advance mark or the card's NEW mark is this request's
        const asked = num(v.gm_adv_at) === before || num(v.gm_new_at) === before
        if (asked) out.askedNew++
        if (asked && prevAsked) out.newTwice++
        const up = stepOf(v.gm_beat) !== null && stepOf(pv.gm_beat) !== null && stepOf(v.gm_beat) > stepOf(pv.gm_beat)
        if (up && prevBeatUp) out.beatTwice++
        prevAsked = asked; prevBeatUp = up
        history.push({ role: 'user', text: t.text }, { role: 'char', text: t.reply })
        prevVars = v
    }
    return out
}

function runMetrics(dir) {
    const out = []
    for (const k of ['ss', 'lotm', 'mailman', 'zombie']) {
        const f = path.join(dir, `${k}.json`)
        if (fs.existsSync(f)) out.push(storyMetrics(JSON.parse(fs.readFileSync(f, 'utf8'))))
    }
    return out
}

const sum = (rows, key) => rows.reduce((a, r) => a + (Array.isArray(r[key]) ? r[key].length : r[key]), 0)
const dirs = process.argv.slice(2)
if (!dirs.length) { console.error('usage: gmMetrics.mjs DIR [DIR2]'); process.exit(2) }
const runs = dirs.map((d) => ({ dir: d, rows: runMetrics(d) }))
for (const r of runs) {
    console.log(`\n== ${r.dir}`)
    for (const x of r.rows) {
        console.log(`${x.story}: ${x.turns} story turns; invented-need offers flagged ${x.invented.length}; dead acting ${x.dead.length}; absent acting flagged ${x.absent.length}; asked new ${x.askedNew}, twice in a row ${x.newTwice}; beat rose twice in a row ${x.beatTwice}`)
        for (const c of [...x.invented.map((c) => ['invented', c]), ...x.dead.map((c) => ['dead', c]), ...x.absent.map((c) => ['absent', c])]) console.log(`   ${c[0]} ${c[1].turn} ${c[1].need ?? c[1].who}: ${c[1].sentence}`)
    }
    console.log(`TOTAL ${sum(r.rows, 'turns')} turns: invented ${sum(r.rows, 'invented')}, dead ${sum(r.rows, 'dead')}, absent ${sum(r.rows, 'absent')}, newTwice ${sum(r.rows, 'newTwice')}/${sum(r.rows, 'askedNew')} asked, beatTwice ${sum(r.rows, 'beatTwice')}`)
}
