// @vitest-environment node
// The librarian's knowledge graph (server/node/storyGraph.cjs): fact / rumor / unknown / outdated, kept apart from the card's
// lore to the chat's last turn.
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const req = createRequire(import.meta.url)
const merge = req('../../../server/node/dbMerge.cjs')
const { openStoryStore } = req('../../../server/node/storyStore.cjs')
const { openStoryGraph, statusOfText, relOf, HEADER } = req('../../../server/node/storyGraph.cjs')
const { validate, sub } = req('../../../server/node/jsonSchemaLite.cjs')
const { findClingo } = req('../../../server/node/gmSolver.cjs')
const graphMerge = req('../../../server/node/story/graphs/build/merge.cjs')

const SCHEMA = JSON.parse(readFileSync(join(__dirname, '../../../server/node/story/schema/lore-graph.schema.json'), 'utf8'))
const ANSWER = JSON.parse(readFileSync(join(__dirname, '../../../server/node/story/schema/librarian-answer.schema.json'), 'utf8'))

const GRAPH = {
    world: 'mailman', version: 1, built: '2026-10-21',
    entities: [
        { id: 'hồng bà bà', kind: 'person', name: 'Hồng bà bà', aliases: ['Red Granny'] },
        { id: 'mặc cúc', kind: 'person', name: 'Mặc Cúc' },
        { id: 'kai', kind: 'person', name: 'Kai' },
        { id: 'ghost market', kind: 'place', name: 'Ghost Market', aliases: ['Quỷ thị'] },
        { id: 'hồng yên quán', kind: 'place', name: 'Hồng Yên quán' },
        { id: 'the north quarter', kind: 'place', name: 'the North Quarter', aliases: ['Khu Bắc'] },
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
        { s: 'kai', r: 'identity', o: 'a former postman', status: 'fact', text: 'Kai was once a postman himself.', source: 'book:Ghost Market', known_by: [{ who: 'mặc cúc', as: 'fact' }] },
    ],
}

function setup(graph: any = GRAPH) {
    const dir = mkdtempSync(join(tmpdir(), 'kg-'))
    writeFileSync(join(dir, 'mailman.json'), JSON.stringify(graph))
    const store = openStoryStore({ dbFile: ':memory:', now: () => 1_000_000 })
    const g = openStoryGraph({ db: store.db, graphDir: dir })
    return { store, g, dir }
}
const vars = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => ['$' + k, v]))
function saveOf(chats: any[]) {
    const c = { chaId: 'mm', name: 'Người Đưa Thư Vô Hạn', globalLore: [], chats }
    return merge.encodeSave([
        merge.serializeBlock(1, 0, 'root', { __directory: ['mm'] }),
        merge.serializeBlock(2, 1, 'mm', c),
        { type: 0, comp: 0, name: 'config', data: Buffer.from('{}') },
    ])
}
const chat = (led: Record<string, string>, n = 4) => ({
    id: 'c1', name: 'Run', message: Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'char' : 'user', data: 'x', time: 1000 + i })),
    scriptstate: vars({ st_name: 'Triệu Khách', st_place: 'Ghost Market', ...led }),
})
function play(s: any, g: any, led: Record<string, string>, n = 4, rev = 1) {
    s.sync(saveOf([chat(led, n)]), rev)
    return g.syncChat('c1', s.story('c1'))
}

