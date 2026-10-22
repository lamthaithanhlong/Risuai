// @vitest-environment node
// NPC psychology (server/node/npcPsych.cjs): seeds from story/npcs/<world>.json, the social ledger folded into trust / affection /
// debt / grudge by story/npcs/appraisal.json, after-effects, the sidecar switch, the atoms clingo reads and the Subtext line.
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const req = createRequire(import.meta.url)
const { openStoryStore } = req('../../../server/node/storyStore.cjs')
const { openStoryGraph } = req('../../../server/node/storyGraph.cjs')
const np = req('../../../server/node/npcPsych.cjs')
const { validate, sub } = req('../../../server/node/jsonSchemaLite.cjs')
const build = { merge: req('../../../server/node/story/npcs/build/merge.cjs'), normalize: req('../../../server/node/story/npcs/build/normalize.cjs') }
const { SCHEMA, APPRAISAL, TAGS, DIMS, EMOTION_OF_TAG, ENGINES, SUBTEXT_MAX } = np

const NPC_DIR = join(__dirname, '../../../server/node/story/npcs')
const GRAPH_DIR = join(__dirname, '../../../server/node/story/graphs')
const GOLDEN = JSON.parse(readFileSync(join(NPC_DIR, 'build/golden.json'), 'utf8'))

// the graph of storyGraph.test.ts, trimmed: fact indexes 6 (an unknown about Hồng bà bà) and 9 (what Kai was) carry the secrets
const GRAPH = {
    world: 'mailman', version: 1, built: '2026-10-21',
    entities: [
        { id: 'hồng bà bà', kind: 'person', name: 'Hồng bà bà', aliases: ['Red Granny'] },
        { id: 'mặc cúc', kind: 'person', name: 'Mặc Cúc' },
        { id: 'kai', kind: 'person', name: 'Kai' },
        { id: 'ghost market', kind: 'place', name: 'Ghost Market', aliases: ['Quỷ thị'] },
        { id: 'hồng yên quán', kind: 'place', name: 'Hồng Yên quán' },
        { id: 'the north quarter', kind: 'place', name: 'the North Quarter' },
        { id: 'liệp cẩu đoàn', kind: 'faction', name: 'Liệp Cẩu đoàn', aliases: ['Hound Band'] },
    ],
    facts: [
        { s: 'hồng bà bà', r: 'controls', o: 'ghost market', status: 'fact', text: 'Hồng bà bà is the master of the Ghost Market.', source: 'book:Ghost Market' },
        { s: 'hồng yên quán', r: 'part_of', o: 'ghost market', status: 'fact', text: 'Hồng Yên quán is a house of the Ghost Market.', source: 'book:Ghost Market' },
        { s: 'the north quarter', r: 'part_of', o: 'ghost market', status: 'rumor', text: 'Some say the North Quarter belongs to the Ghost Market.', source: 'book:Ghost Market' },
        { s: 'mặc cúc', r: 'located_at', o: 'hồng yên quán', status: 'fact', text: 'Mặc Cúc works at Hồng Yên quán.', source: 'book:Ghost Market' },
        { s: 'mặc cúc', r: 'member_of', o: 'liệp cẩu đoàn', status: 'fact', text: 'Mặc Cúc rides with the Hound Band.', source: 'book:Ghost Market' },
        { s: 'liệp cẩu đoàn', r: 'enemy_of', o: 'kai', status: 'fact', text: 'The Hound Band hunts Kai.', source: 'book:Ghost Market' },
        { s: 'hồng bà bà', r: 'identity', o: null, status: 'unknown', text: 'Nobody knows what Hồng bà bà really is.', source: 'book:Ghost Market' },
        { s: 'mặc cúc', r: 'rank', o: 'steward', status: 'outdated', text: 'Mặc Cúc was one of the twelve stewards.', source: 'book:Ghost Market', until: 'she rose to chief steward' },
        { s: 'kai', r: 'located_at', o: 'hồng yên quán', status: 'rumor', text: 'Kai is said to hide at Hồng Yên quán.', source: 'book:Ghost Market' },
        { s: 'kai', r: 'identity', o: 'a former postman', status: 'fact', text: 'Kai was once a postman himself.', source: 'book:Ghost Market' },
    ],
}
const SECRET_HONG = 'Granny hides what she is'
const SECRET_KAI = 'Kai hides that he was a postman'
const SAY_CUC = 'Cúc wants the postman to warn the north quarter'
const traits = (open: number, consc: number, extra: number, agree: number, neuro: number) => ({ open, consc, extra, agree, neuro })
const SEED = {
    world: 'mailman', version: 1, built: '2026-10-21',
    npcs: [
        { id: 'hồng bà bà', name: 'Hồng bà bà', aliases: ['Red Granny'], importance: 90, traits: traits(40, 80, 30, 20, 30), speech: 'cold', wants_to_say: null, wants_to_hide: SECRET_HONG, hide_fid: 6, tags: ['proud', 'ruthless'] },
        { id: 'mặc cúc', name: 'Mặc Cúc', aliases: ['Cúc'], importance: 70, traits: traits(50, 70, 60, 60, 50), speech: 'warm', wants_to_say: SAY_CUC, wants_to_hide: null, hide_fid: null, tags: ['kind'] },
        { id: 'kai', name: 'Kai', importance: 50, traits: traits(60, 40, 40, 50, 70), speech: 'terse', wants_to_hide: SECRET_KAI, hide_fid: 9 },
    ],
    relations: [
        { p: 'mặc cúc', q: 'kai', trust: 70, affection: 40, debt: 0, grudge: 5, why: 'she hides him' },
        { p: 'mặc cúc', q: 'player', trust: 55, affection: 45, debt: 0, grudge: 5 },
        { p: 'kai', q: 'mặc cúc', trust: 80, affection: 60, debt: 20, grudge: 0 },
        { p: 'hồng bà bà', q: 'player', trust: 20, affection: 10, debt: 0, grudge: 30 },
    ],
}

function setup(o: { seed?: any; graph?: any; engine?: string; fatima?: any; log?: (s: string) => void; fatimaBudgetMs?: number } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'npc-'))
    const gdir = join(dir, 'graphs'), ndir = join(dir, 'npcs')
    mkdirSync(gdir); mkdirSync(ndir)
    writeFileSync(join(gdir, 'mailman.json'), JSON.stringify(o.graph ?? GRAPH))
    writeFileSync(join(ndir, 'mailman.json'), JSON.stringify(o.seed ?? SEED))
    const store = openStoryStore({ dbFile: ':memory:', now: () => 1_000_000 })
    const g = openStoryGraph({ db: store.db, graphDir: gdir })
    g.loadWorld('mailman')
    const logs: string[] = []
    const p = np.openNpcPsych({ db: store.db, npcDir: ndir, log: o.log ?? ((s: string) => logs.push(s)), engine: o.engine, fatima: o.fatima, fatimaBudgetMs: o.fatimaBudgetMs })
    return { store, g, p, db: store.db, dir, ndir, logs }
}
const ev = (turn: number, who: string, tag: string, target: string) => ({ turn, who, tag, target })
const ASK = { chatId: 'c1', world: 'mailman', turn: 5, present: ['mặc cúc', 'kai'], events: [ev(4, 'player', 'help', 'mặc cúc')] }

