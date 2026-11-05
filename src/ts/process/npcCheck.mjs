// NPC dialogue: state, verdict, post-check (design .pm-risu-5h/npc-dialogue-algorithm.md, approved by L1 2026-11-05).
//
// Owner 2026-11-05 ("npc hội thoại lúc nào cũng ngu ngu"), Zombie, the 704 balcony woman:
//   class 1  “Đừng gọi ai. Tôi bị kính cửa thôi.”                      clipped / missing verb            -> npc-grammar
//   class 2  “Có một phòng khám gần Kisaragi Cũ… nếu anh tìm được…”      the NPC as a quest dispenser      -> npc-quest-hook
//   class 3  “Vậy anh giữ lại mà dùng. Tôi chỉ xin thuốc giảm đau.”     refuses what she needs, asks for what she holds -> npc-contradicts-need
//   class 4  “Tôi chỉ đang cố giữ cánh tay này khỏi nhiễm trùng.”      unprompted motive exposition      -> npc-exposition
// Owner popups (2026-11-05): (a) a direct question needs the address term of the relationship ("Anh còn thuốc không, cho em xin ít?"),
// else npc-address; (b) refusing a need is allowed ONLY when she distrusts the player AND the line says why.
//
// MIRROR RULE: accept() is the Dafny predicate Accept of
//   ~/Downloads/architecture-debug/specs/risu-npc-dialogue/NpcDialogue.dfy (copy: tests/spec/NpcDialogue.dfy)
// clause for clause, in the same order; stepNpc() is Dafny Step. Change the .dfy first, re-run `./tools/dafny --spec
// risu-npc-dialogue`, then `node tests/spec/gen-npc-dafny-tests.mjs` (npcCheck.dafny.test.ts is generated from the Witness lemmas).
//
// State: the ledger $led_npc, lines "n | npc_id | op value" (n = the reply count, like $led_soc; a reroll takes them away with the
// panel snapshot). foldNpc(ledger, beforeN) folds the lines of replies < beforeN: the state BEFORE the reply being checked.

// ---- items ---------------------------------------------------------------------------------------------------------------------
/** item id -> [Vietnamese label, pattern]; the first match in a phrase wins (longest phrases first) */
export const ITEM_LEX = [
    ['thuoc_ha_sot', 'thuốc hạ sốt', /thuốc hạ sốt|hạ sốt|thuốc sốt/u],
    ['thuoc_giam_dau', 'thuốc giảm đau', /thuốc giảm đau|giảm đau|thuốc đau/u],
    ['khang_sinh', 'thuốc kháng sinh', /kháng sinh/u],
    ['do_rua_vet_thuong', 'đồ rửa vết thương', /rửa vết thương|nước rửa|nước muối|oxy già|cồn sát trùng|sát trùng/u],
    ['bang_gac', 'băng gạc', /băng gạc|cuộn băng|băng cá nhân|gạc/u],
    ['nuoc', 'nước uống', /nước uống|chai nước|bình nước|(?<!\p{L})(?:ít|chút|xin|cần|có|còn|thêm) nước(?! (?:mắt|rửa|muối|ngoài))/u],
    ['do_an', 'đồ ăn', /đồ ăn|thức ăn|đồ hộp|lương khô|mì gói|bánh mì|gạo/u],
]
const LABEL = Object.fromEntries(ITEM_LEX.map(([id, vi]) => [id, vi]))
export const itemLabel = (id) => LABEL[id] ?? String(id).replace(/_/g, ' ')
/** a bare container word ("gói thuốc", "nó") stands for the item last mentioned in the scene */
const VAGUE_ITEM = /(?<!\p{L})(?:gói|vỉ|hộp|viên|lọ|túi|chai) thuốc(?!\s*(?:hạ|giảm|kháng))|(?<!\p{L})thuốc(?!\s*(?:hạ|giảm|kháng|sốt|đau))(?!\p{L})/u

/** the items a text names, in order of appearance (vague words resolved to `last`, else 'unknown_item') */
export function itemsIn(text, last = '') {
    const found = []
    const t = String(text ?? '').normalize('NFC').toLowerCase()
    for (const [id, , re] of ITEM_LEX) {
        const m = new RegExp(re.source, 'gu')
        for (const x of t.matchAll(m)) found.push([x.index, id])
    }
    if (!found.length && VAGUE_ITEM.test(t)) found.push([0, last || 'unknown_item'])
    found.sort((a, b) => a[0] - b[0])
    return [...new Set(found.map((f) => f[1]))]
}

// ---- the verdict (Dafny Accept) --------------------------------------------------------------------------------------------
export const MAX_SENTENCES = 2      // Dafny MaxSentences
export const LOW_TRUST = 40         // Dafny LowTrust (owner popup b)
const inter = (a, b) => [...a].filter((x) => b.has(x))
const subset = (a, b) => [...a].every((x) => b.has(x))

/**
 * Dafny Accept(s, f), one entry per failing clause (empty = accepted). s: {isAdmin, needs:Set, has:Map, trust, received:Set};
 * f: {requests, offers, refusals, handed: Set; questHook, exposition, playerAskedWhy, reasonFlag, unaddressed: bool; sentences}.
 */
