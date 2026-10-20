import { describe, expect, it } from 'vitest'
import { applyStatus, counterRises, hasSystemLine, narratorWrites, paidNote, parseStatus, statusPrompt, statusSpec } from './statusBook'

// condensed from the Lord of the Mysteries card's Module 07 (lorebook)
const MODULE07 = `MODULE 07: STATUS PANEL AND LEDGER

A script draws a status panel under your latest reply from hidden blocks you write at the very end of a reply.

[[STATUS
date: năm 1349, chiều
place: Tingen
]]

One key per line, only the keys that changed; "-" clears a key.
* Identity: name; date (in-world date and time of day); place. Update date and place whenever time passes or the character moves.
* seq changes only in the reply where the character drinks the next potion.

CURRENT PANEL (filled by the script from the variables; this is the truth, do not contradict it; "null" means not set yet)
Date: {{getvar::st_date}}; Place: {{getvar::st_place}}
Identity: name={{getvar::st_name}}; seq={{getvar::st_seq}}
Condition: {{getvar::st_condition}}; Items: 1={{getvar::st_item1}}
Refused last change: {{getvar::st_refused}}
Memory: {{getvar::led_mem}}`

const CARD = { globalLore: [{ content: 'Module 01: fate' }, { content: MODULE07 }] }

describe('the status panel bookkeeper', () => {
    it('reads the card\'s keys and rules from its lorebook, never st_refused, and nothing for a card with no panel', () => {
        const spec = statusSpec(CARD)!
        expect(spec.keys).toEqual(['date', 'place', 'name', 'seq', 'condition', 'item1'])
        expect(spec.guide).toContain('Update date and place whenever time passes')
        expect(spec.guide).not.toContain('{{getvar::')
        expect(spec.guide).not.toContain('CURRENT PANEL')
        expect(statusSpec({ globalLore: [{ content: 'no panel here' }] })).toBeNull()
        expect(statusSpec(undefined)).toBeNull()
    })
    it('asks with the panel as it is now and only the card\'s keys', () => {
        const p = statusPrompt(statusSpec(CARD)!, { $st_name: 'Arthur Bell', $st_place: 'Bayam' })
        expect(p).toContain('name: Arthur Bell')
        expect(p).toContain('not set: date, seq, condition, item1')
        expect(p).toContain('Only these keys: date, place, name, seq, condition, item1')
    })
    it('takes the changed keys from the answer as status.lua would: "-" clears, unknown keys and talk ignored', () => {
        const spec = statusSpec(CARD)!
        const vars: Record<string, string> = { $st_place: 'Bayam', $st_item1: 'ví da | 1 bảng' }
        const up = parseStatus('[[GM\nbeat: 2 | x | y\n]]\n[[STATUS\ndate: năm 1350, sáng\nplace: Bayam\ncondition: unchanged\nitem1: -\nhp: 10\nrefused: x\n]]', spec, vars)
        expect(up).toEqual({ date: 'năm 1350, sáng', item1: '' })
        applyStatus(vars, up)
        expect(vars).toEqual({ $st_place: 'Bayam', $st_item1: '', $st_date: 'năm 1350, sáng' })
        expect(parseStatus('nothing changed', spec, vars)).toEqual({})
        expect(parseStatus('[[STATUS\nplace: ' + 'x'.repeat(300) + '\n]]', spec, vars).place).toHaveLength(160)
    })
})

// The owner's Shadow Slave chat, 2026-10-20 (save.story.sqlite + the 9router log): after the first kill the Soul Fragments went
// 0 -> 3 (narrator) -> 8 (helper, the same kill), 8 -> 12 (helper, a turn that only looked through the door), 12 -> 16 (narrator,
// "Con quái không chết"). The replies below are those turns, cut.
const SS07 = `MODULE 07: RUNES AND LEDGER

[[STATUS
frag: 12/1000
]]
* frag (Soul Fragments "x/N").
* a kill of a Nightmare Creature or a human adds a few fragments silently.

CURRENT RUNES (filled by the script from the variables; this is the truth, do not contradict it; "null" means not set yet)
Runes: frag={{getvar::st_frag}}; place={{getvar::st_place}}; points={{getvar::st_points}}; condition={{getvar::st_condition}}`
const KILL = 'Viên cuối xuyên qua hốc mắt, và tiếng gầm tắt giữa chừng.\n\n[Ngươi đã giết một Thú Ngủ Say, Kẻ Rình Khe.]\n\nNgười đàn ông cầm giáo vẫn ghì vai vào tấm cửa nứt.'
const LOOK = 'Kenji nhìn xuyên qua cánh cửa nứt.\n\nMột xác xám nằm co quắp sát chân tường, hốc mắt thủng lỗ chỗ vì những viên đá vừa bắn trúng.'
const NOT_DEAD = 'Viên đá xoáy vụt đi, trúng con vật đang bò sát nền.\n\nCon quái không chết. Nó húc vào cánh cửa bằng vai.\n\n[💡Kế hoạch| Không ]'