describe('the seed schema (story/schema/npc-profile.schema.json)', () => {
    test('the sample is valid; a trait of 101, a negative one, a bad speech, an extra key and a missing trait are not', () => {
        expect(validate(SCHEMA, SEED)).toEqual([])
        const npc = sub(SCHEMA, 'npc')
        const ok = SEED.npcs[1]
        expect(validate(npc, ok)).toEqual([])
        expect(validate(npc, { ...ok, traits: { ...ok.traits, open: 101 } }).join()).toMatch(/traits\.open: above 100/)
        expect(validate(npc, { ...ok, traits: { ...ok.traits, neuro: -1 } }).join()).toMatch(/traits\.neuro: below 0/)
        expect(validate(npc, { ...ok, traits: { ...ok.traits, open: 50.5 } }).join()).toMatch(/is number, wants integer|wants integer/)
        expect(validate(npc, { ...ok, speech: 'shouty' }).join()).toMatch(/not one of cold, warm/)
        expect(validate(npc, { ...ok, mood: 3 }).join()).toMatch(/unexpected mood/)
        const { traits: _t, ...noTraits } = ok
        expect(validate(npc, noTraits).join()).toMatch(/missing traits/)
        expect(validate(npc, { ...ok, tags: ['a', 'b', 'c', 'd', 'e', 'f'] }).join()).toMatch(/more than 5/)
        expect(validate(npc, { ...ok, id: 'Mặc Cúc' }).join()).toMatch(/does not match/)           // ids are lower-case
        expect(validate(npc, { ...ok, wants_to_say: 'x'.repeat(201) }).join()).toMatch(/longer than 200/)
        expect(validate(sub(SCHEMA, 'relation'), { p: 'kai', q: 'player', trust: 101, affection: 0, debt: 0, grudge: 0 }).join()).toMatch(/trust: above 100/)
    })
    test('what the schema cannot say is caught by seedErrors, by merge and by the loader: p == q, a pair twice, an end outside the file, the player as an npc', () => {
        const bad = (relations: any[], npcs = SEED.npcs) => ({ ...SEED, npcs, relations })
        const rel = (p: string, q: string) => ({ p, q, trust: 50, affection: 50, debt: 0, grudge: 0 })
        expect(np.seedErrors(SEED)).toEqual([])
        expect(np.seedErrors(bad([rel('kai', 'kai')])).join()).toMatch(/same/)
        expect(np.seedErrors(bad([rel('kai', 'player'), rel('kai', 'player')])).join()).toMatch(/listed twice/)
        expect(np.seedErrors(bad([rel('kai', 'nobody')])).join()).toMatch(/q is no npc/)
        expect(np.seedErrors(bad([rel('nobody', 'kai')])).join()).toMatch(/p is no npc/)
        expect(np.seedErrors(bad([], [...SEED.npcs, { ...SEED.npcs[2], id: 'player' }])).join()).toMatch(/never an npc/)
        // merge's draft check says the same, per file
        const g = { persons: new Set(['hồng bà bà', 'mặc cúc', 'kai']), facts: GRAPH.facts }
        expect(build.merge.checkDraft({ npcs: SEED.npcs, relations: [rel('kai', 'kai')] }, g, new Set(['kai'])).join()).toMatch(/p and q are the same/)
        // and the loader refuses the file whole, keeping what was there
        const s = setup({ seed: bad([rel('kai', 'kai')]) })
        expect(s.p.loadWorld('mailman')).toBe(false)
        expect(s.logs.join()).toMatch(/same/)
    })
    test('every column of npc_profile has a schema property with the same range, and the database refuses what the schema refuses', () => {
        const s = setup()
        const cols = s.db.prepare('PRAGMA table_info(npc_profile)').all().map((c: any) => c.name)
        const prop: Record<string, string> = { wants_say: 'wants_to_say', wants_hide: 'wants_to_hide' }
        const npcProps = SCHEMA.$defs.npc.properties
        for (const c of cols) {
            if (c === 'world') continue
            if (['open', 'consc', 'extra', 'agree', 'neuro'].includes(c)) {
                const t = SCHEMA.$defs.score
                expect([t.minimum, t.maximum]).toEqual([0, 100])
                expect(SCHEMA.$defs.traits.properties[c]).toBeDefined()
            } else expect(npcProps[prop[c] ?? c], c).toBeDefined()
        }
        const ins = (open: number) => s.db.prepare("INSERT INTO npc_profile (world, id, name, importance, open, speech) VALUES ('x', ?, 'n', 5, ?, 'cold')").run('k' + open, open)
        expect(() => ins(100)).not.toThrow()
        expect(() => ins(101)).toThrow(/CHECK/)
        expect(() => s.db.prepare("INSERT INTO npc_rel_seed (world, p, q, trust, affection, debt, grudge) VALUES ('x', 'a', 'a', 1, 1, 1, 1)").run()).toThrow(/CHECK/)
    })
    test('the appraisal table has the 17 tags with the numbers of the plan, one emotion each, and every tag has a Vietnamese gloss', () => {
        expect(TAGS).toHaveLength(17)
        expect(DIMS).toEqual(['trust', 'affection', 'debt', 'grudge'])
        expect(APPRAISAL.tags.betray).toMatchObject({ trust: -30, affection: -12, grudge: 25, emotion: 'hate' })
        expect(EMOTION_OF_TAG.save).toBe('gratitude')
        for (const t of TAGS) expect(APPRAISAL.tags[t].vi.length, t).toBeGreaterThan(0)
        expect(ENGINES).toEqual(['auto', 'fatima', 'asp'])
    })
})

describe('loading a card\'s seeds', () => {
    test('rows are written, a second call is a hash check, a changed file is reloaded, a broken one is refused and the old rows stay', () => {
        const s = setup()
        expect(s.p.loadWorld('mailman')).toBe(true)
        expect(s.logs.filter((l) => /3 profiles, 4 pairs/.test(l))).toHaveLength(1)
        expect(s.db.prepare('SELECT COUNT(*) AS n FROM npc_profile').get().n).toBe(3)
        expect(s.db.prepare('SELECT COUNT(*) AS n FROM npc_rel_seed').get().n).toBe(4)
        expect(s.p.profileOf('mailman', 'mặc cúc')).toMatchObject({ name: 'Mặc Cúc', importance: 70, speech: 'warm', hasAgenda: true, hasSecret: false, traits: traits(50, 70, 60, 60, 50) })
        expect(s.p.profileOf('mailman', 'kai')).toMatchObject({ hasSecret: true, hideFid: 9 })
        expect(s.p.profileOf('mailman', 'nobody')).toBeNull()
        s.p.loadWorld('mailman')
        expect(s.logs.filter((l) => /profiles/.test(l))).toHaveLength(1)        // not read again
        // another process (another open on the same db): the meta hash says it is loaded
        const again = np.openNpcPsych({ db: s.db, npcDir: s.ndir, log: (l: string) => s.logs.push(l) })
        expect(again.loadWorld('mailman')).toBe(true)
        expect(s.logs.filter((l) => /profiles/.test(l))).toHaveLength(1)
        expect(again.profileOf('mailman', 'kai')?.name).toBe('Kai')
        // a changed file replaces the rows
        writeFileSync(join(s.ndir, 'mailman.json'), JSON.stringify({ ...SEED, npcs: SEED.npcs.slice(0, 2), relations: SEED.relations.slice(1, 2) }))
        expect(s.p.loadWorld('mailman')).toBe(true)
        expect(s.db.prepare('SELECT COUNT(*) AS n FROM npc_profile').get().n).toBe(2)
        expect(s.p.profileOf('mailman', 'kai')).toBeNull()
        // a broken one is refused, the rows stay
        writeFileSync(join(s.ndir, 'mailman.json'), JSON.stringify({ ...SEED, npcs: [{ ...SEED.npcs[1], traits: traits(50, 70, 60, 60, 101) }], relations: [] }))
        expect(s.p.loadWorld('mailman')).toBe(false)
        expect(s.logs.join('\n')).toMatch(/traits\.neuro: above 100/)
        expect(s.db.prepare('SELECT COUNT(*) AS n FROM npc_profile').get().n).toBe(2)
        expect(s.p.loadWorld('zombie')).toBe(false)                              // no file
    })
    test('opening on a database that already has the tables changes nothing (CREATE IF NOT EXISTS only)', () => {
        const s = setup()
        s.p.loadWorld('mailman')
        np.openNpcPsych({ db: s.db, npcDir: s.ndir })
        np.openNpcPsych({ db: s.db, npcDir: s.ndir })
        expect(s.db.prepare('SELECT COUNT(*) AS n FROM npc_profile').get().n).toBe(3)
        expect(s.p.stats().worlds).toEqual({ mailman: { npcs: 3, pairs: 4 } })
    })
})

describe('names to ids (resolveId)', () => {
    const st = { st_name: 'Kenji Park', st_truename: 'Ken' }
    test('aliases of the graph and of the seed, NFC against NFD, the player by every name, honorifics, a unique first word, nobody', () => {
        const s = setup()
        s.p.loadWorld('mailman')
        const id = (n: string, state: any = st) => s.p.resolveId('mailman', 'c1', n, state)
        expect(id('Hồng bà bà')).toBe('hồng bà bà')
        expect(id('Red Granny')).toBe('hồng bà bà')                                // kg_alias
        expect(id('Cúc')).toBe('mặc cúc')                                          // npc_alias only
        expect(id('Mặc Cúc'.normalize('NFD'))).toBe('mặc cúc')                     // NFD input
        expect(id('  “Kai”. ')).toBe('kai')
        expect(id('Kenji')).toBe('player')
        expect(id('Kenji Park')).toBe('player')
        expect(id('ken')).toBe('player')
        expect(id('player')).toBe('player')
        expect(id('Kenji', {})).toBeNull()                                         // no panel, no player
        expect(id('ông Kai')).toBe('kai')
        expect(id('chị Cúc')).toBe('mặc cúc')
        expect(id('Bà Hồng bà bà')).toBe('hồng bà bà')
        expect(id('mặc')).toBe('mặc cúc')                                          // first word of one profile
        expect(id('Zorg')).toBeNull()
        expect(id('')).toBeNull()
        // a chat-local person the graph made is a person too (no profile: no atoms later, but an id)
        s.db.prepare("INSERT INTO kg_entity (world, id, kind, name, chat) VALUES ('mailman', 'tiểu bạch', 'person', 'Tiểu Bạch', 'c1')").run()
        s.db.prepare("INSERT INTO kg_alias (world, chat, id, alias) VALUES ('mailman', 'c1', 'tiểu bạch', 'tiểu bạch')").run()
        expect(id('Tiểu Bạch')).toBe('tiểu bạch')
        expect(s.p.resolveId('mailman', 'other chat', 'Tiểu Bạch', st)).toBeNull()
        // a place is not a person
        expect(id('Ghost Market')).toBeNull()
    })
    test('a first word two profiles share names nobody; with the graph tables missing the seed still resolves', () => {
        const two = { ...SEED, npcs: [...SEED.npcs, { id: 'mặc kỳ', name: 'Mặc Kỳ', importance: 10, traits: traits(50, 50, 50, 50, 50), speech: 'blunt' }], relations: [] }
        const s = setup({ seed: { ...two } })
        s.p.loadWorld('mailman')
        expect(s.p.resolveId('mailman', 'c1', 'mặc', st)).toBeNull()
        expect(s.p.resolveId('mailman', 'c1', 'mặc cúc', st)).toBe('mặc cúc')
        const bare = np.openNpcPsych({ db: new (req('better-sqlite3'))(':memory:'), npcDir: s.ndir })
        bare.loadWorld('mailman')
        expect(bare.resolveId('mailman', 'c1', 'Kai', st)).toBe('kai')
    })
})

