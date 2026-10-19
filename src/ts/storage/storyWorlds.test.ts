// @vitest-environment node
// Story checks and plans for every card (server/node/storyWorlds.cjs): the world profile is picked from the card itself, and each
// world's own Prolog rules (story/worlds/*.pl) and PDDL domain (story/<world>.domain.pddl) apply. Shadow Slave keeps its own file
// (storyLogic.test.ts); this one covers the pick, Lord of the Mysteries, Infinite Mailman and the generic fallback.
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const req = createRequire(import.meta.url)
const merge = req('../../../server/node/dbMerge.cjs')
const { openStoryStore } = req('../../../server/node/storyStore.cjs')
const L = req('../../../server/node/storyLogic.cjs')
const W = req('../../../server/node/storyWorlds.cjs')
const P = req('../../../server/node/story/pddl.cjs')
const STORY = join(__dirname, '../../../server/node/story')
const HAS_SWIPL = !!L.findSwipl()
const rules = (r: any) => (r.violations ?? []).map((v: any) => v.rule).sort()
const levels = (p: any) => p.ranks.map(([id]: [string], i: number) => `rank_level(${id}, ${i}).`).join('\n') + '\n'

// ---- picking the world ----------------------------------------------------------------------------------------------------------
describe('the world of a card is picked from the card', () => {
    const pick = (card: any) => W.pickProfile(card).profile.id
    test('by name, by lore titles alone, by panel keys alone; anything else is generic', () => {
        expect(pick({ name: 'Shadow Slave — Independent Fate Simulator' })).toBe('shadow-slave')
        expect(pick({ name: 'Lord of the Mysteries — Independent Fate Simulator' })).toBe('lotm')
        expect(pick({ name: 'Infinite Mailman (Người Đưa Thư Khủng Bố) — Independent Fate Simulator' })).toBe('mailman')
        // a renamed card still carries its modules
        expect(pick({ name: 'my run', loreTitles: ['Module 03 — Pathway, Potion and Loss-of-Control Engine'] })).toBe('lotm')
        expect(pick({ name: 'my run', loreTitles: ['Module 02 — Delivery World Engine'] })).toBe('mailman')
        expect(pick({ name: 'my run', loreTitles: ['Module 02 — Nightmare Engine'] })).toBe('shadow-slave')
        // a card with no name or lore signal: its chat's panel keys
        expect(pick({ name: 'x', keys: ['st_pathway', 'st_seq', 'st_potion'] })).toBe('lotm')
        expect(pick({ name: 'x', keys: ['st_points', 'st_stamp1', 'st_world'] })).toBe('mailman')
        expect(pick({ name: 'x', keys: ['st_frag', 'st_mem1'] })).toBe('shadow-slave')
        // one key is not enough (st_place, st_rank exist everywhere)
        expect(pick({ name: 'Tu Tiên Ký', keys: ['st_rank', 'st_place', 'st_points'] })).toBe('generic')
        expect(pick({ name: 'Tu Tiên Ký', loreTitles: ['Cultivation realms'] })).toBe('generic')
        expect(W.pickProfile({ name: 'x', keys: ['st_level'] }).profile.rankKey).toBe('st_level')
    })
    test('panel values normalize per world', () => {
        expect(['Danh Sách 9: Nhà bói toán', 'Sequence 8', 'seq 7', ''].map((v) => W.lotm.normalizeRank(v))).toEqual(['seq9', 'seq8', 'seq7', null])
        expect(['con đường Nhà bói toán (Seer)', 'con đường Học đồ', 'Spectator Pathway', 'con đường Thủy thủ'].map(W.normalizePathway)).toEqual(['fool', 'door', 'visionary', 'tyrant'])
        // the English name in parentheses decides when the Vietnamese words also name another Pathway
        expect(W.normalizePathway('con đường Thợ Săn Bóng Tối (Hunter)')).toBe('red_priest')
        expect(['chưa tiêu hoá | x', 'đang tiêu hóa | đóng vai', 'gần xong', 'đã tiêu hoá', '', 'đâu đó'].map(W.digestion)).toEqual(['not_started', 'in_progress', 'close', 'complete', 'unknown', 'unknown'])
        expect(['Người đưa thư thực tập', 'Người đưa thư hạ cấp', 'người đưa thư cấp thấp', 'Người đưa thư trung cấp'].map((v) => W.mailman.normalizeRank(v))).toEqual(['trainee', 'low', 'low', 'mid'])
    })
})