export function accept(s, f) {
    const hits = []
    const has = new Set(s.has.keys())
    // (1) AcceptNoNeedRefusal / AcceptTrustedNeverRefusesNeed: no refusal of a need, unless distrust (trust < LowTrust) and a stated reason
    if (!(inter(f.refusals, s.needs).length === 0 || (f.reasonFlag && s.trust < LOW_TRUST))) hits.push({ rule: 'npc-contradicts-need', clause: 1, items: inter(f.refusals, s.needs) })
    // (2) AcceptNoPhantomItem: nothing handed or placed that she does not hold, nor offered
    if (!subset(f.handed, has)) hits.push({ rule: 'npc-phantom-item', clause: 2, items: [...f.handed].filter((x) => !has.has(x)) })
    if (!subset(f.offers, has)) hits.push({ rule: 'npc-phantom-item', clause: 2, items: [...f.offers].filter((x) => !has.has(x)) })
    // (3) AcceptHookOnlyAdmin: only Admin gives tasks
    if (f.questHook && !s.isAdmin) hits.push({ rule: 'npc-quest-hook', clause: 3 })
    // (4) AcceptNoUnpromptedExposition
    if (f.exposition && !f.playerAskedWhy) hits.push({ rule: 'npc-exposition', clause: 4 })
    // (5) AcceptSentenceCap: 1..MaxSentences
    if (!(1 <= f.sentences && f.sentences <= MAX_SENTENCES)) hits.push({ rule: 'npc-long', clause: 5, n: f.sentences })
    //     never asks for what she already holds (part of clause 1's class in the scorer)
    if (inter(f.requests, has).length) hits.push({ rule: 'npc-contradicts-need', clause: 5, items: inter(f.requests, has) })
    // (6) AcceptAddressed: a direct question/request carries an address term (owner popup a)
    if (f.unaddressed) hits.push({ rule: 'npc-address', clause: 6 })
    // (7) AcceptInnerLine: the hidden inner line [[NPC|…]]: never refuses what she wants now (same distrust exception), never says what she withholds
    const wants = f.wantsNow ?? new Set()
    if (!(inter(f.refusals, wants).length === 0 || (f.reasonFlag && s.trust < LOW_TRUST))) hits.push({ rule: 'npc-inner', clause: 7, items: inter(f.refusals, wants) })
    if (f.leaksWithheld) hits.push({ rule: 'npc-inner', clause: 7, why: 'says what she withholds' })
    // (8) AcceptVoice: her voice card: no forbidden word, no sentence longer than her voice
    const forb = s.forbidden ?? new Set()
    if (inter(f.forbiddenUsed ?? new Set(), forb).length) hits.push({ rule: 'npc-voice', clause: 8, items: inter(f.forbiddenUsed, forb) })
    if (!((s.maxWords ?? 0) === 0 || (f.longestSentence ?? 0) <= s.maxWords)) hits.push({ rule: 'npc-voice', clause: 8, n: f.longestSentence })
    // (9) AcceptOnlyKnownEvents: she refers only to events she was present for or learned (logged ops)
    const knows = s.knows ?? new Set()
    if (![...(f.mentions ?? [])].every((e) => knows.has(e))) hits.push({ rule: 'npc-unwitnessed', clause: 9, items: [...f.mentions].filter((e) => !knows.has(e)) })
    return hits
}

/** Dafny Take / Put / Step: the player gives `given`, she hands over f.handed, new requests become needs. */
export function stepNpc(s, f, given = new Set(), dTrust = 0) {
    const has = new Map()
    for (const [k, v] of s.has) { const n = f.handed.has(k) ? v - 1 : v; if (n >= 1) has.set(k, n) }          // Take
    for (const k of given) has.set(k, (has.get(k) ?? 0) + 1)                                                 // Put
    const received = new Set([...s.received, ...given])
    const needs = new Set([...s.needs, ...f.requests].filter((x) => !received.has(x) && !has.has(x)))
    const trust = Math.min(100, Math.max(0, s.trust + dTrust))
    return { ...s, has, received, needs, trust }
}

// ---- the ledger -----------------------------------------------------------------------------------------------------------------
const TRUST_OF = { low: 30, mid: 55, high: 80, 'thấp': 30, 'vừa': 55, 'cao': 80 }
export const NPC_OPS = ['meet', 'need+', 'need-', 'has+', 'has-', 'recv', 'knows+', 'want', 'trust', 'promise+', 'promise-', 'why', 'voice', 'present', 'learn', 'event']
/** the ledger id of the scene's own lines: "n | * | event <slug>;<keyword>,<keyword>" logs an event and the words that name it */
export const EVENTS_ID = '*'
const slug = (s) => String(s ?? '').normalize('NFC').toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40)
/** a ledger item: an ITEM_LEX id as written, or the id of the Vietnamese words */
const itemOf = (v) => { const t = String(v ?? '').trim(); if (LABEL[t]) return t; const i = itemsIn(t); return i[0] && i[0] !== 'unknown_item' ? i[0] : slug(t).replace(/-/g, '_') }

/** a new card: a stranger starts at low trust (owner's balcony woman) */
export function blankNpc(id, name = id) {
    return { id, name, self: 'tôi', toPlayer: 'anh', age: '', isAdmin: false, needs: new Set(), has: new Map(), received: new Set(), knows: new Set(), want: '', trust: 30, promises: new Set(), why: new Set(), lastTurn: -1, forbidden: new Set(), maxWords: 0, tics: '', sample: '', events: new Map() }
}

