// @vitest-environment node
// The GM's symbolic turn (server/node/gmSolver.cjs): Datalog facts read from the chat, the ASP choice (clingo, story/gm/*.lp), an
// absent enemy's road (PDDL), and the line for the GM note. Each hard rule is also checked broken: with it taken out of the program,
// the bad outcome is possible again (the rule is what keeps it out, not the luck of one model).
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const req = createRequire(import.meta.url)
const G = req('../../../server/node/gmSolver.cjs')
const HAS_CLINGO = !!G.findClingo()
const LP = (f: string) => join(G.GM_DIR, f)

const vars = {
    st_name: 'Kenji Park', st_place: 'Khu chợ', st_condition: 'Áo khoác ướt',
    gm_arc: 'phe đang nắm quyền | người cầm gậy | chứng minh lòng trung thành | chỗ đứng',
    gm_beat: '8 | nghe tin đồn | hỏi thêm',
    gm_threats: 'Ba kẻ lạ mặt | 3/4 | xông vào',
    gm_enemies: 'người cầm gậy | muốn lục soát Kenji',
    led_rel: 'Marek | Kenji Park | người lạ\nBa kẻ lạ mặt | Kenji Park | thù địch\nAldric | Kenji Park | kẻ thù',
    led_ev: 'Đêm mưa | Kenji tỉnh lại ở bến cảng\nSáng | Aldric bị giết ở bến cảng',
}
// the Shadow Slave chat of 2026-10-21: the player only walked on; nobody had shown the character thirsty
const walked = [{ role: 'char', text: 'Marek đứng cạnh sạp cá. Ba kẻ lạ mặt đứng ở cổng.' }, { role: 'user', text: 'Kenji thở dài, chầm chậm đi theo đoàn người.' }]
const lure = { world: 'shadow_slave', phase: 'run', vars, messages: walked, dice: { pace: 'quiet', cardNew: true }, kinds: ['a stranger'], stance: 'wants to use the character' }
const intents = (r: any) => (r.decision?.intents ?? []).map((i: any) => `${i.who}:${i.what}${i.need ? '(' + i.need + ')' : ''}`).sort()

describe('reading the words: a need is said, not guessed', () => {
    test('needs in Vietnamese and English; negated, or inside a word that means something else, is no need', () => {
        expect([...G.needsIn('kenji khát khô cổ')]).toEqual(['thirst'])
        expect([...G.needsIn('cẳng tay rách, chảy máu')]).toEqual(['wound'])
        expect([...G.needsIn('he is thirsty and hungry')].sort()).toEqual(['hunger', 'thirst'])
        expect([...G.needsIn('tôi không khát')]).toEqual([])
        expect([...G.needsIn('khát vọng làm giàu')]).toEqual([])
        expect([...G.needsIn('đưa anh tới bệnh viện')]).toEqual([])
        expect([...G.needsIn('mưa rơi trên mái tôn, nước chảy thành dòng')]).toEqual([])
    })
})