// ---- Prolog, one world at a time ------------------------------------------------------------------------------------------------
const LOTM = { world: 'lotm' }
const LOTM_CLEAN = `
event(1, 'năm 1349, đêm', unknown, 7, 'klein uống ma dược danh sách 9: nhà bói toán').
event(2, 'năm 1349, sáng', unknown, 2, 'klein uống ma dược danh sách 8: thằng hề').
event_seen(1, 3). event_seen(2, 8).
rank_change(3, ordinary, seq9). rank_change(8, seq9, seq8).
potion_changed(3). potion_changed(8).
digestion_before(3, unknown). digestion_before(8, complete).
slot(artifact, 1, 'găng tay'). slot(artifact, 2, 'ống sáo'). artifact_grade(1, 2). artifact_grade(2, 3).
ability_seq(1, 'linh thị', 9). ability_seq(2, 'nhào lộn', 8).
seq_now(8).
npc(dunn).
` + levels(W.lotm)
const LOTM_BROKEN: Record<string, [string, string[]]> = {
    rank_without_event: [LOTM_CLEAN.replace("'klein uống ma dược danh sách 8: thằng hề'", "'klein tập đóng vai thằng hề'"), []],
    rank_skipped: [LOTM_CLEAN.replace('rank_change(8, seq9, seq8).', 'rank_change(8, seq9, seq7).'), []],
    rank_lowered: [LOTM_CLEAN + "event(3, 'năm 1350', unknown, unknown, 'klein uống ma dược danh sách 9').\nevent_seen(3, 12).\nrank_change(12, seq8, seq9).\npotion_changed(12).\n", []],
    potion_not_digested: [LOTM_CLEAN.replace('digestion_before(8, complete)', 'digestion_before(8, in_progress)'), []],
    seq_without_new_potion: [LOTM_CLEAN.replace('potion_changed(8).', ''), []],
    pathway_changed: [LOTM_CLEAN + 'pathway_change(8, fool, sun).\n', []],
    grade0_artifact_carried: [LOTM_CLEAN.replace('artifact_grade(2, 3)', 'artifact_grade(2, 0)'), []],
    ability_above_sequence: [LOTM_CLEAN.replace("ability_seq(2, 'nhào lộn', 8)", "ability_seq(2, 'nhào lộn', 7)"), []],
    artifact_in_two_slots: [LOTM_CLEAN.replace("slot(artifact, 2, 'ống sáo')", "slot(artifact, 2, 'găng tay')"), []],
}

const MAIL = { world: 'mailman' }
const MAIL_CLEAN = `
event(1, 'day 1, night', count(1), 7, 'nhặt hộp đầu tiên; bị đưa vào xưởng muối').
event(2, 'day 3, noon', count(3), 3, 'mở gói: trở thành người đưa thư cấp thấp, 16 điểm').
event_seen(1, 2). event_seen(2, 5).
rank_change(5, trainee, low).
points_change(5, 0, 16). points_change(7, 16, 15).
points_now(15). world_now(''). rank_now(low). book(47, 50).
slot(stamp, 1, 'áo gấu'). stamp_text(1, 'áo gấu | gấp đôi sức mạnh | 1 điểm, cold-down 3h').
slot(item, 1, 'bạc vụn').
` + levels(W.mailman)
const MAIL_BROKEN: Record<string, [string, string[]]> = {
    rank_without_event: [MAIL_CLEAN.replace("'mở gói: trở thành người đưa thư cấp thấp, 16 điểm'", "'về nhà ngủ một giấc'"), []],
    rank_skipped: [MAIL_CLEAN.replace('rank_change(5, trainee, low).', 'rank_change(5, trainee, mid).'), ['rank_without_event']],
    rank_lowered: [MAIL_CLEAN + "event(3, 'day 9', count(9), unknown, 'mất sách tem').\nevent_seen(3, 9).\nrank_change(9, low, trainee).\n", ['rank_without_event']],
    points_without_event: [MAIL_CLEAN + 'points_change(9, 15, 40).\n', []],
    points_negative: [MAIL_CLEAN.replace('points_now(15)', 'points_now(-3)'), []],
    mission_outside_world: [MAIL_CLEAN + "mission_slot(1, 'nhiệm vụ chính tuyến: tìm lối ra | 40%').\n", []],
    life_stamp_too_early: [MAIL_CLEAN.replace("stamp_text(1, 'áo gấu |", "stamp_text(1, 'áo gấu (tem bản mệnh) |"), []],
    book_free_over_capacity: [MAIL_CLEAN.replace('book(47, 50)', 'book(52, 50)'), []],
    stamp_in_two_slots: [MAIL_CLEAN + "slot(stamp, 2, 'áo gấu').\n", []],
}

