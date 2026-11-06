// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'

vi.mock('../storage/database.svelte', () => ({ getDatabase: vi.fn(() => ({})) }))

import {
    FIND_DC, FIND_DROUGHT, FIND_FIRST_TURN, FIND_MIN_GAP, findDiceLine, findFailNote, findRoll, statTier, findDue, findNote, findFingerprint, findId, findRequest, hasFindRule, lastFindTurnOf, noteFind,
    onFindParsed, parseFind, sceneKindOf, setFindKnownProvider, setFindParsedHandler, stripFind, type FindRecord, type SceneKind,
} from './findDrop'

const BLOCK = '[[FIND|skill|Nghe tiếng bước chân|Muffled Footsteps|Nghe bước chân qua tường mỏng trong 10 m; phải im lặng.|uncommon|Cần yên tĩnh; mệt thêm sau mỗi lần dùng|yes]]'

/** a whole simulated run: the narrator writes a block whenever one is due (the worst case for the cap) */
function simulate(seed: string, turns: number, scene: (t: number) => SceneKind = () => 'quiet') {
    let last: number | null = null
    const hits: number[] = []
    for (let t = 1; t <= turns; t++) {
        const r = findDue({ turn: t, lastFindTurn: last, sceneKind: scene(t), seed })
        if (r.due) { hits.push(t); last = t }
    }
    return hits
}

describe('findDue', () => {
    test('never in the first story turns', () => {
        for (let s = 0; s < 300; s++) for (let t = 0; t < FIND_FIRST_TURN; t++) {
            expect(findDue({ turn: t, lastFindTurn: null, sceneKind: 'quiet', seed: 'seed' + s }).due).toBe(false)
        }
    })

    test('never in creation, combat or a death scene, drought or not', () => {
        for (const scene of ['creation', 'combat', 'death'] as SceneKind[]) {
            for (let s = 0; s < 50; s++) for (let t = 1; t <= 60; t++) {
                expect(findDue({ turn: t, lastFindTurn: null, sceneKind: scene, seed: 'x' + s }).due).toBe(false)
                expect(findDue({ turn: t, lastFindTurn: 1, sceneKind: scene, seed: 'x' + s }).due).toBe(false)
            }
        }
    })

    test('at most one find in any window of 8 turns, over 1000 turns and many seeds', () => {
        for (let s = 0; s < 60; s++) {
            const hits = simulate('chat-' + s, 1000)
            expect(hits.length).toBeGreaterThan(20)
            for (let i = 1; i < hits.length; i++) expect(hits[i] - hits[i - 1]).toBeGreaterThanOrEqual(FIND_MIN_GAP)
        }
    })

    test('a drought ends by turn 14 since the last find in a scene that can carry it', () => {
        for (let s = 0; s < 80; s++) {
            const hits = simulate('d-' + s, 600)
            expect(hits[0]).toBeLessThanOrEqual(FIND_DROUGHT)
            for (let i = 1; i < hits.length; i++) expect(hits[i] - hits[i - 1]).toBeLessThanOrEqual(FIND_DROUGHT)
        }
        // certain on the breaker turn whatever the seed
        for (let s = 0; s < 200; s++) expect(findDue({ turn: 30, lastFindTurn: 30 - FIND_DROUGHT, sceneKind: 'social', seed: 's' + s }).due).toBe(true)
    })

    test('a combat turn on the breaker turn pushes the find to the next scene that can carry it', () => {
        const fight = (t: number): SceneKind => (t >= 14 && t <= 17 ? 'combat' : 'quiet')
        const hits = simulate('fight', 40, fight)
        expect(hits.some((t) => t >= 14 && t <= 17)).toBe(false)
    })

    test('deterministic for a seed, different between seeds', () => {
        expect(simulate('same', 300)).toEqual(simulate('same', 300))
        expect(simulate('same', 300)).not.toEqual(simulate('other', 300))
        const a = findDue({ turn: 20, lastFindTurn: null, sceneKind: 'quiet', seed: 'k' })
        expect(findDue({ turn: 20, lastFindTurn: null, sceneKind: 'quiet', seed: 'k' })).toEqual(a)
    })

    test('quiet and scavenging scenes drop more often than social ones', () => {
        const count = (scene: SceneKind) => { let n = 0; for (let s = 0; s < 4000; s++) if (findDue({ turn: 10, lastFindTurn: 1, sceneKind: scene, seed: 'w' + s }).due) n++; return n }
        expect(count('scavenge')).toBeGreaterThan(count('social') * 1.3)
        expect(count('quiet')).toBeGreaterThan(count('social'))
    })

    test('the note carries the rules and excludes the known names', () => {
        const r = findDue({ turn: 40, lastFindTurn: 1, sceneKind: 'quiet', seed: 'n', known: ['Mắt đêm', 'Night Vision Goggles'] })
        expect(r.due).toBe(true)
        expect(r.note).toContain('Mắt đêm')
        expect(r.note).toContain('Night Vision Goggles')
        expect(r.note).toContain('[[FIND|' + r.kind + '|')
        expect(r.note).toContain('Bạn nhận được')   // named only to forbid it
        expect(r.note).toMatch(/write nothing/)
        expect(r.rarity).toMatch(/^(common|uncommon|rare|epic)$/)
        expect(findDue({ turn: 40, lastFindTurn: null, sceneKind: 'quiet', seed: 'n' }).note).not.toContain('none of these')
    })
})