describe('JSON Schema (jsonSchemaLite.cjs over story/schema)', () => {
    test('the test graph is valid; a bad status, a missing source, an extra key and a bad relation are not', () => {
        expect(validate(SCHEMA, GRAPH)).toEqual([])
        const fact = sub(SCHEMA, 'fact')
        const ok = GRAPH.facts[0]
        expect(validate(fact, ok)).toEqual([])
        expect(validate(fact, { ...ok, status: 'maybe' }).join()).toMatch(/not one of fact, rumor, unknown, outdated/)
        const { source, ...noSource } = ok
        expect(validate(fact, noSource).join()).toMatch(/missing source/)
        expect(validate(fact, { ...ok, extra: 1 }).join()).toMatch(/unexpected extra/)
        expect(validate(fact, { ...ok, r: 'likes' }).join()).toMatch(/not one of/)
        expect(validate(fact, { ...ok, source: 'wiki' }).join()).toMatch(/does not match/)
        expect(validate(sub(SCHEMA, 'entity'), { id: 'Hồng', kind: 'person', name: 'x' }).join()).toMatch(/does not match/)   // ids are lower-case
    })
    test('maximum is checked, the mirror of minimum', () => {
        const traits = { type: 'object', properties: { open: { type: 'integer', minimum: 0, maximum: 100 } } }
        expect(validate(traits, { open: 100 })).toEqual([])
        expect(validate(traits, { open: 0 })).toEqual([])
        expect(validate(traits, { open: 101 }).join()).toMatch(/\$\.open: above 100/)
        expect(validate(traits, { open: -1 }).join()).toMatch(/below 0/)
    })
    test('a graph that fails its schema is not loaded', () => {
        const { g } = setup({ ...GRAPH, facts: [{ ...GRAPH.facts[0], status: 'gossip' }] })
        expect(g.loadWorld('mailman')).toBe(false)
    })
})

describe('the build: merge.cjs checks the model drafts', () => {
    test('drafts sharing an alias are one entity; a relation to no entity, a wrong book, a sentence about someone else and a duplicate are dropped', () => {
        const titles = new Set(['Ghost Market', 'Path: Postman hunter (nhiệm vụ săn bắt)'])
        const drafts = [
            { entities: [{ id: 'ghost market', kind: 'place', name: 'Ghost Market', aliases: ['Quỷ thị'] }, { id: 'hồng bà bà', kind: 'person', name: 'Hồng bà bà' }],
              facts: [{ s: 'hồng bà bà', r: 'controls', o: 'Quỷ thị', status: 'fact', text: 'Hồng bà bà is the master of the Market.', source: 'book:Ghost Market' }] },
            { entities: [{ id: 'quỷ thị', kind: 'place', name: 'Quỷ thị', aliases: [] }],
              facts: [
                  { s: 'hồng bà bà', r: 'controls', o: 'ghost market', status: 'fact', text: 'Hong ba ba is the master of the Market.', source: 'book:Ghost Market' },
                  { s: 'hồng bà bà', r: 'controls', o: 'quỷ thị', status: 'rumor', text: 'Some say the Sharks own the roofs.', source: 'book:Ghost Market' },
                  { s: 'hồng bà bà', r: 'enemy_of', o: 'somebody', status: 'fact', text: 'Hồng bà bà hates somebody unnamed.', source: 'book:Ghost Market' },
                  { s: 'hồng bà bà', r: 'rank', o: 'master', status: 'fact', text: 'Hồng bà bà ranks as the master here.', source: 'book:Path: Postman hunter' },
                  { s: 'hồng bà bà', r: 'rank', o: 'elder', status: 'outdated', text: 'Hồng bà bà was once only an elder.', source: 'book:No Such Book' },
              ] },
        ]
        const { graph, drop, errors } = graphMerge.merge('mailman', drafts, titles)
        expect(errors).toEqual([])
        expect(graph.entities.filter((e: any) => e.kind === 'place')).toHaveLength(1)
        expect(graph.facts.map((f: any) => `${f.r}:${f.o}:${f.source}`)).toEqual(['controls:ghost market:book:Ghost Market', 'rank:master:book:Path: Postman hunter (nhiệm vụ săn bắt)'])
        expect(drop).toMatchObject({ 'fact: duplicate': 1, 'fact: enemy_of object is no entity': 1, 'fact: source is no book of this card': 1, 'fact: sentence names neither side': 1 })
    })
})