const GEN = { world: 'generic' }
const GEN_CLEAN = `
event(1, 'day 1', count(1), unknown, 'lâm phong đột phá trúc cơ').
event_seen(1, 4).
rank_change(4, 'luyện khí', 'trúc cơ').
npc(mara).
`
const GEN_BROKEN: Record<string, [string, string[]]> = {
    rank_without_event: [GEN_CLEAN.replace("'lâm phong đột phá trúc cơ'", "'lâm phong ăn sáng'"), []],
    dead_npc_acts: [GEN_CLEAN + "event(2, 'day 2', count(2), unknown, 'mara bị giết ở cổng').\nevent(3, 'day 3', count(3), unknown, 'mara rút kiếm').\nevent_seen(2, 5). event_seen(3, 6).\n", []],
    timeline_backwards: [GEN_CLEAN + "event(2, 'day 0', count(0), unknown, 'lâm phong ngủ').\nevent_seen(2, 5).\n", []],
}

const WORLDS: [string, any, string, Record<string, [string, string[]]>, string][] = [
    ['lotm', LOTM, LOTM_CLEAN, LOTM_BROKEN, 'lotm.pl'],
    ['mailman', MAIL, MAIL_CLEAN, MAIL_BROKEN, 'mailman.pl'],
    ['generic', GEN, GEN_CLEAN, GEN_BROKEN, 'generic.pl'],
]