// ---- 2026-10-21, acceptance ss ON: 0/20 turns with a Subtext; the scene's people were never anyone the layer knew -------------------
describe('who the layer can read: canon names in the prose (namedIn), and strangers the card has no profile for', () => {
    test('namedIn: each profiled person a text names, by the longest alias it holds as a whole word; short aliases and parts of words are no hit', () => {
        const s = setup()
        s.p.loadWorld('mailman')
        const texts = ['Cúc rót trà, rồi Red Granny bước vào', 'không ai thấy Kai']
        expect(s.p.namedIn('mailman', texts)).toEqual([{ id: 'hồng bà bà', alias: 'red granny' }, { id: 'kai', alias: 'kai' }, { id: 'mặc cúc', alias: 'cúc' }])
        expect(s.p.namedIn('mailman', ['Mặc Cúc gật đầu với Cúc'])).toEqual([{ id: 'mặc cúc', alias: 'mặc cúc' }])   // longest wins
        expect(s.p.namedIn('mailman', ['Kaiser và Cúcu'])).toEqual([])                                              // inside a word
        const short = setup({ seed: { ...SEED, npcs: [{ ...SEED.npcs[2], aliases: ['Ka'] }], relations: [] } })
        short.p.loadWorld('mailman')
        expect(short.p.namedIn('mailman', ['Ka nói'])).toEqual([])                                                 // 2 letters: not looked for
        // an alias the seed writes in lower case is a description, an ordinary word in prose ("không gian" is "space")
        const desc = setup({ seed: { ...SEED, npcs: [{ ...SEED.npcs[2], aliases: ['không gian', 'Lừa Già'] }], relations: [] } })
        desc.p.loadWorld('mailman')
        expect(desc.p.namedIn('mailman', ['không gian lạnh đi'])).toEqual([])
        expect(desc.p.namedIn('mailman', ['Lừa Già bước tới'])).toEqual([{ id: 'kai', alias: 'lừa già' }])
        // and case-sensitive: an alias that is also an ordinary word ("hy vọng" = hope) is the person only as the seed writes it
        const hope = setup({ seed: { ...SEED, npcs: [{ ...SEED.npcs[2], aliases: ['Hy Vọng'] }], relations: [] } })
        hope.p.loadWorld('mailman')
        expect(hope.p.namedIn('mailman', ['Cô ấy còn chút hy vọng.'])).toEqual([])
        expect(hope.p.namedIn('mailman', ['Hy vọng cuối cùng đã tắt.'])).toEqual([])
        expect(hope.p.namedIn('mailman', ['Hy Vọng bước vào.'])).toEqual([{ id: 'kai', alias: 'hy vọng' }])
        expect(desc.p.namedIn('mailman', ['lừa già bước tới'])).toEqual([])
    })
    test('a stranger: neutral traits, the default seed toward everyone, no secret, no agenda; a profile with the same id wins', async () => {
        const s = setup()
        const r = await s.p.appraise({ chatId: 'c1', world: 'mailman', turn: 5, present: ['martin vale', 'kai'], events: [ev(4, 'player', 'insult', 'martin vale')], strangers: [{ id: 'martin vale', name: 'Martin Vale' }, { id: 'kai', name: 'Not Kai' }] })
        const m = r.npcs.find((n: any) => n.id === 'martin vale')
        expect(m).toMatchObject({ name: 'Martin Vale', hasSecret: false, hasAgenda: false, traits: { open: 50, consc: 50, extra: 50, agree: 50, neuro: 50 } })
        expect(m.rel.player.grudge).toBeGreaterThan(APPRAISAL.default_seed.grudge)          // the insult moved how he sees the player
        expect(m.rel.player.trust).toBeLessThan(APPRAISAL.default_seed.trust)
        expect(m.emotions.some((e: any) => e.type === 'anger' && e.target === 'player')).toBe(true)
        expect(r.npcs.find((n: any) => n.id === 'kai').name).toBe('Kai')                     // the card's profile, not the stranger's
        const atoms = s.p.aspFacts(r, ['martin vale', 'kai'], { world: 'mailman', turn: 5 })
        expect(atoms).toContain('npc("martin vale").')
        expect(atoms).not.toContain('has_secret("martin vale")')
        expect(atoms).not.toContain('has_agenda("martin vale")')
        expect(atoms).toContain('has_secret("kai")')
        // a stranger who is not present, or none asked for, is nobody
        expect((await s.p.appraise({ chatId: 'c1', world: 'mailman', turn: 5, present: ['kai'], events: [], strangers: [{ id: 'martin vale', name: 'Martin Vale' }] })).npcs.map((n: any) => n.id)).toEqual(['kai'])
        expect((await s.p.appraise({ chatId: 'c1', world: 'mailman', turn: 5, present: ['martin vale'], events: [] })).npcs).toEqual([])
        expect(np.strangerOf('x', 'X')).toMatchObject({ hasSecret: false, hasAgenda: false, wantsHide: null, wantsSay: null, source: 'stranger' })
    })
})

describe('the social ledger ($led_soc)', () => {
    test('lines are parsed; unknown tags, bad turns, empty names and who == whom are dropped; the Vietnamese gloss counts; a repeat is one act', () => {
        const led = ['3 | player | help | Mặc Cúc', '3 | Player | HELP | mặc cúc', '4 | Mặc Cúc | giúp | Kai', '4 | kai | dance | player', 'x | kai | help | player', '5 | kai | harm | kai',
            '5 | | harm | kai', '5 | kai | harm', '', '6 | player | thất hứa | kai', '6 | player | làm lành | kai'].join('\n')
        const e = np.socialEvents({ led_soc: led })
        expect(e.map((x: any) => `${x.turn} ${x.who} ${x.tag} ${x.target}`)).toEqual(['3 player help mặc cúc', '4 mặc cúc help kai', '6 player promise_broken kai', '6 player reconcile kai'])
        expect(e.map((x: any) => x.pos)).toEqual([0, 1, 2, 3])
        expect(np.socialEvents({ $led_soc: '1 | a | save | b' })).toHaveLength(1)
        expect(np.socialEvents({})).toEqual([])
        expect(np.socialEvents('2 | a | insult | b')).toHaveLength(1)
    })
    test('only the last 120 acts are read', () => {
        const led = Array.from({ length: 130 }, (_, i) => `${i + 1} | player | help | n${i}`).join('\n')
        const e = np.socialEvents({ led_soc: led })
        expect(e).toHaveLength(120)
        expect(e[0]).toMatchObject({ turn: 11, pos: 0 })
        expect(e[119]).toMatchObject({ turn: 130, pos: 119 })
    })
})

describe('the fold (foldRelations)', () => {
    test('golden vectors: what server/node/story/npcs/build/golden.json says, which the C# port must also produce', () => {
        expect(GOLDEN.vectors).toHaveLength(6)
        for (const v of GOLDEN.vectors) expect(np.foldRelations(v.seed, v.events, v.traits), v.name).toEqual(v.expect)
    })
    test('betrayal: trust 60 -> 30 and affection 50 -> 38; help: debt 0 -> 8; save lifts debt most; debt_paid brings it down', () => {
        const seed = [{ p: 'a', q: 'player', trust: 60, affection: 50, debt: 0, grudge: 10 }]
        expect(np.foldRelations(seed, [ev(1, 'player', 'betray', 'a')]).a.player).toMatchObject({ trust: 30, affection: 38, grudge: 35 })
        expect(np.foldRelations(seed, [ev(1, 'player', 'help', 'a')]).a.player).toMatchObject({ trust: 66, debt: 8 })
        expect(np.foldRelations(seed, [ev(1, 'player', 'save', 'a')]).a.player.debt).toBe(20)
        expect(np.foldRelations(seed, [ev(1, 'player', 'save', 'a'), ev(2, 'player', 'debt_paid', 'a')]).a.player.debt).toBe(0)
        expect(np.foldRelations(seed, [ev(1, 'player', 'insult', 'a')]).a.player.grudge).toBe(20)
    })
    test('the view is the target\'s of the actor: who acts changes how the OTHER sees them; confide also lifts the actor\'s own trust', () => {
        const r = np.foldRelations([], [ev(1, 'a', 'confide', 'player')])
        expect(r.player.a.trust).toBe(45)                  // default 40 + confide trust 5
        expect(r.a.player.trust).toBe(48)                  // the actor trusted: mutual_trust 8
        expect(r.a.player.affection).toBe(40)              // unmoved
    })
    test('clamped at 0 and 100 after every event; an unknown tag, a self act and an empty name do nothing', () => {
        const seed = [{ p: 'a', q: 'player', trust: 98, affection: 3, debt: 99, grudge: 1 }]
        const up = np.foldRelations(seed, [ev(1, 'player', 'save', 'a'), ev(2, 'player', 'save', 'a')])
        expect(up.a.player).toMatchObject({ trust: 100, debt: 100, grudge: 0 })
        const down = np.foldRelations(seed, [ev(1, 'player', 'betray', 'a'), ev(2, 'player', 'betray', 'a'), ev(3, 'player', 'betray', 'a'), ev(4, 'player', 'betray', 'a')])
        expect(down.a.player.trust).toBe(0)
        expect(down.a.player.affection).toBe(0)
        expect(np.foldRelations(seed, [ev(1, 'player', 'dance', 'a'), ev(1, 'a', 'help', 'a'), ev(1, '', 'help', 'a'), ev(1, 'player', 'help', '')])).toEqual({ a: { player: seed.map((r) => ({ trust: 98, affection: 3, debt: 99, grudge: 1 }))[0] } })
    })
    test('trait modulators: grudge x(1.5 - agree), trust loss x(0.5 + neuro), affection gain x(0.5 + extra), debt gain x(0.6 + 0.8 consc); losses of the other kind are as written', () => {
        const at = (t: any, tag: string) => np.foldRelations([{ p: 'a', q: 'player', trust: 50, affection: 50, debt: 50, grudge: 50 }], [ev(1, 'player', tag, 'a')], { a: t }).a.player
        expect(at(traits(50, 50, 50, 0, 50), 'insult').grudge).toBe(65)            // +10 x 1.5
        expect(at(traits(50, 50, 50, 100, 50), 'insult').grudge).toBe(55)          // +10 x 0.5
        expect(at(traits(50, 50, 50, 0, 50), 'reconcile').grudge).toBe(40)         // a fall is unmodulated
        expect(at(traits(50, 50, 50, 50, 100), 'lie').trust).toBe(28)              // -15 x 1.5 = 27.5 -> 50 - 22.5 = 27.5 -> 28
        expect(at(traits(50, 50, 50, 50, 0), 'lie').trust).toBe(43)                // -15 x 0.5 = -7.5 -> 42.5 -> 43
        expect(at(traits(50, 50, 50, 50, 100), 'help').trust).toBe(56)             // a rise is unmodulated
        expect(at(traits(50, 50, 0, 50, 50), 'help').affection).toBe(51.5 > 51 ? 52 : 51)   // +3 x 0.5 = 1.5 -> 51.5 -> 52
        expect(at(traits(50, 50, 100, 50, 50), 'help').affection).toBe(55)         // +3 x 1.5 = 4.5 -> 54.5 -> 55
        expect(at(traits(50, 0, 50, 50, 50), 'save').debt).toBe(62)                // +20 x 0.6
        expect(at(traits(50, 100, 50, 50, 50), 'save').debt).toBe(78)              // +20 x 1.4
    })
})

