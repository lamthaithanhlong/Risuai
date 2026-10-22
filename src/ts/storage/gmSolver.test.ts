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

// the librarian's knowledge graph (storyGraph.cjs, story/gm/graph.lp) joins the turn: who in the scene knows what, who the graph has dead
describe.skipIf(!HAS_CLINGO)('the turn with the librarian\'s graph', () => {
    const store = { story: () => ({ chat: { char_id: 'c1', messages: 9 } }), lore: () => [] }
    const graph = (asp: string, facts: any[]) => ({ aspFacts: () => asp, chatWorld: () => 'shadow-slave', factsAbout: () => facts })
    const watch = graph('now(9).\nfact(12, "marek", member_of, "the night watch", fact).\nknows("marek", 12, rumor).\nentity("marek", person).',
        [{ fid: 12, text: 'Marek is in the Night Watch', status: 'fact' }])
    const quiet = { ...lure, chatId: 'k1', dice: { pace: 'quiet' }, kinds: [], stance: '' }

    test('on a quiet turn someone in the scene shares what they know, and only what they know; hearsay stays hearsay', async () => {
        const r = await G.decide(quiet, { budgetMs: 3000, store, graph: watch })
        expect(r.status).toBe('ok')
        expect(intents(r)).toContain('marek:tell')
        expect(r.line).toContain('Marek is in the Night Watch')
        expect(r.line).toContain('hearsay')
        // the enemy in the scene does not know it, so never tells it
        expect(intents(r)).toContain('ba kẻ lạ mặt:oppose')
    })
    test('a pace with an event keeps people on their own business; without the graph nothing changes', async () => {
        const r = await G.decide({ ...quiet, dice: { pace: 'build', surface: 'the threat "Ba kẻ lạ mặt"' } }, { budgetMs: 3000, store, graph: watch })
        expect(intents(r).some((i: string) => /tell/.test(i))).toBe(false)
        const none = await G.decide(quiet, { budgetMs: 3000, store })
        expect(intents(none).some((i: string) => /tell/.test(i))).toBe(false)
    })
    test('the graph\'s dead are dead: never in the scene, never acting', async () => {
        const dead = graph('now(9).\nfact(13, "marek", status, "dead", fact).\nentity("marek", person).', [])
        const r = await G.decide(quiet, { budgetMs: 3000, store, graph: dead })
        expect(r.dead).toContain('marek')
        expect(r.present).not.toContain('marek')
    })
    test('KNOWLEDGE: without the rule someone who does not know the fact tells it', async () => {
        const facts = (await G.decide(quiet, { budgetMs: 3000, store, graph: watch, withFacts: true })).facts + '\n:- not intent("ba kẻ lạ mặt", tell(12)).\nrole("ba kẻ lạ mặt").\n'
        const run = (core: string) => G.runClingo([LP('derive.lp'), G.GRAPH_LP, core, LP('shadow_slave.lp')], facts, { timeoutMs: 5000 })
        expect((await run(LP('core.lp'))).status).toBe('unsat')
        const dir2 = mkdtempSync(join(tmpdir(), 'gm-lp-'))
        const f = join(dir2, 'no-knowledge.lp')
        writeFileSync(f, readFileSync(LP('core.lp'), 'utf8').replace(/^opt\(P, tell\(F\)\) :- .*$/m, 'opt(P, tell(F)) :- role(P), news(F).').replace(/^:- intent\(P, tell\(F\)\), not knows_here\(P, F, _\)\.$/m, '').replace(/^opt\(P, oppose\) :- role\(P\), hostile\(P\)\.$/m, ''))
        expect((await run(f)).status).toBe('ok')
    })
})