describe('the build: status and knowers agree (GraphStatus.als)', () => {
    test('a rumor is known only as a rumor; an unknown somebody knows is a secret (a fact with its knowers)', () => {
        const drafts = [{ entities: [{ id: 'kai', kind: 'person', name: 'Kai' }, { id: 'mặc cúc', kind: 'person', name: 'Mặc Cúc' }],
            facts: [
                { s: 'kai', r: 'identity', o: 'a spy', status: 'rumor', text: 'Some say Kai is a spy.', source: 'book:B', known_by: [{ who: 'mặc cúc', as: 'fact' }] },
                { s: 'kai', r: 'identity', o: 'a postman', status: 'unknown', text: 'Nobody knows Kai was a postman.', source: 'book:B', known_by: [{ who: 'mặc cúc', as: 'fact' }] },
                { s: 'kai', r: 'rank', o: null, status: 'unknown', text: 'Kai rank is unknown to all.', source: 'book:B' },
            ] }]
        const { graph } = graphMerge.merge('mailman', drafts, new Set(['B']))
        expect(graph.facts.map((f: any) => [f.status, f.known_by?.[0]?.as ?? '-'])).toEqual([['rumor', 'rumor'], ['fact', 'fact'], ['unknown', '-']])
    })
})

describe('names in a scene (FTS5 over every alias, then whole words)', () => {
    test('Vietnamese and English names, an alias, a whole word only', () => {
        const { g } = setup()
        g.loadWorld('mailman')
        expect(g.namedIn('mailman', 'c1', 'Triệu Khách bước vào Quỷ thị, gặp Hồng bà bà.')).toEqual(expect.arrayContaining(['ghost market', 'hồng bà bà']))
        expect(g.namedIn('mailman', 'c1', 'The Hound Band rides at dawn')).toEqual(['liệp cẩu đoàn'])
        expect(g.namedIn('mailman', 'c1', 'Kaitlyn and Makai talk')).toEqual([])        // "Kai" only as a whole word
        expect(g.namedIn('mailman', 'c1', 'kai là gì, một chữ thường')).toEqual([])        // a one-word plain name counts only with a capital
        expect(g.namedIn('mailman', 'c1', 'gặp hồng bà bà')).toEqual(['hồng bà bà'])      // a name of several words or with marks needs none
        expect(g.namedIn('mailman', 'c1', 'Hồng bà bà')).not.toContain('mặc cúc')
        expect(g.namedIn('mailman', 'c1', 'the north quarters of town')).toEqual([])   // a name of several words, whole words only
        expect(g.namedIn('mailman', 'c1', 'đi về phía the North Quarter')).toEqual(['the north quarter'])
        // a long scene: the latest message is read even past the first few hundred words; the latest named comes first
        const filler = (n: number) => Array.from({ length: n }, (_, i) => `chữ${i}`).join(' ')
        expect(g.namedIn('mailman', 'c1', `Kai đi trước. ${filler(300)} Rồi Hồng bà bà xuất hiện.`)).toEqual(['hồng bà bà', 'kai'])
        expect(g.namedIn('mailman', 'c1', `Kai đi trước. ${filler(900)} Rồi Hồng bà bà xuất hiện.`)).toEqual(['hồng bà bà'])
    })
})