/** One ledger op on a card; false (nothing changed) when it would break Dafny Inv (stock below 1, a need already received or held). */
export function applyNpcOp(c, op, value, n) {
    const v = String(value ?? '').trim()
    switch (op) {
        case 'meet': { const [name, self, to, age] = v.split(';').map((x) => x.trim()); if (name) c.name = name; if (self) c.self = self; if (to) c.toPlayer = to; if (age) c.age = age; break }
        case 'need+': { const i = itemOf(v); if (c.received.has(i) || c.has.has(i)) return false; c.needs.add(i); break }
        case 'need-': c.needs.delete(itemOf(v)); break
        case 'has+': { const i = itemOf(v); c.has.set(i, (c.has.get(i) ?? 0) + 1); c.needs.delete(i); break }
        case 'has-': { const i = itemOf(v); const k = c.has.get(i) ?? 0; if (k < 1) return false; if (k === 1) c.has.delete(i); else c.has.set(i, k - 1); break }
        case 'recv': { const s = stepNpc(c, { handed: new Set(), requests: new Set() }, new Set([itemOf(v)])); Object.assign(c, { has: s.has, received: s.received, needs: s.needs }); break }
        case 'knows+': c.knows.add(slug(v)); break
        case 'want': c.want = v; break
        case 'trust': { const t = TRUST_OF[v.toLowerCase()] ?? Number(v); if (!Number.isFinite(t)) return false; c.trust = Math.min(100, Math.max(0, t)); break }
        case 'promise+': c.promises.add(slug(v)); break
        case 'promise-': c.promises.delete(slug(v)); break
        case 'why': c.why.add(itemOf(v)); break
        // voice <max words>;<forbidden, words>;<tics>;<a sample line>
        case 'voice': { const [mw, forb, tics, sample] = v.split(';').map((x) => x.trim()); const m = Number(mw); if (Number.isFinite(m) && m >= 0) c.maxWords = m; if (forb) forb.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).forEach((x) => c.forbidden.add(x)); if (tics) c.tics = tics; if (sample) c.sample = sample; break }
        // presence (Talemate Learn): she was there when the event happened, or someone told her (both logged, never inferred from speech)
        case 'present': case 'learn': c.knows.add(slug(v)); break
        // the scene's event log (id "*"): slug and the words that name it
        case 'event': { const [e, kws] = v.split(';'); if (!e) return false; c.events.set(slug(e), String(kws ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)); break }
        default: return false
    }
    c.lastTurn = Math.max(c.lastTurn, n)
    return true
}

/** "n | id | op value" -> {n, id, op, value} or null */
export function parseNpcLine(line) {
    const parts = String(line ?? '').split('|').map((x) => x.trim())
    if (parts.length < 3) return null
    const n = Number(parts[0])
    const m = /^(\S+)\s*(.*)$/su.exec(parts.slice(2).join(' | '))
    if (!Number.isInteger(n) || !parts[1] || !m || !NPC_OPS.includes(m[1])) return null
    const id = parts[1] === EVENTS_ID ? EVENTS_ID : slug(parts[1])
    if (!id) return null
    return { n, id, op: m[1], value: m[2] }
}

/** The cards folded from the ledger lines of replies < beforeN (all when beforeN is omitted). Map id -> card. */
export function foldNpc(ledger, beforeN = Infinity) {
    const cards = new Map()
    for (const raw of String(ledger ?? '').split(/\r?\n/)) {
        const l = parseNpcLine(raw)
        if (!l || l.n >= beforeN) continue
        if (!cards.has(l.id)) cards.set(l.id, blankNpc(l.id, l.id))
        applyNpcOp(cards.get(l.id), l.op, l.value, l.n)
    }
    return cards
}