describe('parseFind', () => {
    test('all the fields', () => {
        const r = parseFind('Cô khựng lại, tai áp vào bức tường.\n' + BLOCK + '\n[[STATUS\nday: 2\n]]', { card: 'zombie', chapter: 'Ngày 2' })
        expect(r).toEqual({
            id: 'muffled-footsteps', kind: 'skill', name: { vi: 'Nghe tiếng bước chân', en: 'Muffled Footsteps' },
            source: { card: 'zombie', chapter: 'Ngày 2' }, effect: 'Nghe bước chân qua tường mỏng trong 10 m; phải im lặng.',
            rarity: 'uncommon', conditions: 'Cần yên tĩnh; mệt thêm sau mỗi lần dùng', portable: true,
        })
    })

    test('an item, portable no, case of the enums does not matter', () => {
        const r = parseFind('[[FIND| Item |Kính nhìn đêm|Night Vision Goggles|Thấy trong tối 20 m.|RARE|Pin 3 giờ|No]]')
        expect(r?.kind).toBe('item'); expect(r?.rarity).toBe('rare'); expect(r?.portable).toBe(false)
        expect(r?.id).toBe('night-vision-goggles')
    })

    test('bad blocks give null', () => {
        const bad = [
            '', 'không có gì', '[[FIND]]', '[[FIND|skill|A|B]]',
            '[[FIND|power|Tên|Name|effect|rare|cond|yes]]',
            '[[FIND|skill|Tên|Name|effect|legendary|cond|yes]]',
            '[[FIND|skill|Tên|Name|effect|rare|cond|maybe]]',
            '[[FIND|skill|Tên|Name||rare|cond|yes]]',
            '[[FIND|skill||Name|effect|rare|cond|yes]]',
            '[[FIND|skill|Tên|Name|effect|rare||yes]]',
            `[[FIND|skill|${'x'.repeat(61)}|Name|effect|rare|cond|yes]]`,
            `[[FIND|skill|Tên|Name|${'e'.repeat(401)}|rare|cond|yes]]`,
            '[[FIND|skill|Tên|!!!|effect|rare|cond|yes]]',
            '[[FIND|skill|Tên|Name|effect|rare|cond|yes',   // unclosed
        ]
        for (const b of bad) expect(parseFind(b), b).toBeNull()
    })

    test('a pipe inside a field is not allowed (too many fields)', () => {
        expect(parseFind('[[FIND|skill|Tên|Name|hiệu ứng | thêm|rare|cond|yes]]')).toBeNull()
        expect(parseFind('[[FIND|skill|Tên|Name|effect|rare|cond|yes|extra]]')).toBeNull()
    })

    test('two blocks: the first only', () => {
        const second = '[[FIND|item|Dao|Knife|Cắt.|common|Không|no]]'
        expect(parseFind(BLOCK + '\n' + second)?.id).toBe('muffled-footsteps')
        expect(parseFind(second + '\n' + BLOCK)?.id).toBe('knife')
        // a bad first block is not replaced by the second
        expect(parseFind('[[FIND|skill|x]]\n' + second)).toBeNull()
    })

    test('id and fingerprint', () => {
        expect(findId('Night-Vision  Goggles!')).toBe('night-vision-goggles')
        expect(findFingerprint('Night Vision Goggles')).toBe(findFingerprint('night-vision goggles'))
        expect(findFingerprint('The Goggles of Night Vision')).toBe(findFingerprint('night vision goggles'))
    })
})