describe('the chat: the ledger each turn (statuses, who knows, what goes stale)', () => {
    test('a relation is a fact both of them and the player know; "nghe nói" is a rumor the player only heard; "chưa rõ" is unknown', () => {
        const { store, g } = setup()
        play(store, g, {
            led_rel: 'Mặc Cúc | Triệu Khách | kẻ thù, muốn giết',
            led_mem: 'Hồng bà bà | nghe nói bà ta ăn thịt người\nKai | chưa rõ Kai là ai?',
        })
        const all = g.factsAbout('mailman', 'c1', ['mặc cúc', 'hồng bà bà', 'kai', 'player'], 4).filter((f: any) => f.chat)
        const rel = all.find((f: any) => f.r === 'enemy_of')
        expect(rel).toMatchObject({ s: 'mặc cúc', o: 'player', status: 'fact', player_knows: 'fact' })
        expect(rel.known_by.map((k: any) => k.who)).toEqual(['mặc cúc'])
        expect(all.find((f: any) => f.s === 'hồng bà bà' && f.r === 'note')).toMatchObject({ status: 'rumor', player_knows: 'rumor' })
        expect(all.find((f: any) => f.s === 'kai' && f.r === 'note')).toMatchObject({ status: 'unknown', player_knows: 'no' })
        // the ledger's short name for the player is the player ("Triệu" for "Triệu Khách"), not a new person
        play(store, g, { led_rel: 'Mặc Cúc | Triệu | đồng minh' })
        expect(g.factsAbout('mailman', 'c1', ['mặc cúc'], 4).find((f: any) => f.chat && f.r === 'ally_of')?.o).toBe('player')
    })
    test('a death ends the card facts about that person from the turn it is first seen, and only from then', () => {
        const { store, g } = setup()
        play(store, g, { led_ev: 'Ngày 1 | Triệu Khách đến Quỷ thị' }, 4, 1)
        let mc = g.factsAbout('mailman', 'c1', ['mặc cúc'], 4)
        expect(mc.find((f: any) => f.r === 'located_at' && !f.chat).status).toBe('fact')
        // turn 8: the timeline says Mặc Cúc died; the npc list knows her from a relation
        play(store, g, { led_rel: 'Mặc Cúc | Triệu Khách | kẻ thù', led_ev: 'Ngày 1 | Triệu Khách đến Quỷ thị\nNgày 2 | Mặc Cúc chết ở Hồng Yên quán' }, 8, 2)
        mc = g.factsAbout('mailman', 'c1', ['mặc cúc'], 8)
        expect(mc.find((f: any) => f.r === 'status' && f.o === 'dead')).toMatchObject({ status: 'fact', chat: true, valid_from: 8 })
        const at = mc.find((f: any) => f.r === 'located_at' && !f.chat)
        expect(at).toMatchObject({ status: 'outdated', until: 'mặc cúc died (Ngày 2)' })
        expect(mc.find((f: any) => f.r === 'member_of').status).toBe('outdated')
        // asked about turn 6 (before the death was seen), she was still there
        expect(g.factsAbout('mailman', 'c1', ['mặc cúc'], 6).find((f: any) => f.r === 'located_at' && !f.chat).status).toBe('fact')
        // the next turns do not move the turn it ended (kg_seen), and a reroll that drops the line brings the fact back
        play(store, g, { led_rel: 'Mặc Cúc | Triệu Khách | kẻ thù', led_ev: 'Ngày 1 | Triệu Khách đến Quỷ thị\nNgày 2 | Mặc Cúc chết ở Hồng Yên quán' }, 12, 3)
        expect(g.factsAbout('mailman', 'c1', ['mặc cúc'], 12).find((f: any) => f.r === 'status' && f.o === 'dead').valid_from).toBe(8)
        play(store, g, { led_rel: 'Mặc Cúc | Triệu Khách | kẻ thù', led_ev: 'Ngày 1 | Triệu Khách đến Quỷ thị' }, 12, 4)
        mc = g.factsAbout('mailman', 'c1', ['mặc cúc'], 12)
        expect(mc.find((f: any) => f.r === 'status')).toBeUndefined()
        expect(mc.find((f: any) => f.r === 'located_at' && !f.chat).status).toBe('fact')
    })
    test('a line rerolled away and written again later is dated by the later turn; a turn a reroll took back is no turn (GraphSync.tla)', () => {
        const { store, g } = setup()
        const rel = { led_rel: 'Mặc Cúc | Triệu Khách | kẻ thù' }
        const from = () => g.factsAbout('mailman', 'c1', ['mặc cúc'], 99).find((f: any) => f.chat && f.r === 'enemy_of')?.valid_from
        play(store, g, rel, 4, 1)
        expect(from()).toBe(4)
        play(store, g, {}, 3, 2)                 // the reply that wrote it is rerolled away
        expect(from()).toBeUndefined()
        play(store, g, {}, 6, 3)
        play(store, g, rel, 8, 4)                // the same line, four turns later: a new event
        expect(from()).toBe(8)
        play(store, g, rel, 6, 5)                // two replies taken back, the line still there: not dated after now
        expect(from()).toBe(6)
    })
    test('two moves: the first place is outdated from the turn of the second, the second a fact', () => {
        const { store, g } = setup()
        const first = 'Ngày 3 | Mặc Cúc rời đi, chạy tới Khu Bắc'
        play(store, g, { led_rel: 'Mặc Cúc | Triệu Khách | đồng minh', led_ev: first }, 4, 1)
        play(store, g, { led_rel: 'Mặc Cúc | Triệu Khách | đồng minh', led_ev: first + '\nNgày 5 | Mặc Cúc trở về Hồng Yên quán' }, 8, 2)
        const at = g.factsAbout('mailman', 'c1', ['mặc cúc'], 8).filter((f: any) => f.r === 'located_at' && f.chat)
        expect(at.find((f: any) => f.o === 'hồng yên quán')).toMatchObject({ status: 'fact', valid_from: 8 })
        expect(at.find((f: any) => f.o === 'the north quarter')).toMatchObject({ status: 'outdated', until: 'mặc cúc was seen at hồng yên quán (Ngày 5)' })
    })
    test('a move to where the card already puts her leaves that card fact standing', () => {
        const { store, g } = setup()
        play(store, g, { led_rel: 'Mặc Cúc | Triệu Khách | đồng minh', led_ev: 'Ngày 3 | Mặc Cúc trở về Hồng Yên quán' }, 4)
        expect(g.factsAbout('mailman', 'c1', ['mặc cúc'], 4).find((f: any) => f.r === 'located_at' && !f.chat).status).toBe('fact')
    })
    test('a move makes the old place outdated and the new one a fact', () => {
        const { store, g } = setup()
        play(store, g, { led_rel: 'Mặc Cúc | Triệu Khách | đồng minh', led_ev: 'Ngày 3 | Mặc Cúc rời đi, chạy tới Khu Bắc' }, 6)
        const mc = g.factsAbout('mailman', 'c1', ['mặc cúc'], 6).filter((f: any) => f.r === 'located_at')
        expect(mc.find((f: any) => f.o === 'the north quarter')).toMatchObject({ status: 'fact', chat: true })
        expect(mc.find((f: any) => f.o === 'hồng yên quán')).toMatchObject({ status: 'outdated', until: 'mặc cúc was seen at khu bắc (Ngày 3)' })
    })
})

