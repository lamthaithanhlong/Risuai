import { describe, expect, it } from 'vitest'
import { isOpening, storyEffort } from './storyEffort'

describe('reasoning effort by turn (measured: -56% output tokens after the opening, judged as good)', () => {
    it('the opening keeps the default; every later story turn asks for low', () => {
        expect(storyEffort(isOpening([{ role: 'user' }]), 'model', true)).toBe(undefined)                         // "Có" sent, no reply yet
        expect(storyEffort(isOpening([{ role: 'user' }, { role: 'char' }, { role: 'user' }]), 'model', true)).toBe('low')
    })
    it('not a story turn, another mode, or switched off: the backend default', () => {
        expect(storyEffort(undefined, 'model', true)).toBe(undefined)
        expect(storyEffort(false, 'submodel', true)).toBe(undefined)                                             // the lore picker
        expect(storyEffort(false, 'translate', true)).toBe(undefined)
        expect(storyEffort(false, 'model', false)).toBe(undefined)
    })
    it('a reroll of the opening is still the opening (the reply is removed first)', () => {
        expect(isOpening([])).toBe(true)
        expect(isOpening(undefined)).toBe(true)
    })
    it('a card set to full reasoning keeps the default on every turn (passed as an opening)', () => {
        expect(storyEffort(true, 'model', true)).toBe(undefined)
    })
})
