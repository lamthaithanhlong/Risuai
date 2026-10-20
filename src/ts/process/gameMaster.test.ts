import { describe, expect, it } from 'vitest'
import {
    applyBookkeep, applyGm, cardEvent, playerSide, sidePaths, markAdvance, sideAge, sinceAdvance, bookkeepPrompt, gmBlocks, parseBookkeep, stateLines, gmNote, gmPhase, gmRequest, gmStateOf, isYes, rollGm, settleGm, stripGm, takeGm, worldFlavour, type GmState,
} from './gameMaster'

const SS = { name: 'Shadow Slave — Independent Fate', desc: 'Character Creation (before the story starts)\n… "Được chưa? Sửa dòng nào cứ nói"', firstMessage: '' }
const PLAIN = { name: 'Aiko', desc: 'A cheerful barista who chats with you.', firstMessage: 'Hi!' }

const msg = (role: 'user' | 'char', data: string, chatId?: string) => ({ role, data, chatId })
const seq = (...vals: number[]) => { let i = 0; return () => vals[i++ % vals.length] }

const FULL: GmState = {
    gm_arc: 'a debt to the Black Lantern crew | Varn, a crew enforcer who wants her Memory | pay or break the debt | her brother\'s safety',
    gm_beat: '2 | Varn\'s man watches the shelter | collection night in two days',
    gm_threats: 'Collection | 2/4 | Varn takes the brother\nRumour | 1/3 | the clan hears of her Aspect\nCold | 1/4 | the shelter closes',
    gm_rewards_due: 'a forged permit | when the crew\'s ledger is stolen',
    gm_consequences_due: 'the shelter warden turns her out | if she brings the crew to the door',
    gm_canon: 'Day 3 of the First Nightmare | far to the east the Forgotten Shore party is still crossing the labyrinth',
    gm_beat_at: '4',
}

describe('the [[GM]] block: parsed, kept, and never shown', () => {
    const reply = 'Gió quất qua mái tôn.\n\n[[GM\narc: debt | Varn | pay | brother\nbeat: 1 | Varn appears | collection in 3 days\nthreat: Collection | 1/4 | Varn takes the brother\nreward: a permit | when the ledger is stolen\ncanon: Day 1 | the Shore party sleeps\n]]'
    it('takes the block out of the message and the screen, also an unclosed one being streamed', () => {
        expect(stripGm(reply)).toBe('Gió quất qua mái tôn.')
        expect(stripGm('Văn.\n[[GM\narc: x | y')).toBe('Văn.')
        expect(stripGm('A\n[[GM\nbeat: 1 | x\n]]\nB')).toBe('A\nB')
        expect(stripGm('[[STATUS\nname: K\n]]')).toBe('[[STATUS\nname: K\n]]')
    })
    it('reads every field, merges threats by name, replaces due lists, caps threats at 3', () => {
        const s = applyGm({}, gmBlocks(reply), 5)
        expect(s.gm_arc).toBe('debt | Varn | pay | brother')
        expect(s.gm_beat).toBe('1 | Varn appears | collection in 3 days')
        expect(s.gm_beat_at).toBe('5')
        expect(s.gm_threats).toBe('Collection | 1/4 | Varn takes the brother')
        expect(s.gm_rewards_due).toBe('a permit | when the ledger is stolen')
        expect(s.gm_canon).toBe('Day 1 | the Shore party sleeps')
        const s2 = applyGm(s, ['\nthreat: collection | 2/4 | Varn takes the brother\nthreat: A | 1 | x\nthreat: B | 1 | x\nthreat: C | 1 | x\nreward: -\n'], 6)
        expect(s2.gm_threats!.split('\n')).toEqual(['A | 1 | x', 'B | 1 | x', 'C | 1 | x'])
        expect(s2.gm_rewards_due).toBe('')
        expect(s2.gm_arc).toBe(s.gm_arc)          // unchanged lines stay
        expect(s2.gm_beat_at).toBe('5')           // the beat did not move
        expect(applyGm(s2, ['threat: B | -'], 7).gm_threats).toBe('A | 1 | x\nC | 1 | x')
    })
    it('drops field names the model copied as values (measured: "hook|…|antagonist|…")', () => {
        expect(applyGm({}, ['arc: hook|a debt|antagonist|Kelber|goal|survive|stakes|death'], 1).gm_arc).toBe('a debt | Kelber | survive | death')
        expect(applyGm({}, ['arc: <hook> | a debt | Goal'], 1).gm_arc).toBe('a debt')
    })
    it('the beat moved only when its number changed, not its wording (the bookkeeper rewrites it every reply)', () => {
        const s = applyGm({ gm_beat: '2 | a knock | the door', gm_beat_at: '4' }, ['beat: 2 | the knock again | the door opens'], 6)
        expect(s.gm_beat).toBe('2 | the knock again | the door opens')
        expect(s.gm_beat_at).toBe('4')
        expect(applyGm(s, ['beat: 3 | the door opens | a stranger'], 7).gm_beat_at).toBe('7')
        expect(applyGm({ gm_beat: 'arrival | x', gm_beat_at: '1' }, ['beat: arrival | y'], 3).gm_beat_at).toBe('1')
    })
    it('a closed arc clears arc, beat and threats and keeps what it left behind for the next one', () => {
        const s = applyGm(FULL, ['arc: done | she burned the ledger; Varn swore revenge'], 9)
        expect(s.gm_arc).toBe('')
        expect(s.gm_beat).toBe('')
        expect(s.gm_threats).toBe('')
        expect(s.gm_past).toContain('Varn')
        expect(s.gm_past).toContain('swore revenge')
        expect(gmPhase(SS, [msg('char', 'x')], {}, s)).toBe('seed')
    })
    it('keeps the state before the reply, and goes back to it when that reply is rerolled away', () => {
        const before: GmState = { gm_arc: 'old | A | g | s' }
        const t = takeGm(before, msg('char', 'Văn.\n[[GM\narc: new | B | g | s\n]]', 'r2'), 3)!
        expect(t.text).toBe('Văn.')
        expect(t.state.gm_arc).toBe('new | B | g | s')
        expect(settleGm(t.state, [msg('char', 'x', 'r2')]).rolledBack).toBe(false)
        const back = settleGm(t.state, [msg('char', 'x', 'r1')])
        expect(back.rolledBack).toBe(true)
        expect(back.state.gm_arc).toBe('old | A | g | s')
        expect(takeGm(before, msg('char', 'no block'), 3)).toBeNull()
    })
    it('reads the chat variables as setChatVar keeps them ($gm_*)', () => {
        expect(gmStateOf({ $gm_arc: 'a | b', $st_name: 'K', $gm_canon: 'null' })).toEqual({ gm_arc: 'a | b' })
    })
})

