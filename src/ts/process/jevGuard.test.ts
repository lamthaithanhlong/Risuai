import { describe, expect, test } from 'vitest'
import { buildQuestions, decide, shouldDraw, toState } from './jevGuardCore'

const all = { guard: true, vietnamese: true, draw: true }

describe('jevGuard.decide', () => {
    const q = buildQuestions('Kenji Park', all)

    test('passes a clean reply', () => {
        const v = decide({ speaksForUser: 0.1, outOfCharacter: 0.05, vietnamese: 0.95, worthDrawing: 0.1 }, q, 0.7)
        expect(v.ok).toBe(true)
    })

    test('fails when the reply speaks for the user', () => {
        expect(decide({ speaksForUser: 0.82, outOfCharacter: 0.05, vietnamese: 0.95 }, q, 0.7).failed).toEqual(['speaksForUser'])
    })

    test('fails a non-Vietnamese reply on the low side', () => {
        expect(decide({ speaksForUser: 0.1, outOfCharacter: 0.1, vietnamese: 0.2 }, q, 0.7).failed).toEqual(['vietnamese'])
    })

    test('a dull scene is not a fault in the reply', () => {
        expect(decide({ speaksForUser: 0.1, outOfCharacter: 0.1, vietnamese: 0.9, worthDrawing: 0.01 }, q, 0.7).ok).toBe(true)
    })

    test('a missing answer is not a failure', () => {
        expect(decide({ outOfCharacter: 0.1 }, q, 0.7).ok).toBe(true)
    })
})

describe('jevGuard.buildQuestions', () => {
    test('the Vietnamese check is dropped when auto-translate shows Vietnamese anyway', () => {
        expect(Object.keys(buildQuestions('Kenji Park', { guard: true, vietnamese: false, draw: false }))).toEqual(['speaksForUser', 'outOfCharacter'])
    })

    test('image gate alone asks only the drawing question', () => {
        expect(Object.keys(buildQuestions('Kenji Park', { guard: false, vietnamese: true, draw: true }))).toEqual(['worthDrawing'])
    })
})

describe('jevGuard.shouldDraw', () => {
    test('draws a striking scene', () => {
        expect(shouldDraw({ worthDrawing: 0.8 }, 0.5)).toBe(true)
    })

    test('skips routine dialogue', () => {
        expect(shouldDraw({ worthDrawing: 0.2 }, 0.5)).toBe(false)
    })

    test('draws when Jev could not answer', () => {
        expect(shouldDraw(null, 0.5)).toBe(true)
        expect(shouldDraw({ speaksForUser: 0.1 }, 0.5)).toBe(true)
    })
})

describe('jevGuard.toState', () => {
    test('strips card styling, markup and image placeholders', () => {
        expect(toState('<style>.a{color:red}</style><div class="a">*Anh cười* Chào em</div> <ImgGen="cafe, night"> {{inlay::abc}}')).toBe('*Anh cười* Chào em')
    })

    test('caps the state at 4000 chars', () => {
        expect(toState('a'.repeat(5000))).toHaveLength(4000)
    })
})