describe('stripFind', () => {
    test('takes the block out and keeps the Vietnamese text around it', () => {
        const text = 'Cô nhặt được một cuộn băng keo, và chợt nhớ ra cách bịt tiếng ồn.\n\n[💡Kế hoạch| Không ]\n' + BLOCK + '\n[[STATUS\nday: 2\n]]'
        const out = stripFind(text)
        expect(out).not.toContain('FIND')
        expect(out).toContain('Cô nhặt được một cuộn băng keo, và chợt nhớ ra cách bịt tiếng ồn.')
        expect(out).toContain('[💡Kế hoạch| Không ]')
        expect(out).toContain('[[STATUS\nday: 2\n]]')
    })

    test('hides a block still being streamed, and its first characters', () => {
        expect(stripFind('Gió thổi qua.\n[[FIND|skill|Nghe tiếng')).toBe('Gió thổi qua.')
        expect(stripFind('Gió thổi qua.\n[[FIN')).toBe('Gió thổi qua.')
        expect(stripFind('Gió thổi qua.\n[[')).toBe('Gió thổi qua.')
        expect(stripFind('Gió thổi qua.\n[[STATUS\nday: 2')).toBe('Gió thổi qua.\n[[STATUS\nday: 2')
    })

    test('no block: the text is untouched; two blocks both go', () => {
        const t = 'Một ngày yên tĩnh.\n'
        expect(stripFind(t)).toBe(t)
        expect(stripFind(`A\n${BLOCK}\nB\n${BLOCK}`)).toBe('A\nB')
    })
})

type M = { role: string; data: string; chatId?: string }
const card = (desc = 'Rules. [[FIND|skill|Tên VI|Name EN|…]] end. Character Creation… Được chưa?') => ({ type: 'character', chaId: 'fc27f53b', desc, firstMessage: '' }) as never
/** a chat past creation: the char asks "Được chưa?", the player says yes, then `n` story replies */
function chatWith(n: number, extra: Partial<{ scriptstate: Record<string, string>; last: string; player: string }> = {}) {
    const message: M[] = [{ role: 'char', data: 'Mở đầu' }, { role: 'user', data: 'tạo' }, { role: 'char', data: 'Hồ sơ. Được chưa?' }, { role: 'user', data: 'được' }]
    for (let i = 0; i < n; i++) {
        message.push({ role: 'char', data: i === n - 1 && extra.last ? extra.last : `Cảnh ${i}` })
        if (i < n - 1) message.push({ role: 'user', data: 'đi tiếp' })
    }
    return { id: 'chat-1', message, scriptstate: { $find_roll: JSON.stringify({ turn: n, d20: 15, bonus: 0, dc: 8, ok: true, kind: 'skill', rarity: 'common', stat: 'tinh_than' }), ...(extra.scriptstate ?? {}) } } as never as { id: string; message: M[]; scriptstate: Record<string, string> }
}
const withPlayer = (c: ReturnType<typeof chatWith>, text: string) => { c.message.push({ role: 'user', data: text }); return c }
const asked = (c: unknown, k = card()) => { const out = findRequest([{ role: 'user', content: 'hi' }], k, c as never); return String(out.at(-1)?.content ?? '') }