/** The ledger with this reply's ops appended ("n | id | op value"), deduped on the whole line, the last `max` kept. */
export function appendNpcLines(ledger, n, ops, max = 200) {
    const have = String(ledger ?? '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
    const key = (l) => l.split('|').map((x) => x.trim()).join('|').toLowerCase()
    const seen = new Set(have.map(key))
    let added = 0
    for (const o of ops) {
        const line = `${n} | ${o.id === EVENTS_ID ? EVENTS_ID : slug(o.id)} | ${o.op} ${String(o.value ?? '').trim()}`.trim()
        if (!parseNpcLine(line) || seen.has(key(line))) continue
        seen.add(key(line)); have.push(line); added++
    }
    return { ledger: have.slice(-max).join('\n'), added }
}

/** The helper's `npc: <id> | <op> <value>` lines (the bookkeeper's answer) -> ops; unknown ops dropped, at most 8. */
const NPC_LINE = /^\s*[-*•]?\s*npc\s*:\s*(.*)$/iu
export function npcOpsOf(bodies) {
    const out = []
    for (const body of bodies ?? []) for (const raw of String(body ?? '').split(/\r?\n/)) {
        const m = NPC_LINE.exec(raw)
        if (!m) continue
        const [id, rest] = m[1].split('|').map((x) => x.trim())
        const o = /^(\S+)\s*(.*)$/su.exec(rest ?? '')
        if (!id || !o || !NPC_OPS.includes(o[1])) continue
        out.push({ id, op: o[1], value: o[2] })
        if (out.length >= 8) return out
    }
    return out
}

// ---- the card the narrator reads (GM note) -------------------------------------------------------------------------------------
const trustWord = (t) => (t < LOW_TRUST ? 'thấp' : t < 70 ? 'vừa' : 'cao')
const listVi = (xs) => [...xs].map(itemLabel).join(', ')
const capWords = (s, n) => { const w = s.split(/\s+/); return w.length > n ? w.slice(0, n).join(' ') + '…' : s }
/** One NPC card, at most 160 words. */
export function cardLine(c) {
    const has = [...c.has].map(([k, v]) => (v > 1 ? `${v} ${itemLabel(k)}` : itemLabel(k)))
    const parts = [
        `NPC “${c.name}” (xưng ${c.self}, gọi người chơi ${c.toPlayer}${c.age ? `, ${c.age}` : ''}; tin người chơi: ${trustWord(c.trust)})`,
        c.needs.size ? `cần ${listVi(c.needs)}` : 'không cần gì từ người chơi',
        has.length ? `đang giữ ${has.join(', ')}` : 'không giữ món nào',
        c.received.size ? `đã nhận từ người chơi ${listVi(c.received)}` : '',
        c.want ? `muốn ${c.want}` : '',
        c.why.size ? `có lý do từ chối ${listVi(c.why)}` : '',
        c.knows.size ? `biết ${[...c.knows].join(', ')}` : '',
        c.promises.size ? `đã hứa ${[...c.promises].join(', ')}` : '',
        c.maxWords || c.tics ? `giọng: ${[c.maxWords ? `câu tối đa ${c.maxWords} chữ` : '', c.tics].filter(Boolean).join(', ')}` : '',
        c.forbidden.size ? `không bao giờ nói: ${[...c.forbidden].join(', ')}` : '',
        c.sample ? `ví dụ: “${c.sample}”` : '',
        'chỉ nhắc việc mình có mặt hoặc được kể',
    ].filter(Boolean)
    return capWords(parts.join('; ') + '.', 160)
}

/** The inner-line rule (always in the GM note): before a person other than the player speaks, one hidden line, stripped from the screen. */
export const NPC_INNER_RULE = '\n\n[NPC inner line (hidden, never named): right before the first words a person other than the player\'s character says in this reply, write one line [[NPC|<their id, e.g. ban-cong-704>|<what they want right now>|<what they feel>|<what they hold back>]]; their words follow from it: they never refuse what they want right now without saying why, never say what they hold back, and mention only what they saw or were told.]'

/** The hidden note with the cards of the NPCs active in the last 3 replies (at most 3); the inner-line rule alone when none. */
export function npcCardsNote(ledger, n) {
    const cards = [...foldNpc(ledger, n).values()].filter((c) => !c.isAdmin && c.id !== EVENTS_ID && c.lastTurn >= n - 3).sort((a, b) => b.lastTurn - a.lastTurn).slice(0, 3)
    if (!cards.length) return NPC_INNER_RULE
    return NPC_INNER_RULE + `\n\n[NPC cards (hidden, never named): ${cards.map(cardLine).join(' ')} Each of them says one or two whole sentences built from this card, as a real person: what she needs, holds and knows, asked with the address term on the card; she never refuses what she needs unless she distrusts the player and says why, never asks for what she already holds, never hands out an errand, a place to go or an "if you do X I will Y" (tasks come only from Admin).]`
}

// ---- extraction: reply text -> per-speaker Facts --------------------------------------------------------------------------------
const SPEECH_VERB = '(?:nói|hỏi|đáp|gọi|hét|thì thầm|lẩm bẩm|thốt|kêu|bảo|trả lời|lên tiếng|cất giọng|gắt)'
const SYSTEM_LINE = /【|^\s*(?:\*|_)?\s*(?:QUÉT|GHI NHẬN|NHẬN DẠNG MẪU|HỆ THỐNG|ADMIN)\s*:/u
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The NPC lines of one reply: every “…” quote that is not the player's character speaking and not a System/Admin line.
 * [{ line, para, at }] — para is the paragraph, at the quote's offset in it. A quote is the player's when the player's name (or its
 * first word) is the speaker right before or right after it, or when the reply opens with a paragraph of bare quotes (the narrator
 * echoing the player's words).
 */
export function npcLines(reply, { player = '' } = {}) {
    // a hidden tag line goes with its own line break, so the quote stays in the paragraph it was written in
    const text = String(reply ?? '').replace(/[ \t]*\n?[ \t]*\[\[[\s\S]*?\]\]/g, '').replace(/\[💡[\s\S]*?\]/g, '')
    const names = [...new Set([player, String(player).split(/\s+/)[0]].map((s) => s.trim()).filter(Boolean))]
    const before = names.length ? new RegExp(`(?:${names.map(esc).join('|')})[^.!?“”\\n]{0,24}${SPEECH_VERB}[^.!?“”\\n]{0,16}:?\\s*$`, 'u') : null
    const after = names.length ? new RegExp(`^\\s*(?:${names.map(esc).join('|')})\\s+[^.!?“”\\n]{0,12}${SPEECH_VERB}`, 'u') : null
    const out = []
    const paras = text.split(/\n\s*\n/)
    const first = paras.findIndex((x) => x.trim())
    for (const [k, para] of paras.entries()) {
        if (SYSTEM_LINE.test(para) && !para.includes('“')) continue
        if (k === first && !para.replace(/“[^”]*”/g, '').trim()) continue
        for (const m of para.matchAll(/“([^”]+)”/g)) {
            const line = m[1].trim()
            if (!line || SYSTEM_LINE.test(line)) continue
            const pre = para.slice(Math.max(0, m.index - 60), m.index)
            const post = para.slice(m.index + m[0].length, m.index + m[0].length + 40)
            if ((before && before.test(pre)) || (after && after.test(post))) continue
            out.push({ line, para: para.trim(), at: m.index })
        }
    }
    return out
}

const W = (alts) => new RegExp(`(?<!\\p{L})(?:${alts})(?!\\p{L})`, 'iu')
const ADDRESS = W('anh|chị|em|cậu|cô|chú|bác|ông|bà|cháu|bạn|mày|ngươi|các người|mọi người|ai|con')
const PARTICLE = W('à|nhé|chứ|đấy|ạ|ơi|đi|mà|lắm|nha|hả|cơ|với|làm ơn')
const PRONOUN_SHE = W('cô|cô ta|cô ấy|người phụ nữ|chị|chị ta|bà|bà ta|anh ta|ông|ông ta|gã|hắn|cậu ta|người đàn ông|cậu bé|cô bé|người kia')

/** sentences of a quote: split on . ! ? and on … followed by a capital; empty pieces dropped */
export function sentencesOfLine(line) {
    return String(line ?? '').split(/(?<=[.!?])\s+|(?<=[.!?])$|…\s+(?=\p{Lu})/u).map((s) => s.replace(/[.!?…]+$/u, '').trim()).filter((s) => /\p{L}/u.test(s))
}
const words = (s) => s.split(/\s+/).filter((w) => /\p{L}/u.test(w))

const REQ = /(?<!\p{L})(?:cho (?:tôi|em|tớ|cháu|mình|chúng tôi)(?: xin)?|(?:tôi|em|tớ|cháu|mình|chúng tôi) (?:chỉ )?(?:xin|cần)|xin (?:anh|chị|cậu|ông|bà|chú|bác)|lấy giúp|đưa (?:tôi|em|cháu)|(?:có|còn) .{0,40}không\s*$)/u
const MORE = /(?<!\p{L})còn (?:nhiều |ít |chút |thêm )?.{0,30}không\s*$|thêm (?:một|ít|chút)/u
const REFUSE = /(?<!\p{L})(?:giữ lại|cứ giữ|không cần|đừng đưa|thôi khỏi|không lấy|không nhận|khỏi đưa|đừng cho)(?!\p{L})/u
const REASON = /(?<!\p{L})(?:vì|tại|sợ|chưa (?:biết|dám|tin|quen)|người lạ|không tin|không dám)(?!\p{L})/u
const HOOK_A = /(?<!\p{L})nếu (?:anh|chị|cậu|em|ông|bà|cô|chú)?\s?.{0,50}(?:tìm|mang|lấy|đem|giúp|làm|đi|đến|tới)(?!\p{L}).{0,60}(?:thì )?(?:tôi|tớ|em|cháu|chúng tôi) (?:sẽ|mới)(?!\p{L})/u
const HOOK_B = /(?<!\p{L})có (?:một )?(?:phòng khám|hiệu thuốc|nhà thuốc|kho|trạm|chỗ|nơi|bệnh viện|siêu thị|cửa hàng)(?!\p{L}).{0,40}(?:gần|ở|phía|bên|cạnh)(?!\p{L})/u
const ASKED_WHERE = /ở đâu|chỗ nào|đâu có|biết chỗ/u
const EXPO = [/(?<!\p{L})tôi (?:chỉ )?(?:đang )?cố(?: gắng)?(?!\p{L})/u, /(?<!\p{L})tôi (?:chỉ )?muốn(?!\p{L}).{0,30}(?:thôi|mà)(?!\p{L})/u, /(?<!\p{L})tôi làm (?:vậy|thế|thế này|điều này).{0,10}(?:vì|để)(?!\p{L})/u, /(?<!\p{L})(?:điều|việc) tôi cần (?:bây giờ )?là(?!\p{L})/u, /(?<!\p{L})tôi không biết .{0,40} hơn (?:anh|chị|cậu)(?!\p{L})/u]
const ASKED_WHY = /tại sao|vì sao|sao (?:cô|chị|em|bà|anh)|để làm gì|muốn gì/u
const HAND = /(?<!\p{L})(?:đặt|để|đưa|ném|chuyền|thả)(?!\p{L})/u

/**
 * The speaker card of a quote. One speaker per paragraph (the Prose Style rule), so the whole paragraph is read: a card's name in it,
 * else the most recently active card when the paragraph points at a person ("cô", "người phụ nữ", "ông ta"…); null when neither.
 */
function speakerOf(it, cards) {
    const para = it.para.replace(/“[^”]*”/g, ' ').toLowerCase()
    for (const c of cards.values()) {
        const nm = String(c.name ?? '').toLowerCase()
        if (nm && nm !== c.id && para.includes(nm)) return c
    }
    const active = [...cards.values()].filter((c) => !c.isAdmin && c.id !== EVENTS_ID)
    if (active.length && PRONOUN_SHE.test(para)) return active.sort((a, b) => b.lastTurn - a.lastTurn)[0]
    return null
}

/**
 * Facts (Dafny shape) of each speaker in one reply: Map key -> {card|null, lines:[...], facts}. Unknown speakers share the key '?'.
 * ctx: { player, playerText (the player's last message), lastItem (the item last mentioned before this reply) }.
 */
export function extractFacts(reply, cards, ctx = {}) {
    const groups = new Map()
    let last = ctx.lastItem || itemsIn(ctx.playerText ?? '').at(-1) || ''
    const playerItems = itemsIn(ctx.playerText ?? '')
    const innerAll = ctx.inner ?? parseInner(ctx.raw ?? reply)
    const innerOnly = innerAll.size === 1 ? cards.get([...innerAll.keys()][0]) : null
    for (const it of npcLines(reply, ctx)) {
        // the paragraph's name or pronoun; else the one NPC whose inner line this reply carries
        const card = speakerOf(it, cards) ?? innerOnly ?? null
        const key = card ? card.id : '?' + it.para.slice(0, 80)   // an unknown speaker: one per paragraph
        if (!groups.has(key)) groups.set(key, { card, lines: [], facts: { requests: new Set(), offers: new Set(), refusals: new Set(), handed: new Set(), questHook: false, exposition: false, playerAskedWhy: ASKED_WHY.test(ctx.playerText ?? ''), reasonFlag: false, sentences: 0, unaddressed: false, wantsNow: new Set(), leaksWithheld: false, forbiddenUsed: new Set(), longestSentence: 0, mentions: new Set() } })
        const g = groups.get(key)
        g.lines.push(it.line)
        const f = g.facts
        const sents = sentencesOfLine(it.line)
        f.sentences += sents.length
        const low = it.line.toLowerCase()
        let addressed = ADDRESS.test(it.line) || (ctx.player && low.includes(String(ctx.player).split(/\s+/)[0].toLowerCase()))
        const raws = String(it.line).split(/(?<=[.!?])\s+|…\s+(?=\p{Lu})/u).filter((x) => /\p{L}/u.test(x))
        for (const raw of raws) {
            const s = raw.replace(/[.!?…]+\s*$/u, '').trim()
            const sl = s.toLowerCase()
            const items = itemsIn(sl, last)
            if (items.length) last = items.at(-1)
            if (REFUSE.test(sl)) {
                const its = items.length ? items : playerItems.length ? playerItems : last ? [last] : []
                its.forEach((i) => f.refusals.add(i))
                if (REASON.test(sl) || (card && its.some((i) => card.why.has(i)))) f.reasonFlag = true
            } else if (MORE.test(sl)) {
                // "còn … không" asks for MORE of a held item: not a request (Dafny WitnessAskMoreIsNotARequest)
            } else if (REQ.test(sl)) items.forEach((i) => f.requests.add(i))
            // owner popup (a): a direct QUESTION to the player needs an address term ("Tôi cần thuốc…" is a statement, not one)
            const question = /\?\s*$/u.test(raw) || MORE.test(sl) || /(?<!\p{L})(?:có|còn) .{0,40}không$/u.test(sl)
            if (question && !addressed) f.unaddressed = true
        }
        if (REASON.test(low) && [...f.refusals].length) f.reasonFlag = true
        for (const s of sents) f.longestSentence = Math.max(f.longestSentence, words(s).length)
        if (card) {
            for (const w of card.forbidden) if (new RegExp(`(?<!\\p{L})${esc(w)}(?!\\p{L})`, 'iu').test(it.line)) f.forbiddenUsed.add(w)
            const inner = innerAll.get(card.id)
            if (inner) {
                itemsIn(inner.wants).forEach((i) => i !== 'unknown_item' && f.wantsNow.add(i))
                const kept = contentWords(inner.withholding)
                if (kept.length && kept.filter((w) => low.includes(w)).length >= Math.min(2, kept.length)) f.leaksWithheld = true
            }
            const log = cards.get(EVENTS_ID)?.events ?? new Map()
            for (const [e, kws] of log) if (kws.some((k) => k && low.includes(k))) f.mentions.add(e)
        }
        if (HOOK_A.test(low)) f.questHook = true
        if (HOOK_B.test(low) && !(ASKED_WHERE.test(ctx.playerText ?? '') && card && [...card.knows].some((k) => low.includes(k.replace(/-/g, ' '))))) f.questHook = true
        if (EXPO.some((re) => re.test(low))) f.exposition = true
        // narration in the same paragraph, after the quote, with her as the subject: what she hands over or puts down
        const tail = it.para.slice(it.at + it.line.length + 2).split('“')[0]
        for (const clause of tail.split(/[.;]/)) {
            if (HAND.test(clause) && PRONOUN_SHE.test(clause)) itemsIn(clause, last).forEach((i) => f.handed.add(i))
        }
    }
    return groups
}

// ---- the hidden inner line [[NPC|id|wants now|feels|withholding]] ------------------------------------------------------------
const INNER = /\[\[\s*NPC\s*\|([^\]\n]*)\]\]?/giu
/** id -> {wants, feels, withholding} from the raw reply (before the client strip and the card's Lua take the lines out) */
export function parseInner(raw) {
    const out = new Map()
    for (const m of String(raw ?? '').matchAll(INNER)) {
        const [id, wants = '', feels = '', withholding = ''] = m[1].split('|').map((x) => x.trim())
        if (id) out.set(slug(id), { wants, feels, withholding })
    }
    return out
}
const STOP = new Set(['của', 'những', 'không', 'người', 'chuyện', 'việc', 'mình', 'được', 'đang', 'đã', 'với', 'cho', 'này', 'kia', 'một', 'các', 'là', 'và', 'thì', 'mà', 'rằng', 'anh', 'chị', 'tôi', 'cô', 'em'])
const contentWords = (s) => [...new Set(String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)))]