describe('silent before the character is confirmed', () => {
    const asked = msg('char', 'Tên: Mai\nTuổi: 19\nĐược chưa? Sửa dòng nào cứ nói, hoặc bảo bốc lại dòng đó.')
    it('says nothing on the opening, during the interview, or when the record is being changed', () => {
        expect(gmPhase(SS, [], {}, {})).toBe('silent')
        expect(gmPhase(SS, [msg('user', 'từng bước'), msg('char', 'Giới tính và tuổi?'), msg('user', 'nữ, 19')], {}, {})).toBe('silent')
        expect(gmPhase(SS, [msg('user', 'surprise me'), asked, msg('user', 'sửa tên thành Lan')], {}, {})).toBe('silent')
        expect(gmPhase(SS, [msg('user', 'surprise me'), asked, msg('user', 'được nhưng đổi tuổi')], {}, {})).toBe('silent')
    })
    it('leaves the Initialization reply to the card, seeds on the turn after it, and runs once an arc exists', () => {
        expect(gmPhase(SS, [msg('user', 'surprise me'), asked, msg('user', 'được')], {}, {})).toBe('silent')
        expect(gmPhase(SS, [asked, msg('user', 'ok'), msg('char', 'story'), msg('user', 'tui đi')], {}, {})).toBe('seed')
        expect(gmPhase(SS, [msg('char', 'story')], { $st_name: 'Mai' }, {})).toBe('seed')
        expect(gmPhase(SS, [msg('char', 'story')], { $st_name: '-' }, {})).toBe('silent')
        expect(gmPhase(SS, [msg('char', 'story')], {}, { gm_arc: 'a | b' })).toBe('run')
    })
    it('a card with no creation step and no panel is a companion chat: silent; with a panel shape it is a story', () => {
        expect(gmPhase(PLAIN, [msg('char', 'hi'), msg('user', 'hello')], {}, {})).toBe('silent')
        expect(gmPhase(PLAIN, [msg('char', 'hi'), msg('user', 'hello')], {}, {}, true)).toBe('seed')
    })
    it('knows a yes from a change', () => {
        for (const y of ['được', 'Ok', 'bắt đầu đi', 'yes', 'được rồi, bắt đầu']) expect(isYes(y), y).toBe(true)
        for (const n of ['sửa tên', 'được nhưng sửa tuổi', 'không', 'bốc lại dòng 3', '', 'tui là Mai']) expect(isYes(n), n).toBe(false)
    })
})