describe('after-effects (emotionsLocal)', () => {
    test('an act gives its emotion at full strength, halved each turn, gone under 2; a neurotic target keeps 0.7; later acts do not count', () => {
        const e = [ev(5, 'player', 'betray', 'a')]
        const at = (now: number, t: any = {}) => np.emotionsLocal(e, now, { a: t }).a
        expect(at(5)).toEqual({ mood: -4.5, emotions: [{ type: 'hate', intensity: 9, target: 'player', sinceTurn: 5 }] })
        expect(at(6).emotions[0].intensity).toBe(5)                 // 4.5, half up
        expect(at(7).emotions[0].intensity).toBe(2)                 // 2.25
        expect(at(8)).toBeUndefined()                               // 1.125
        expect(at(8, traits(50, 50, 50, 50, 70)).emotions[0].intensity).toBe(3)    // 9 x 0.7^3 = 3.09
        expect(at(4)).toBeUndefined()                               // the act is after `now`
    })
    test('the same emotion about the same person adds up (capped at 10); mood is the positive minus the negative, halved, within -10..10', () => {
        const e = [ev(5, 'player', 'insult', 'a'), ev(5, 'player', 'harm', 'a'), ev(5, 'player', 'help', 'a'), ev(5, 'player', 'save', 'a'), ev(5, 'b', 'harm', 'a')]
        const r = np.emotionsLocal(e, 5, {}).a
        expect(r.emotions.filter((x: any) => x.type === 'anger' && x.target === 'player')[0].intensity).toBe(10)     // 6 + 8, capped
        expect(r.emotions.find((x: any) => x.type === 'gratitude').intensity).toBe(10)                                // 4 + 8 capped
        expect(r.mood).toBeLessThanOrEqual(10)
        expect(r.mood).toBeGreaterThanOrEqual(-10)
        const flat = np.emotionsLocal([ev(1, 'player', 'praise', 'a')], 1, {}).a
        expect(flat.mood).toBe(1)                                   // joy 2 / 2
    })
})

describe('the switch (appraise): the sidecar when it answers in time and sanely, the local fold otherwise', () => {
    const good = (over: any = {}) => ({
        ms: 7, engine: 'fatima', cache: 'miss',
        npcs: [
            { id: 'mặc cúc', mood: 99, emotions: [{ type: 'gratitude', intensity: 12, target: 'player', sinceTurn: 4 }], si: { player: 11 }, rel: { player: { trust: 150, affection: 61.4, debt: -5, grudge: 3 } } },
            { id: 'kai', mood: -2, emotions: [], si: {}, rel: { player: { trust: 40, affection: 40, debt: 0, grudge: 10 } } },
        ],
        ...over,
    })
    const fake = (impl: any, ready = true) => { const calls: any[] = []; return { calls, ready: () => ready, appraise: (...a: any[]) => { calls.push(a); return impl(...a) } } }

    test('the local answer: seeds, fold, gratitude, source asp; the payload shape of the sidecar is what the local path takes', async () => {
        const s = setup({ engine: 'asp' })
        const r = await s.p.appraise(ASK)
        expect(r.source).toBe('asp')
        expect(r.npcs.map((n: any) => n.id).sort()).toEqual(['kai', 'mặc cúc'])
        const cuc = r.npcs.find((n: any) => n.id === 'mặc cúc')
        expect(cuc.rel.player).toMatchObject({ trust: 61, affection: 48, debt: 9, grudge: 3 })      // seed 55/45/0/5 + help, her traits
        expect(cuc.rel.kai).toMatchObject({ trust: 70 })                                          // her seed toward Kai
        expect(cuc.emotions).toEqual([{ type: 'gratitude', intensity: 2, target: 'player', sinceTurn: 4 }])
        expect(cuc.mood).toBe(1)                                              // gratitude 2 / 2
        expect(r.ms).toBeLessThan(50)
        const kai = r.npcs.find((n: any) => n.id === 'kai')
        expect(kai.rel.player).toEqual({ trust: 40, affection: 40, debt: 0, grudge: 10 })         // no seed, no ledger: the default
        expect(s.p.appraiseLocal({ turn: 1, npcs: [], events: [] }).npcs).toEqual([])
    })
    test('a ledger relation seeds a pair the card did not (enemy words give grudge 60, ally words trust 60); the card\'s own seed wins; nobody profiled -> nothing', async () => {
        const s = setup({ engine: 'asp' })
        const r = await s.p.appraise({ ...ASK, events: [], present: ['kai', 'mặc cúc', 'hồng bà bà'], relations: [{ a: 'kai', b: 'hồng bà bà', how: 'kẻ thù' }, { a: 'mặc cúc', b: 'kai', how: 'bạn thân' }] })
        const by = (id: string) => r.npcs.find((n: any) => n.id === id)
        expect(by('kai').rel['hồng bà bà']).toMatchObject({ trust: 10, grudge: 60 })
        expect(by('hồng bà bà').rel.kai).toMatchObject({ trust: 10, grudge: 60 })                // both ways
        expect(by('mặc cúc').rel.kai.trust).toBe(70)                                             // the card's seed, not the ledger's 60
        expect((await s.p.appraise({ ...ASK, present: ['nobody', 'player'] })).npcs).toEqual([])
        expect((await s.p.appraise({ ...ASK, world: 'zombie' })).npcs).toEqual([])
    })
    test('engine asp never calls the sidecar; a sidecar that is not ready is not called and the turn says why', async () => {
        const f1 = fake(() => Promise.resolve(good()))
        expect((await setup({ engine: 'asp', fatima: f1 }).p.appraise(ASK)).source).toBe('asp')
        expect(f1.calls).toHaveLength(0)
        const f2 = fake(() => Promise.resolve(good()), false)
        const r = await setup({ engine: 'auto', fatima: f2 }).p.appraise(ASK)
        expect(r).toMatchObject({ source: 'asp', why: 'sidecar not ready' })
        expect(f2.calls).toHaveLength(0)
        expect((await setup({ engine: 'auto' }).p.appraise(ASK)).source).toBe('asp')               // no client at all
    })
    test('a good answer is source fatima with its numbers clamped; the payload carries traits and flags, never the text of a secret or an agenda', async () => {
        for (const engine of ['auto', 'fatima']) {
            const f = fake(() => Promise.resolve(good()))
            const s = setup({ engine, fatima: f })
            const r = await s.p.appraise(ASK)
            expect(r.source).toBe('fatima')
            const cuc = r.npcs.find((n: any) => n.id === 'mặc cúc')
            expect(cuc).toMatchObject({ mood: 10, si: { player: 10 }, rel: { player: { trust: 100, affection: 61, debt: 0, grudge: 3 } } })
            expect(cuc.emotions[0]).toMatchObject({ type: 'gratitude', intensity: 10, target: 'player' })
            expect(cuc.traits).toEqual(traits(50, 70, 60, 60, 50))                                   // the profile rides along
            const [payload, budget] = f.calls[0]
            expect(budget).toBe(110)
            expect(payload).toMatchObject({ chatId: 'c1', world: 'mailman', turn: 5, present: ['mặc cúc', 'kai'], events: [ev(4, 'player', 'help', 'mặc cúc')] })
            const pc = payload.npcs.find((n: any) => n.id === 'mặc cúc')
            expect(pc).toMatchObject({ name: 'Mặc Cúc', importance: 70, speech: 'warm', tags: ['kind'], hasSecret: false, hasAgenda: true, traits: traits(50, 70, 60, 60, 50) })
            expect(Object.keys(pc.seed).sort()).toEqual(['kai', 'player'])
            expect(pc.seed.player).toEqual({ trust: 55, affection: 45, debt: 0, grudge: 5 })
            const text = JSON.stringify(payload)
            for (const secret of [SECRET_HONG, SECRET_KAI, SAY_CUC]) expect(text).not.toContain(secret)
        }
    })
    test('a rejection, a throw, a hang past the budget (answered within budget + 50 ms), a bad shape: all fall to the local fold', async () => {
        const reject = await setup({ fatima: fake(() => Promise.reject(new Error('boom 500'))) }).p.appraise(ASK)
        expect(reject).toMatchObject({ source: 'asp', why: 'boom 500' })
        const thrown = await setup({ fatima: fake(() => { throw new Error('sync boom') }) }).p.appraise(ASK)
        expect(thrown).toMatchObject({ source: 'asp', why: 'sync boom' })
        const s = setup({ fatima: fake(() => new Promise(() => {})) })
        const t0 = Date.now()
        const hang = await s.p.appraise(ASK, { budgetMs: 60 })
        const took = Date.now() - t0
        expect(hang.source).toBe('asp')
        expect(hang.why).toMatch(/no answer in 60 ms/)
        expect(took).toBeGreaterThanOrEqual(55)
        expect(took).toBeLessThan(60 + 50)
        expect(hang.npcs.find((n: any) => n.id === 'mặc cúc').rel.player.trust).toBe(61)           // the local numbers
        const late = await setup({ fatima: fake(() => new Promise((res) => setTimeout(() => res(good()), 120))), fatimaBudgetMs: 40 }).p.appraise(ASK)
        expect(late).toMatchObject({ source: 'asp' })
        expect(s.p.stats().fell).toBe(1)
    })
    test.each([
        ['nothing', null],
        ['no npcs', { npcs: [] }],
        ['npcs not a list', { npcs: {} }],
        ['a person asked for is missing', { npcs: [good().npcs[0]] }],
        ['an id nobody sent', { npcs: [...good().npcs, { id: 'ghost', mood: 0, emotions: [], si: {}, rel: {} }] }],
        ['mood is a string', { npcs: [{ ...good().npcs[0], mood: 'sad' }, good().npcs[1]] }],
        ['mood is NaN', { npcs: [{ ...good().npcs[0], mood: NaN }, good().npcs[1]] }],
        ['an emotion that is not OCC', { npcs: [{ ...good().npcs[0], emotions: [{ type: 'boredom', intensity: 3, target: 'player' }] }, good().npcs[1]] }],
        ['an emotion about nobody known', { npcs: [{ ...good().npcs[0], emotions: [{ type: 'joy', intensity: 3, target: 'ghost' }] }, good().npcs[1]] }],
        ['a relation toward nobody known', { npcs: [{ ...good().npcs[0], rel: { ghost: { trust: 1, affection: 1, debt: 1, grudge: 1 } } }, good().npcs[1]] }],
        ['a relation missing a dimension', { npcs: [{ ...good().npcs[0], rel: { player: { trust: 1, affection: 1, debt: 1 } } }, good().npcs[1]] }],
        ['si is not a number', { npcs: [{ ...good().npcs[0], si: { player: 'high' } }, good().npcs[1]] }],
    ])('a bad shape (%s) falls to asp', async (_name, answer) => {
        const r = await setup({ fatima: fake(() => Promise.resolve(answer)) }).p.appraise(ASK)
        expect(r).toMatchObject({ source: 'asp', why: 'bad shape' })
        expect(r.npcs).toHaveLength(2)
    })
    test('no profiled person present: no sidecar call at all', async () => {
        const f = fake(() => Promise.resolve(good()))
        const r = await setup({ fatima: f }).p.appraise({ ...ASK, present: ['nobody'] })
        expect(r.npcs).toEqual([])
        expect(f.calls).toHaveLength(0)
    })
    test('the sidecar\'s emotions about people the events name are accepted (ids known from the ledger), the card\'s stat counts follow', async () => {
        const f = fake(() => Promise.resolve(good({ npcs: [{ ...good().npcs[0], emotions: [{ type: 'anger', intensity: 4, target: 'hồng bà bà' }] }, good().npcs[1]] })))
        const s = setup({ fatima: f })
        const r = await s.p.appraise({ ...ASK, events: [ev(4, 'hồng bà bà', 'insult', 'mặc cúc')] })
        expect(r.source).toBe('fatima')
        expect(s.p.stats()).toMatchObject({ calls: 1, fatima: 1, asp: 0, engine: 'auto' })
    })
})