// ---- grammar / telegraph (deterministic part of class 1) ---------------------------------------------------------------------
const BI_NOUN = /(?<!\p{L})bị (?:mảnh kính|kính|dao|đinh|gạch|kim|sắt|thủy tinh|mảnh sắt)(?: cửa| vỡ)?(?!\p{L})(?!\s*(?:cứa|cắt|đâm|rạch|găm|đập|cào|xước|chém|đè))/u
const ADDRESS_NO_AI = W('anh|chị|em|cậu|cô|chú|bác|ông|bà|cháu|bạn|mày|ngươi|các người|mọi người|con')
/** [{rule, soft?}] for one quote */
export function grammarHits(line) {
    const out = []
    if (BI_NOUN.test(line)) out.push({ rule: 'npc-grammar', why: 'bị + noun, no verb' })
    const short = sentencesOfLine(line).filter((s) => words(s).length <= 5 && !ADDRESS_NO_AI.test(s) && !PARTICLE.test(s))
    if (short.length >= 2) out.push({ rule: 'npc-grammar', why: 'telegraph: ' + short.slice(0, 2).join(' / ') })
    const sents = sentencesOfLine(line)
    if (sents.length === 1 && (REQ.test(sents[0].toLowerCase()) || /\?\s*$/.test(line))) {
        const bare = itemsIn(sents[0]).reduce((s, id) => s, sents[0].toLowerCase())
        const stripped = ITEM_LEX.reduce((s, [, , re]) => s.replace(new RegExp(re.source, 'gu'), ' '), bare)
        if (!/đau|sốt|chảy máu|sợ|lạnh|khát|đói|tay|chân|vết|mệt/u.test(stripped) && !PARTICLE.test(stripped) && !ADDRESS_NO_AI.test(stripped)) out.push({ rule: 'npc-bare-request', soft: true })
    }
    return out
}

