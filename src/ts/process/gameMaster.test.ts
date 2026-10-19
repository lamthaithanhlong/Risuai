import { describe, expect, it } from 'vitest'
import {
    applyGm, gmBlocks, gmNote, gmPhase, gmRequest, gmStateOf, isYes, rollGm, settleGm, stripGm, takeGm, worldFlavour, type GmState,
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
    it('a beat that just moved rests; a stalled beat is pushed', () => {
        const at = (since: number) => Array.from({ length: 400 }, () => rollGm({ ...FULL, gm_beat_at: '10' }, 10 + since)).filter((d) => d.pace === 'advance' || d.pace === 'escalate').length / 400
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