describe('the GM dice come from the app, fresh every turn', () => {
    it('two turns with the default dice are not the same roll every time', () => {
        const rolls = new Set(Array.from({ length: 40 }, () => JSON.stringify(rollGm(FULL, 6))))
        expect(rolls.size).toBeGreaterThan(3)
    })
    it('follows the dice it is given: advance or hold, hot or calm, which thread, whether a cost lands', () => {
        expect(rollGm(FULL, 6, seq(0.01, 0.9, 0.0, 0.1, 0.9))).toEqual({ pace: 'advance', surface: 'the antagonist (Varn, a crew enforcer who wants her Memory)', consequence: true, canon: false })
        expect(rollGm(FULL, 6, seq(0.99, 0.1, 0.99, 0.9, 0.1))).toEqual({ pace: 'build', surface: 'the goal', consequence: false, canon: true })
    })
    it('the pace clock is the app\'s own advances, not the model\'s beat number (measured: 7-8 quiet replies in 10)', () => {
        // the model raised the beat number every reply; the clock ignores it once the app has marked an advance
        const st: GmState = { gm_beat_at: '9', gm_adv_at: '4' }
        expect(sinceAdvance(st, 9)).toBe(4)
        const d = (pace: 'quiet' | 'advance' | 'escalate' | 'build') => ({ pace, surface: 'x', consequence: false, canon: false })
        expect(markAdvance(st, 9, d('quiet'))).toBeNull()
        expect(markAdvance(st, 9, d('build'))).toBeNull()
        const m = markAdvance(st, 9, d('advance'))!
        expect(m).toEqual({ gm_adv_at: '9', gm_adv_prev: '4' })
        const after = { ...st, ...m }
        expect(sinceAdvance(after, 10)).toBe(0)          // the reply it asked for is in: rest
        expect(sinceAdvance(after, 12)).toBe(2)
        expect(sinceAdvance(after, 9)).toBe(4)           // that reply was rerolled away: the mark before
        expect(markAdvance(after, 9, d('escalate'))).toEqual({ gm_adv_at: '9', gm_adv_prev: '4' })
        expect(sinceAdvance({ gm_beat_at: '6' }, 7)).toBe(7)   // no advance rolled yet: every reply counts, whatever the beat says
        const pushed = Array.from({ length: 400 }, () => rollGm({ gm_beat_at: '20', gm_adv_at: '10' }, 20)).filter((x) => x.pace === 'advance' || x.pace === 'escalate').length / 400
        expect(pushed).toBeGreaterThan(0.7)
    })
    it('a beat that just moved rests; a stalled beat is pushed', () => {
        const at = (since: number) => Array.from({ length: 400 }, () => rollGm({ ...FULL, gm_adv_at: '9' }, 10 + since)).filter((d) => d.pace === 'advance' || d.pace === 'escalate').length / 400
        expect(at(0)).toBeLessThan(0.25)
        expect(at(6)).toBeGreaterThan(0.7)
    })
})

