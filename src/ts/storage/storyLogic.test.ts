// @vitest-environment node
// Canon checks (server/node/story/canon.pl + worlds/shadow_slave.pl via SWI-Prolog) and plans (story/shadow_slave.*.pddl via
// story/pddl.cjs) over story.sqlite: the Shadow Slave world. The other worlds and the profile pick are in storyWorlds.test.ts.
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const req = createRequire(import.meta.url)
const merge = req('../../../server/node/dbMerge.cjs')
const { openStoryStore } = req('../../../server/node/storyStore.cjs')
const L = req('../../../server/node/storyLogic.cjs')
const P = req('../../../server/node/story/pddl.cjs')
const STORY = join(__dirname, '../../../server/node/story')
const W = req('../../../server/node/storyWorlds.cjs')
const CANON_FILE = join(STORY, 'canon.pl')
const SS_FILE = join(STORY, 'worlds', 'shadow_slave.pl')
const SS = { world: 'shadow-slave' }
const DOMAIN = readFileSync(join(STORY, 'shadow_slave.domain.pddl'), 'utf8')
const WORLD = readFileSync(join(STORY, 'shadow_slave.world.pddl'), 'utf8')
const HAS_SWIPL = !!L.findSwipl()

// a clean story: every rule silent
const CLEAN = `
event(1, 'day 1, dawn', count(1), 1, 'kenji enters the first nightmare').
event(2, 'day 1, dusk', count(1), 5, 'mara died at the gate').
event(3, 'day 2, noon', count(2), 3, 'aiko buries mara').
event(4, 'day 3, night', count(3), 7, 'kenji passes the gateway').
event_seen(1, 5). event_seen(2, 6). event_seen(3, 7). event_seen(4, 9).
rank_change(6, aspirant, sleeper).
rank_change(9, sleeper, awakened).
npc(aiko). npc(mara).
slot(memory, 1, 'mảnh vỡ bình minh'). slot(memory, 2, 'chuông bạc').
fragments(1200, 2000). cores(2).
` + W.shadowSlave.ranks.map(([id]: [string], i: number) => `rank_level(${id}, ${i}).`).join('\n') + '\n'
// each case breaks exactly one rule
const BROKEN: Record<string, string> = {
    rank_without_event: CLEAN.replace('rank_change(9, sleeper, awakened).', 'rank_change(9, sleeper, awakened).\nrank_change(12, awakened, ascended).'),
    dead_npc_acts: CLEAN + "event(5, 'day 4, dawn', count(4), 1, 'mara laughs and draws her sword').\nevent_seen(5, 10).\n",
    timeline_backwards: CLEAN.replace("event(4, 'day 3, night', count(3), 7,", "event(4, 'day 1, noon', count(1), 3,"),
    memory_in_two_slots: CLEAN.replace("slot(memory, 2, 'chuông bạc')", "slot(memory, 2, 'mảnh vỡ bình minh')"),
    rank_skipped: CLEAN.replace('rank_change(9, sleeper, awakened).', 'rank_change(9, sleeper, awakened).\nevent_seen(5, 12).\nevent(5, \'day 4\', count(4), unknown, \'kenji enters the second nightmare\').\nrank_change(12, awakened, transcendent).'),
    rank_lowered: CLEAN.replace('rank_change(9, sleeper, awakened).', 'rank_change(9, sleeper, awakened).\nevent_seen(5, 12).\nevent(5, \'day 4\', count(4), unknown, \'kenji enters the second nightmare\').\nrank_change(12, awakened, sleeper).'),
    fragments_over_capacity: CLEAN.replace('fragments(1200, 2000). cores(2).', 'fragments(1200, 1000).'),
    fragment_cap_mismatch: CLEAN.replace('fragments(1200, 2000)', 'fragments(1200, 1000)'),
}
const rules = (r: any) => (r.violations ?? []).map((v: any) => v.rule).sort()