describe('the atoms clingo reads (aspFacts)', () => {
    async function answer(over: any = {}) {
        const s = setup({ engine: 'asp' })
        const ask = { ...ASK, present: ['mặc cúc', 'kai', 'nobody'], events: [ev(2, 'hồng bà bà', 'insult', 'mặc cúc'), ev(4, 'player', 'help', 'mặc cúc'), ev(5, 'player', 'betray', 'kai')], ...over }
        const result = await s.p.appraise(ask)
        return { s, ask, result, text: s.p.aspFacts(result, ask.present, { world: 'mailman', events: ask.events, turn: ask.turn }) as string }
    }
    test('only present people with a profile; relations only toward the present and the player; one atom a line', async () => {
        const { text } = await answer()
        const atoms = text.split('\n')
        for (const a of atoms) expect(a, a).toMatch(/^[a-z_]+\(.*\)\.$/)
        expect(atoms).toContain('npc("mặc cúc").')
        expect(atoms).toContain('npc("kai").')
        expect(text).not.toContain('npc("nobody")')
        expect(text).not.toContain('hồng bà bà", ')                       // she is not here: no rel toward her, no trait of hers
        expect(atoms).toContain('trait("mặc cúc", agree, 60).')
        expect(atoms).toContain('rel("mặc cúc", "player", trust, 61).')
        expect(atoms).toContain('rel("mặc cúc", "kai", trust, 70).')
        expect(atoms).toContain('rel("kai", "player", trust, 4).')        // the default 40, betrayed: -30 x (0.5 + 0.7) = -36
        expect(atoms.filter((a) => a.startsWith('rel(')).every((a) => /^rel\("[^"]+", "[^"]+", (trust|affection|debt|grudge), \d+\)\.$/.test(a))).toBe(true)
        expect(atoms.filter((a) => a.startsWith('rel("mặc cúc"'))).toHaveLength(12)      // toward the player, kai and 'nobody' (present, no profile), four dims each
    })
    test('mood, emotions, secrets and agendas as booleans, recent acts of the last 3 turns that touch a present profiled person', async () => {
        const { text } = await answer()
        const atoms = text.split('\n')
        expect(atoms).toContain('has_secret("kai").')
        expect(atoms.some((a) => a.startsWith('has_secret("mặc cúc")'))).toBe(false)
        expect(atoms).toContain('has_agenda("mặc cúc").')
        expect(atoms.some((a) => /^emotion\("kai", hate, \d+\)\.$/.test(a))).toBe(true)
        expect(atoms.some((a) => /^mood\("kai", -?\d+\)\.$/.test(a))).toBe(true)
        expect(atoms).toContain('recent("player", betray, "kai").')
        expect(atoms).toContain('recent("player", help, "mặc cúc").')
    })
    test('the turn-2 insult is older than 3 turns at turn 5: not recent; the secret and agenda texts and wants_* never appear', async () => {
        const { text } = await answer()
        expect(text).not.toContain('recent("hồng bà bà", insult')
        for (const secret of [SECRET_HONG, SECRET_KAI, SAY_CUC, 'postman', 'warn']) expect(text).not.toContain(secret)
        expect(text).not.toMatch(/wants/)
    })
    test('an answered person with no profile (or one outside `present`) gets no atom; nothing at all gives \'\'', async () => {
        const { s, result } = await answer()
        const ghost = { npcs: [{ id: 'ghost', rel: {}, emotions: [], mood: 0, si: {} }] }
        expect(s.p.aspFacts(ghost, ['ghost'], { world: 'mailman' })).toBe('')
        expect(s.p.aspFacts(result, ['hồng bà bà'], { world: 'mailman' })).toBe('')
        expect(s.p.aspFacts({ npcs: [] }, ['kai'])).toBe('')
        expect(s.p.aspFacts(null, [])).toBe('')
        // a result without the profile riding along is read through ctx.world
        const bare = { npcs: [{ id: 'kai', rel: { player: { trust: 12, affection: 1, debt: 0, grudge: 3 } }, emotions: [], mood: 0, si: { player: 6 } }] }
        const atoms = s.p.aspFacts(bare, ['kai'], { world: 'mailman' }).split('\n')
        expect(atoms).toContain('trait("kai", neuro, 70).')
        expect(atoms).toContain('si("kai", "player", 6).')
        expect(atoms).toContain('has_secret("kai").')
    })
    test('the emotions are capped at the 20 strongest', async () => {
        const s = setup({ engine: 'asp' })
        const emotions = Array.from({ length: 30 }, (_, i) => ({ type: np.EMOTIONS[i % 14], intensity: 1 + Math.floor(i / 14), target: 'player', sinceTurn: 1 }))
        const text = s.p.aspFacts({ npcs: [{ id: 'kai', rel: {}, emotions, mood: 0, si: {}, traits: traits(1, 2, 3, 4, 5) }] }, ['kai'], {})
        expect(text.split('\n').filter((a: string) => a.startsWith('emotion('))).toHaveLength(20)
    })
})