describe('the note', () => {
    const dice = { pace: 'escalate' as const, surface: 'the goal', consequence: true, canon: true }
    it('is empty while silent, and rides at the end of the player\'s last message', () => {
        expect(gmNote('silent', FULL, dice, 'x')).toBe('')
        const req = [{ role: 'system', content: 's' }, { role: 'user', content: 'Tui đi.' }, { role: 'assistant', content: 'a' }]
        expect(gmRequest(req, '')).toBe(req)
        expect(gmRequest(req, '\n\n[GM x]')[1].content).toBe('Tui đi.\n\n[GM x]')
        const two = [{ role: 'user', content: 'cũ' }, { role: 'assistant', content: 'a' }, { role: 'user', content: 'mới' }]
        expect(gmRequest(two, ' [GM]').map((m) => m.content)).toEqual(['cũ', 'a', 'mới [GM]'])
    })
    it('carries the state, this turn\'s dice and the rules', () => {
        const n = gmNote('run', FULL, dice, 'x')
        expect(n).toContain('Arc: a debt to the Black Lantern crew')
        expect(n).toContain('Threat: Collection | 2/4')
        expect(n).toContain('ESCALATE')
        expect(n).toContain('a due consequence lands now')
        expect(n).toContain('some may come up now')
        expect(n).toContain('canon events still happen'); expect(n).toContain('never forced')
        expect(n).toContain('The player\'s action happens')
        expect(n).toContain('no free rank, Sequence, stamp, power')
        expect(n).toContain('[[GM\nbeat: <n> | <now> | <due next>'); expect(n).toContain('no planning notes')
        expect(gmNote('run', FULL, { ...dice, pace: 'quiet', consequence: false, canon: false }, 'x')).not.toMatch(/lands now|come up now/)
    })
    it('seeds an arc of the player\'s own, grown from the last one, with world flavour', () => {
        const n = gmNote('seed', { gm_past: 'debt / Varn → Varn swore revenge' }, dice, worldFlavour(SS))
        expect(n).toContain('No arc yet')
        expect(n).toContain('arc: <hook> | <antagonist> | <goal> | <stakes>')
        expect(n).toContain('never a canon villain')
        expect(n).toContain('Varn swore revenge')
        expect(n).toContain('rival Sleeper')
        expect(n).not.toContain('ESCALATE')
    })
    it('stays compact with a full state (rides every turn)', () => {
        const n = gmNote('run', FULL, dice, 'x')
        // ~4 characters a token for English: ~400 tokens (cl100k) with every slot full (no side chosen yet)
        expect(n.length).toBeLessThan(1550)
    })
    it('stays near 290 tokens with a typical state (arc, beat, one threat, canon) and when seeding', () => {
        const typical = { gm_arc: FULL.gm_arc, gm_beat: FULL.gm_beat, gm_threats: 'Collection | 2/4 | Varn takes the brother', gm_canon: 'Day 3 | the Shore party crosses the labyrinth' }
        expect(gmNote('run', typical, dice, 'x').length).toBeLessThan(1300)
        expect(gmNote("seed", {}, dice, worldFlavour(SS)).length).toBeLessThan(1150)
    })
})

describe('the card\'s own fate die reaches the note', () => {
    const sys = (die: string) => [{ role: 'system', content: `MODULE 10: FATE DICE\nTHIS REPLY'S DICE\n${die}\n* Kind: a stranger.` }, { role: 'user', content: 'Tôi ngồi nghỉ.' }]
    it('reads NEW/quiet (Lord of the Mysteries) and a number under the card\'s own bound (Shadow Slave, Infinite Mailman)', () => {
        expect(cardEvent(sys('* Event: NEW. At a natural pause (arriving somewhere, resting), NEW means something new surfaces'))).toBe(true)
        expect(cardEvent(sys('* Event: quiet. At a natural pause (arriving somewhere, resting), NEW means something new surfaces'))).toBe(false)
        expect(cardEvent(sys('* Event: 9. At a natural pause (arriving, resting, travelling, a day passing), 1–20 means something new surfaces; otherwise the scene goes on.'))).toBe(true)
        expect(cardEvent(sys('* Event: 20. At a natural pause (resting at home), 1–20 means something new surfaces (a person, thing)'))).toBe(true)
        expect(cardEvent(sys('* Event: 21. At a natural pause (resting at home), 1–20 means something new surfaces (a person, thing)'))).toBe(false)
        expect(cardEvent([{ role: 'system', content: 'a card with no fate dice' }, { role: 'user', content: 'x' }])).toBeNull()
        expect(cardEvent([{ role: 'system', content: '* Event: {{randint::1::100}}' }])).toBeNull()
    })
    it('a NEW die is named in the note and outranks a QUIET pace; a quiet one adds nothing', () => {
        const quiet = { pace: 'quiet' as const, surface: 'the goal', consequence: false, canon: false }
        const n = gmNote('run', FULL, { ...quiet, cardNew: true }, 'x')
        expect(n).toContain('QUIET')
        expect(n).toContain('Card fate die: NEW EVENT')
        expect(n).toContain('overrides a QUIET or BUILD pace')
        expect(n.indexOf('Card fate die')).toBeGreaterThan(n.indexOf('Dice: QUIET'))
        expect(gmNote('run', FULL, quiet, 'x')).not.toContain('Card fate die')
        expect(gmNote('run', FULL, { ...quiet, cardNew: true }, 'x').length).toBeLessThan(1550 + 360)
    })
})