describe.skipIf(!HAS_SWIPL)('canon rules (SWI-Prolog)', () => {
    test('a clean story has no violation', async () => {
        const r = await L.runProlog(CLEAN, SS)
        expect(r.status).toBe('ok')
        expect(r.violations).toEqual([])
    })

    for (const [rule, facts] of Object.entries(BROKEN)) {
        test(`${rule}: red when broken`, async () => {
            const r = await L.runProlog(facts, SS)
            expect(r.status).toBe('ok')
            expect(rules(r)).toContain(rule)
            // and only the rules this case breaks (fragments over capacity also shows the capacity it should have)
            const allowed = rule === 'fragments_over_capacity' ? [rule, 'fragment_cap_mismatch'] : rule === 'fragment_cap_mismatch' ? [rule] : [rule]
            expect(rules(r).every((x: string) => allowed.includes(x))).toBe(true)
        })
    }

    test('details say what is wrong', async () => {
        const r = await L.runProlog(BROKEN.dead_npc_acts, SS)
        expect(r.violations[0].detail).toMatchObject({ npc: 'mara', died_at: 'day 1, dusk', acts_at: 'day 4, dawn' })
        const t = await L.runProlog(BROKEN.timeline_backwards, SS)
        expect(t.violations[0].detail).toEqual({ earlier: 'day 2, noon', later: 'day 1, noon' })
    })

    test('canon nuances: a Nightmare Creature is not a Nightmare; a dead NPC as an Echo or a body is not acting', async () => {
        const creature = CLEAN.replace("'kenji passes the gateway'", "'kenji kills a nightmare creature'")
        expect(rules(await L.runProlog(creature, SS))).toContain('rank_without_event')
        const viet = CLEAN.replace("'kenji passes the gateway'", "'kenji giết một sinh vật ác mộng'")
        expect(rules(await L.runProlog(viet, SS))).toContain('rank_without_event')
        const echo = CLEAN + "event(5, 'day 4, dawn', count(4), 1, 'the echo of mara follows kenji').\nevent_seen(5, 10).\n"
        expect(rules(await L.runProlog(echo, SS))).toEqual([])
        const vn = CLEAN + "event(5, 'day 4, dawn', count(4), 1, 'aiko mang xác mara về').\nevent_seen(5, 10).\n"
        expect(rules(await L.runProlog(vn, SS))).toEqual([])
    })

    test('every rule is load-bearing: with its clause removed, its red case goes silent', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'canon-mut-'))
        // each rule's clauses sit between "% rule: <marker>" and the next blank line (canon.pl's header says so)
        const marker = (rule: string) => (rule.endsWith('_in_two_slots') ? 'in_two_slots' : rule)
        for (const rule of Object.keys(BROKEN)) {
            const re = new RegExp(`% rule: ${marker(rule)}\\n[\\s\\S]*?(?:\\n\\n|$)`)
            const files = [CANON_FILE, SS_FILE].map((f) => {
                const text = readFileSync(f, 'utf8')
                if (!re.test(text)) return f
                const out = join(dir, `${rule}-${f.split('/').pop()}`)
                writeFileSync(out, text.replace(re, '\n'))
                return out
            })
            expect(files.filter((f) => f.startsWith(dir)).length, rule).toBe(1)
            const r = await L.runProlog(BROKEN[rule], { rules: files })
            expect(r.status, rule).toBe('ok')
            expect(rules(r), rule).not.toContain(rule)
        }
    })

    test('facts are data: a directive in them is refused, not run', async () => {
        const r = await L.runProlog(":- halt(0).\n")
        expect(r).toMatchObject({ status: 'error' })
        expect(r.reason).toMatch(/directive/)
    })
})

describe('fails soft', () => {
    test('no swipl: unavailable, never a throw', async () => {
        expect(await L.runProlog('npc(a).\n', { swipl: null })).toMatchObject({ status: 'unavailable' })
        expect(await L.runProlog('npc(a).\n', { swipl: '/nonexistent/swipl' })).toMatchObject({ status: 'unavailable' })
    })
    test('promptLine is empty unless there is something to correct', () => {
        expect(L.promptLine({ status: 'unavailable' })).toBe('')
        expect(L.promptLine({ status: 'ok', violations: [] })).toBe('')
        const line = L.promptLine({ status: 'ok', violations: [{ rule: 'dead_npc_acts', detail: { npc: 'mara', died_at: 'day 1', acts_at: 'day 4' } }] })
        expect(line).toBe('[Story consistency check: mara died (day 1) but acts later (day 4). Correct this in the story without mentioning the check.]')
        expect(line.includes('\n')).toBe(false)
    })
})

