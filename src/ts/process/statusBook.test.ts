import { describe, expect, it } from 'vitest'
import { applyStatus, parseStatus, statusPrompt, statusSpec } from './statusBook'

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