describe('the chat wiring', () => {
    test('only a card whose description teaches the block is asked', () => {
        expect(hasFindRule(card())).toBe(true)
        expect(hasFindRule(card('no rule here'))).toBe(false)
        const c = withPlayer(chatWith(30, { scriptstate: { $find_turn: '1' } }), 'nhìn quanh')
        expect(asked(c, card('no rule here'))).toBe('hi')
    })

    test('no note in the first story turns or before the yes; a note when due', () => {
        expect(asked(withPlayer(chatWith(2), 'nhìn quanh'))).toBe('hi')
        const creation = { id: 'c', message: [{ role: 'char', data: 'Chào' }, { role: 'user', data: 'hi' }], scriptstate: {} }
        expect(asked(creation)).toBe('hi')
        // a long quiet run with no find yet: the breaker makes it due by turn 14
        const c = withPlayer(chatWith(14), 'nhìn quanh')
        expect(asked(c)).toContain('[[FIND|')
    })

    test('the scene: a fight or an attack in the player turn blocks it even on the breaker', () => {
        expect(asked(withPlayer(chatWith(20), 'tôi đâm hắn'))).toBe('hi')
        expect(asked(withPlayer(chatWith(20, { scriptstate: { $gm_mode: JSON.stringify({ at: 1, mode: { scene: 'still', combat: 'fight' }, prev: {} }) } }), 'chờ'))).toBe('hi')
        expect(asked(withPlayer(chatWith(20, { last: 'Bạn đã chết.' }), 'chờ'))).toBe('hi')
        expect(asked(withPlayer(chatWith(20), 'lục soát tủ'))).toContain('[[FIND|')
    })

    test('the known names of the chat and of the provider are in the note', () => {
        setFindKnownProvider(() => ['Tên từ kho'])
        try {
            const out = asked(withPlayer(chatWith(20, { scriptstate: { $find_known: JSON.stringify(['Dao găm', 'Dagger']) } }), 'nhìn quanh'))
            expect(out).toContain('Dao găm'); expect(out).toContain('Dagger'); expect(out).toContain('Tên từ kho')
        } finally { setFindKnownProvider(null) }
    })

    test('a reply with a block: stripped, recorded for the cap, panel line, hook called once; no block = nothing counted', () => {
        const seen: [FindRecord, number][] = []
        setFindParsedHandler((r, ctx) => seen.push([r, ctx.turn]))
        try {
            const c = chatWith(6, { last: 'Cô nghe tiếng bước chân sau tường.\n' + BLOCK })
            const rec = noteFind(0, card(), c as never)
            expect(rec?.id).toBe('muffled-footsteps')
            expect(rec?.source.card).toBe('fc27f53b')
            expect(c.message.at(-1)!.data).toBe('Cô nghe tiếng bước chân sau tường.')
            expect(c.scriptstate.$find_turn).toBe('6')
            expect(c.scriptstate.$find_line).toBe('🎲 d20 15 vs 8: OK — nhận Nghe tiếng bước chân')
            expect(JSON.parse(c.scriptstate.$find_known)).toEqual(['Nghe tiếng bước chân', 'Muffled Footsteps'])
            expect(seen).toHaveLength(1); expect(seen[0][1]).toBe(6)

            // the next request: panel line gone, cap counts from 6 (no note for 8 turns)
            expect(asked(withPlayer(c, 'nhìn quanh'))).toBe('hi')
            expect(c.scriptstate.$find_line).toBe('')

            // a reply with no block counts nothing
            const d = chatWith(9)
            expect(noteFind(0, card(), d as never)).toBeNull()
            expect(d.scriptstate.$find_turn).toBeUndefined()
            expect(seen).toHaveLength(1)
        } finally { setFindParsedHandler(null) }
    })

    test('an item panel line; a known find or a bad block is stripped but not counted', () => {
        const item = chatWith(5, { last: 'Cô nhặt cái đèn.\n[[FIND|item|Đèn pin dây quấn|Hand-crank Torch|Sáng 5 m.|common|Quay tay 30 s|yes]]' })
        noteFind(0, card(), item as never)
        expect(item.scriptstate.$find_line).toBe('🎲 d20 15 vs 8: OK — nhận Đèn pin dây quấn')

        const dup = chatWith(9, { last: 'Lại nó.\n[[FIND|item|Đèn khác|the hand crank torch|Sáng.|common|x|yes]]', scriptstate: { $find_known: JSON.stringify(['Đèn pin dây quấn', 'Hand-crank Torch']), $find_turn: '5' } })
        expect(noteFind(0, card(), dup as never)).toBeNull()
        expect(dup.message.at(-1)!.data).toBe('Lại nó.')
        expect(dup.scriptstate.$find_turn).toBe('5')

        const bad = chatWith(9, { last: 'Gì đó.\n[[FIND|skill|chỉ hai]]' })
        expect(noteFind(0, card(), bad as never)).toBeNull()
        expect(bad.message.at(-1)!.data).toBe('Gì đó.')
        expect(bad.scriptstate.$find_turn).toBeUndefined()
    })

    test('a reroll of the reply that carried a find asks again at its own turn: the mark before counts (prev)', () => {
        const e = chatWith(12, { last: 'Khác.\n' + BLOCK, scriptstate: { $find_turn: '4' } })
        noteFind(0, card(), e as never)
        expect(e.scriptstate.$find_prev).toBe('4'); expect(e.scriptstate.$find_turn).toBe('12')
        expect(lastFindTurnOf(e.scriptstate, 12)).toBe(4)
        expect(lastFindTurnOf(e.scriptstate, 13)).toBe(12)
    })

    test('the default hook is a no-op and a throwing hook does not break the reply', () => {
        const rec = parseFind(BLOCK)!
        expect(() => onFindParsed(rec, { chatId: 'c', card: 'x', turn: 5 })).not.toThrow()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        setFindParsedHandler(() => { throw new Error('bridge down') })
        try { expect(() => onFindParsed(rec, { chatId: 'c', card: 'x', turn: 5 })).not.toThrow() } finally { setFindParsedHandler(null); warn.mockRestore() }
    })

    test('sceneKindOf reads the machine mode and the words', () => {
        const mode = (scene: string, combat = 'peace') => ({ $gm_mode: JSON.stringify({ at: 3, mode: { scene, combat }, prev: {} }) })
        expect(sceneKindOf(mode('still'), 'chờ')).toBe('quiet')
        expect(sceneKindOf(mode('travel'), 'đi')).toBe('travel')
        expect(sceneKindOf(mode('still', 'fight'), 'chờ')).toBe('combat')
        expect(sceneKindOf(undefined, 'tôi lục lọi trong tủ')).toBe('scavenge')
        expect(sceneKindOf(undefined, 'quan sát phố')).toBe('explore')
        expect(sceneKindOf(undefined, 'xin chào')).toBe('other')
    })
})