describe('normalizing for the rules', () => {
    test('ranks, dates, fragments', () => {
        expect(['Aspirant (Ứng viên)', 'Sleeper', 'Người Thức Tỉnh', 'Master (Bậc Thầy)', '—'].map(L.normalizeRank)).toEqual(['aspirant', 'sleeper', 'awakened', 'ascended', null])
        expect(L.dateKey('19/5/2026, đêm')).toEqual({ day: `cal(${Date.UTC(2026, 4, 19) / 86400000})`, part: 7 })
        expect(L.dateKey('Day 3, dusk')).toEqual({ day: 'count(3)', part: 5 })
        expect(L.dateKey('18/10/2026, nửa đêm').part).toBe(8)
        expect(L.dateKey('Thử Thách Đầu Tiên, giữa trưa')).toEqual({ day: 'unknown', part: 3 })
        expect(L.fragments('12/1.000')).toEqual({ x: 12, cap: 1000 })
    })
})

// ---- from story.sqlite --------------------------------------------------------------------------------------------------------
const vars = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => ['$' + k, v]))
const saveWith = (state: Record<string, string>) => merge.encodeSave([
    merge.serializeBlock(1, 0, 'root', { __directory: ['ss'] }),
    merge.serializeBlock(2, 0, 'ss', { chaId: 'ss', name: 'Shadow Slave', globalLore: [], chats: [{ id: 'k1', name: 'c', message: [], scriptstate: vars(state) }] }),
])
const START = { st_name: 'Kenji', st_rank: 'Aspirant (Ứng viên)', st_place: 'Trại lính chưa rõ tên', st_date: 'Thử Thách Đầu Tiên, giữa trưa', st_frag: '0/1000', led_rel: 'Nephis | Kenji | trusts', led_ev: 'Day 1, dawn | Kenji wakes in the camp' }

describe.skipIf(!HAS_SWIPL)('check over story.sqlite', () => {
    test('a rank raised with no Nightmare in the timeline is reported; with one it is not', async () => {
        const s = openStoryStore({ dbFile: ':memory:' })
        s.sync(saveWith(START), 1)
        s.sync(saveWith({ ...START, st_rank: 'Sleeper' }), 2)
        const bad = await L.check(s, 'k1')
        expect(rules(bad)).toEqual(['rank_without_event'])
        expect(bad.violations[0].detail).toEqual({ rev: 2, from: 'aspirant', to: 'sleeper' })

        const t = openStoryStore({ dbFile: ':memory:' })
        t.sync(saveWith(START), 1)
        t.sync(saveWith({ ...START, st_rank: 'Sleeper', led_ev: START.led_ev + '\nDay 2, dusk | Kenji survives Cơn Ác Mộng Đầu Tiên' }), 2)
        expect(await L.check(t, 'k1')).toMatchObject({ status: 'ok', violations: [] })
    })
    test('an unknown chat is not_found', async () => {
        expect(await L.check(openStoryStore({ dbFile: ':memory:' }), 'nope')).toEqual({ status: 'not_found' })
    })
})