describe.skipIf(!HAS_SWIPL)('world rules (SWI-Prolog)', () => {
    for (const [name, opts, clean, broken, file] of WORLDS) {
        test(`${name}: a clean story has no violation`, async () => {
            const r = await L.runProlog(clean, opts)
            expect(r.status, JSON.stringify(r)).toBe('ok')
            expect(r.violations).toEqual([])
        })
        for (const [rule, [facts, also]] of Object.entries(broken)) {
            test(`${name}: ${rule} red when broken, and only it`, async () => {
                const r = await L.runProlog(facts, opts)
                expect(r.status).toBe('ok')
                expect(rules(r)).toContain(rule)
                expect(rules(r).filter((x: string) => x !== rule && !also.includes(x))).toEqual([])
            })
        }
        test(`${name}: every rule is load-bearing (its clause removed, its red case goes silent)`, async () => {
            const dir = mkdtempSync(join(tmpdir(), `world-mut-${name}-`))
            const marker = (rule: string) => (rule.endsWith('_in_two_slots') ? 'in_two_slots' : rule)
            for (const [rule, [facts]] of Object.entries(broken)) {
                const re = new RegExp(`% rule: ${marker(rule)}\\n[\\s\\S]*?(?:\\n\\n|$)`)
                const files = [join(STORY, 'canon.pl'), join(STORY, 'worlds', file)].map((f) => {
                    const text = readFileSync(f, 'utf8')
                    if (!re.test(text)) return f
                    const out = join(dir, `${rule}-${f.split('/').pop()}`)
                    writeFileSync(out, text.replace(re, '\n'))
                    return out
                })
                expect(files.filter((f) => f.startsWith(dir)).length, rule).toBe(1)
                const r = await L.runProlog(facts, { rules: files })
                expect(r.status, rule).toBe('ok')
                expect(rules(r), rule).not.toContain(rule)
            }
        })
    }

    test('lotm nuances: a neighbouring Pathway taken with the next potion is allowed, without it is not; "chưa uống" is no drink', async () => {
        expect(rules(await L.runProlog(LOTM_CLEAN + 'pathway_change(8, fool, door).\n', LOTM))).toEqual([])
        const idle = await L.runProlog(LOTM_CLEAN + 'pathway_change(10, fool, door).\n', LOTM)
        expect(rules(idle)).toEqual(['pathway_changed'])
        expect(idle.violations[0].detail).toMatchObject({ reason: 'not_with_next_potion' })
        const notYet = LOTM_CLEAN.replace("'klein uống ma dược danh sách 8: thằng hề'", "'klein chưa uống ma dược danh sách 8'")
        expect(rules(await L.runProlog(notYet, LOTM))).toEqual(['rank_without_event'])
        // the Shadow Slave words mean nothing here: a Nightmare does not raise a Sequence
        const nightmare = LOTM_CLEAN.replace("'klein uống ma dược danh sách 8: thằng hề'", "'klein survives a nightmare'")
        expect(rules(await L.runProlog(nightmare, LOTM))).toEqual(['rank_without_event'])
    })
    test('mailman nuances: a mission inside a world is fine; a low-rank rise needs the package, a mid-rank one the advancement world', async () => {
        expect(rules(await L.runProlog(MAIL_CLEAN.replace("world_now('')", "world_now('xưởng muối')") + "mission_slot(1, 'tìm lối ra | 40%').\n", MAIL))).toEqual([])
        const midOk = MAIL_CLEAN + "event(3, 'day 30', count(30), unknown, 'qua thế giới tiến giai, hoàn thành nhiệm vụ đặc thù').\nevent_seen(3, 20).\nrank_change(20, low, mid).\n"
        expect(rules(await L.runProlog(midOk, MAIL))).toEqual([])
        const midByPackage = MAIL_CLEAN + "event(3, 'day 30', count(30), unknown, 'mở gói lần nữa').\nevent_seen(3, 20).\nrank_change(20, low, mid).\n"
        expect(rules(await L.runProlog(midByPackage, MAIL))).toEqual(['rank_without_event'])
    })
    test('a world file only accepts its own facts: Shadow Slave facts in a Mailman check are refused, not ignored', async () => {
        expect(await L.runProlog(MAIL_CLEAN + 'fragments(1, 1000).\n', MAIL)).toMatchObject({ status: 'error' })
    })
})

describe('prompt wording follows the world', () => {
    const line = (world: string, violations: any[]) => L.promptLine({ status: 'ok', world, violations })
    test('generic rules in each world\'s terms; no Shadow Slave words outside Shadow Slave', () => {
        const ss = line('shadow-slave', [{ rule: 'rank_without_event', detail: { rev: 2, from: 'aspirant', to: 'sleeper' } }])
        expect(ss).toContain('Rank changed aspirant -> sleeper with no Nightmare or Gateway in the timeline')
        const lotm = line('lotm', [{ rule: 'rank_without_event', detail: { rev: 2, from: 'seq9', to: 'seq8' } }, { rule: 'rank_skipped', detail: { rev: 3, from: 'seq8', to: 'seq6' } }])
        expect(lotm).toContain('Sequence changed Sequence 9 -> Sequence 8 with no potion drunk in the timeline')
        expect(lotm).toContain('Sequence jumped Sequence 8 -> Sequence 6, skipping a step')
        const mail = line('mailman', [
            { rule: 'rank_without_event', detail: { rev: 2, from: 'trainee', to: 'low' } },
            { rule: 'stamp_in_two_slots', detail: { stamp: 'áo gấu', slot: 1, other_slot: 2 } },
            { rule: 'points_without_event', detail: { rev: 4, from: 0, to: 16 } },
        ])
        expect(mail).toContain('postman rank changed trainee -> low with no opened package')
        expect(mail).toContain('Stamp "áo gấu" is in slots 1 and 2')
        expect(mail).toContain('post points rose 0 -> 16')
        for (const l of [lotm, mail]) expect(l).not.toMatch(/Soul Fragment|Nightmare|Gateway|Memory/)
        expect(line('generic', [{ rule: 'rank_without_event', detail: { from: 'luyện khí', to: 'trúc cơ' } }])).toContain('Rank changed luyện khí -> trúc cơ with no rank-up event')
        expect(line('lotm', [{ rule: 'ability_above_sequence', detail: { ability: 'x', ability_seq: 7, seq: 10 } }])).toContain('stronger than an ordinary person')
    })
})