// ---- the people as people (npc.lp, npcPsych.cjs): social acts under hard rules about trust, grudge and secrets ------------------------
describe.skipIf(!HAS_CLINGO)('NPC psychology: story/gm/npc.lp', () => {
    const NPC = LP('npc.lp')
    const dir = mkdtempSync(join(tmpdir(), 'npc-lp-'))
    /** one person, "marek", in the scene; `rel` = [trust, affection, debt, grudge] toward the player; extra = more facts */
    const person = (rel: [number, number, number, number], extra = '') => [
        'npc("marek"). present("marek").',
        `rel("marek","player",trust,${rel[0]}). rel("marek","player",affection,${rel[1]}). rel("marek","player",debt,${rel[2]}). rel("marek","player",grudge,${rel[3]}).`,
        'trait("marek",extra,50). trait("marek",agree,50). mood("marek",0).', extra,
    ].join('\n')
    const solve = (facts: string, lp = NPC) => G.runClingo([lp], facts, { timeoutMs: 5000 })
    const acts = (r: any, f = 'social_action') => r.atoms.filter((a: any) => a.name === f).map((a: any) => `${a.args[0]}:${a.args[1].name}`).sort()
    const wants = (r: any) => acts(r, 'wants').map((x: string) => x.split(':')[1])
    /** npc.lp with one line taken out (the rule is a whole line of the file; it must be there) */
    const without = (name: string, rule: string) => {
        const text = readFileSync(NPC, 'utf8')
        const lines = text.split('\n')
        const at = lines.findIndex((l) => l === rule)
        expect(at, `rule line not found: ${rule}`).toBeGreaterThanOrEqual(0)
        const f = join(dir, name)
        writeFileSync(f, lines.filter((_, i) => i !== at).join('\n'))
        return f
    }
    /** the bad answer is forced; with the rule it cannot be had, with the rule taken out it can */
    const keepsOut = async (name: string, rule: string, facts: string, bad: string) => {
        const forced = facts + `\n:- not social_action("marek", ${bad}).\n`
        expect((await solve(forced)).status, 'with the rule').toBe('unsat')
        expect((await solve(forced, without(name, rule))).status, 'without the rule').toBe('ok')
    }

    test('a person with no trust never confides, high debt helps, grudge 40 refuses, an open grudge and affection reconcile', async () => {
        expect(acts(await solve(person([20, 30, 0, 0], 'has_agenda("marek").')))).not.toContain('marek:confide')
        const open = await solve(person([70, 30, 0, 0], 'has_agenda("marek").'))
        expect(wants(open)).toContain('confide')
        expect(acts(open)).toEqual(['marek:confide'])
        expect(acts(await solve(person([50, 30, 45, 0])))).toEqual(['marek:help'])
        expect(acts(await solve(person([50, 30, 0, 45])))).toEqual(['marek:refuse'])
        expect(acts(await solve(person([60, 60, 0, 30])))).toEqual(['marek:reconcile'])
    })
    test('conceal_affection beats forgive: both wanted, the guarded heart hides its affection (affection 70, trust 45, grudge 25, mood 4)', async () => {
        const f = person([45, 70, 0, 25]).replace('mood("marek",0)', 'mood("marek",4)')
        const r = await solve(f)
        expect(wants(r)).toEqual(expect.arrayContaining(['conceal_affection', 'forgive']))
        expect(acts(r)).toEqual(['marek:conceal_affection'])
        // reserved by nature instead of by distrust (extraversion < 40) wants it as well
        const shy = await solve(person([80, 70, 0, 0]).replace('trait("marek",extra,50)', 'trait("marek",extra,30)'))
        expect(wants(shy)).toContain('conceal_affection')
        // forgive alone: a small grudge, a good mood, nothing to hide
        const only = await solve(person([80, 40, 0, 20]).replace('mood("marek",0)', 'mood("marek",5)'))
        expect(wants(only)).toContain('forgive'); expect(wants(only)).not.toContain('conceal_affection')
        expect(acts(only)).toEqual(['marek:forgive'])
    })
    test('the owner\'s example: below trust 30 a person with a secret never volunteers it, by confiding or by telling', async () => {
        const f = person([25, 40, 0, 0], 'has_secret("marek"). has_agenda("marek"). intent("marek", tell(7)).')
        expect((await solve(f)).status).toBe('unsat')       // an intent to tell from core.lp, below 30 with a secret: no answer at all
        const calm = await solve(person([25, 40, 0, 0], 'has_secret("marek"). has_agenda("marek"). intent("marek", own).'))
        expect(acts(calm)).not.toContain('marek:confide')
    })
    test('demeanor: hostile, cold, guarded, warm, neutral; fear or a cold reserved person may stay silent', async () => {
        const dem = async (rel: [number, number, number, number], extra = '') => acts(await solve(person(rel, extra), NPC), 'demeanor')[0]
        expect(await dem([50, 50, 0, 10], 'hostile("marek").')).toBe('marek:hostile')
        expect(await dem([50, 50, 0, 35])).toBe('marek:cold')
        expect(await dem([30, 50, 0, 10])).toBe('marek:guarded')
        expect(await dem([60, 60, 0, 10])).toBe('marek:warm')
        expect(await dem([60, 20, 0, 10])).toBe('marek:neutral')
        const silent = await solve(person([50, 50, 0, 35]).replace('trait("marek",extra,50)', 'trait("marek",extra,20)'))
        const silentOf = (r: any) => r.atoms.filter((x: any) => x.name === 'may_silent').map((x: any) => x.args[0])
        expect(silentOf(silent)).toEqual(['marek'])
        expect(silentOf(await solve(person([50, 50, 0, 35])))).toEqual([])                 // cold but sociable (extraversion 50)
        expect(silentOf(await solve(person([50, 50, 0, 0], 'emotion("marek",fear,7).')))).toEqual(['marek'])
        expect(silentOf(await solve(person([50, 50, 0, 0], 'emotion("marek",fear,3).')))).toEqual([])
    })

    // the rule taken out: the same facts now allow what it forbids (red when a rule is broken)
    describe('each hard rule is what keeps the bad outcome out', () => {
        test('SECRET: confiding below trust 30', () => keepsOut('no-secret.lp', ':- social_action(P, confide), rel(P, "player", trust, V), V < 30.', person([20, 50, 0, 0]), 'confide'))
        test('SECRET: telling what they know below trust 30 with something to hide', () =>
            keepsOut('no-tell.lp', ':- intent(P, tell(_)), has_secret(P), rel(P, "player", trust, V), V < 30.', person([20, 50, 0, 0], 'has_secret("marek"). intent("marek", tell(7)).'), 'small_talk'))
        test('SECRET: a hidden secret needs trust 60 even above 30', () =>
            keepsOut('no-secret60.lp', ':- social_action(P, confide), has_secret(P), rel(P, "player", trust, V), V < 60.', person([45, 50, 0, 0], 'has_secret("marek").'), 'confide'))
        test('HOSTILE-HELP: a hostile person does not help', () => keepsOut('no-hostile-help.lp', ':- social_action(P, help), hostile(P).', person([50, 50, 0, 0], 'hostile("marek").'), 'help'))
        test('HELP-OPPOSE: no help while the intent is to oppose', () => keepsOut('no-help-oppose.lp', ':- social_action(P, help), intent(P, oppose).', person([50, 50, 0, 0], 'intent("marek", oppose).'), 'help'))
        test('INSULT-HELP: no insult while the intent is to help', () => keepsOut('no-insult-help.lp', ':- social_action(P, insult), intent(P, help).', person([50, 50, 0, 0], 'intent("marek", help).'), 'insult'))
        test('THREATEN-HELP: no threat while the intent is to help', () => keepsOut('no-threaten-help.lp', ':- social_action(P, threaten), intent(P, help).', person([50, 50, 0, 0], 'intent("marek", help).'), 'threaten'))
        test('FLIRT: not below affection 50', () => keepsOut('no-flirt.lp', ':- social_action(P, flirt), rel(P, "player", affection, V), V < 50.', person([50, 30, 0, 0]), 'flirt'))
        test('GRUDGE-RECONCILE: not at grudge 70', () => keepsOut('no-grudge-reconcile.lp', ':- social_action(P, reconcile), rel(P, "player", grudge, G), G >= 70.', person([50, 50, 0, 75]), 'reconcile'))
        test('GRUDGE-FORGIVE: not at grudge 70', () => keepsOut('no-grudge-forgive.lp', ':- social_action(P, forgive), rel(P, "player", grudge, G), G >= 70.', person([50, 50, 0, 75]), 'forgive'))
        test('BETRAYED-RECONCILE: not the turn after a betrayal', () => keepsOut('no-betrayed-reconcile.lp', ':- social_action(P, reconcile), recent(_, betray, P).', person([50, 50, 0, 30], 'recent("player", betray, "marek").'), 'reconcile'))
        test('BETRAYED-FORGIVE: not the turn after a betrayal', () => keepsOut('no-betrayed-forgive.lp', ':- social_action(P, forgive), recent(_, betray, P).', person([50, 50, 0, 30], 'recent("player", betray, "marek").'), 'forgive'))
    })
})