// ---- the post-check of one reply --------------------------------------------------------------------------------------------
/** rules a sentence cut may fix when the redo still has them (never the state rules) */
export const CUT_RULES = ['npc-quest-hook', 'npc-exposition', 'npc-long', 'npc-voice', 'npc-unwitnessed']
export const HARD_RULES = ['npc-grammar', 'npc-address', 'npc-quest-hook', 'npc-contradicts-need', 'npc-phantom-item', 'npc-exposition', 'npc-long', 'npc-inner', 'npc-voice', 'npc-unwitnessed']

/**
 * Every NPC hit of a reply: [{rule, text, npc, soft?, why?}]. ctx: { ledger ($led_npc), n (this reply's number: the state is the
 * fold of lines < n), player, playerText }. A speaker without a card gets the state-free checks only (phantom and held-item off).
 */
export function npcHits(reply, ctx = {}) {
    const cards = foldNpc(ctx.ledger ?? '', ctx.n ?? Infinity)
    const out = []
    for (const [key, g] of extractFacts(reply, cards, ctx)) {
        const card = g.card ?? blankNpc('?')
        const facts = g.card ? g.facts : { ...g.facts, handed: new Set(), offers: new Set() }
        const name = g.card ? g.card.name : '?'
        const quote = g.lines.join(' … ')
        for (const h of accept(card, facts)) {
            if (!g.card && h.rule === 'npc-contradicts-need') continue
            const ev = cards.get(EVENTS_ID)?.events ?? new Map()
            const keys = h.rule === 'npc-unwitnessed' ? (h.items ?? []).flatMap((e) => ev.get(e) ?? []) : h.rule === 'npc-voice' ? (h.items ?? []) : undefined
            out.push({ rule: h.rule, text: quote, npc: name, why: h.why ?? (h.items?.length ? h.items.map(itemLabel).join(', ') : h.n ? `${h.n} ${h.rule === 'npc-voice' ? 'chữ' : 'câu'}` : ''), ...(keys ? { keys } : {}) })
        }
        for (const l of g.lines) for (const h of grammarHits(l)) out.push({ ...h, text: l, npc: name })
        void key
    }
    return out
}