// ---- from story.sqlite, per world -------------------------------------------------------------------------------------------------
const vars = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => ['$' + k, v]))
const saveOf = (name: string, state: Record<string, string>, lore: any[] = []) => merge.encodeSave([
    merge.serializeBlock(1, 0, 'root', { __directory: ['c1'] }),
    merge.serializeBlock(2, 0, 'c1', { chaId: 'c1', name, globalLore: lore, chats: [{ id: 'k1', name: 'c', message: [], scriptstate: vars(state) }] }),
])
const LOTM_NAME = 'Lord of the Mysteries — Independent Fate Simulator'
const MAIL_NAME = 'Infinite Mailman (Người Đưa Thư Khủng Bố) — Independent Fate Simulator'
const KLEIN = { st_name: 'Klein', st_place: 'Tingen', st_date: 'năm 1349, chiều', st_faction: '—', led_rel: 'Klein | Dunn Smith | đội trưởng' }
const MAILMAN = { st_name: 'Tôn Mai', st_rank: 'Người đưa thư thực tập', st_points: '0', st_world: 'Xưởng muối', st_place: 'Xưởng muối', st_mission1: 'Nhiệm vụ chính tuyến: tìm lối ra | 40%', led_ev: '19/5/2026, đêm | Nhặt hộp đầu tiên; bị đưa vào xưởng muối' }

describe.skipIf(!HAS_SWIPL)('check over story.sqlite picks the world of the chat', () => {
    test('Lord of the Mysteries: the first potion is fine; a skipped Sequence drunk before digestion is reported', async () => {
        const s = openStoryStore({ dbFile: ':memory:' })
        s.sync(saveOf(LOTM_NAME, KLEIN), 1)
        const first = { ...KLEIN, st_pathway: 'con đường Nhà bói toán (Seer)', st_seq: 'Danh Sách 9: Nhà bói toán', st_potion: 'chưa tiêu hoá | đóng vai thầy bói', led_ev: 'năm 1349, đêm | uống ma dược Danh Sách 9: Nhà bói toán' }
        s.sync(saveOf(LOTM_NAME, first), 2)
        const ok = await L.check(s, 'k1')
        expect(ok).toMatchObject({ status: 'ok', world: 'lotm', violations: [] })
        s.sync(saveOf(LOTM_NAME, { ...first, st_seq: 'Danh Sách 7: Ma thuật sư', st_potion: 'chưa tiêu hoá | x', led_ev: first.led_ev + '\nnăm 1349, sáng | uống ma dược Danh Sách 7' }), 3)
        const bad = await L.check(s, 'k1')
        expect(rules(bad)).toEqual(['potion_not_digested', 'rank_skipped'])
        expect(L.promptLine(bad)).toContain('Sequence jumped Sequence 9 -> Sequence 7')
    })
    test('Lord of the Mysteries: an ordinary person given a Sequence with no potion drunk; one sealed artifact in two slots', async () => {
        const s = openStoryStore({ dbFile: ':memory:' })
        s.sync(saveOf(LOTM_NAME, KLEIN), 1)
        s.sync(saveOf(LOTM_NAME, { ...KLEIN, st_seq: 'Danh Sách 9: Nhà bói toán', st_potion: 'chưa tiêu hoá | x', st_artifact1: 'Găng tay | cấp 3, 3-011 | x | y', st_artifact2: 'Găng tay | cấp 3, 3-011 | x | y' }), 2)
        const r = await L.check(s, 'k1')
        expect(rules(r)).toEqual(['artifact_in_two_slots', 'rank_without_event'])
        expect(r.violations.find((v: any) => v.rule === 'rank_without_event').detail).toMatchObject({ from: 'ordinary', to: 'seq9' })
    })
    test('Infinite Mailman: back in reality with the mission still listed and points from nowhere', async () => {
        const s = openStoryStore({ dbFile: ':memory:' })
        s.sync(saveOf(MAIL_NAME, MAILMAN), 1)
        s.sync(saveOf(MAIL_NAME, { ...MAILMAN, st_world: '', st_place: 'Nhà trọ', st_points: '16', st_stamp1: 'Áo gấu | x | 1 điểm', st_stamp2: 'Áo gấu | x | 1 điểm' }), 2)
        const r = await L.check(s, 'k1')
        expect(r.world).toBe('mailman')
        expect(rules(r)).toEqual(['mission_outside_world', 'points_without_event', 'stamp_in_two_slots'])
        expect(L.promptLine(r)).not.toMatch(/Soul Fragment|Nightmare/)
    })
    test('an unknown card: the generic rules, with generic advancement words', async () => {
        const s = openStoryStore({ dbFile: ':memory:' })
        const base = { st_name: 'Lâm Phong', st_rank: 'Luyện khí', led_ev: 'Day 1 | Lâm Phong vào tông môn' }
        s.sync(saveOf('Tu Tiên Ký', base), 1)
        s.sync(saveOf('Tu Tiên Ký', { ...base, st_rank: 'Trúc cơ' }), 2)
        const r = await L.check(s, 'k1')
        expect(r).toMatchObject({ status: 'ok', world: 'generic' })
        expect(rules(r)).toEqual(['rank_without_event'])
        s.sync(saveOf('Tu Tiên Ký', { ...base, st_rank: 'Kim đan', led_ev: base.led_ev + '\nDay 9 | Lâm Phong đột phá kim đan' }), 3)
        expect(rules(await L.check(s, 'k1'))).toEqual(['rank_without_event'])   // the rev-2 change is still unexplained; rev 3 is fine
    })
})

