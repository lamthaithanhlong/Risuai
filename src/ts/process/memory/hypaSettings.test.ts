import { describe, expect, it } from 'vitest'
import { sanitizeHypaV3Settings } from './hypaSettings'

const ok = { maxChatsPerSummary: 6, queryChatCount: 3, memoryTokensRatio: 0.2, extraSummarizationRatio: 0, recentMemoryRatio: 0.4, similarMemoryRatio: 0.4 }

describe('sanitizeHypaV3Settings (specs/core/SummarizeLoop.dfy)', () => {
    it('leaves a valid preset alone', () => {
        expect(sanitizeHypaV3Settings(ok)).toEqual(ok)
    })

    it('never lets maxChatsPerSummary be below 1: 0, negative, NaN, Infinity and fractions all become a positive whole number', () => {
        for (const bad of [0, -5, NaN, Infinity, -Infinity, 0.4, undefined as unknown as number, '3' as unknown as number]) {
            const v = sanitizeHypaV3Settings({ ...ok, maxChatsPerSummary: bad }).maxChatsPerSummary
            expect(Number.isInteger(v) && v >= 1).toBe(true)
        }
        expect(sanitizeHypaV3Settings({ ...ok, maxChatsPerSummary: 2.9 }).maxChatsPerSummary).toBe(2)
    })

    it('never lets queryChatCount be 0, because slice(-0) would query with every chat', () => {
        expect(sanitizeHypaV3Settings({ ...ok, queryChatCount: 0 }).queryChatCount).toBe(1)
        expect(sanitizeHypaV3Settings({ ...ok, queryChatCount: NaN }).queryChatCount).toBe(3)
    })

    it('keeps every ratio finite and inside [0, 1]', () => {
        for (const bad of [NaN, -1, 7, Infinity]) {
            const s = sanitizeHypaV3Settings({ ...ok, memoryTokensRatio: bad, extraSummarizationRatio: bad, recentMemoryRatio: bad, similarMemoryRatio: bad })
            for (const v of [s.memoryTokensRatio, s.extraSummarizationRatio, s.recentMemoryRatio, s.similarMemoryRatio]) {
                expect(Number.isFinite(v) && v >= 0 && v <= 1).toBe(true)
            }
        }
    })

    it('does not touch other fields', () => {
        const s = sanitizeHypaV3Settings({ ...ok, summarizationModel: 'subModel' } as typeof ok & { summarizationModel: string })
        expect(s.summarizationModel).toBe('subModel')
    })

    // Enumerated, not sampled: with doubles, Math.floor(A * r) can be one token below the exact value (100 * 0.29 is 28.999...),
    // but the three floored shares never add up to more than the budget, so MemoryBudget.dfy's bound holds in IEEE arithmetic too.
    it('the floored recent, similar and random shares never exceed the budget in double arithmetic', () => {
        for (let i = 0; i <= 100; i++) {
            for (let j = 0; i + j <= 100; j++) {
                const r = i / 100
                const sim = j / 100
                const rand = 1 - r - sim
                for (let a = 1; a <= 2500; a++) {
                    if (Math.floor(a * r) + Math.floor(a * sim) + Math.floor(a * rand) > a) {
                        throw new Error(`over budget: A=${a} r=${r} s=${sim}`)
                    }
                }
            }
        }
    })
})
