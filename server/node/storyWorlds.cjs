'use strict'
// World profiles: what a story's own rules are, picked automatically from its card. Every Fate Simulator card writes the same kind
// of panel (st_* chat variables and the led_* ledger), but what a rank is, what event raises it, which slots must not hold the same
// thing twice and which planning domain applies differ per novel. A profile says that for one novel; a card that matches none gets
// the generic profile (generic rules only, a plan over the places the chat itself names).
//
// The profile of a chat is picked from three signals of its card, never from a per-card switch: the card's name, the titles of its
// lore entries (each card ships its own Module NN entries), and which st_* keys its chats use. Scores add up; the best profile with
// at least MIN_SCORE wins (pickProfile).
//
// A profile:
//   id, title                  'shadow-slave' | 'lotm' | 'mailman' | 'generic'
//   signals                    {name: RegExp, lore: RegExp[], keys: RegExp[]}
//   rankKey, ranks, emptyRank  the st_* key that holds the rank, its order low -> high as [id, test], and the rank an empty value
//                              means (LotM: an empty seq is an ordinary person; elsewhere an empty rank is "not set yet")
//   rankWord, showRank, advancement   wording for the prompt line ("Sequence", "Sequence 8", "potion drunk")
//   slotGroups                 [{group, prefix, n, label}]: st_<prefix>1..n, the same thing twice is <group>_in_two_slots
//   rules                      world rules files under story/worlds/, loaded after story/canon.pl
//   facts(ctx)                 the world's own Prolog facts (the header of its rules file lists them)
//   say                        prompt wording of the world's own rules
//   pddl                       {domain, world, hubs, init(ctx)} or the generic builder (storyLogic.cjs)