// ---- PDDL per world ----------------------------------------------------------------------------------------------------------------
const read = (f: string) => readFileSync(join(STORY, f), 'utf8')
describe('Lord of the Mysteries PDDL', () => {
    const DOMAIN = read('lotm.domain.pddl'), WORLD = read('lotm.world.pddl')
    const at = (init: string, goal: string, domain = DOMAIN) => P.solve({ domain, problem: WORLD.replace('(:init', `(:init ${init}`), goal })
    test('an ordinary person reaches Sequence 9 through a formula (here from a dealer), ingredients, brewing and drinking', () => {
        expect(at('(at tingen) (seq s10) (digested)', '(seq s9)').plan).toEqual([
            '(travel tingen zoutelande)', '(meet old-neil zoutelande)', '(buy-formula old-neil zoutelande s10 s9)',
            '(travel zoutelande tingen)', '(buy-ingredients s9 tingen)', '(brew s9 tingen)', '(drink-potion s10 s9)',
        ])
    })
    test('digestion by acting comes before the next potion; a broken domain without it goes red', () => {
        const ok = at('(at tingen) (seq s9) (member nighthawks)', '(seq s8)')
        expect(ok.plan).toContain('(act s9)')
        expect(ok.plan.indexOf('(act s9)')).toBeLessThan(ok.plan.indexOf('(drink-potion s9 s8)'))
        const broken = DOMAIN.replace(':precondition (and (seq ?cur) (next ?cur ?s) (potion ?s) (digested) (no-ritual ?s) (not (exhausted)))', ':precondition (and (seq ?cur) (next ?cur ?s) (potion ?s) (no-ritual ?s) (not (exhausted)))')
        expect(broken).not.toBe(DOMAIN)
        expect(at('(at tingen) (seq s9) (member nighthawks)', '(seq s8)', broken).plan).not.toContain('(act s9)')
    })
    test('refuses impossible goals: no skipping, no way back, a dead leader cannot recruit; Sequence 4 needs its ritual', () => {
        // a Sequence 7 potion in hand does not let a Sequence 9 skip Sequence 8
        const skip = at('(at tingen) (seq s9) (digested) (member nighthawks) (potion s7)', '(seq s7)')
        expect(skip.plan).toContain('(drink-potion s9 s8)')
        expect(skip.plan.at(-1)).toBe('(drink-potion s8 s7)')
        expect(at('(at tingen) (seq s8) (digested)', '(seq s9)')).toMatchObject({ ok: false, reason: 'unsolvable' })
        expect(at('(at tingen) (seq s10) (digested) (dead dunn)', '(member nighthawks)')).toMatchObject({ ok: false, reason: 'unsolvable', relaxed: true })
        // with the dealer dead too, no formula: no Sequence at all
        expect(at('(at tingen) (seq s10) (digested) (dead dunn) (dead old-neil)', '(seq s9)')).toMatchObject({ ok: false, reason: 'unsolvable' })
        const s4 = at('(at backlund) (seq s5) (digested) (member nighthawks)', '(seq s4)')
        expect(s4.plan.at(-1)).toBe('(drink-potion-with-ritual s5 s4)')
        expect(s4.plan).toContain('(perform-ritual s4 bayam)')
    })
})