describe('Shadow Slave PDDL', () => {
    const at = (init: string, goal: string, domain = DOMAIN) => P.solve({ domain, problem: WORLD.replace('(:init', `(:init ${init}`), goal })

    test('finds the known plans', () => {
        expect(at('(at outskirts) (aspirant)', '(awakened)').plan).toEqual([
            '(enter-nightmare)', '(survive-nightmare)', '(fall-asleep outskirts labyrinth)', '(venture labyrinth crimson-spire)', '(pass-gateway crimson-spire academy)',
        ])
        expect(at('(at dark-city) (sleeper)', '(member castle)').plan).toEqual(['(travel dark-city bright-castle)', '(meet gunlaug bright-castle)', '(join-faction castle gunlaug bright-castle)'])
        const asc = at('(at outskirts) (aspirant)', '(ascended)').plan
        expect(asc.slice(-2)).toEqual(['(enter-second-nightmare)', '(survive-second-nightmare)'])
    })

    test('respects preconditions: Awakened only through pass-gateway, so without the Gateway it is impossible', () => {
        for (const init of ['(at outskirts) (aspirant)', '(at dark-city) (sleeper)', '(at dark-city) (sleeper) (exhausted)']) {
            const r = at(init, '(awakened)')
            expect(r.ok, init).toBe(true)
            expect(r.plan.some((s: string) => s.startsWith('(pass-gateway')), init).toBe(true)
        }
        // the world without its only Gateway (Crimson Spire): no way to become Awakened
        expect(P.solve({ domain: DOMAIN, problem: WORLD.replace('(gateway crimson-spire)', '').replace('(:init', '(:init (at outskirts) (aspirant)'), goal: '(awakened)' })).toMatchObject({ ok: false, reason: 'unsolvable' })
        // a deliberately broken domain: pass-gateway without (sleeper) lets an Aspirant skip the First Nightmare -- the check goes red
        const broken = DOMAIN.replace(':precondition (and (sleeper) (at ?g) (gateway ?g) (return-point ?w))', ':precondition (and (at ?g) (gateway ?g) (return-point ?w))')
        expect(broken).not.toBe(DOMAIN)
        const skip = at('(at crimson-spire) (aspirant)', '(awakened)', broken)
        expect(skip.plan).toEqual(['(pass-gateway crimson-spire academy)'])
        expect(at('(at crimson-spire) (aspirant)', '(awakened)').plan[0]).toBe('(enter-nightmare)')
    })

    test('refuses impossible goals', () => {
        expect(at('(at dark-city) (sleeper) (dead nephis)', '(met nephis)')).toMatchObject({ ok: false, reason: 'unsolvable' })
        expect(at('(at outskirts) (aspirant)', '(and (aspirant) (member castle))')).toMatchObject({ ok: false, reason: 'unsolvable' })
        expect(at('(at outskirts) (awakened)', '(sleeper)')).toMatchObject({ ok: false, reason: 'unsolvable' })   // no way back down
        expect(at('(at outskirts)', '(at nowhere)')).toMatchObject({ ok: false, reason: 'parse' })
    })

    test('a plan from the chat: place by alias, rank, the First Nightmare, a dead NPC; an unknown place plans from "here"', () => {
        const s = openStoryStore({ dbFile: ':memory:' })
        s.sync(saveWith(START), 1)
        const p = L.problemFor(s, 'k1')
        expect(p.here).toBe('here')
        expect(p.notes[0]).toMatch(/not on the map/)
        expect(p.text).toContain('(in-nightmare)')
        expect(p.text).toContain('(met nephis)')
        const r = L.plan(s, 'k1', '(awakened)')
        expect(r.status).toBe('ok')
        expect(r.plan[0]).toBe('(survive-nightmare)')                 // already inside the First Nightmare
        expect(r.plan).toContain('(fall-asleep here labyrinth)')   // "here" is in the waking world: the Spell takes the Sleeper from there

        s.sync(saveWith({ ...START, st_rank: 'Sleeper', st_place: 'Thành Phố Bóng Tối, phía đông', st_date: 'Ngày 3', led_ev: 'Day 3, dawn | Nephis died at the spire' }), 2)
        const q = L.problemFor(s, 'k1')
        expect(q.here).toBe('dark-city')
        expect(q.text).toContain('(dead nephis)')
        expect(L.plan(s, 'k1', '(met nephis)')).toMatchObject({ status: 'impossible' })
        expect(L.plan(s, 'k1', '(member changing-star-group)')).toMatchObject({ status: 'impossible' })
        expect(L.plan(s, 'k1', '(member castle)')).toMatchObject({ status: 'ok' })
        expect(L.plan(s, 'k1', 'awakened')).toMatchObject({ status: 'error' })
        expect(L.plan(s, 'k1', '(flying)')).toMatchObject({ status: 'error' })
        expect(L.plan(s, 'nope', '(awakened)')).toEqual({ status: 'not_found' })
    })
})