describe('the side the player chose (path, enemies, what it gave)', () => {
    it('keeps the path, merges enemies by name, and remembers a side the player left', () => {
        let s = applyGm({}, ['path: Song clan | sworn servant | trusted by a steward\nenemy: Sunny\'s cohort | I sold their route\ngained: a Song token'], 3)
        expect(s.gm_path).toBe('Song clan | sworn servant | trusted by a steward')
        expect(s.gm_enemies).toBe('Sunny\'s cohort | I sold their route')
        expect(s.gm_gained).toBe('a Song token')
        s = applyGm(s, ['enemy: sunny\'s cohort | they hunt me now\ngained: a Memory loaned by the clan'], 4)
        expect(s.gm_enemies).toBe('sunny\'s cohort | they hunt me now')
        expect(s.gm_gained).toBe('a Song token\na Memory loaned by the clan')
        s = applyGm(s, ['path: Nephis\'s cohort | newcomer | distrusted'], 5)
        expect(s.gm_path).toBe('Nephis\'s cohort | newcomer | distrusted')
        expect(s.gm_left).toBe('Song clan | left')
        expect(applyGm(s, ['path: -'], 6).gm_left).toBe('Song clan | left\nNephis\'s cohort | left')
        expect(applyGm(s, ['enemy: sunny\'s cohort | -'], 6).gm_enemies).toBe('')
        // measured: "path: — | — | —" and "path: — | chưa chọn bên | …" were written while no side was taken
        expect(applyGm({}, ['path: — | — | —'], 2).gm_path).toBe('')
        expect(applyGm({}, ['path: chưa chọn bên | - | -'], 2).gm_path).toBe('')
    })
    it('a side newly taken re-seeds the arc from it and sends the GM\'s own antagonist to the background', () => {
        const st: GmState = { gm_arc: 'a debt | Varn | pay | brother', gm_beat: '3 | x | y', gm_threats: 'Collection | 2/4 | z' }
        const s = applyGm(st, ['path: the garrison | new recruit | watched'], 7)
        expect(s.gm_path_at).toBe('7')
        expect(s.gm_arc).toBe('')
        expect(s.gm_beat).toBe('')
        expect(s.gm_threats).toBe('Varn | background | may return\nCollection | 2/4 | z')
        expect(s.gm_past).toContain('set aside for the side')
        // an arc written with the side (the bookkeeper seeding from it) is kept; the old antagonist still steps back
        const k = applyGm(st, ['path: the garrison | recruit | watched\narc: the wall watch | Otto, the sergeant | earn a post | a place inside'], 7)
        expect(k.gm_arc).toBe('the wall watch | Otto, the sergeant | earn a post | a place inside')
        expect(k.gm_threats).toContain('Varn | background')
        // the same side written again is not a new side
        expect(applyGm({ ...k, gm_path_at: '7' }, ['path: the garrison | sergeant\'s man | trusted'], 9).gm_path_at).toBe('7')
    })
    it('the side\'s first order comes due at once and stays the focus for the next beats', () => {
        const st: GmState = { gm_arc: 'a | b | c | d', gm_path: 'the garrison | recruit | low', gm_path_at: '7', gm_beat_at: '7' }
        expect(sideAge(st, 7)).toBe(0)
        for (let i = 0; i < 30; i++) {
            const d = rollGm(st, 7)
            expect(d.firstOrder).toBe(true)
            expect(['advance', 'escalate']).toContain(d.pace)
            expect(d.surface).toBe('the side (the garrison)')
        }
        expect(rollGm(st, 9).surface).toBe('the side (the garrison)')
        expect(rollGm(st, 9).firstOrder).toBeUndefined()
        // a side not here yet (SS 2026-10-19: Nephis's group from inside the First Nightmare): the note asks for a step toward it
        expect(gmNote('run', st, rollGm(st, 7), 'x')).toContain('not here yet: a step toward it')
        expect(gmNote('run', { gm_arc: 'a | b | c | d' }, rollGm({ gm_arc: 'a | b | c | d' }, 7), 'x')).not.toContain('not here yet')
        const later = new Set(Array.from({ length: 200 }, () => rollGm(st, 10).surface))
        expect(later.size).toBeGreaterThan(1)
        expect(sideAge({ gm_path: 'x' }, 5)).toBe(-1)
        const first = gmNote('run', st, rollGm(st, 7), 'x')
        expect(first).toContain('the side\'s first order or test comes due now')
        const seed = gmNote('seed', { gm_path: 'the garrison | recruit | low', gm_path_at: '7' }, rollGm({ gm_path: 'the garrison | recruit | low', gm_path_at: '7' }, 7), 'x')
        expect(seed).toContain('seed it from the side the player took (the garrison)')
        expect(seed).toContain('first order or test, due now')
        expect(seed).not.toContain('never a canon villain')
    })
    it('the note carries the path, its enemies, what it gave and who remembers; without one it says how a side opens', () => {
        const st: GmState = { ...FULL, gm_path: 'Nighthawks | probationary member | trusted by Dunn', gm_enemies: 'the Aurora Order | I burned their altar', gm_gained: 'a revolver', gm_left: 'a heretic cell | left' }
        const n = gmNote('run', st, { pace: 'advance', surface: 'x', consequence: false, canon: false }, 'x')
        expect(n).toContain('Path: Nighthawks | probationary member')
        expect(n).toContain('enemies: the Aurora Order')
        expect(n).toContain('gained: a revolver')
        expect(n).toContain('left: a heretic cell (they remember)')
        expect(n).toContain('its lore entry when present')
        const none = gmNote('run', FULL, { pace: 'quiet', surface: 'x', consequence: false, canon: false }, 'x')
        expect(none).toContain('villains included')
        expect(none).toContain('never a menu')
    })
    it('a chosen side and its enemies surface in the dice', () => {
        const st: GmState = { gm_arc: 'a | b | c | d', gm_path: 'Song clan | servant | low', gm_enemies: 'a rival servant | jealous' }
        const seen = new Set(Array.from({ length: 300 }, () => rollGm(st, 3).surface))
        expect([...seen].some((x) => x.startsWith('the path (Song clan)'))).toBe(true)
        expect(seen.has('the enemy "a rival servant"')).toBe(true)
    })
})