describe('the Subtext line (subtextOf)', () => {
    async function people() {
        const s = setup({ engine: 'asp' })
        const result = await s.p.appraise({ ...ASK, present: ['mặc cúc', 'kai', 'hồng bà bà'] })
        return { s, result }
    }
    const decision = {
        social: [['mặc cúc', 'reconcile'], ['kai', 'small_talk'], ['hồng bà bà', 'threaten']],
        demeanor: [['mặc cúc', 'cold'], ['kai', 'guarded'], ['hồng bà bà', 'hostile']],
        wants: [['mặc cúc', 'reconcile'], ['mặc cúc', 'keep_distance'], ['hồng bà bà', 'threaten']],
        mayStay: ['mặc cúc'],
    }
    test('abstract volitions from the phrase tables: wants, action, demeanor, speech, silence, unsaid, kept back; by importance; nothing numeric, nothing secret', async () => {
        const { s, result } = await people()
        const line = s.p.subtextOf(decision, result, { 'mặc cúc': 'Mặc Cúc' })
        expect(line.startsWith('Subtext (hidden drives; show them through action, tone and what is left unsaid, never state them):')).toBe(true)
        expect(line.indexOf('“Hồng bà bà”')).toBeLessThan(line.indexOf('“Mặc Cúc”'))          // importance 90 before 70 before 50
        expect(line.indexOf('“Mặc Cúc”')).toBeLessThan(line.indexOf('“Kai”'))
        expect(line).toContain('“Mặc Cúc” wants to reconcile but moves to reconcile'.replace('but moves to reconcile', 'and says so'))
        expect(line).toContain('“Hồng bà bà” wants to threaten and says so; hostile, speaks coldly; keeps something back.')
        expect(line).toContain('“Kai” makes small talk; guarded, speaks tersely; keeps something back.')
        expect(line).toMatch(/“Mặc Cúc” [^.]*; cold, speaks warmly; may stay silent; has something unsaid\./)
        expect(line).not.toMatch(/\d/)
        for (const secret of [SECRET_HONG, SECRET_KAI, SAY_CUC, 'postman']) expect(line).not.toContain(secret)
        expect([...line].length).toBeLessThanOrEqual(SUBTEXT_MAX.total)
    })
    test('a want the action does not follow reads "but ..."; a person with no social action is absent; no actions at all gives an empty string; shapes: objects, Sets, {name}', async () => {
        const { s, result } = await people()
        const line = s.p.subtextOf({ social: { 'mặc cúc': 'keep_distance' }, wants: { 'mặc cúc': ['reconcile'] } }, result, {})
        expect(line).toContain('“Mặc Cúc” wants to reconcile but keeps distance; speaks warmly; has something unsaid.')
        expect(line).not.toContain('Kai')
        expect(s.p.subtextOf({}, result, {})).toBe('')
        expect(s.p.subtextOf({ social: [] }, result, {})).toBe('')
        expect(s.p.subtextOf(null, result, {})).toBe('')
        expect(s.p.subtextOf(decision, { npcs: [] }, {})).toBe('')
        const odd = s.p.subtextOf({ social: [['kai', { name: 'help' }]], mayStay: new Set(['kai']) }, result, {})
        expect(odd).toContain('“Kai” offers help; speaks tersely; may stay silent; keeps something back.')
        expect(s.p.subtextOf({ social: [['kai', 'dance']] }, result, {})).toBe('')              // an act it has no phrase for
    })
    test('small talk that wants nothing, neutral, plain and holding nothing back is no drive: no fragment (Mailman 2026-10-22, Evelyn mid bear chase)', async () => {
        const s = setup({ engine: 'asp' })
        const result = await s.p.appraise({ ...ASK, present: ['evelyn', 'kai'], strangers: [{ id: 'evelyn', name: 'Evelyn' }] })
        expect(result.npcs.map((n: any) => n.id)).toContain('evelyn')
        const idle = { social: [['evelyn', 'small_talk']], demeanor: [['evelyn', 'neutral']] }
        expect(s.p.subtextOf(idle, result, {})).toBe('')
        // anything that is a drive brings the fragment back: a want, a demeanor, silence
        expect(s.p.subtextOf({ ...idle, wants: [['evelyn', 'help']] }, result, {})).toContain('“Evelyn” wants to help but makes small talk')
        expect(s.p.subtextOf({ ...idle, demeanor: [['evelyn', 'warm']] }, result, {})).toContain('“Evelyn” makes small talk; warm.')
        expect(s.p.subtextOf({ ...idle, mayStay: ['evelyn'] }, result, {})).toContain('“Evelyn” makes small talk; neutral; may stay silent.')
        // a profiled person keeps theirs (Kai speaks tersely and keeps something back)
        expect(s.p.subtextOf({ social: [['kai', 'small_talk']], demeanor: [['kai', 'neutral']] }, result, {})).toContain('“Kai” makes small talk')
    })
    test('at most 4 people, 110 characters each, 520 in all, however long the names and tails', () => {
        const s = setup({ engine: 'asp' })
        const result = {
            npcs: Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, name: 'A very long name '.repeat(8), importance: 90 - i, speech: 'mocking', traits: traits(1, 1, 1, 1, 1), hasSecret: true, hasAgenda: true })),
        }
        const dec = {
            social: result.npcs.map((n: any) => [n.id, 'small_talk']), demeanor: result.npcs.map((n: any) => [n.id, 'guarded']),
            wants: result.npcs.map((n: any) => [n.id, 'reconcile']), mayStay: result.npcs.map((n: any) => n.id),
        }
        const line = s.p.subtextOf(dec, result, null)
        expect(line.length).toBeGreaterThan(200)
        expect([...line].length).toBeLessThanOrEqual(SUBTEXT_MAX.total)
        const frags = line.split('“').slice(1)
        expect(frags.length).toBeLessThanOrEqual(4)
        for (const f of frags) expect([...('“' + f).trim()].length).toBeLessThanOrEqual(SUBTEXT_MAX.perNpc + 1)
        expect(s.p.subtextOf(dec, result, null, 2).split('“').length - 1).toBe(2)                 // `max` people
        expect(SUBTEXT_MAX).toEqual({ npcs: 4, perNpc: 110, total: 520 })
    })
    test('the line never contains a wants_to_say or wants_to_hide text of any seed file, whatever the decision', async () => {
        const { s, result } = await people()
        const acts = ['small_talk', 'reconcile', 'refuse', 'keep_distance', 'insult', 'flirt', 'confide', 'threaten', 'help']
        const texts = [SECRET_HONG, SECRET_KAI, SAY_CUC]
        for (const a of acts) for (const w of acts) {
            const line = s.p.subtextOf({ social: ['mặc cúc', 'kai', 'hồng bà bà'].map((i) => [i, a]), wants: ['mặc cúc', 'kai', 'hồng bà bà'].map((i) => [i, w]), demeanor: [['kai', 'warm']] }, result, {})
            for (const t of texts) expect(line).not.toContain(t)
        }
        for (const w of ['shadow_slave', 'lotm', 'mailman', 'zombie']) {
            const f = join(NPC_DIR, `${w}.json`)
            if (!existsSync(f)) continue
            const seed = JSON.parse(readFileSync(f, 'utf8'))
            const one = np.openNpcPsych({ db: setup().db, npcDir: NPC_DIR })
            expect(one.loadWorld(w)).toBe(true)
            const res = { npcs: seed.npcs.slice(0, 4).map((n: any) => ({ id: n.id, name: n.name, importance: n.importance, speech: n.speech, traits: n.traits, hasSecret: !!n.wants_to_hide, hasAgenda: !!n.wants_to_say })) }
            const line = one.subtextOf({ social: res.npcs.map((n: any) => [n.id, 'confide']), wants: res.npcs.map((n: any) => [n.id, 'help']) }, res, {})
            for (const n of seed.npcs) for (const t of [n.wants_to_say, n.wants_to_hide]) if (t) expect(line).not.toContain(t)
        }
    })
})

describe('records (persist, stateOf, relationsOf)', () => {
    async function turn(s: any, over: any = {}) {
        const result = await s.p.appraise({ ...ASK, ...over })
        return result
    }
    const decision = { social: [['mặc cúc', 'help'], ['kai', 'keep_distance']], demeanor: [['mặc cúc', 'warm']], wants: [['kai', 'keep_distance']] }
    test('one row a person, written again for the same turn it is overwritten, a new turn is a new row; what the reroll no longer has goes', async () => {
        const s = setup({ engine: 'asp' })
        const r1 = await turn(s)
        s.p.persist('c1', 5, r1, decision, 'asp', 3.4)
        s.p.persist('c1', 5, r1, decision, 'asp', 3.4)
        const rows = s.db.prepare('SELECT * FROM npc_state ORDER BY npc').all()
        expect(rows.map((r: any) => [r.chat, r.turn, r.npc, r.source, r.action, r.demeanor])).toEqual([['c1', 5, 'kai', 'asp', 'keep_distance', null], ['c1', 5, 'mặc cúc', 'asp', 'help', 'warm']])
        expect(rows[1].subtext).toMatch(/^“Mặc Cúc” offers help; warm, speaks warmly/)
        expect(rows[1].ms).toBe(3)
        const state = s.p.stateOf('c1', 5)
        expect(state).toHaveLength(2)
        expect(state[1].rel.player.trust).toBe(61)
        expect(state[1].emotions[0].type).toBe('gratitude')
        expect(typeof state[1].mood).toBe('number')
        // the reroll gives other numbers and one person fewer
        const r2 = await turn(s, { present: ['mặc cúc'], events: [ev(4, 'player', 'insult', 'mặc cúc')] })
        s.p.persist('c1', 5, r2, { social: [['mặc cúc', 'refuse']] }, 'fatima', 9)
        const after = s.p.stateOf('c1', 5)
        expect(after.map((r: any) => [r.npc, r.source, r.action, r.rel.player.trust])).toEqual([['mặc cúc', 'fatima', 'refuse', 51]])
        // another turn is another row; the latest is the default
        s.p.persist('c1', 6, r1, decision, 'asp', 1)
        expect(s.db.prepare('SELECT COUNT(*) AS n FROM npc_state').get().n).toBe(3)
        expect(s.p.stateOf('c1').every((r: any) => r.turn === 6)).toBe(true)
        expect(s.p.stateOf('nobody')).toEqual([])
        expect(() => s.db.prepare("INSERT INTO npc_state (chat, turn, npc, source) VALUES ('c', 1, 'a', 'llm')").run()).toThrow(/CHECK/)
    })
})