describe('Infinite Mailman PDDL', () => {
    const DOMAIN = read('mailman.domain.pddl'), WORLD = read('mailman.world.pddl')
    const at = (init: string, goal: string, domain = DOMAIN) => P.solve({ domain, problem: WORLD.replace('(:init', `(:init ${init}`), goal })
    test('a trainee becomes low-rank by delivering and opening the reward box', () => {
        expect(at('(in-reality) (trainee) (earned t0)', '(low-rank)').plan).toEqual(['(take-package)', '(enter-world)', '(find-mission)', '(deliver)', '(return)', '(open-trainee-box t0 t1)'])
    })
    test('mid-rank only through an advancement world and its special mission; a broken domain that skips it goes red', () => {
        const mid = at('(in-reality) (low-rank) (has-book) (earned t1)', '(mid-rank)').plan
        expect(mid).toEqual(['(take-advancement-package)', '(enter-advancement-world)', '(find-mission)', '(receive-special-mission)', '(complete-special-mission)', '(deliver-advancement)', '(return-advanced)', '(open-advancement-box)'])
        const broken = DOMAIN.replace(':precondition (and (in-reality) (advancement-box) (low-rank))', ':precondition (and (in-reality) (low-rank))')
        expect(broken).not.toBe(DOMAIN)
        expect(at('(in-reality) (low-rank) (has-book) (earned t1)', '(mid-rank)', broken).plan).toEqual(['(open-advancement-box)'])
    })
    test('the Ghost Market waits for more than 60 points earned; no life stamp below mid-rank', () => {
        const market = at('(in-reality) (low-rank) (has-book) (earned t1)', '(in-market)').plan
        expect(market.filter((x: string) => x.startsWith('(open-reward-box'))).toHaveLength(2)
        expect(at('(in-reality) (low-rank) (has-book) (earned t3)', '(and (life-stamp) (low-rank))')).toMatchObject({ ok: false, reason: 'unsolvable' })
    })
})

