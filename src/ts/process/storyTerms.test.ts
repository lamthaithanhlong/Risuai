import { describe, expect, it } from 'vitest'
import { parseGlossary, termsReminder, termsUsed } from './storyTerms'

const G = parseGlossary('[{"vi": "Tiếng Vọng", "lore": "Echo", "means": "an obedient servant made from a slain creature"}, {"vi": "Ký Ức", "lore": "Memory", "means": "a soul-woven item"}, {"vi": "Khía Cạnh", "lore": "Aspect", "means": "a power"}]')!

describe('the story glossary (measured: "tiếng vọng" understood as an Echo 0/4 -> 4/4)', () => {
    it('finds the terms the player used, whole words, any case', () => {
        expect(termsUsed(G, 'trong lúc đó tui cố tìm tiếng vọng nào quanh đây').map((t) => t.lore)).toEqual(['Echo'])
        expect(termsUsed(G, 'tui hy vọng tìm được tiếng vang hoặc ký ức').map((t) => t.lore)).toEqual(['Memory'])
        expect(termsUsed(G, 'Tui đi tiếp.')).toEqual([])
    })
    it('the reminder names each term and what it means; none when no term is used', () => {
        expect(termsReminder(termsUsed(G, 'tìm tiếng vọng'))).toBe('\n\n[Terms in this story: "Tiếng Vọng" is Echo: an obedient servant made from a slain creature]')
        expect(termsReminder([])).toBe('')
        expect(parseGlossary('not json')).toBe(null)
    })
})