describe('after every save (syncAll)', () => {
    test('a chat is rebuilt only when its ledger or its length changed', () => {
        const { store, g } = setup()
        store.sync(saveOf([chat({ led_rel: 'Mặc Cúc | Triệu Khách | kẻ thù' })]), 1)
        expect(g.syncAll(store).chats).toBe(1)
        expect(g.chatWorld('c1')).toBe('mailman')
        expect(g.syncAll(store).chats).toBe(0)
        store.sync(saveOf([chat({ led_rel: 'Mặc Cúc | Triệu Khách | kẻ thù' }, 6)]), 2)
        expect(g.syncAll(store).chats).toBe(1)
        expect(g.factsAbout('mailman', 'c1', ['mặc cúc'], 6).some((f: any) => f.chat && f.r === 'enemy_of')).toBe(true)
    })
})

describe("the librarian's answer (facts) and what the narrator reads", () => {
    test('only what the scene names; tagged; who knows; the answer passes its schema', () => {
        const { store, g } = setup()
        play(store, g, { led_mem: 'Hồng bà bà | nghe nói bà ta ăn thịt người' })
        const a = g.facts('c1', store.story('c1'), { text: 'Hồng bà bà nhìn Triệu Khách.' })
        expect(validate(ANSWER, a)).toEqual([])
        expect(a.status).toBe('ok')
        expect(a.entities.map((e: any) => e.id).sort()).toEqual(['hồng bà bà', 'player'])     // the player's name is in the scene too
        const tags = a.facts.map((f: any) => f.status)
        expect(tags).toEqual(expect.arrayContaining(['rumor', 'unknown', 'fact']))
        expect(a.facts.some((f: any) => f.s === 'kai')).toBe(false)              // Kai is not in the scene
        expect(a.lines).toMatch(/RUMOR · Hồng bà bà: nghe nói bà ta ăn thịt người.*only heard it/)
        expect(a.lines).toMatch(/UNKNOWN · Nobody knows what Hồng bà bà really is/)
        expect(a.lines.split('\n')[0]).toMatch(/never states it as true/)
        const k = g.facts('c1', store.story('c1'), { text: 'Kai gặp Mặc Cúc' })
        expect(k.lines).toMatch(/FACT · Kai was once a postman himself\. Known to: Mặc Cúc\./)
        expect(k.lines).toMatch(/OUTDATED · Mặc Cúc was one of the twelve stewards\. \(no longer: she rose to chief steward\)/)
    })
    test('the answer stays inside its token cap', () => {
        const { store, g } = setup()
        play(store, g, {})
        const a = g.facts('c1', store.story('c1'), { text: 'Hồng bà bà, Mặc Cúc, Kai, Quỷ thị, Hound Band', maxTokens: 60 })
        expect(a.tokens).toBeLessThanOrEqual(60 + Math.ceil(HEADER.length / 3.9) + 1)       // the header line is outside the cap
        expect(a.facts.length).toBeLessThan(5)
    })
})