describe('world flavour only from the card', () => {
    it('picks the world like storyWorlds does, generic otherwise', () => {
        expect(worldFlavour({ name: 'Lord of the Mysteries — Fate' })).toContain('Beyonder')
        expect(worldFlavour({ name: 'x', globalLore: [{ comment: 'Module: Delivery World rules' }] })).toContain('mailman')
        expect(worldFlavour(PLAIN)).toContain('rival')
    })
})

describe('the bookkeeper (the submodel keeps the notes the narrator forgot)', () => {
    it('asks with the notes, the player\'s turn and the reply, and names what a side is', () => {
        const p = bookkeepPrompt({ gm_arc: 'a | b | c | d', gm_path: 'Song clan | servant | low' }, 'Tui xin theo đoàn.', 'Lão gật đầu.', 'a rival')
        expect(p).toContain('arc: a | b | c | d')
        expect(p).toContain('path: Song clan | servant | low')
        expect(p).toContain('Tui xin theo đoàn.')
        expect(p).toContain('Lão gật đầu.')
        expect(p).toContain('the villains\' side included')
        expect(p).toContain('never a place, a camp, a route')
        expect(p).toContain('never write "unchanged"')
        expect(p).toContain('never a canon villain')
        expect(stateLines({})).toBe('none')
    })
    it('drops commentary the helper wrote instead of a value (measured)', () => {
        const st: GmState = { gm_arc: 'a | b | c | d', gm_path: 'Marlowe | probation | watched' }
        const s = applyGm(st, ['arc: unchanged (still a)\npath: player avoided the front gate, went back way — did they commit?\nenemy: no change.\nenemy: Whitlock | wants the nail back'], 4)
        expect(s.gm_arc).toBe('a | b | c | d')
        expect(s.gm_path).toBe('Marlowe | probation | watched')
        expect(s.gm_enemies).toBe('Whitlock | wants the nail back')
        expect(applyGm({}, ['beat: 2 | the threat: a wolf at the door | dusk'], 4).gm_beat).toBe('2 | the threat: a wolf at the door | dusk')
        expect(applyGm({}, ['enemy: Aldric — now named. enemy: Aldric, the gate\'s Aspirant | kills me if I open the bar'], 4).gm_enemies).toBe('Aldric, the gate\'s Aspirant | kills me if I open the bar')
        expect(applyGm({}, ['beat: 2 | a knock | who sent him?\nenemy: the cloaked one | do they oppose?'], 4)).toMatchObject({ gm_beat: '2 | a knock | who sent him?', gm_enemies: '' })
    })
    it('reads a block, or bare lines, and nothing else', () => {
        expect(parseBookkeep('ok\n[[GM\npath: the slavers | new hand | watched\n]]')).toEqual(['\npath: the slavers | new hand | watched\n'])
        expect(parseBookkeep('path: the slavers | new hand | watched\nblah')).toEqual(['path: the slavers | new hand | watched'])
        expect(parseBookkeep('Nothing changed.')).toBeNull()
    })
    it('adds to the same reply\'s rollback point: one reroll undoes the narrator\'s and the helper\'s notes', () => {
        const before: GmState = { gm_arc: 'old | A | g | s' }
        const narr = takeGm(before, msg('char', 'x\n[[GM\nbeat: 2 | y | z\n]]', 'r5'), 5)!.state
        const both = applyBookkeep(narr, ['path: the slavers | new hand | watched\nenemy: the girl\'s mother | I sold her child'], 'r5', 5)
        expect(both.gm_path).toBe('the slavers | new hand | watched')
        expect(both.gm_enemies).toContain('the girl\'s mother')
        expect(JSON.parse(both.gm_prev!)).toEqual(before)
        const back = settleGm(both, [msg('char', 'x', 'r4')])
        expect(back.state.gm_path ?? '').toBe('')
        expect(back.state.gm_arc).toBe('old | A | g | s')
        // a reply the narrator left without a block: the helper's notes roll back to the state before it
        const alone = applyBookkeep(before, ['beat: 1 | x | y'], 'r6', 6)
        expect(JSON.parse(alone.gm_prev!)).toEqual(before)
    })
})

