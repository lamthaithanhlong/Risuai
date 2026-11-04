// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'

vi.mock('../storage/database.svelte', () => ({ getDatabase: vi.fn(() => ({})) }))

import {
    FIND_DROUGHT, FIND_FIRST_TURN, FIND_MIN_GAP, findDue, findFingerprint, findId, findRequest, hasFindRule, lastFindTurnOf, noteFind,
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
    return { id: 'chat-1', message, scriptstate: { ...(extra.scriptstate ?? {}) } } as never as { id: string; message: M[]; scriptstate: Record<string, string> }
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
            expect(c.scriptstate.$find_line).toBe('+ Skill mới: Nghe tiếng bước chân')
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
        expect(item.scriptstate.$find_line).toBe('+ Item mới: Đèn pin dây quấn')

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