describe('a reward is paid once', () => {
    const spec = statusSpec({ globalLore: [{ content: SS07 }] })!
    it('knows a system line: the Spell\'s bracket line, not the plan line or a block', () => {
        expect(hasSystemLine(KILL)).toBe(true)
        expect(hasSystemLine('*[Ngươi đã nhận được một Ký Ức: Dao Găm.]*')).toBe(true)
        expect(hasSystemLine(LOOK)).toBe(false)
        expect(hasSystemLine(NOT_DEAD)).toBe(false)
        expect(hasSystemLine('[[STATUS\nfrag: 3/1000\n]]')).toBe(false)
        expect(counterRises('8/1000', '12/1000')).toBe(true)
        expect(counterRises('12', '9')).toBe(false)
        expect(counterRises('', '0/1000')).toBe(false)
    })
    it('the helper never pays again what the narrator wrote for this reply (the kill turn: 3 -> 8)', () => {
        const vars = { $st_frag: '3/1000' }
        expect(parseStatus('[[STATUS\nfrag: 8/1000\n]]', spec, vars, { reply: KILL, written: { frag: '3/1000' } })).toEqual({})
        // the narrator forgot the block: the helper pays the kill, once
        expect(parseStatus('[[STATUS\nfrag: 3/1000\n]]', spec, { $st_frag: '0/1000' }, { reply: KILL })).toEqual({ frag: '3/1000' })
    })
    it('a counter goes up only in a reply with a system line; down always (8 -> 12 on a look, points spent)', () => {
        expect(parseStatus('[[STATUS\nfrag: 12/1000\nplace: hành lang\n]]', spec, { $st_frag: '8/1000' }, { reply: LOOK })).toEqual({ place: 'hành lang' })
        expect(parseStatus('[[STATUS\npoints: 9\n]]', spec, { $st_points: '12' }, { reply: 'Tôi dán tem, điểm trừ đi.' })).toEqual({ points: '9' })
    })
    it('the narrator\'s own counter rise with no event goes back (12 -> 16 on "Con quái không chết"); with the kill it stays', () => {
        const before = { frag: '12/1000', place: '', points: '', condition: '' }
        expect(narratorWrites(spec, before, { $st_frag: '16/1000', $st_condition: 'không có thương tích' }, NOT_DEAD))
            .toEqual({ unpaid: { frag: '12/1000' }, written: { condition: 'không có thương tích' } })
        expect(narratorWrites(spec, { ...before, frag: '0/1000' }, { $st_frag: '3/1000' }, KILL)).toEqual({ unpaid: {}, written: { frag: '3/1000' } })
    })
    it('asks with the reply before it and what the story already wrote', () => {
        const p = statusPrompt(spec, { $st_frag: '3/1000' }, { previous: LOOK, written: { frag: '3/1000' } })
        expect(p).toContain('THE REPLY BEFORE IT (everything it showed is already on the panel):\nKenji nhìn xuyên')
        expect(p).toContain('leave them out: frag: 3/1000')
        expect(p).toContain('A gain is paid once')
    })
})

describe('the next request is told what the last reply already counted', () => {
    it('names the amounts that moved (LotM: six pence of wages became 12, 18, 24 when it was not)', () => {
        expect(paidNote({ money: '', place: 'Tingen' }, { money: '6 pence', place: 'Backlund' })).toBe('\n\n[Panel (hidden): the last reply already counted money — → 6 pence; a gain or payment is counted once, only for what happens in this reply.]')
        expect(paidNote({ money: '6 pence' }, { money: '6 pence' })).toBe('')
        expect(paidNote(undefined, { money: '6 pence' })).toBe('')
    })
})