describe('a find that is the same kind as a known one (another English name for it)', () => {
    test('is stripped and not counted, with the chat\'s own names and the store\'s', () => {
        const near = 'Lại tiếng đó.\n[[FIND|skill|Nhịp cầu thang|Stairwell Rhythm|Nghe nhịp bước chân ở cầu thang.|rare|Cần yên tĩnh|yes]]'
        const c = chatWith(9, { last: near, scriptstate: { $find_known: JSON.stringify(['Nghe nhịp âm', 'Sound Rhythm']) } })
        expect(noteFind(0, card(), c as never)).toBeNull()
        expect(c.scriptstate.$find_turn).toBeUndefined()
        expect(c.message.at(-1)!.data).toBe('Lại tiếng đó.')
        setFindKnownProvider(() => ['Sound Rhythm'])
        try {
            const d = chatWith(9, { last: near })
            expect(noteFind(0, card(), d as never)).toBeNull()
            expect(d.scriptstate.$find_turn).toBeUndefined()
        } finally { setFindKnownProvider(null) }
        expect(noteFind(0, card(), chatWith(9, { last: near }) as never)?.id).toBe('stairwell-rhythm')
    })
    test('the note tells the narrator that the same kind of thing under another name counts as the same', () => {
        expect(findNote('skill', 'rare', ['Sound Rhythm'])).toMatch(/nothing close to them/)
    })
})

describe('findNote wording (a real run: the narrator found the item in prose and filled a STATUS line, but left the block out)', () => {
    test('says the line is required and that a STATUS line does not replace it, with the rarity, kind and the names to avoid', () => {
        const n = findNote('item', 'rare', ['Muffled Footsteps'])
        expect(n).toMatch(/MUST end with exactly one line/)
        expect(n).toMatch(/STATUS item or skill line or a GM line does NOT replace it/)
        expect(n).toContain('[[FIND|item|')
        expect(n).toContain('rare item')
        expect(n).toContain('Muffled Footsteps')
        expect(n).toMatch(/Only if this scene truly cannot carry a find/)
    })
})