// ---- decide() with the module: appraisal, npc.lp, the Subtext line --------------------------------------------------------------------
describe.skipIf(!HAS_CLINGO)('NPC psychology in decide()', () => {
    const { openStoryStore } = req('../../../server/node/storyStore.cjs')
    const np = req('../../../server/node/npcPsych.cjs')
    const tr = (open: number, consc: number, extra: number, agree: number, neuro: number) => ({ open, consc, extra, agree, neuro })
    const SECRET = 'Marek spies for the night watch'
    const AGENDA = 'Marek knows where the vault is'
    const HIDE = 'the three strangers hide a map'
    const seedOf = (marek: number[], more: any[] = [], relations: any[] = []) => ({
        world: 'shadow_slave', version: 1, built: '2026-10-21',
        npcs: [
            { id: 'marek', name: 'Marek', importance: 80, traits: tr(50, 50, 30, 50, 50), speech: 'warm', wants_to_say: AGENDA, wants_to_hide: SECRET, hide_fid: null },
            { id: 'ba kẻ lạ mặt', name: 'Ba kẻ lạ mặt', importance: 40, traits: tr(50, 50, 50, 20, 50), speech: 'cold', wants_to_hide: HIDE, hide_fid: null },
            ...more,
        ],
        relations: [
            { p: 'marek', q: 'player', trust: marek[0], affection: marek[1], debt: marek[2], grudge: marek[3] },
            { p: 'ba kẻ lạ mặt', q: 'player', trust: 10, affection: 10, debt: 0, grudge: 60 },
            ...relations,
        ],
    })
    const open = (seed: any, o: any = {}) => {
        const d = mkdtempSync(join(tmpdir(), 'npc-gm-'))
        writeFileSync(join(d, 'shadow_slave.json'), JSON.stringify(seed))
        const store = openStoryStore({ dbFile: ':memory:' })
        return { store, npc: np.openNpcPsych({ db: store.db, npcDir: d, engine: 'asp', ...o }) }
    }
    const withSoc = (led_soc: string) => ({ ...lure, chatId: 'c1', dice: { pace: 'quiet' }, kinds: [], stance: '', vars: { ...vars, led_soc } })
    const quiet = withSoc('2 | player | gift | Marek')
    const lastLine = (r: any) => String(r.line).split('\n').at(-1) as string

    test('with profiles the line ends with a Subtext, under 520 characters, and the answer carries what it came from', async () => {
        const { npc } = open(seedOf([45, 70, 0, 25]))
        const r = await G.decide(quiet, { budgetMs: 3000, npc })
        expect(r.status).toBe('ok')
        expect(lastLine(r)).toMatch(/^Subtext \(hidden drives; show them/)
        expect(lastLine(r).length).toBeLessThanOrEqual(520)
        expect(r.npc).toMatchObject({ source: 'asp', subtext: lastLine(r) })
        expect(r.npc.actions.map((a: any) => a.who)).toEqual(['Marek', 'Ba kẻ lạ mặt'])
        expect(r.npc.actions[0]).toMatchObject({ action: 'conceal_affection', demeanor: 'warm' })
        expect(lastLine(r)).toContain('hides how much they care')
        expect(r.npc.actions[1]).toMatchObject({ action: 'keep_distance', demeanor: 'hostile' })     // the enemy: opposes, never helps
        expect(r.line).toContain('opposes the player')                                          // the arc's intents are still core.lp's
        // the numbers the narrator was given are kept per chat and turn
        expect(npc.stateOf('c1').map((x: any) => `${x.npc}:${x.action}`).sort()).toEqual(['ba kẻ lạ mặt:keep_distance', 'marek:conceal_affection'])
        expect(npc.stateOf('c1')[1].turn).toBe(2)
    })
    test('the Subtext never carries a secret, an agenda, or a number (over every present profile and the four volitions that touch them)', async () => {
        for (const marek of [[20, 40, 0, 0], [80, 50, 0, 0], [50, 30, 60, 0], [50, 80, 0, 45], [45, 70, 0, 25]]) {
            for (const soc of ['', '2 | player | gift | Marek', '2 | player | insult | Marek\n2 | player | threaten | Marek']) {
                const { npc } = open(seedOf(marek))
                const r = await G.decide(withSoc(soc), { budgetMs: 3000, npc })
                const text = JSON.stringify(r)
                for (const s of [SECRET, AGENDA, HIDE]) expect(text).not.toContain(s)
                expect(r.npc.subtext).not.toMatch(/\d/)
            }
        }
        // and the table: wants_to_say / wants_to_hide of every profile of the card file are not in the lines the module builds
        const seed = seedOf([60, 60, 0, 0])
        const { npc } = open(seed)
        const r = await G.decide(quiet, { budgetMs: 3000, npc })
        for (const n of seed.npcs) for (const t of [n.wants_to_say, n.wants_to_hide]) if (t) expect(r.line).not.toContain(t)
    })
    test('no profile in the scene: the module changes nothing, same line as without it, no npc field', async () => {
        const d = mkdtempSync(join(tmpdir(), 'npc-gm-'))        // an npcDir with no card file: nobody has a profile
        const store = openStoryStore({ dbFile: ':memory:' })
        const npc = np.openNpcPsych({ db: store.db, npcDir: d, engine: 'asp' })
        const a = await G.decide(quiet, { budgetMs: 3000 })
        const b = await G.decide(quiet, { budgetMs: 3000, npc })
        expect(b.line).toBe(a.line)
        expect(b.npc).toBeUndefined()
        expect(b.decision).toEqual(a.decision)
        expect(b.status).toBe('ok')
        // a profile for someone who is not in the scene is no atom either; the people who are (Marek, Ba kẻ lạ mặt: the ledger's,
        // no profile in this card) are strangers: the default seed, neutral traits, and never a secret or an agenda
        const far = open({ ...seedOf([45, 70, 0, 25]), npcs: [{ id: 'aldric', name: 'Aldric', importance: 10, traits: tr(50, 50, 50, 50, 50), speech: 'blunt' }], relations: [] })
        const c = await G.decide({ ...quiet, withFacts: true }, { budgetMs: 3000, npc: far.npc, withFacts: true })
        expect(c.npc.actions.map((x: any) => x.who).sort()).toEqual(['Ba kẻ lạ mặt', 'Marek'])
        expect(c.facts).not.toContain('npc("aldric")')
        expect(c.facts).not.toMatch(/has_secret|has_agenda/)
        expect(c.npc.subtext).not.toMatch(/keeps something back|has something unsaid/)
        expect(c.line.split('\n').slice(0, -1).join('\n')).toBe(a.line)     // the solver's own lines are today's; only the Subtext is added
    })
    test('the off switch: input.npc === false is today\'s answer exactly', async () => {
        const { npc } = open(seedOf([45, 70, 0, 25]))
        const off = await G.decide({ ...quiet, npc: false }, { budgetMs: 3000, npc })
        const none = await G.decide(quiet, { budgetMs: 3000 })
        expect(off.line).toBe(none.line)
        expect(off.npc).toBeUndefined()
        expect(npc.stateOf('c1')).toEqual([])
        const on = await G.decide({ ...quiet, npc: true }, { budgetMs: 3000, npc })
        expect(on.npc).toBeTruthy()
    })
    test('the seed phase carries no Subtext', async () => {
        const { npc } = open(seedOf([45, 70, 0, 25]))
        const r = await G.decide({ ...quiet, phase: 'seed' }, { budgetMs: 3000, npc })
        expect(r.line).not.toContain('Subtext')
        expect(r.npc).toBeUndefined()
    })
    // measured 2026-10-21, acceptance ss ON: 0/20 turns with a Subtext; the ledger never named the people the replies did
    const bare = { st_name: 'Kenji Park', st_place: 'Hành lang', gm_arc: 'phe đang nắm quyền | người cầm gậy | gia nhập | chỗ đứng', gm_beat: '3 | đi tiếp | tìm cầu thang' }
    const scene = (messages: any[], extra: any = {}) => ({ world: 'shadow_slave', phase: 'run', chatId: 'c2', dice: { pace: 'quiet' }, kinds: [], stance: '', turn: 9, vars: { ...bare, ...(extra.vars ?? {}) }, messages, ...extra, ...(extra.vars ? { vars: { ...bare, ...extra.vars } } : {}) })
    test('a profiled person the player\'s message or the last reply names is in the scene, ledger or not (by an alias too)', async () => {
        const { npc } = open(seedOf([45, 70, 0, 25], [{ id: 'nephis', name: 'Nephis', aliases: ['Changing Star'], importance: 95, traits: tr(40, 80, 20, 40, 30), speech: 'cold' }]))
        const r = await G.decide(scene([{ role: 'char', text: 'Hành lang trống.' }, { role: 'user', text: 'Tôi hỏi Changing Star cô ấy định đi đâu.' }]), { budgetMs: 3000, npc })
        expect(r.present).toEqual(['changing star'])                       // derive.lp's present/1: the person atom is the alias the text holds
        expect(r.npc.actions.map((a: any) => a.who)).toEqual(['Nephis'])     // shown by the profile's name
        expect(lastLine(r)).toMatch(/^Subtext .*“Nephis”/)
        // named three messages back only: not in the scene (the same rule as the ledger's people)
        const old = await G.decide(scene([{ role: 'char', text: 'Nephis đi khỏi.' }, { role: 'user', text: 'a' }, { role: 'char', text: 'b' }, { role: 'user', text: 'Tôi nhìn quanh.' }]), { budgetMs: 3000, npc })
        expect(old.present).toEqual([])
        expect(old.npc).toBeUndefined()
        // and the off switch still means today's answer
        const off = await G.decide({ ...scene([{ role: 'user', text: 'Tôi hỏi Nephis.' }]), npc: false }, { budgetMs: 3000, npc })
        expect(off.present).toEqual([])
    })
    test('a named person the chat invented (a LOOK name from the page, or the bookkeeper\'s social line) is a stranger: a Subtext, never a secret', async () => {
        const { npc } = open(seedOf([45, 70, 0, 25]))
        const reply = { role: 'char', text: 'Martin bước lệch khỏi vệt xước, chờ xem Kenji đi tiếp hay dừng.' }
        const byLook = await G.decide(scene([reply, { role: 'user', text: 'Tôi đi tiếp.' }], { people: ['Martin Vale'] }), { budgetMs: 3000, npc, withFacts: true })
        expect(byLook.present).toEqual(['martin vale'])                    // "Martin" in the prose is Martin Vale
        expect(byLook.npc.actions[0]).toMatchObject({ who: 'Martin Vale', demeanor: 'neutral' })
        // a neutral stranger who wants nothing has no drive to show: no Subtext (it read "makes small talk" and the narrator gave him
        // a filler line); he is still in the scene and his act is still recorded
        expect(byLook.line).not.toMatch(/Subtext/)
        expect(byLook.line).toMatch(/“Martin Vale”/)
        expect(byLook.npc.actions[0]).toMatchObject({ action: 'small_talk' })
        expect(byLook.facts).not.toMatch(/has_secret|has_agenda/)
        // the bookkeeper's social line names him, no page list: the same; "Martin" in a later line is still him, and what the player
        // did to him moves how he sees the player (insults: a grudge, so he is cold and keeps away)
        const bySoc = await G.decide(scene([reply, { role: 'user', text: 'Tôi đi tiếp.' }], { vars: { led_soc: '7 | Martin Vale | help | player\n8 | player | insult | Martin\n9 | player | insult | Martin' } }), { budgetMs: 3000, npc })
        expect(bySoc.present).toEqual(['martin vale'])
        expect(bySoc.npc.actions[0]).toMatchObject({ who: 'Martin Vale', demeanor: 'cold' })
        expect(lastLine(bySoc)).toMatch(/^Subtext .*“Martin Vale”.*cold/)
        expect(lastLine(bySoc)).not.toMatch(/keeps something back|has something unsaid/)
        const rel = npc.stateOf('c2').find((x: any) => x.npc === 'martin vale').rel.player
        expect(rel.grudge).toBeGreaterThanOrEqual(30)
        // a role is no name, and a name nobody says in the last two messages is not in the scene
        const none = await G.decide(scene([{ role: 'user', text: 'Tôi đi tiếp.' }], { people: ['Martin Vale'] }), { budgetMs: 3000, npc })
        expect(none.present).toEqual([])
        expect(none.npc).toBeUndefined()
    })
    test('the persona\'s companion (input.companions) is close to the player and there to help, not a neutral stranger making small talk (Mailman 2026-10-22)', async () => {
        const { npc } = open(seedOf([45, 70, 0, 25]))
        const msgs = [{ role: 'char', text: 'Evelyn lướt sát bên Kenji, vừa chạy vừa ngoái nhìn. Con gấu vẫn đuổi theo.' }, { role: 'user', text: 'Tôi chạy lên sườn núi và nhìn xuống.' }]
        const as = await G.decide(scene(msgs, { companions: ['Evelyn'] }), { budgetMs: 3000, npc, withFacts: true })
        expect(as.present).toEqual(['evelyn'])
        expect(as.facts).toContain('companion("evelyn")')
        expect(as.decision.intents).toEqual([expect.objectContaining({ who: 'evelyn', what: 'help' })])
        expect(as.npc.actions[0]).toMatchObject({ who: 'Evelyn', action: 'help', demeanor: 'warm' })
        expect(lastLine(as)).toMatch(/^Subtext .*“Evelyn” helps as a close friend: feeling first, a few words in their own voice, never a report of the scene/)
        expect(lastLine(as)).not.toMatch(/says so/)
        expect(lastLine(as)).not.toMatch(/small talk|keeps something back|has something unsaid/)
        const rel = npc.stateOf('c2').find((x: any) => x.npc === 'evelyn').rel.player
        expect(rel).toMatchObject({ trust: 85, affection: 80, grudge: 0 })
        // the same name, not a companion: a stranger, neutral, its own business and no Subtext
        const { npc: npc2 } = open(seedOf([45, 70, 0, 25]))
        const st = await G.decide(scene(msgs, { people: ['Evelyn'] }), { budgetMs: 3000, npc: npc2 })
        expect(st.decision.intents).toEqual([expect.objectContaining({ who: 'evelyn', what: 'own' })])
        expect(st.npc.actions[0]).toMatchObject({ who: 'Evelyn', demeanor: 'neutral' })
        expect(st.line).not.toMatch(/Subtext/)
        // a companion is in the scene only when named, like everyone: not named in the last two messages, not there
        const gone = await G.decide(scene([{ role: 'user', text: 'Tôi đi tiếp.' }], { companions: ['Evelyn'] }), { budgetMs: 3000, npc })
        expect(gone.present).toEqual([])
    })
    test('the ledger moves the numbers the solver reads: a betrayal the turn before is never answered by making peace', async () => {
        const base = seedOf([60, 55, 0, 30])
        const calm = await G.decide(withSoc(''), { budgetMs: 3000, npc: open(base).npc })
        expect(calm.npc.actions[0]).toMatchObject({ who: 'Marek', action: 'reconcile' })
        const hurt = await G.decide(withSoc('2 | player | betray | Marek'), { budgetMs: 3000, npc: open(base).npc })
        expect(hurt.npc.actions[0].action).not.toBe('reconcile')
        expect(hurt.npc.actions[0].action).not.toBe('forgive')
        expect(hurt.npc.actions[0].action).not.toBe('help')
    })
    test('it fails soft: a sidecar slower than its deadline falls to the local fold in time; a module that throws or writes garbage leaves today\'s answer', async () => {
        const { npc: real } = open(seedOf([45, 70, 0, 25]))
        const slow = { ready: () => true, appraise: () => new Promise((r) => setTimeout(r, 1500)) }
        const { npc } = open(seedOf([45, 70, 0, 25]), { engine: 'auto', fatima: slow })
        const t0 = Date.now()
        const r = await G.decide(quiet, { npc })                     // the real 300 ms budget
        expect(r.status).toBe('ok')
        expect(Date.now() - t0).toBeLessThan(300 + 150)
        expect(r.npc.source).toBe('asp')
        expect(lastLine(r)).toMatch(/^Subtext/)
        const none = await G.decide(quiet, { budgetMs: 3000 })
        for (const bad of [
            { ...real, appraise: async () => { throw new Error('boom') } },
            { ...real, resolveId: () => { throw new Error('boom') } },
            { ...real, aspFacts: () => 'this is ((( not asp' },
            { ...real, aspFacts: () => 'npc("marek"). present("marek"). :- social_action("marek", _).' },        // no answer set at all
        ]) {
            const x = await G.decide(quiet, { budgetMs: 3000, npc: bad })
            expect(x.status).toBe('ok')
            expect(x.line).toBe(none.line)
            expect(x.npc).toBeUndefined()
        }
    })
    test('budget: six profiled people in the scene, decide stays far under 300 ms (p95 of 20)', async () => {
        const names = ['Marek', 'Evelyn', 'Torben', 'Sasha', 'Ilya', 'Doran']
        const more = names.slice(1).map((n, i) => ({ id: n.toLowerCase(), name: n, importance: 70 - i, traits: tr(40 + i, 50, 40 + 3 * i, 30 + 8 * i, 60 - 5 * i), speech: 'blunt', wants_to_say: 'x'.repeat(10), wants_to_hide: i % 2 ? 'y' : null, hide_fid: null }))
        const seed = seedOf([45, 70, 0, 25], more, names.slice(1).map((n) => ({ p: n.toLowerCase(), q: 'player', trust: 35, affection: 55, debt: 10, grudge: 30 })))
        seed.npcs = seed.npcs.filter((n: any) => n.id !== 'ba kẻ lạ mặt'); seed.relations = seed.relations.filter((r: any) => r.p !== 'ba kẻ lạ mặt')
        const { npc } = open(seed)
        const six = { ...quiet, vars: { ...vars, led_soc: '1 | player | help | Marek\n2 | player | gift | Evelyn\n2 | Torben | insult | player', led_rel: names.map((n) => `${n} | Kenji Park | ally`).join('\n') },
            messages: [{ role: 'char', text: names.join(', ') + ' đứng quanh.' }, { role: 'user', text: 'Kenji nhìn quanh.' }] }
        const first = await G.decide(six, { budgetMs: 3000, npc })
        expect(first.npc.actions).toHaveLength(6)
        const ms: number[] = []
        for (let i = 0; i < 20; i++) { const t0 = Date.now(); const r = await G.decide(six, { npc }); ms.push(Date.now() - t0); expect(r.status).toBe('ok'); expect(r.npc.actions).toHaveLength(6) }
        ms.sort((a, b) => a - b)
        expect(ms[Math.floor(ms.length * 0.95) - 1]).toBeLessThan(300)
        expect(lastLine(first).length).toBeLessThanOrEqual(520)
    })
})

// The Mailman chat of 2026-10-22: two replies said Mặt Sẹo was gone, and the next had him speak with nothing showing his return.
// A name in a message made him "present"; now a leave word beside the name (narration, not negated, not in speech) takes him out
// until a return word or the player calling him.
describe.skipIf(!HAS_CLINGO)('who left the scene (left/returned in derive.lp)', () => {
    const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'mailman-scarface.json'), 'utf8'))
    const turnOf = (messages: any[], over: any = {}) => ({ world: 'mailman', phase: 'run', vars: fx.vars, messages, dice: { pace: 'quiet' }, kinds: [], stance: '', ...over })
    const history = fx.messages.slice(0, 5)                       // what the turn that wrote the bad reply was given
    const MS = 'mặt sẹo'
    const presentOf = async (messages: any[]) => (await G.decide(turnOf(messages), { budgetMs: 4000 })).present as string[]
    const withReply = (reply: string) => [...history.slice(0, 4), { role: 'char', text: reply }, { role: 'user', text: 'Tôi nhìn quanh.' }]

    test('the fixture is the bug: his name is in the last replies, which say he left', () => {
        expect(history.at(-2).text).toMatch(/Mặt Sẹo đã biến mất/)
        expect(history[1].text).toMatch(/Gã mặt sẹo đã khuất hẳn/)
        expect(fx.messages.at(-1).text).toMatch(/^😐 Mặt Sẹo/m)
    })
    test('on the live chat he is not present, has no intent and no Subtext line', async () => {
        const r = await G.decide(turnOf(history), { budgetMs: 4000, withFacts: true })
        expect(r.present).not.toContain(MS)
        expect(r.present).toContain('evelyn')                     // the others are untouched
        expect(intents(r).join(' ')).not.toContain(MS)
        expect(r.line).not.toContain('Mặt Sẹo')
        expect(r.facts).toMatch(/left\("mặt sẹo", 1\)/)
        expect(r.facts).toMatch(/left\("mặt sẹo", 3\)/)
    })
    test('with a profile he gets no npc action either', async () => {
        const { openStoryStore } = req('../../../server/node/storyStore.cjs')
        const np = req('../../../server/node/npcPsych.cjs')
        const t = { open: 50, consc: 50, extra: 30, agree: 40, neuro: 50 }
        const d = mkdtempSync(join(tmpdir(), 'npc-gm-'))
        writeFileSync(join(d, 'mailman.json'), JSON.stringify({ world: 'mailman', version: 1, built: '2026-10-22',
            npcs: [{ id: MS, name: 'Mặt Sẹo', importance: 60, traits: t, speech: 'cold', wants_to_hide: 'he fears bears', hide_fid: null }, { id: 'evelyn', name: 'Evelyn', importance: 60, traits: t, speech: 'warm', hide_fid: null }],
            relations: [{ p: MS, q: 'player', trust: 30, affection: 20, debt: 0, grudge: 10 }, { p: 'evelyn', q: 'player', trust: 60, affection: 50, debt: 0, grudge: 0 }] }))
        const store = openStoryStore({ dbFile: ':memory:' })
        const npc = np.openNpcPsych({ db: store.db, npcDir: d, engine: 'asp' })
        const r = await G.decide(turnOf(history, { chatId: 'c-ms' }), { budgetMs: 4000, npc })
        const who = (r.npc?.actions ?? []).map((a: any) => String(a.who).toLowerCase())
        expect(who).toContain('evelyn')
        expect(who).not.toContain(MS)
        expect(String(r.npc?.subtext ?? '')).not.toMatch(/Mặt Sẹo/)
    })
    test('he comes back: "Mặt Sẹo quay lại" in the last reply makes him present again', async () => {
        expect(await presentOf(withReply('Tiếng gầm vang xa. Mặt Sẹo quay lại bên lối mòn, tay vẫn cầm gậy.'))).toContain(MS)
    })
    test('a return after the leave (newer reply) wins; a leave after the return does not', async () => {
        const left = 'Mặt Sẹo biến mất sau thân cây.'
        const back = 'Mặt Sẹo trở lại, thở hổn hển.'
        expect(await presentOf([{ role: 'char', text: left }, { role: 'user', text: 'Tôi chờ.' }, { role: 'char', text: back }, { role: 'user', text: 'Tôi nhìn.' }])).toContain(MS)
        expect(await presentOf([{ role: 'char', text: back }, { role: 'user', text: 'Tôi chờ.' }, { role: 'char', text: left }, { role: 'user', text: 'Tôi nhìn.' }])).not.toContain(MS)
    })
    test('left and back in the same reply: present', async () => {
        expect(await presentOf(withReply('Mặt Sẹo biến mất sau thân cây rồi quay lại với một cành khô.'))).toContain(MS)
    })
    test('speech does not count: "hắn đã đi rồi" inside quotes leaves him in the scene', async () => {
        expect(await presentOf(withReply('Evelyn thì thầm: “Mặt Sẹo bỏ đi rồi, hắn biến mất từ nãy.” Mặt Sẹo đứng ngay sau lưng cô.'))).toContain(MS)
        expect(await presentOf(withReply('Mặt Sẹo nói "tôi sẽ không rời đi đâu" rồi khoanh tay.'))).toContain(MS)
    })
    test('a negated or wished leave does not count', async () => {
        expect(await presentOf(withReply('Mặt Sẹo không bỏ đi, gã đứng nhìn con gấu.'))).toContain(MS)
        expect(await presentOf(withReply('Mặt Sẹo chưa hề biến mất, gã vẫn ở cuối nhóm.'))).toContain(MS)
        expect(await presentOf(withReply('Nếu Mặt Sẹo bỏ đi thì nhóm mất người dẫn đường.'))).toContain(MS)
    })
    test('the player calling him makes him present again, however the replies left him', async () => {
        const called = [...history.slice(0, 4), { role: 'user', text: 'Tôi gọi Mặt Sẹo lại đây giúp một tay.' }]
        expect(await presentOf(called)).toContain(MS)
    })
    test('a leave word beside another person does not move him', async () => {
        expect(await presentOf(withReply('Evelyn biến mất sau tán cây. Mặt Sẹo đứng khoanh tay.'))).toContain(MS)
    })
    test('movesIn reads English and Vietnamese', () => {
        const keys: [string, string[]][] = [['marek', ['marek']], ['mặt sẹo', ['mặt sẹo']]]
        expect([...G.movesIn('marek walked away into the fog.', 'leave', keys)]).toEqual(['marek'])
        expect([...G.movesIn('marek came back at dawn.', 'return', keys)]).toEqual(['marek'])
        expect([...G.movesIn('marek never left.', 'leave', keys)]).toEqual([])
        expect([...G.movesIn('mặt sẹo rời khỏi nhóm, marek ở lại.', 'leave', keys)]).toEqual(['mặt sẹo'])
    })
})
