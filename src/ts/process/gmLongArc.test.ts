// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { CONSEQ_MAX_AGE, MIN_END_TURNS, emotionOf, stampConsequence, dueConsequences, overdueConsequences, forceConsequenceDice, canCloseArc, pickEnding, emotionToneHint, longArcGmBlurb } from './gmLongArc'

describe('gmLongArc', () => {
    test('exports thresholds and identifies emotions', () => {
        expect(CONSEQ_MAX_AGE).toBe(5)
        expect(MIN_END_TURNS).toBe(100)
        expect(emotionOf('wound | tức | @2')).toBe('tức')
    })
    test('stamps and filters landed consequences', () => {
        expect(stampConsequence('wound | tức', 4)).toBe('wound | tức | @4')
        expect(dueConsequences({ gm_consequences_due: 'wound | tức | @1\ndebt | done' })).toEqual(['wound | tức | @1'])
    })
    test('finds overdue consequences and forces their die', () => {
        const state = { gm_beat: '6 | current', gm_consequences_due: 'wound | tức | @1' }
        expect(overdueConsequences(state)).toEqual(['wound | tức | @1'])
        expect(forceConsequenceDice(state, { consequence: false })).toBe(true)
    })
    test('closes only after 100 turns and selects reconciled ending warmly', () => {
        expect(canCloseArc(99)).toBe(false)
        expect(canCloseArc(100)).toBe(true)
        expect(pickEnding({ gm_path: 'hostile faction' }, 'reconciled with the rival')).toBe('warm')
        expect(pickEnding({}, 'the rival betrayed her')).toBe('break')
    })
    test('provides concise emotional guidance and a must-land prompt', () => {
        expect(emotionToneHint('vui')).toContain('joy')
        expect(longArcGmBlurb(100, ['debt | tức | @1'])).toMatch(/must land|phải hạ cánh/i)
    })
})