describe('going alone is a side (Mailman, 2026-10-19)', () => {
    it('"no group at all, I go alone" is the path đi một mình; turning down one group is not', () => {
        const solo = 'Tôi quyết định rồi: tôi không gia nhập đoàn nào cả, tôi sẽ đi một mình và tự gây dựng tên tuổi bằng những lá thư mình giao.'
        expect(playerSide(solo)).toBe('đi một mình')
        expect(sidePaths([''], {}, solo).join('\n')).toContain('path: đi một mình | tự đi | chưa có tên tuổi')
        expect(playerSide('Tôi không gia nhập nhóm của Nephis.')).toBe('')
        expect(playerSide('Tôi không đi một mình nữa, tôi gia nhập Liệp Cẩu đoàn.')).toBe('Liệp Cẩu đoàn')
        expect(playerSide("I'll go it alone from now on.")).toBe('alone')
        expect(playerSide('Tôi sẽ gia nhập Kẻ Gác Đêm.')).toBe('Kẻ Gác Đêm')
    })
})

// the Mailman chat of 2026-10-20 kept "Đầu gối đau nhói | Đã xảy ra" in gm_consequences_due, and every turn's note named it as due
describe('a due reward or consequence that landed is never due again', () => {
    const dice = rollGm({ gm_arc: 'a', gm_beat: '1 | x | y' }, 3, seq(0.99))
    it('is left out of the note and the helper\'s notes, even when an old state still holds it', () => {
        const s: GmState = { gm_arc: 'bear | hunger | live | knee', gm_beat: '2 | x | y', gm_consequences_due: 'Đầu gối đau nhói | Đã xảy ra', gm_rewards_due: 'năm điểm bưu chính | khi giao xong' }
        expect(gmNote('run', s, dice, 'x')).not.toContain('Đầu gối')
        expect(gmNote('run', s, dice, 'x')).toContain('Reward: năm điểm bưu chính')
        expect(stateLines(s)).not.toContain('Đầu gối')
    })
    it('a "| done" line takes that one off the list and keeps the others', () => {
        const s = applyGm({ gm_rewards_due: 'năm điểm | khi giao xong\na permit | when the ledger is stolen' }, ['reward: Năm điểm | done'], 4)
        expect(s.gm_rewards_due).toBe('a permit | when the ledger is stolen')
        expect(applyGm({ gm_consequences_due: 'knee | soon' }, ['consequence: knee | đã xảy ra'], 4).gm_consequences_due).toBe('')
        expect(bookkeepPrompt({}, 'p', 'r', 'x')).toContain('paid in this reply: reward: <what> | done')
    })
})