const VI_RULE = {
    'npc-grammar': 'câu cụt hoặc thiếu động từ', 'npc-address': 'câu hỏi/nhờ thiếu từ xưng hô', 'npc-quest-hook': 'NPC không giao việc, không chỉ đi nơi khác, không mặc cả kiểu nhiệm vụ',
    'npc-contradicts-need': 'trái với điều cô ấy đang cần/đang giữ', 'npc-phantom-item': 'đưa/đặt món cô ấy không có', 'npc-exposition': 'tự giải thích động cơ khi không ai hỏi',
    'npc-long': 'quá 2 câu', 'npc-bare-request': 'nhờ trống không, không có gì neo',
    'npc-inner': 'trái với dòng nội tâm ẩn (từ chối điều đang muốn, hoặc nói ra điều đang giấu)', 'npc-voice': 'sai giọng của NPC (từ cấm hoặc câu dài hơn giọng)', 'npc-unwitnessed': 'nhắc việc cô ấy không có mặt và chưa ai kể',
}
/** The part of the hidden rewrite note for the NPC hits (with each speaker's card), '' when none. */
export function npcRewriteNote(hits, ledger, n) {
    const hard = hits.filter((h) => !h.soft)
    if (!hard.length) return ''
    const cards = foldNpc(ledger ?? '', n ?? Infinity)
    const byName = new Map([...cards.values()].map((c) => [c.name, c]))
    const lines = hard.map((h) => `(${h.rule}) “${h.text.slice(0, 140)}”: ${VI_RULE[h.rule]}${h.why ? ` (${h.why})` : ''}`)
    const shown = [...new Set(hard.map((h) => h.npc))].map((nm) => byName.get(nm)).filter(Boolean).map(cardLine)
    return `\n\n[Rewrite (hidden, never named): lời NPC trong bản trước sai: ${lines.join(' / ')}.${shown.length ? ` Thẻ NPC: ${shown.join(' ')}` : ''} Viết lại chỉ lời NPC đó, 1–2 câu trọn vẹn đúng thẻ, giữ nguyên phần còn lại.]`
}