describe('the derived index (syncChat, syncAll)', () => {
    const story = (led: string, extra: any = {}) => ({ chat: { id: 'c1', messages: 6, character: 'Người Đưa Thư Vô Hạn' }, state: { st_name: 'Triệu Khách', led_soc: led }, relations: [], ...extra })
    test('npc_soc and npc_rel are rebuilt from the ledger; a line that left it takes its rows with it', () => {
        const s = setup()
        const led = '3 | Triệu Khách | help | Mặc Cúc\n4 | player | betray | Kai\n4 | Kai | confide | Mặc Cúc\n5 | Zorg | help | player'
        const r = s.p.syncChat('c1', story(led))
        expect(r).toMatchObject({ world: 'mailman', events: 4 })
        const soc = s.db.prepare('SELECT turn, pos, who, tag, target FROM npc_soc WHERE chat = ? ORDER BY pos').all('c1')
        expect(soc.map((x: any) => `${x.turn} ${x.who} ${x.tag} ${x.target}`)).toEqual(['3 player help mặc cúc', '4 player betray kai', '4 kai confide mặc cúc', '5 zorg help player'])
        const rel = (p: string, q: string) => s.db.prepare('SELECT * FROM npc_rel WHERE chat = ? AND p = ? AND q = ?').get('c1', p, q)
        expect(rel('mặc cúc', 'player')).toMatchObject({ trust: 61, debt: 9, events: 1 })
        expect(rel('kai', 'player')).toMatchObject({ events: 1 })
        expect(rel('kai', 'player').trust).toBeLessThan(20)
        expect(rel('mặc cúc', 'kai')).toMatchObject({ trust: 75, events: 1 })           // her seed 70; Kai confided in her, so she now trusts him +5
        expect(rel('kai', 'mặc cúc').trust).toBe(88)                                    // his seed 80 + the mutual trust of the one who confides
        expect(rel('player', 'zorg')).toBeDefined()                                    // somebody the graph does not know: counted under the raw name
        const out = s.p.relationsOf('c1')
        expect(out.events).toHaveLength(4)
        expect(out.relations.length).toBeGreaterThan(3)
        expect(out.relations.every((x: any) => x.p !== x.q)).toBe(true)
        // the betrayal line leaves the ledger (a reroll took the reply away)
        s.p.syncChat('c1', story('3 | Triệu Khách | help | Mặc Cúc'))
        expect(s.db.prepare('SELECT COUNT(*) AS n FROM npc_soc WHERE chat = ?').get('c1').n).toBe(1)
        expect(rel('kai', 'player')).toBeUndefined()
        expect(rel('mặc cúc', 'player')).toMatchObject({ trust: 61, events: 1 })
        // and the same ledger twice is the same rows
        s.p.syncChat('c1', story('3 | Triệu Khách | help | Mặc Cúc'))
        expect(s.db.prepare('SELECT COUNT(*) AS n FROM npc_rel WHERE chat = ?').get('c1').n).toBe(s.p.relationsOf('c1').relations.length)
        // an empty ledger: nothing
        s.p.syncChat('c1', story(''))
        expect(s.p.relationsOf('c1')).toEqual({ relations: [], events: [] })
        expect(s.p.syncChat('nobody', null)).toBeNull()
    })
    test('the story may carry the ledger as led_soc beside state; the chat\'s own relation lines seed a pair', () => {
        const s = setup()
        const st: any = { chat: { id: 'c1', messages: 2, character: 'Người Đưa Thư Vô Hạn' }, state: { st_name: 'Triệu Khách' }, led_soc: '1 | player | help | hồng bà bà', relations: [{ a: 'Kai', b: 'Hồng bà bà', how: 'kẻ thù' }] }
        s.p.syncChat('c1', st)
        expect(s.p.relationsOf('c1').events).toHaveLength(1)
        const r = s.db.prepare("SELECT * FROM npc_rel WHERE chat = 'c1' AND p = 'hồng bà bà' AND q = 'player'").get()
        expect(r).toMatchObject({ events: 1, trust: 26 })                              // her seed 20 + help 6
    })
    test('syncAll walks the live chats, skips one it already read, drops the rows of chats that are gone', () => {
        const s = setup()
        s.db.prepare("INSERT INTO characters (char_id, block, name) VALUES ('mm', 'b', 'Người Đưa Thư Vô Hạn')").run()
        s.db.prepare("INSERT INTO chats (chat_id, char_id, name, messages, vars_hash) VALUES ('c1', 'mm', 'Run', 6, 'h1')").run()
        s.db.prepare("INSERT INTO chats (chat_id, char_id, name, messages, vars_hash, deleted_at) VALUES ('old', 'mm', 'Old', 6, 'h2', 5)").run()
        s.db.prepare("INSERT INTO npc_soc (chat, turn, pos, who, tag, target, origin) VALUES ('gone', 1, 0, 'a', 'help', 'b', 'soc:x')").run()
        s.db.prepare("INSERT INTO npc_state (chat, turn, npc, source) VALUES ('gone', 1, 'a', 'asp')").run()
        let led = '2 | player | help | kai'
        let reads = 0
        const store = { lore: () => [], story: (id: string) => { reads++; return id === 'c1' ? story(led) : null } }
        expect(s.p.syncAll(store)).toMatchObject({ chats: 1 })
        expect(reads).toBe(1)
        expect(s.p.relationsOf('c1').events).toHaveLength(1)
        expect(s.p.syncAll(store).chats).toBe(0)                                       // same hash, same length
        expect(reads).toBe(1)
        s.db.prepare("UPDATE chats SET vars_hash = 'h3' WHERE chat_id = 'c1'").run()
        led = ''
        expect(s.p.syncAll(store).chats).toBe(1)
        expect(s.p.relationsOf('c1').events).toHaveLength(0)
        expect(s.db.prepare("SELECT COUNT(*) AS n FROM npc_soc WHERE chat = 'gone'").get().n).toBe(0)
        expect(s.db.prepare("SELECT COUNT(*) AS n FROM npc_state WHERE chat = 'gone'").get().n).toBe(0)
        // a chat that throws is skipped, not fatal
        s.db.prepare("UPDATE chats SET vars_hash = 'h4' WHERE chat_id = 'c1'").run()
        expect(s.p.syncAll({ lore: () => [], story: () => { throw new Error('bad chat') } })).toMatchObject({ chats: 0 })
        expect(s.logs.join()).toMatch(/bad chat/)
    })
})