describe.skipIf(!HAS_CLINGO)('the turn (clingo)', () => {
    test('no stated need: the stranger who wants to use the character bargains for their own ends, never with water', async () => {
        const r = await G.decide(lure, { budgetMs: 3000 })
        expect(r.status).toBe('ok')
        expect(r.needs).toEqual([])
        expect(r.decision.turn.name).toBe('new')
        expect(intents(r)).toContain('newcomer:own')
        expect(intents(r).some((i: string) => /offer|lure/.test(i))).toBe(false)
        expect(r.line).toContain('stated no need')
        expect(r.ms).toBeLessThan(3000)
    })
    test('a stated need (the panel, or the player\'s words) is the one an offer or a lure may target', async () => {
        const panel = await G.decide({ ...lure, vars: { ...vars, st_condition: 'Cẳng tay rách, chảy máu' } }, { budgetMs: 3000 })
        expect(panel.needs).toEqual(['wound'])
        expect(intents(panel)).toContain('newcomer:lure(wound)')
        const said = await G.decide({ ...lure, messages: [walked[0], { role: 'user', text: 'Kenji khát khô cổ, đi tìm nước.' }] }, { budgetMs: 3000 })
        expect(said.needs).toEqual(['thirst'])
        // met later: drank
        const met = await G.decide({ ...lure, messages: [{ role: 'user', text: 'Kenji khát khô cổ.' }, { role: 'char', text: 'Marek đưa bình, Kenji uống một hơi dài.' }, { role: 'user', text: 'Kenji cảm ơn.' }] }, { budgetMs: 3000 })
        expect(met.needs).toEqual([])
    })
    test('nobody acts where they are not or after death; an absent enemy only comes closer off-stage, on a planned road', async () => {
        const r = await G.decide({ ...lure, dice: { pace: 'escalate', surface: 'the antagonist (người cầm gậy)' }, kinds: [], stance: '' }, { budgetMs: 3000 })
        expect(r.dead).toContain('aldric')
        expect(r.present.sort()).toEqual(['ba kẻ lạ mặt', 'marek'])
        expect(r.decision.turn.name).toBe('escalate')
        expect(r.decision.offstage).toEqual(['người cầm gậy'])
        expect(r.plans['người cầm gậy'].steps.length).toBeGreaterThan(0)
        expect(r.line).toContain('is not here')
        for (const i of r.decision.intents) expect(r.present).toContain(i.who)
        expect(intents(r)).toContain('ba kẻ lạ mặt:oppose')
    })
    test('pacing: no new event right after one (a NEW die or an advance builds instead)', async () => {
        const r = await G.decide({ ...lure, dice: { pace: 'advance', surface: 'the threat "Ba kẻ lạ mặt"', cardNew: true }, prevNew: true }, { budgetMs: 3000 })
        expect(['build', 'quiet']).toContain(r.decision.turn.name)
        expect(r.newEvent).toBe(false)
        expect(r.line).toContain('already brought something new')
    })
    test('combat (the GM machine): nothing new surfaces in a fight, and the enemy in it opposes', async () => {
        const r = await G.decide({ ...lure, mode: { scene: 'still', combat: 'fight' } }, { budgetMs: 3000 })
        expect(r.decision.turn.name).not.toBe('new')
        expect(intents(r)).toContain('ba kẻ lạ mặt:oppose')
    })
    test('every world file loads with the core and picks the rolled kind', async () => {
        for (const [world, kind] of [['shadow_slave', 'a stranger'], ['lotm', 'a stranger'], ['mailman', 'a local being pursuing its own goal'], ['zombie', 'a person in trouble'], ['generic', 'a stranger']]) {
            const r = await G.decide({ ...lure, world, vars: { ...vars, st_world: 'Rừng đói', st_place: 'đường phố' }, kinds: [kind] }, { budgetMs: 3000 })
            expect(r.status, world).toBe('ok')
            expect(r.decision.turn.name, world).toBe('new')
        }
    })
    test('fails soft: no clingo, or no time left, is not an answer', async () => {
        expect((await G.decide(lure, { python: null })).status).toBe('unavailable')
        expect(['timeout', 'ok']).toContain((await G.decide(lure, { budgetMs: 1 })).status)
        expect((await G.decide(lure, { budgetMs: 1 })).line ?? '').toBe('')
    })
})

// the rule taken out: the same facts now allow what the rule forbids (red when broken)
describe.skipIf(!HAS_CLINGO)('each hard rule is what keeps the bad outcome out', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gm-lp-'))
    const broken = (name: string, edit: (s: string) => string) => { const f = join(dir, name); writeFileSync(f, edit(readFileSync(LP('core.lp'), 'utf8'))); return f }
    const allModels = async (core: string, facts: string) => {
        const r = await G.runClingo([LP('derive.lp'), core, LP('shadow_slave.lp')], facts + '\n#show intent/2.\n#show turn/1.', { timeoutMs: 5000 })
        return r
    }
    const factsOf = async (input: any) => (await G.decide(input, { budgetMs: 3000, withFacts: true })).facts as string

    test('NEED: without it a lure on a need nobody stated is a valid answer', async () => {
        const facts = (await factsOf(lure)) + '\n:- not intent(newcomer, lure(thirst)).\nneed_word(thirst).\n'
        const ok = await allModels(LP('core.lp'), facts)
        expect(ok.status).toBe('unsat')                                    // with the rule: impossible
        const f = broken('no-need.lp', (s) => s.replace(/^opt\(P, lure\(N\)\) :- role\(P\), need\(N\)\.$/m, 'opt(P, lure(N)) :- role(P), need_word(N).').replace(/^:- intent\(_, lure\(N\)\), not need\(N\)\.$/m, '').replace('#defined phase/1.', '#defined need_word/1. #defined phase/1.'))
        expect((await allModels(f, facts)).status).toBe('ok')              // without it: chosen
    })
    test('PACING: without it a NEW right after a new event is a valid answer', async () => {
        const facts = (await factsOf({ ...lure, prevNew: true })) + '\n:- not turn(new(stranger)).\n'
        expect((await allModels(LP('core.lp'), facts)).status).toBe('unsat')
        const f = broken('no-pacing.lp', (s) => s.replace(/^:- prev_new, turn\(E\), newish\(E\)\.$/m, ''))
        expect((await allModels(f, facts)).status).toBe('ok')
    })
    test('PRESENCE: without it someone not in the scene gets an intent in it', async () => {
        const facts = (await factsOf(lure)) + '\nrole("người cầm gậy").\n:- not intent("người cầm gậy", _).\n'
        expect((await allModels(LP('core.lp'), facts)).status).toBe('unsat')
        const f = broken('no-presence.lp', (s) => s.replace(/^:- intent\(P, _\), P != newcomer, not present\(P\)\.$/m, ''))
        expect((await allModels(f, facts)).status).toBe('ok')
    })
})