/** Remove from each violating quote the sentences that carry a CUT_RULES hit, when at least one sentence of that quote stays. */
export function cutViolations(reply, hits) {
    let text = String(reply ?? '')
    const cut = []
    for (const h of hits.filter((x) => CUT_RULES.includes(x.rule))) {
        for (const quote of h.text.split(' … ')) {
            const sents = sentencesOfLine(quote)
            if (sents.length < 2) continue
            const bad = (s) => {
                const l = s.toLowerCase()
                if (h.rule === 'npc-quest-hook') return HOOK_A.test(l) || HOOK_B.test(l)
                if (h.rule === 'npc-exposition') return EXPO.some((re) => re.test(l))
                if (h.rule === 'npc-voice' || h.rule === 'npc-unwitnessed') return (h.keys ?? []).some((k) => k && l.includes(String(k).toLowerCase()))
                return false
            }
            let keep = h.rule === 'npc-long' ? sents.slice(0, MAX_SENTENCES) : sents.filter((s) => !bad(s))
            if (!keep.length || keep.length === sents.length) continue
            const rebuilt = keep.map((s) => (/[.!?…]$/u.test(s) ? s : s + (quote.includes(s + '?') ? '?' : quote.includes(s + '!') ? '!' : '.'))).join(' ')
            if (text.includes(`“${quote}”`)) { text = text.replace(`“${quote}”`, `“${rebuilt}”`); cut.push(h.rule) }
        }
    }
    return { text, cut }
}

// ---- the optional model judge in the app (Settings npcJudge, OFF by default; the acceptance judge is npcDialogue.mjs) ---------
/** A short prompt for the helper model: each NPC line with its speaker's card; answer JSON {"bad":[{"i","rule","why"}]}. */
export function judgePrompt(reply, ctx = {}) {
    const cards = foldNpc(ctx.ledger ?? '', ctx.n ?? Infinity)
    const items = npcLines(reply, ctx)
    if (!items.length) return null
    const shown = [...cards.values()].filter((c) => !c.isAdmin).slice(0, 3).map(cardLine).join(' ')
    return {
        items,
        prompt: `You check the spoken lines of the non-player characters of a Vietnamese story.${shown ? ` Their cards: ${shown}` : ''}
A line is bad when it is ungrammatical or a telegram of bare fragments (npc-grammar), a direct question with no address term (npc-address), an errand, a place to go or an "if you do X I will Y" bargain (npc-quest-hook), or against the speaker's card: refuses what she needs with no reason, asks for what she holds (npc-contradicts-need). If unsure, it is good.
${items.map((it, i) => `${i}: “${it.line}”`).join('\n')}
Answer only JSON: {"bad":[{"i":<index>,"rule":"<rule>","why":"<short>"}]}`,
    }
}
const JUDGE_RULES = new Set(['npc-grammar', 'npc-address', 'npc-quest-hook', 'npc-contradicts-need'])
/** The judge's answer -> hits on lines that exist, known rules only; anything unreadable is no hit (fail-open). */
export function parseJudge(text, items) {
    const m = /\{[\s\S]*\}/.exec(String(text ?? '').replace(/```json|```/g, ''))
    if (!m) return []
    let j
    try { j = JSON.parse(m[0]) } catch { return [] }
    return (Array.isArray(j?.bad) ? j.bad : []).filter((b) => items[b?.i] && JUDGE_RULES.has(b?.rule)).map((b) => ({ rule: b.rule, text: items[b.i].line, npc: '?', why: String(b.why ?? '').slice(0, 120), judge: true }))
}