describe('the seed pipeline (normalize.cjs, merge.cjs)', () => {
    const graph = {
        world: 'mailman', version: 1,
        entities: [...GRAPH.entities, { id: 'kenji park', kind: 'person', name: 'Kenji Park' }, { id: 'the observer', kind: 'person', name: 'the Observer', aliases: ['Kẻ Quan Sát'] }],
        facts: GRAPH.facts,
    }
    test('normalize: candidates become targets: ids resolved by alias, the player dropped, importance by rank, graph facts with their index', () => {
        const cands = {
            world: 'mailman',
            npcs: [
                { id: 'kai', name: 'Kai', aliases: [], score: 100, facts: ['Kai was once a postman himself.'], lore_snippets: ['a', 'b', 'c', 'd', 'e', 'x'.repeat(400)], pairs: [{ id: 'mặc cúc', r: 'knows' }, { id: 'stranger', r: 'knows' }] },
                { id: 'red granny', name: 'Red Granny', score: 300, facts: [], lore_snippets: [], pairs: [] },
                { id: 'mặc cúc', name: 'Mặc Cúc', aliases: ['Cúc'], score: 200, facts: [], lore_snippets: [], pairs: [] },
                { id: 'mac cuc', name: 'Mac Cuc', score: 5 },                        // the same person unaccented: one target, the better score
                { id: 'kenji park', name: 'Kenji Park', score: 999 },                  // the player
                { id: 'the observer', name: 'the Observer', score: 50 },
                { id: 'Nobody At All', name: 'Nobody At All', score: 900 },
            ],
        }
        const r = build.normalize.normalize('mailman', cands, graph)
        expect(r.unresolved).toEqual(['Nobody At All'])
        expect(r.dropped.join()).toMatch(/kenji park/)
        expect(r.targets.map((t: any) => t.id)).toEqual(['hồng bà bà', 'mặc cúc', 'kai', 'the observer'])
        expect(r.targets.map((t: any) => t.importance)).toEqual([100, 67, 34, 1])
        const kai = r.targets.find((t: any) => t.id === 'kai')
        expect(kai.facts.map((f: any) => f.fid)).toEqual([9, 5, 8])                   // the quoted one first, then fact before rumor
        expect(kai.facts[0]).toMatchObject({ fid: 9, s: 'kai', status: 'fact', text: 'Kai was once a postman himself.' })
        expect(kai.lore).toHaveLength(4)
        expect(kai.pairs).toEqual([{ id: 'mặc cúc', r: 'knows' }])
        expect(r.targets.find((t: any) => t.id === 'hồng bà bà').facts.map((f: any) => f.fid)).toEqual([0, 6])
        expect(r.targets[3].facts).toEqual([])
        expect(build.normalize.normalize('mailman', [{ id: 'kai', score: 1 }], graph).targets[0].importance).toBe(100)
    })
    test('merge --check: unknown ids, the player, a secret not resting on a fact about the npc, a rumor as a secret, a relation to nobody, duplicates, bad skips', () => {
        const g = { persons: new Set(['hồng bà bà', 'mặc cúc', 'kai']), facts: GRAPH.facts }
        const base = SEED.npcs[1]
        const chk = (d: any, all = ['mặc cúc', 'kai']) => build.merge.checkDraft(d, g, new Set(all))
        expect(chk({ npcs: [base], relations: [] })).toEqual([])
        expect(chk({ npcs: [SEED.npcs[0], SEED.npcs[2]], relations: SEED.relations.filter((r) => r.p === 'kai') }, ['hồng bà bà', 'kai', 'mặc cúc'])).toEqual([])
        expect(chk({ npcs: [{ ...base, id: 'stranger' }] }).join()).toMatch(/id is no person of this world's graph/)
        expect(chk({ npcs: [{ ...base, id: 'player' }] }).join()).toMatch(/never an npc/)
        expect(chk({ npcs: [{ ...base, wants_to_hide: 'x secret', hide_fid: null }] }).join()).toMatch(/wants_to_hide without hide_fid/)
        expect(chk({ npcs: [{ ...base, hide_fid: 3 }] }).join()).toMatch(/hide_fid without wants_to_hide/)
        expect(chk({ npcs: [{ ...base, wants_to_hide: 'x secret', hide_fid: 9 }] }).join()).toMatch(/hide_fid 9 is a fact about kai, not about this npc/)
        expect(chk({ npcs: [{ ...base, wants_to_hide: 'x secret', hide_fid: 99 }] }).join()).toMatch(/no fact of the graph/)
        expect(chk({ npcs: [{ ...base, wants_to_hide: 'x secret', hide_fid: 7 }] }).join()).toMatch(/is a outdated/)
        expect(chk({ npcs: [{ ...SEED.npcs[2], wants_to_hide: 'x secret', hide_fid: 8 }] }).join()).toMatch(/is a rumor/)
        expect(chk({ npcs: [{ ...base, wants_to_hide: 'x secret', hide_fid: 3 }] })).toEqual([])             // a fact about her
        expect(chk({ npcs: [base, base] }).join()).toMatch(/listed twice in this file/)
        expect(chk({ npcs: [{ ...base, traits: { ...base.traits, agree: 101 } }] }).join()).toMatch(/above 100/)
        expect(chk({ npcs: [base], relations: [{ p: 'mặc cúc', q: 'zorg', trust: 1, affection: 1, debt: 1, grudge: 1 }] }).join()).toMatch(/q is no npc of any draft/)
        expect(chk({ npcs: [base], relations: [{ p: 'kai', q: 'player', trust: 1, affection: 1, debt: 1, grudge: 1 }] }).join()).toMatch(/p is no npc of this file/)
        expect(chk({ npcs: [base], relations: [{ p: 'mặc cúc', q: 'player', trust: 1, affection: 1, debt: 1, grudge: 1 }, { p: 'mặc cúc', q: 'player', trust: 2, affection: 1, debt: 1, grudge: 1 }] }).join()).toMatch(/listed twice/)
        expect(chk({ npcs: [base], relations: [{ p: 'mặc cúc', q: 'kai', trust: 1, affection: 1, debt: 1, grudge: 101 }] }).join()).toMatch(/grudge: above 100/)
        expect(chk({ npcs: [base], skip: [{ id: 'mặc cúc', why: 'x' }] }).join()).toMatch(/also listed as an npc/)
        expect(chk({ npcs: [], skip: [{ id: 'the observer', why: 'a title' }] })).toEqual([])
        expect(chk({ npcs: [], skip: [{ id: 1 }] }).join()).toMatch(/wants \{id, why\}/)
        expect(chk(null).join()).toMatch(/not a JSON object/)
        expect(chk({}).join()).toMatch(/npcs: missing/)
    })
    test('merge --check over a directory prints per file, and counts at most 30 distinct npcs; the real graph is read', () => {
        const dir = mkdtempSync(join(tmpdir(), 'drafts-'))
        writeFileSync(join(dir, 'b1.json'), JSON.stringify({ npcs: [SEED.npcs[1]], relations: [{ p: 'mặc cúc', q: 'kai', trust: 60, affection: 50, debt: 0, grudge: 0 }], skip: [{ id: 'the observer', why: 'a title' }] }))
        writeFileSync(join(dir, 'b2.json'), JSON.stringify({ npcs: [SEED.npcs[2]], relations: [] }))
        writeFileSync(join(dir, 'b3.json'), '{not json')
        writeFileSync(join(dir, 'x.targets.json'), '{}')
        const r = build.merge.check('mailman', dir, { persons: new Set(['mặc cúc', 'kai']), facts: GRAPH.facts })
        expect(r.errors.map((e: any) => e.file)).toEqual(['b3.json'])
        expect(r.npcs).toBe(2)
        expect(r.skipped).toHaveLength(1)
        const many = Array.from({ length: 31 }, (_, i) => ({ ...SEED.npcs[1], id: `n${i}`, name: `N${i}` }))
        writeFileSync(join(dir, 'b4.json'), JSON.stringify({ npcs: many }))
        const r2 = build.merge.check('mailman', dir, { persons: new Set(many.map((n) => n.id).concat(['mặc cúc', 'kai'])), facts: GRAPH.facts })
        expect(r2.errors.map((e: any) => e.message).join()).toMatch(/33 distinct npcs, at most 30/)
        for (const w of ['shadow_slave', 'lotm', 'mailman', 'zombie']) expect(build.merge.loadGraph(w).persons.size).toBeGreaterThan(50)
    })
    test('merge: one npc an id (the higher importance wins), the top 30, relations of one pair averaged, relations to the dropped removed, schema-valid', () => {
        const d1 = { npcs: [{ ...SEED.npcs[1], importance: 40 }, SEED.npcs[2]], relations: [{ p: 'mặc cúc', q: 'kai', trust: 60, affection: 40, debt: 0, grudge: 10, why: 'first' }, { p: 'kai', q: 'hồng bà bà', trust: 1, affection: 1, debt: 1, grudge: 1 }] }
        const d2 = { npcs: [{ ...SEED.npcs[1], importance: 80, speech: 'blunt' }], relations: [{ p: 'mặc cúc', q: 'kai', trust: 71, affection: 41, debt: 0, grudge: 11, why: 'second' }, { p: 'mặc cúc', q: 'player', trust: 50, affection: 50, debt: 0, grudge: 0 }] }
        const { file, drop, errors } = build.merge.merge('mailman', [d1, d2])
        expect(errors).toEqual([])
        expect(file.npcs.map((n: any) => [n.id, n.importance, n.speech])).toEqual([['mặc cúc', 80, 'blunt'], ['kai', 50, 'terse']])
        expect(file.relations).toEqual([
            { p: 'mặc cúc', q: 'player', trust: 50, affection: 50, debt: 0, grudge: 0 },
            { p: 'mặc cúc', q: 'kai', trust: 66, affection: 41, debt: 0, grudge: 11, why: 'first' },
        ])
        expect(drop).toMatchObject({ 'npc: duplicate id': 1, 'relation: an end is not in the file': 1, 'relation: same pair twice, averaged': 1 })
        expect(file).toMatchObject({ world: 'mailman', version: 1 })
        expect(file.built).toMatch(/^\d{4}-\d\d-\d\d$/)
        const many = Array.from({ length: 35 }, (_, i) => ({ ...SEED.npcs[1], id: `n${i}`, importance: i }))
        const cut = build.merge.merge('mailman', [{ npcs: many, relations: [{ p: 'n34', q: 'n0', trust: 1, affection: 1, debt: 1, grudge: 1 }, { p: 'n34', q: 'n9', trust: 1, affection: 1, debt: 1, grudge: 1 }] }])
        expect(cut.file.npcs).toHaveLength(30)
        expect(cut.file.npcs[0].id).toBe('n34')
        expect(cut.file.relations.map((r: any) => r.q)).toEqual(['n9'])             // n0 did not make the cut
        expect(cut.errors).toEqual([])
        // the merged file is exactly what the loader takes
        const out = build.merge.merge('mailman', [{ npcs: SEED.npcs, relations: SEED.relations }])
        expect(out.errors).toEqual([])
        const s = setup({ seed: out.file })
        expect(s.p.loadWorld('mailman')).toBe(true)
    })
})

describe('seed files (server/node/story/npcs/<world>.json, when they exist)', () => {
    for (const world of ['shadow_slave', 'lotm', 'mailman', 'zombie']) {
        const file = join(NPC_DIR, `${world}.json`)
        test.skipIf(!existsSync(file))(`${world}: valid, every id a person of the graph, no self pair, at most 30 npcs, every secret rests on a fact about its npc`, () => {
            const seed = JSON.parse(readFileSync(file, 'utf8'))
            const graph = JSON.parse(readFileSync(join(GRAPH_DIR, `${world}.json`), 'utf8'))
            const persons = new Set(graph.entities.filter((e: any) => e.kind === 'person').map((e: any) => e.id))
            expect(validate(SCHEMA, seed)).toEqual([])
            expect(np.seedErrors(seed)).toEqual([])
            expect(seed.world).toBe(world)
            expect(seed.npcs.length).toBeLessThanOrEqual(30)
            expect(seed.npcs.length).toBeGreaterThanOrEqual(1)
            for (const n of seed.npcs) {
                expect(persons.has(n.id), `${n.id} is a person of the graph`).toBe(true)
                expect(n.id).not.toBe('player')
                if (n.wants_to_hide) {
                    const f = graph.facts[n.hide_fid]
                    expect(f, `${n.id}: hide_fid ${n.hide_fid}`).toBeDefined()
                    expect([f.s, f.o], `${n.id}: the fact is about it`).toContain(n.id)
                    expect(['fact', 'unknown']).toContain(f.status)
                } else expect(n.hide_fid ?? null).toBeNull()
            }
            for (const r of seed.relations) expect(r.p).not.toBe(r.q)
            // and the loader takes it into a fresh database
            const db = openStoryStore({ dbFile: ':memory:' }).db
            const one = np.openNpcPsych({ db, npcDir: NPC_DIR })
            expect(one.loadWorld(world)).toBe(true)
            expect(db.prepare('SELECT COUNT(*) AS n FROM npc_profile WHERE world = ?').get(world).n).toBe(seed.npcs.length)
        })
    }
})

describe('the acceptance script tests/acceptance/scripts/npc-psych.json', () => {
    const SCRIPT = JSON.parse(readFileSync(join(__dirname, '../../../tests/acceptance/scripts/npc-psych.json'), 'utf8'))
    const WORLD = { ss: 'shadow_slave', lotm: 'lotm', mailman: 'mailman', zombie: 'zombie' } as const
    test('every story meets one profiled person by name and does the four acts the layer folds, then asks what they hide', () => {
        const store = openStoryStore({ dbFile: ':memory:' })
        const p = np.openNpcPsych({ db: store.db, npcDir: NPC_DIR, engine: 'asp' })
        for (const [key, world] of Object.entries(WORLD)) {
            const turns = SCRIPT[key] as { kind: string; text: string }[]
            expect(p.loadWorld(world)).toBe(true)
            const ids = new Set(turns.flatMap((t) => p.namedIn(world, [t.text]).map((h: any) => h.id)))
            expect(ids.size, key).toBe(1)
            // the same person in every turn but the pause
            for (const t of turns.filter((x) => x.kind !== 'pause' && x.kind !== 'npc')) expect(p.namedIn(world, [t.text]).map((h: any) => h.id), `${key}: ${t.text}`).toEqual([...ids])
            expect(turns.map((t) => t.kind)).toEqual(expect.arrayContaining(['help', 'insult', 'apologise', 'confide']))
            expect(turns.some((t) => /giấu/.test(t.text))).toBe(true)
        }
    })
})