describe.runIf(!!findClingo())('Datalog (story/gm/graph.lp, clingo)', () => {
    test('who rules a place inside another: fact through facts, rumor through a rumor; foes through a faction; who here knows', async () => {
        const { store, g } = setup()
        play(store, g, { led_mem: 'Kai | nghe nói Kai từng là người đưa thư' })
        const r = await g.query('c1', store.story('c1'), { ids: ['hồng bà bà', 'hồng yên quán', 'the north quarter', 'ghost market', 'mặc cúc', 'kai', 'liệp cẩu đoàn'], present: ['Mặc Cúc'] })
        expect(r.status).toBe('ok')
        const rules = r.answers.best_rules.map((t: any[]) => t.join('|'))
        expect(rules).toEqual(expect.arrayContaining(['hồng bà bà|ghost market|fact', 'hồng bà bà|hồng yên quán|fact', 'hồng bà bà|the north quarter|rumor']))
        expect(r.answers.best_foe.map((t: any[]) => t.join('|'))).toEqual(expect.arrayContaining(['mặc cúc|kai|fact', 'kai|liệp cẩu đoàn|fact']))
        expect(r.answers.best_in.map((t: any[]) => t.join('|'))).toEqual(expect.arrayContaining(['mặc cúc|ghost market|fact', 'kai|ghost market|rumor']))
        expect(r.answers.best_in.map((t: any[]) => t.join('|'))).not.toContain('kai|ghost market|fact')   // a rumor first, a fact after: still a rumor
        expect(r.answers.knows_here.map((t: any[]) => t[0])).toContain('mặc cúc')
        expect(r.answers.only_rumor).toHaveLength(1)
    })
})

describe('reading the words', () => {
    test('rumor, unknown and fact in both languages; relation words', () => {
        expect(statusOfText('nghe nói hắn là gián điệp')).toBe('rumor')
        expect(statusOfText('Rumors say the gate is open')).toBe('rumor')
        expect(statusOfText('chưa rõ ai đã gửi thư')).toBe('unknown')
        expect(statusOfText('Who sent the letter?')).toBe('unknown')
        expect(statusOfText('đã cứu cô bé')).toBe('fact')
        expect(relOf('kẻ thù')).toBe('enemy_of')
        expect(relOf('đồng minh, tin tưởng')).toBe('ally_of')
        expect(relOf('gặp ở chợ')).toBe('knows')
        // whole Vietnamese words only (an acceptance copy, 2026-10-21: "yêu cầu" made "loves")
        expect(relOf('đang thử việc; bị yêu cầu quyết định ký cam kết')).toBe('knows')
        expect(relOf('người yêu cũ')).toBe('loves')
        expect(relOf('thuộc hạ của hắn')).toBe('serves')
        expect(relOf('đi chung con đường')).toBe('knows')
        expect(relOf('bị thương nặng sau trận đánh')).toBe('knows')
        expect(relOf('nhờ thầy bói xem quẻ')).toBe('knows')
        expect(statusOfText('anh có tin tưởng cô ấy')).toBe('fact')
        expect(statusOfText('có tin đồn về cái giếng')).toBe('rumor')
    })
})