describe('plans from the chat, per world', () => {
    test('Lord of the Mysteries: Sequence and digestion from the panel; a dead NPC; an unknown place plans from "here" next to Tingen', () => {
        const s = openStoryStore({ dbFile: ':memory:' })
        s.sync(saveOf(LOTM_NAME, { ...KLEIN, st_seq: 'Danh Sách 9: Nhà bói toán', st_potion: 'đã tiêu hoá | x', st_place: 'một căn gác', led_ev: 'năm 1349 | Dunn Smith chết' }), 1)
        const p = L.problemFor(s, 'k1')
        expect(p.world).toBe('lotm')
        expect(p.here).toBe('here')
        expect(p.text).toContain('(seq s9)')
        expect(p.text).toContain('(digested)')
        expect(p.text).toContain('(dead dunn)')
        expect(L.plan(s, 'k1', '(member nighthawks)')).toMatchObject({ status: 'impossible', world: 'lotm' })
        const r = L.plan(s, 'k1', '(seq s8)')
        expect(r.status).toBe('ok')
        expect(r.plan).toContain('(drink-potion s9 s8)')
        expect(r.plan).not.toContain('(act s9)')   // already digested
    })
    test('Infinite Mailman: in a world with the main line at 100%, the way up starts by returning', () => {
        const s = openStoryStore({ dbFile: ':memory:' })
        s.sync(saveOf(MAIL_NAME, { ...MAILMAN, st_mission1: 'Nhiệm vụ chính tuyến: tìm lối ra | 100%' }), 1)
        const r = L.plan(s, 'k1', '(low-rank)')
        expect(r).toMatchObject({ status: 'ok', world: 'mailman' })
        expect(r.plan).toEqual(['(return)', '(open-trainee-box t0 t1)'])
        expect(L.plan(s, 'k1', '(at x)')).toMatchObject({ status: 'error' })
    })
    test('generic: places and people the chat names; meet the living only; a broken domain that meets anywhere goes red', () => {
        const s = openStoryStore({ dbFile: ':memory:' })
        s.sync(saveOf('Tu Tiên Ký', { st_name: 'Lâm Phong', st_place: 'Thanh Vân Tông', led_mem: 'Mara | hứa dẫn đường', led_rel: 'Kai | Lâm Phong | thù',
            led_ev: 'Day 1 | Mara đi tới Hắc Phong Sơn\nDay 2 | Kai bị giết ở Thanh Vân Tông' }, [{ comment: 'Region: Hắc Phong Sơn', key: 'Hắc Phong Sơn', content: '[Checked against the novel claim by claim' }]), 1)
        const p = L.problemFor(s, 'k1')
        expect(p.world).toBe('generic')
        expect(p.objects.place.sort()).toEqual(['hac-phong-son', 'thanh-van-tong'])
        expect(p.here).toBe('thanh-van-tong')
        expect(L.plan(s, 'k1', '(met mara)')).toMatchObject({ status: 'ok', plan: ['(travel thanh-van-tong hac-phong-son)', '(meet mara hac-phong-son)'] })
        expect(L.plan(s, 'k1', '(met kai)')).toMatchObject({ status: 'impossible' })
        const domain = read('generic.domain.pddl')
        const broken = domain.replace(':precondition (and (at ?p) (person-at ?x ?p) (not (dead ?x)))', ':precondition (and (person-at ?x ?p) (not (dead ?x)))')
        expect(broken).not.toBe(domain)
        expect(P.solve({ domain: broken, problem: p.text, goal: '(met mara)' }).plan).toEqual(['(meet mara hac-phong-son)'])
    })
})

// ---- a COPY of the owner's save: every card gets a world, every chat checks -------------------------------------------------------
const LIVE = join(__dirname, '../../../save', Buffer.from('database/database.bin').toString('hex'))
describe.skipIf(!existsSync(LIVE) || !HAS_SWIPL)('a copy of the real save', () => {
    test('each card gets its world from the card, and every live chat checks without an error', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'story-worlds-'))
        copyFileSync(LIVE, join(dir, 'database.bin'))
        const s = openStoryStore({ dbFile: ':memory:' })
        expect(s.sync(readFileSync(join(dir, 'database.bin')), 1).error).toBeUndefined()
        const chats = s.db.prepare('SELECT c.chat_id, ch.name FROM chats c JOIN characters ch ON ch.char_id = c.char_id WHERE c.deleted_at IS NULL').all()
        expect(chats.length).toBeGreaterThan(0)
        for (const c of chats) {
            const want = /^Shadow Slave/.test(c.name) ? 'shadow-slave' : /^Lord of the Myster/.test(c.name) ? 'lotm' : /^Infinite Mailman/.test(c.name) ? 'mailman' : null
            const r = await L.check(s, c.chat_id)
            expect(r.status, `${c.name} ${c.chat_id}: ${r.reason ?? ''}`).toBe('ok')
            if (want) expect(r.world, c.name).toBe(want)
        }
        s.close()
    }, 60000)
})
