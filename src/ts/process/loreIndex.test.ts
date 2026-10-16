import { describe, expect, it } from 'vitest'
import { buildLoreIndex, clearLorePicks, estTokens, fitPicks, hintOf, lorePicked, lorePickPrompt, parseLorePick, pickedIds, planLore, recentText, setLorePicks } from './loreIndex'

const LORE = [
    { comment: 'Module 01 — Random Fate Engine', content: 'rules', alwaysActive: true },
    { comment: 'Ashen Barrow', content: 'A necropolis…' },
    { comment: 'Ashen Barrow', content: 'Its traps…' },
    { comment: 'Elise', content: '' },                                   // empty: never indexed
    { comment: 'Nightmare Creatures', content: 'Creatures…' },
]

describe('the lore index', () => {
    it('keyword entries grouped by title, in order; always-on and empty ones left out', () => {
        expect(buildLoreIndex(LORE).map((it) => ({ title: it.title, ids: it.ids, hint: it.hint }))).toEqual([
            { title: 'Ashen Barrow', ids: [1, 2], hint: 'A necropolis…' }, { title: 'Nightmare Creatures', ids: [4], hint: 'Creatures…' }])
        expect(buildLoreIndex(LORE)[0].tokens).toBe(estTokens('A necropolis…') + estTokens('Its traps…'))
    })
    it('the prompt numbers the titles and carries the last messages', () => {
        const p = lorePickPrompt(buildLoreIndex(LORE), 'STORY: Con vật nằm dưới cửa sập.')
        expect(p).toContain('1. Ashen Barrow\n2. Nightmare Creatures')                    // titles: measured best for the fewest tokens
        expect(lorePickPrompt(buildLoreIndex(LORE), 'x', 12, true)).toContain('1. Ashen Barrow — A necropolis…')
        expect(p).toContain('Con vật nằm dưới cửa sập')
    })
    it('reads the numbers named: in range, once, at most max; none is nothing', () => {
        expect(parseLorePick('2, 1, 2, 9', 2)).toEqual([2, 1])
        expect(parseLorePick('none', 5)).toEqual([])
        expect(parseLorePick('1 2 3 4 5 6 7 8 9 10 11 12 13 14', 14)).toHaveLength(12)
        expect(pickedIds(buildLoreIndex(LORE), [1])).toEqual(new Set([1, 2]))
    })
    it('the last messages without the bar blocks and pictures', () => {
        const t = recentText([{ role: 'user', data: 'hello' }, { role: 'char', data: '{{inlay::x}}Mưa.\n[[REPLIES\na | b\n]]\n[[LOOK Elise | grey]]' }])
        expect(t).toBe('PLAYER: hello\n\nSTORY: Mưa.')
    })
    it('the picks of a turn belong to one character', () => {
        setLorePicks('c1', new Set([3]))
        expect(lorePicked('c1', 3)).toBe(true)
        expect(lorePicked('c2', 3)).toBe(false)
        clearLorePicks()
        expect(lorePicked('c1', 3)).toBe(false)
    })
})

// asked 2026-10-15: one rule for every story, measured on all six cards of the live save
describe('the plan for any card', () => {
    const big = (n: number, size: number) => Array.from({ length: n }, (_, i) => ({ comment: `T${i}`, content: 'lore '.repeat(size / 5) }))
    const always = { comment: 'Rules', content: 'r'.repeat(3900), alwaysActive: true }      // ~1000 tokens
    it('the lore fits what the budget leaves: all of it, no helper call', () => {
        expect(planLore([always, ...big(10, 390)], 5000)).toMatchObject({ mode: 'all' })
    })
    it('too big: the helper picks from the titles', () => {
        const plan = planLore([always, ...big(200, 3900)], 14000)
        expect(plan.mode).toBe('titles')
        expect(plan.room).toBe(14000 - estTokens(always.content))
    })
    it('the picks fill the room in the model\'s order, then last turn\'s, never past it', () => {
        const idx = buildLoreIndex(big(5, 3900))                                          // 1000 tokens each
        expect(fitPicks(idx, [3, 1], [5, 1], 2500)).toEqual([3, 1])                       // 2000 used; 5 would pass the room
        expect(fitPicks(idx, [3], [5, 1], 3100)).toEqual([3, 5, 1])
        expect(fitPicks(idx, [9], [], 5000)).toEqual([])
    })
    it('the hint is the opening sentence', () => {
        expect(hintOf('## Dreamspawn are Nightmare Creatures born of the Spell. They hunt.')).toBe('Dreamspawn are Nightmare Creatures born of the Spell.')
    })
})

describe('reported: with learning mode off the story still had a foreign speaker (Elise did not understand Vietnamese)', async () => {
    const { isLearningOnlyLore } = await import('./loreIndex')
    it('the foreign speaker module, or an entry marked @@learning_only, is learning mode\'s lore', () => {
        expect(isLearningOnlyLore({ comment: 'Module 08 — The Japanese Speaker', content: 'MODULE 08: THE FOREIGN SPEAKER\n\nOne recurring character…' })).toBe(true)
        expect(isLearningOnlyLore({ comment: 'Haru', content: '@@learning_only\nHaru sells string.' })).toBe(true)
        expect(isLearningOnlyLore({ comment: 'Naga Clans / Sea Folk', content: 'deeply foreign: they think differently' })).toBe(false)
        expect(isLearningOnlyLore({ comment: 'White Tower Pathway', content: 'learning speed' })).toBe(false)
    })
})