const lower = (s) => String(s ?? '').normalize('NFC').toLowerCase()
/** lower-cased, without Vietnamese marks (đ -> d), for matching words written with either accent placement ("hoá" / "hóa") */
const fold = (s) => lower(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
const EMPTY = new Set(['', 'null', '—', '-', 'none', 'không', 'khong', 'chưa có', 'n/a'])
const isEmpty = (v) => v === undefined || v === null || EMPTY.has(lower(v).trim())
const nameOf = (v) => String(v ?? '').split('|')[0].trim()
const int = (v) => { const m = String(v ?? '').replace(/[.,](?=\d{3}\b)/g, '').match(/-?\d+/); return m ? Number(m[0]) : null }

/** the value a key had just before revision `rev` (the state after rev - 1), from the st_* history and the current state */
function valueBefore(hist, state, key, rev) {
    const h = hist.filter((x) => x.key === key).sort((a, b) => a.rev - b.rev)
    const at = h.find((x) => x.rev === rev)
    if (at) return at.old_value
    const before = h.filter((x) => x.rev < rev).pop()
    if (before) return before.new_value
    const after = h.find((x) => x.rev > rev)
    if (after) return after.old_value
    return state[key] ?? null
}

function rankNormalizer(ranks) {
    return (v) => {
        const t = lower(v).trim()
        if (isEmpty(t)) return null
        const f = fold(t)
        for (const [id, test] of ranks) if (test(t, f)) return id
        return t
    }
}
const re = (r) => (t, f) => r.test(t) || r.test(f)

// ---- Shadow Slave --------------------------------------------------------------------------------------------------------------
const SS_RANKS = [
    ['aspirant', re(/aspirant|ứng viên|người thách thức|ung vien/)],
    ['sleeper', re(/sleeper|người ngủ|kẻ ngủ|ngủ mơ/)],
    ['awakened', re(/awakened|thức tỉnh/)],
    ['ascended', re(/ascended|master|bậc thầy|thăng hoa/)],
    ['transcendent', re(/transcendent|siêu việt|saint|thánh nhân/)],
    ['supreme', re(/supreme|tối cao/)],
    ['sacred', re(/sacred|linh thiêng/)],
    ['divine', re(/divine|thần thánh/)],
]
/** "12/1000" -> {x: 12, cap: 1000} */
function fragments(v) {
    const m = lower(v).match(/(\d[\d.,]*)\s*\/\s*(\d[\d.,]*)/)
    if (!m) return null
    const n = (s) => Number(s.replace(/[.,]/g, ''))
    return { x: n(m[1]), cap: n(m[2]) }
}

const shadowSlave = {
    id: 'shadow-slave',
    title: 'Shadow Slave',
    signals: {
        name: /shadow slave|nô lệ bóng tối/i,
        lore: [/nightmare engine/i, /aspect and flaw/i, /dream realm/i, /forgotten shore/i],
        keys: [/^st_frag$/, /^st_mem\d+$/, /^st_cores?$/, /^st_truename$/, /^st_aspect$/, /^st_echo\d+$/],
    },
    rankKey: 'st_rank',
    ranks: SS_RANKS,
    emptyRank: null,
    rankWord: 'Rank',
    showRank: (r) => r,
    advancement: 'Nightmare or Gateway',
    slotGroups: [{ group: 'memory', prefix: 'st_mem', n: 10, label: 'Memory' }],
    rules: ['shadow_slave.pl'],
    facts({ st, atom }) {
        const out = []
        const f = fragments(st.st_frag)
        if (f && Number.isFinite(f.x) && Number.isFinite(f.cap)) out.push(`fragments(${f.x}, ${f.cap}).`)
        const c = lower(st.st_cores).match(/^\s*(\d+)/)
        if (c) out.push(`cores(${Number(c[1])}).`)
        return out
    },
    say: {
        fragments_over_capacity: (d) => `${d.fragments} Soul Fragments exceed the core capacity ${d.capacity}`,
        fragment_cap_mismatch: (d) => `the fragment counter shows /${d.shown}, the cores hold ${d.expected}`,
    },
    pddl: {
        domain: 'shadow_slave.domain.pddl',
        world: 'shadow_slave.world.pddl',
        init({ st, rank, init, notes, place }) {
            if (['aspirant', 'sleeper', 'awakened', 'ascended'].includes(rank)) init.push([rank])
            else if (rank && ['transcendent', 'supreme', 'sacred', 'divine'].includes(rank)) init.push(['ascended'])
            else notes.push(`rank ${st.st_rank ? `"${st.st_rank}" is not one the domain knows` : 'is not set'}`)
            if (rank === 'aspirant' && /thử thách|ác mộng|nightmare/.test(lower(st.st_date) + ' ' + lower(st.st_place))) init.push(['in-nightmare'])
            if (/kiệt sức|exhausted|kiệt quệ/.test(lower(st.st_condition))) init.push(['exhausted'])
            // an unknown place: in the Dream Realm for a Sleeper, else in the waking world
            const dream = rank === 'sleeper'
            place.unknown = { facts: (p) => [[dream ? 'dream' : 'waking', p], ['safe', p], ['shelter', p]], hubs: dream ? ['labyrinth', 'dark-city'] : ['outskirts'] }
        },
    },
}

// ---- Lord of the Mysteries ----------------------------------------------------------------------------------------------------
// The 22 Pathways by their canon name, with the names a panel may use for them (Sequence 9 names, the Vietnamese edition's names
// from the card's glossary_vi.json). Longest alias first when matching.
const PATHWAYS = {
    fool: ['fool', 'kẻ khờ', 'seer', 'nhà bói toán', 'clown', 'gã hề', 'thằng hề'],
    error: ['error', 'marauder', 'kẻ trộm', 'worm of time', 'ký sinh trùng', 'ký sinh', 'parasite'],
    door: ['door', 'cửa', 'apprentice', 'học đồ', 'traveler', 'lữ khách'],
    visionary: ['visionary', 'spectator', 'người quan sát', 'khán giả'],
    sun: ['sun', 'mặt trời', 'bard', 'ca sĩ'],
    tyrant: ['tyrant', 'bạo quân', 'sailor', 'thủy thủ', 'thuỷ thủ'],
    white_tower: ['white tower', 'tháp trắng', 'reader', 'người đọc'],
    hanged_man: ['hanged man', 'người treo ngược', 'secrets supplicant'],
    darkness: ['darkness', 'bóng tối', 'sleepless', 'người không ngủ', 'người mất ngủ', 'nighthawk'],
    death: ['death', 'thần chết', 'corpse collector', 'người nhặt xác'],
    twilight_giant: ['twilight giant', 'người khổng lồ hoàng hôn', 'warrior', 'chiến binh'],
    demoness: ['demoness', 'ma nữ', 'assassin', 'sát thủ'],
    red_priest: ['red priest', 'linh mục đỏ', 'hunter', 'thợ săn'],
    abyss: ['abyss', 'vực thẳm', 'criminal', 'tội phạm'],
    chained: ['chained', 'xiềng xích', 'prisoner', 'tù nhân'],
    mother: ['mother', 'mẫu thần', 'planter', 'người trồng trọt'],
    moon: ['moon', 'mặt trăng', 'apothecary', 'dược sư'],
    black_emperor: ['black emperor', 'hoàng đế đen', 'lawyer', 'luật sư'],
    justiciar: ['justiciar', 'arbiter', 'trọng tài', 'thẩm phán'],
    hermit: ['hermit', 'ẩn sĩ', 'mystery pryer', 'kẻ dò xét bí ẩn'],
    paragon: ['paragon', 'savant', 'nhà thông thái'],
    wheel_of_fortune: ['wheel of fortune', 'bánh xe vận mệnh', 'monster', 'quái vật'],
}
const PATHWAY_ALIASES = Object.entries(PATHWAYS).flatMap(([id, as]) => as.map((a) => [fold(a), id])).sort((a, b) => b[0].length - a[0].length)
const wordIn = (t, w) => { for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) if (!/[\p{L}\p{N}]/u.test(t[i - 1] ?? '') && !/[\p{L}\p{N}]/u.test(t[i + w.length] ?? '')) return true; return false }
/** "con đường Nhà bói toán (Seer)" -> fool; the English name in parentheses is read first */
function normalizePathway(v) {
    if (isEmpty(v)) return null
    const t = fold(v)
    const paren = t.match(/\(([^)]+)\)/)
    for (const src of paren ? [paren[1], t] : [t]) for (const [a, id] of PATHWAY_ALIASES) if (wordIn(src, a)) return id
    return t.replace(/^con duong\s+/, '').trim() || null
}
/** "Danh Sách 9: Nhà bói toán" / "Sequence 8" / "seq 7" -> 9 / 8 / 7; null when no number */
function seqNumber(v) {
    const m = fold(v).match(/(?:danh sach|sequence|seq|ds|list)\s*[:#]?\s*(\d)\b/) ?? fold(v).match(/^\s*(\d)\b/)
    return m ? Number(m[1]) : null
}
const LOTM_RANKS = [['ordinary', re(/ordinary|người thường|nguoi thuong|bình thường|phàm nhân/)]]
for (let n = 9; n >= 0; n--) LOTM_RANKS.push([`seq${n}`, (t) => seqNumber(t) === n])
/** digestion state of a st_potion value "đang tiêu hoá | đóng vai thầy bói" */
function digestion(v) {
    if (isEmpty(v)) return 'unknown'
    const f = fold(nameOf(v))
    if (/chua tieu hoa|not started|undigested|chua bat dau/.test(f)) return 'not_started'
    if (/gan xong|gan tieu hoa|close|nearly|almost/.test(f)) return 'close'
    if (/dang tieu hoa|in progress|digesting|dang dong vai/.test(f)) return 'in_progress'
    if (/da tieu hoa|tieu hoa xong|tieu hoa hoan toan|fully digested|^digested|complete/.test(f)) return 'complete'
    return 'unknown'
}
const lotmRank = rankNormalizer(LOTM_RANKS)

const lotm = {
    id: 'lotm',
    title: 'Lord of the Mysteries',
    signals: {
        name: /lord of (the )?myster|quỷ bí chi chủ|quy bi chi chu/i,
        lore: [/pathway, potion/i, /mystery and ritual/i, /pathways and sequences/i, /beyonder potions/i],
        keys: [/^st_pathway$/, /^st_seq$/, /^st_potion$/, /^st_artifact\d+$/, /^st_spirit$/, /^st_control$/, /^st_ability\d+$/],
    },
    rankKey: 'st_seq',
    ranks: LOTM_RANKS,
    emptyRank: 'ordinary',
    rankWord: 'Sequence',
    showRank: (r) => (/^seq\d$/.test(r) ? `Sequence ${r.slice(3)}` : r),
    advancement: 'potion drunk',
    slotGroups: [
        { group: 'artifact', prefix: 'st_artifact', n: 4, label: 'Sealed artifact' },
        { group: 'item', prefix: 'st_item', n: 6, label: 'Item' },
    ],
    rules: ['lotm.pl'],
    normalizePathway,
    facts({ st, hist, atom }) {
        const out = []
        for (const h of hist) {
            if (h.key === 'st_pathway') {
                const from = normalizePathway(h.old_value), to = normalizePathway(h.new_value)
                if (from && to && from !== to) out.push(`pathway_change(${Number(h.rev) || 0}, ${atom(from)}, ${atom(to)}).`)
            }
            if (h.key === 'st_potion') out.push(`potion_changed(${Number(h.rev) || 0}).`)
            if (h.key === 'st_control') out.push(`control_changed(${Number(h.rev) || 0}).`)
            if (h.key === lotm.rankKey) {
                const rev = Number(h.rev) || 0
                out.push(`digestion_before(${rev}, ${digestion(valueBefore(hist, st, 'st_potion', rev))}).`)
            }
        }
        for (let i = 1; i <= 4; i++) {
            const v = st['st_artifact' + i]
            if (isEmpty(v)) continue
            const grade = fold(v).split('|')[1] ?? ''
            const g = grade.match(/(?:cap|grade|hang)\s*([0-3])\b/) ?? grade.match(/\b([0-3])-\d{1,3}\b/) ?? fold(v).match(/\b([0-3])-\d{2,3}\b/)
            if (g) out.push(`artifact_grade(${i}, ${Number(g[1])}).`)
        }
        for (let i = 1; i <= 4; i++) {
            const v = st['st_ability' + i]
            if (isEmpty(v)) continue
            const n = seqNumber(String(v).split('|')[1] ?? '')
            if (n !== null) out.push(`ability_seq(${i}, ${atom(nameOf(v))}, ${n}).`)
        }
        const now = isEmpty(st.st_seq) ? 10 : seqNumber(st.st_seq)
        if (now !== null) out.push(`seq_now(${now}).`)
        return [...new Set(out)]
    },
    say: {
        early_advance_unmarked: (d) => `the potion of ${lotm.showRank(d.to)} was drunk before ${lotm.showRank(d.from)} was digested (${String(d.digestion).replace('_', ' ')}): the advance stands, but the panel shows no sign of mất khống chế; write the risk into control and the story`,
        seq_without_new_potion: (d) => `the Sequence rose to ${lotm.showRank(d.to)} with no new potion digestion state`,
        pathway_changed: (d) => `the Pathway changed ${d.from} -> ${d.to}${d.reason === 'not_neighbour' ? ', which is not a neighbouring Pathway' : ' without drinking the next Sequence potion'}`,
        grade0_artifact_carried: (d) => `grade-0 sealed artifact "${d.artifact}" is in the character's hands, but grade 0 stays sealed under the Holy Cathedral`,
        ability_above_sequence: (d) => `ability "${d.ability}" comes from Sequence ${d.ability_seq}, stronger than ${Number(d.seq) === 10 ? 'an ordinary person' : `the character's Sequence ${d.seq}`}`,
    },
    pddl: {
        domain: 'lotm.domain.pddl',
        world: 'lotm.world.pddl',
        init({ st, init, notes, place }) {
            const n = isEmpty(st.st_seq) ? 10 : seqNumber(st.st_seq)
            if (n === null) notes.push(`seq "${st.st_seq}" has no Sequence number: planned as an ordinary person`)
            init.push(['seq', `s${n ?? 10}`])
            if (n === null || n === 10 || digestion(st.st_potion) === 'complete') init.push(['digested'])
            if (/kiệt sức|kiệt quệ|cạn kiệt|exhausted/.test(lower(st.st_condition) + ' ' + lower(st.st_spirit))) init.push(['exhausted'])
            // a formula among the items is the next Sequence's formula
            const next = n === null ? 9 : n - 1
            if (next >= 0) for (let i = 1; i <= 6; i++) if (/phối phương|công thức|formula/.test(lower(st['st_item' + i]))) { init.push(['has-formula', `s${next}`]); break }
            place.unknown = { facts: (p) => [['safe', p], ['shelter', p]], hubs: ['tingen'] }
        },
    },
}

// ---- Infinite Mailman ----------------------------------------------------------------------------------------------------------
const MAILMAN_RANKS = [
    ['trainee', re(/thực tập|thuc tap|trainee|intern/)],
    ['low', re(/hạ cấp|cấp thấp|ha cap|cap thap|low[- ]rank|low/)],
    ['mid', re(/trung cấp|trung cap|mid[- ]rank|mid/)],
    ['high', re(/cao cấp|cao cap|high[- ]rank|high/)],
    ['golden', re(/hoàng kim|hoang kim|golden|gold/)],
]
const mailmanRank = rankNormalizer(MAILMAN_RANKS)
const REALITY = /^(hiện thực|thực tại|hien thuc|thuc tai|reality|real world|thế giới thực)$/
const inReality = (world) => isEmpty(world) || REALITY.test(lower(world).trim())

const mailman = {
    id: 'mailman',
    title: 'Infinite Mailman (Người Đưa Thư Khủng Bố)',
    signals: {
        name: /infinite mailman|người đưa thư|đưa thư khủng bố/i,
        lore: [/delivery world/i, /stamp book|sách tem/i, /post point|điểm bưu điện/i, /post office voice/i],
        keys: [/^st_points$/, /^st_stamp\d+$/, /^st_world$/, /^st_book$/, /^st_mission\d+$/, /^st_next$/],
    },
    rankKey: 'st_rank',
    ranks: MAILMAN_RANKS,
    emptyRank: null,
    rankWord: 'postman rank',
    showRank: (r) => r,
    advancement: 'opened package (trainee) or advancement world (tiến giai)',
    slotGroups: [
        { group: 'stamp', prefix: 'st_stamp', n: 8, label: 'Stamp' },
        { group: 'item', prefix: 'st_item', n: 10, label: 'Item' },
    ],
    rules: ['mailman.pl'],
    facts({ st, hist, atom, firstRev }) {
        const out = []
        if (Number.isFinite(firstRev)) out.push(`first_rev(${firstRev}).`)
        for (const h of hist) {
            if (h.key !== 'st_points') continue
            const a = int(h.old_value), b = int(h.new_value)
            if (a !== null && b !== null && a !== b) out.push(`points_change(${Number(h.rev) || 0}, ${a}, ${b}).`)
        }
        const p = isEmpty(st.st_points) ? null : int(st.st_points)
        if (p !== null) out.push(`points_now(${p}).`)
        out.push(`world_now(${inReality(st.st_world) ? "''" : atom(st.st_world)}).`)
        for (let i = 1; i <= 4; i++) if (!isEmpty(st['st_mission' + i])) out.push(`mission_slot(${i}, ${atom(st['st_mission' + i])}).`)
        for (let i = 1; i <= 8; i++) if (!isEmpty(st['st_stamp' + i])) out.push(`stamp_text(${i}, ${atom(st['st_stamp' + i])}).`)
        const r = mailmanRank(st.st_rank)
        if (r) out.push(`rank_now(${atom(r)}).`)
        const b = lower(st.st_book).match(/(\d+)\s*\/\s*(\d+)/)
        if (b) out.push(`book(${Number(b[1])}, ${Number(b[2])}).`)
        return out
    },
    say: {
        points_without_event: (d) => `post points rose ${d.from} -> ${d.to} with no event in the timeline`,
        points_negative: (d) => `the post point balance is ${d.points}, below zero`,
        mission_outside_world: (d) => `mission "${d.mission}" is still listed though the character is back in reality`,
        life_stamp_too_early: (d) => `life stamp "${String(d.stamp).split('|')[0].trim()}" at rank ${d.rank}; only a mid-rank postman can fuse one`,
        book_free_over_capacity: (d) => `the stamp book shows ${d.free} free slots of ${d.capacity}`,
    },
    pddl: {
        domain: 'mailman.domain.pddl',
        world: 'mailman.world.pddl',
        noPlace: true,
        init({ st, init, notes }) {
            const rank = mailmanRank(st.st_rank)
            if (rank === 'trainee' || !rank) init.push(['trainee'])
            else if (rank === 'low') init.push(['low-rank'])
            else if (['mid', 'high', 'golden'].includes(rank)) init.push(['mid-rank'])
            if (rank && !['trainee', 'low', 'mid', 'high', 'golden'].includes(rank)) notes.push(`rank "${st.st_rank}" is not one the domain knows: planned as a trainee`)
            if (inReality(st.st_world)) init.push(['in-reality'])
            else {
                init.push(['in-world'])
                if (/tiến giai|tien giai|advancement/.test(lower(st.st_world))) init.push(['advancement-world'])
                const ms = [1, 2, 3, 4].map((i) => st['st_mission' + i]).filter((m) => !isEmpty(m))
                if (ms.length) init.push(['mission-given'])
                if (ms.some((m) => /đặc thù|dac thu|special/.test(lower(m)))) init.push(['special-mission-given'])
                const main = ms.filter((m) => /chính tuyến|chinh tuyen|main/.test(lower(m)))
                if ((main.length ? main : ms).some((m) => /\b100\s*%/.test(m))) init.push(['mission-done'])
            }
            if (!isEmpty(st.st_book) || (rank && rank !== 'trainee')) init.push(['has-book'])
            const p = int(st.st_points) ?? 0
            init.push(['earned', p > 60 ? 't3' : p > 30 ? 't2' : p > 0 || (rank && rank !== 'trainee') ? 't1' : 't0'])
            const stamps = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => lower(st['st_stamp' + i])).filter((v) => !isEmpty(v))
            if (stamps.length) init.push(['has-stamp'])
            if (stamps.some((v) => /bạch ngân|bach ngan|silver/.test(v))) init.push(['silver-stamp'])
            if (stamps.some((v) => /bản mệnh|ban menh|life stamp/.test(v))) init.push(['life-stamp'])
        },
    },
}

// ---- generic ------------------------------------------------------------------------------------------------------------------
const generic = {
    id: 'generic',
    title: 'Any story',
    signals: null,
    rankKey: 'st_rank',
    ranks: [],
    emptyRank: null,
    rankWord: 'Rank',
    showRank: (r) => r,
    advancement: 'rank-up event',
    slotGroups: [],
    rules: ['generic.pl'],
    facts: () => [],
    say: {},
    pddl: { domain: 'generic.domain.pddl', world: null },
}

const PROFILES = [shadowSlave, lotm, mailman]
const MIN_SCORE = 2
for (const p of [...PROFILES, generic]) p.normalizeRank = p.normalizeRank ?? (p.ranks.length ? rankNormalizer(p.ranks) : (v) => (isEmpty(v) ? null : lower(v).trim()))
// keys the generic profile reads as the rank when the card has no st_rank
const GENERIC_RANK_KEYS = ['st_rank', 'st_level', 'st_tier', 'st_realm', 'st_cultivation', 'st_class']

/**
 * The profile of a card: {profile, score, why}. card = {name, loreTitles: string[], keys: string[]} (keys of its chat's state).
 * Name 3, each matching lore title 2 (at most 2 titles), each matching st_* key 1 (at most 3 keys).
 */
function pickProfile(card) {
    const name = String(card?.name ?? '')
    const titles = (card?.loreTitles ?? []).map(String)
    const keys = (card?.keys ?? []).map(String)
    let best = null
    for (const p of PROFILES) {
        const why = []
        let score = 0
        if (p.signals.name.test(name)) { score += 3; why.push('name') }
        const lt = p.signals.lore.filter((r) => titles.some((t) => r.test(t))).length
        if (lt) { score += 2 * Math.min(lt, 2); why.push(`${lt} lore title${lt > 1 ? 's' : ''}`) }
        const kk = keys.filter((k) => p.signals.keys.some((r) => r.test(k))).length
        if (kk) { score += Math.min(kk, 3); why.push(`${kk} panel key${kk > 1 ? 's' : ''}`) }
        if (score >= MIN_SCORE && (!best || score > best.score)) best = { profile: p, score, why }
    }
    if (best) return best
    const rankKey = GENERIC_RANK_KEYS.find((k) => keys.includes(k)) ?? 'st_rank'
    return { profile: rankKey === 'st_rank' ? generic : { ...generic, rankKey }, score: 0, why: ['no known world matched'] }
}

const byId = (id) => [...PROFILES, generic].find((p) => p.id === id) ?? generic

module.exports = { pickProfile, byId, PROFILES, generic, shadowSlave, lotm, mailman, valueBefore, normalizePathway, seqNumber, digestion, fragments, lower, fold, isEmpty, nameOf, int }
