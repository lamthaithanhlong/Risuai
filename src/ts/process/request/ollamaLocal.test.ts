import { describe, it, expect, vi } from 'vitest'
import { contextCapFor, responseFloorFor, rewriteBudgetFor, withRewriteBudget } from './ollamaLocal'

describe('ollamaLocal', () => {
    it('leaves other models unchanged', () => {
        for (const m of ['ollama-cloud', 'reverse_proxy', 'gpt-4o']) {
            expect(contextCapFor(m, 64000)).toBe(64000)
            expect(responseFloorFor(m, 800)).toBe(800)
            expect(rewriteBudgetFor(m)).toBe(Infinity)
        }
    })
    it('caps the local model', () => {
        expect(contextCapFor('ollama-hosted', 64000)).toBe(30000)
        expect(responseFloorFor('ollama-hosted', 800)).toBe(1000)
        expect(responseFloorFor('ollama-hosted', 1200)).toBe(1200)
        expect(rewriteBudgetFor('ollama-hosted')).toBe(1)
    })
    it('budget 1 allows one rewrite', async () => {
        const redo = vi.fn(async (_n: string) => 'x')
        const warn = vi.fn()
        const w = withRewriteBudget(redo, 1, warn)
        expect(await w('a')).toBe('x')
        expect(await w('b')).toBeNull()
        expect(await w('c')).toBeNull()
        expect(redo).toHaveBeenCalledTimes(1)
        expect(warn).toHaveBeenCalledTimes(2)
    })
})