describe('the dice: a find is an event that can fail (owner 2026-11-05)', () => {
    const BLOCK = '[[FIND|skill|Nghe tiếng bước chân|Muffled Footsteps|Nghe bước chân sau tường mỏng.|common|Cần yên tĩnh|yes]]'
    const roll = (o: object) => JSON.stringify({ turn: 10, d20: 12, bonus: 0, dc: 8, ok: true, kind: 'skill', rarity: 'common', stat: 'tinh_than', ...o })
    test('the schedule is an event every 6..10 turns', () => {
        expect(FIND_MIN_GAP).toBe(6)
        expect(FIND_DROUGHT).toBe(10)
    })
    test('the roll is a d20 seeded by (chat, turn): the same twice, 1..20, the DC by rarity', () => {
        expect(FIND_DC).toEqual({ common: 8, uncommon: 12, rare: 16, epic: 19 })
        const seen = new Set<number>()
        for (let t = 1; t <= 400; t++) {
            const a = findRoll({ kind: 'skill', rarity: 'rare' }, t, 'chat-1', {})
            expect(findRoll({ kind: 'skill', rarity: 'rare' }, t, 'chat-1', {})).toEqual(a)
            expect(a.d20).toBeGreaterThanOrEqual(1); expect(a.d20).toBeLessThanOrEqual(20)
            expect(a.dc).toBe(16)
            seen.add(a.d20)
        }
        expect(seen.size).toBe(20)
        expect(findRoll({ kind: 'skill', rarity: 'rare' }, 7, 'chat-1', {}).d20 === findRoll({ kind: 'skill', rarity: 'rare' }, 7, 'chat-2', {}).d20 && findRoll({ kind: 'skill', rarity: 'rare' }, 8, 'chat-1', {}).d20 === findRoll({ kind: 'skill', rarity: 'rare' }, 8, 'chat-2', {}).d20).toBe(false)
    })
    test('the bonus is the tier of the related stat: Tinh thần for a skill, the act\'s stat when known, Cảm nhận for an item', () => {
        const vars = { $stats: JSON.stringify({ suc_manh: 1600, tinh_than: 1300, cam_nhan: 1900 }) }
        expect(statTier(vars, 'tinh_than')).toBe(1)
        expect(statTier(vars, 'suc_manh')).toBe(2)
        expect(statTier(vars, 'y_chi')).toBe(0)
        expect(statTier({ $stats: 'not json' }, 'tinh_than')).toBe(0)
        expect(findRoll({ kind: 'skill', rarity: 'common' }, 5, 'c', vars)).toMatchObject({ stat: 'tinh_than', bonus: 1 })
        expect(findRoll({ kind: 'skill', rarity: 'common' }, 5, 'c', { ...vars, $act_stat: 'suc_manh' })).toMatchObject({ stat: 'suc_manh', bonus: 2 })
        expect(findRoll({ kind: 'skill', rarity: 'common' }, 5, 'c', { ...vars, $act_stat: 'bogus' })).toMatchObject({ stat: 'tinh_than' })
        expect(findRoll({ kind: 'item', rarity: 'common' }, 5, 'c', { ...vars, $act_stat: 'suc_manh' })).toMatchObject({ stat: 'cam_nhan', bonus: 3 })
    })
    test('a higher tier turns a miss into a pass: stat 10 vs 13 on the same chat, turn and DC', () => {
        let found = 0
        for (let t = 1; t <= 300; t++) {
            const lo = findRoll({ kind: 'item', rarity: 'uncommon' }, t, 'chat-9', { $stats: JSON.stringify({ cam_nhan: 1000 }) })
            const hi = findRoll({ kind: 'item', rarity: 'uncommon' }, t, 'chat-9', { $stats: JSON.stringify({ cam_nhan: 1300 }) })
            expect(lo.d20).toBe(hi.d20)
            if (hi.ok && !lo.ok) found++
            if (lo.ok) expect(hi.ok).toBe(true)
        }
        expect(found).toBeGreaterThan(0)
    })
    test('the panel line', () => {
        expect(findDiceLine({ turn: 1, d20: 14, bonus: 1, dc: 12, ok: true, kind: 'skill', rarity: 'uncommon', stat: 'tinh_than' })).toBe('🎲 d20 14+1 vs 12: OK')
        expect(findDiceLine({ turn: 1, d20: 3, bonus: 0, dc: 12, ok: false, kind: 'skill', rarity: 'uncommon', stat: 'tinh_than' })).toBe('🎲 d20 3 vs 12: hụt')
    })
    // a due turn and the request it makes
    const dueChat = () => {
        for (let n = 8; n < 40; n++) for (let id = 0; id < 40; id++) {
            const c = chatWith(n, { scriptstate: { $find_roll: '' } }); (c as { id: string }).id = `c${id}`
            const before = asked(c)
            if (before.includes('is due in this reply') || before.includes('did not get it this time')) return { c, n }
        }
        throw new Error('no due turn found')
    }
    test('a due turn writes the roll and the dice line; pass asks for the line, fail says it missed and forbids it', () => {
        let pass = 0, fail = 0
        for (let n = 6; n < 60 && (!pass || !fail); n++) for (let id = 0; id < 60; id++) {
            const c = chatWith(n, { scriptstate: { $find_roll: '' } }); (c as { id: string }).id = `p${id}`
            const text = asked(c)
            if (!text.includes('Find (hidden')) continue
            const r = JSON.parse(c.scriptstate.$find_roll)
            expect(r.turn).toBe(n + 1)
            expect(c.scriptstate.$find_line).toBe(findDiceLine(r))
            if (r.ok) { pass++; expect(text).toContain('is due in this reply'); expect(text).not.toContain('did not get it this time') }
            else { fail++; expect(text).toContain('Do NOT write a [[FIND'); expect(text).not.toContain('is due in this reply') }
        }
        expect(pass).toBeGreaterThan(0)
        expect(fail).toBeGreaterThan(0)
    })
    test('a miss still spends the event (the cap mark moves), and asking again for the same turn gives the same roll and keeps one mark', () => {
        for (let id = 0; id < 400; id++) {
            const c = chatWith(12, { scriptstate: { $find_roll: '' } }); (c as { id: string }).id = `m${id}`
            const text = asked(c)
            if (!text.includes('did not get it this time')) continue
            const roll1 = c.scriptstate.$find_roll
            expect(c.scriptstate.$find_turn).toBe('13')
            asked(c)   // a regenerated reply: the same request again
            expect(c.scriptstate.$find_roll).toBe(roll1)
            expect(c.scriptstate.$find_turn).toBe('13')
            expect(asked(c)).toContain('did not get it this time')
            return
        }
        throw new Error('no miss found')
    })
    test('NoFreeGrant: a FIND line with no roll, a missed roll or a roll of another turn is stripped and saves nothing', () => {
        for (const ss of [{ $find_roll: '' }, { $find_roll: roll({ ok: false, d20: 2 }) }, { $find_roll: roll({ turn: 9 }) }, { $find_roll: 'garbage' }]) {
            const c = chatWith(10, { last: `Cảnh.\n${BLOCK}`, scriptstate: ss })
            const seen: unknown[] = []
            setFindParsedHandler((r) => seen.push(r))
            try { expect(noteFind(0, card(), c as never)).toBeNull() } finally { setFindParsedHandler(null) }
            expect(seen).toEqual([])
            expect(c.message.at(-1)?.data).not.toContain('[[FIND')
            expect(c.scriptstate.$find_turn).toBeUndefined()
        }
        const c = chatWith(10, { last: `Cảnh.\n${BLOCK}`, scriptstate: { $find_roll: roll({}) } })
        expect(noteFind(0, card(), c as never)?.id).toBe('muffled-footsteps')
        expect(c.scriptstate.$find_turn).toBe('10')
    })
    test('when Lua decides the drop ($finds_by_lua=1) the client does not gate on its own roll', () => {
        const c = chatWith(10, { last: `Cảnh.\n${BLOCK}`, scriptstate: { $find_roll: '', $finds_by_lua: '1' } })
        expect(noteFind(0, card(), c as never)?.id).toBe('muffled-footsteps')
    })
    test('the fail note names the kind and never asks for a line', () => {
        expect(findFailNote('item')).toContain('item')
        expect(findFailNote('item')).toContain('Do NOT write a [[FIND')
    })
})
