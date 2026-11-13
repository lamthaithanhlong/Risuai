import { describe, expect, it } from 'vitest'
import { AUTOCOMPACT_MIN, compactLimit, memoryPhaseOn, parseAutocompactArg, pickCompactChunks } from './compact'

const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ chatId: 'm' + i, role: i % 2 ? 'char' : 'user', data: 'text ' + i }))
const ids = (chunks: { chatId?: string }[][]) => chunks.map((c) => c.map((m) => m.chatId))

describe('compactLimit: the token count HypaV3 starts summarising at', () => {
    it('is the model context when autocompact is off or has no number', () => {
        expect(compactLimit(30000, false, 12000)).toBe(30000)
        expect(compactLimit(30000, true, 0)).toBe(30000)
        for (const bad of [NaN, -5, Infinity, undefined as unknown as number, '9000' as unknown as number]) {
            expect(compactLimit(30000, true, bad)).toBe(30000)
        }
    })
    it('is the owner\'s number when that is lower than the context', () => {
        expect(compactLimit(30000, true, 12000)).toBe(12000)
        expect(compactLimit(30000, true, 12000.9)).toBe(12000)
    })
    it('never goes above the context and never below the floor', () => {
        expect(compactLimit(30000, true, 250000)).toBe(30000)
        expect(compactLimit(30000, true, 10)).toBe(AUTOCOMPACT_MIN)
        expect(compactLimit(2000, true, 10)).toBe(2000)
    })
})

describe('memoryPhaseOn: when a request goes through the memory phase', () => {
    it('always for a card whose own switch is on', () => {
        expect(memoryPhaseOn({ cardSwitch: true, autoCompact: false, hasSummaries: false, currentTokens: 1, limit: 30000 })).toBe(true)
    })
    it('for a card with the switch off: only with autocompact on AND (over the limit or already compacted)', () => {
        const base = { cardSwitch: false, autoCompact: true, hasSummaries: false, currentTokens: 100, limit: 30000 }
        expect(memoryPhaseOn(base)).toBe(false)
        expect(memoryPhaseOn({ ...base, currentTokens: 30001 })).toBe(true)
        expect(memoryPhaseOn({ ...base, hasSummaries: true })).toBe(true)
        expect(memoryPhaseOn({ ...base, autoCompact: false, currentTokens: 99999, hasSummaries: true })).toBe(false)
    })
})

describe('pickCompactChunks: which messages /compact summarises', () => {
    it('takes everything but the last `keep` messages, in chunks of `per`, in order', () => {
        expect(ids(pickCompactChunks(msgs(10), new Set(), 3, 3))).toEqual([['m0', 'm1', 'm2'], ['m3', 'm4', 'm5'], ['m6']])
    })
    it('starts after the last message a summary already covers', () => {
        expect(ids(pickCompactChunks(msgs(10), new Set(['m0', 'm1', 'm3']), 2, 4))).toEqual([['m4', 'm5', 'm6', 'm7']])
    })
    it('gives nothing when the chat is no longer than `keep`, or all of it is covered', () => {
        expect(pickCompactChunks(msgs(3), new Set(), 3, 6)).toEqual([])
        expect(pickCompactChunks(msgs(6), new Set(['m3']), 2, 6)).toEqual([])
    })
    it('never puts a message in two chunks and never loops on a bad chunk size', () => {
        for (const per of [0, -1, NaN, 1, 2, 7]) {
            const flat = pickCompactChunks(msgs(9), new Set(), 1, per).flat().map((m) => m.chatId)
            expect(flat).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'])
        }
    })
    it('skips empty messages but does not let them break the order', () => {
        const m = msgs(6); m[1].data = '   '
        expect(ids(pickCompactChunks(m, new Set(), 1, 10))).toEqual([['m0', 'm2', 'm3', 'm4']])
    })
})

describe('parseAutocompactArg: /autocompact <arg>', () => {
    it('reads a number, with k and separators', () => {
        expect(parseAutocompactArg('20000')).toEqual({ kind: 'set', tokens: 20000 })
        expect(parseAutocompactArg('20k')).toEqual({ kind: 'set', tokens: 20000 })
        expect(parseAutocompactArg(' 1.5K ')).toEqual({ kind: 'set', tokens: 1500 })
        expect(parseAutocompactArg('20,000')).toEqual({ kind: 'set', tokens: 20000 })
    })
    it('reads on, off and nothing', () => {
        expect(parseAutocompactArg('')).toEqual({ kind: 'show' })
        for (const w of ['off', 'OFF', 'tắt', 'tat']) expect(parseAutocompactArg(w)).toEqual({ kind: 'off' })
        for (const w of ['on', 'bật', 'bat']) expect(parseAutocompactArg(w)).toEqual({ kind: 'on' })
    })
    it('refuses anything else instead of guessing', () => {
        for (const w of ['abc', '-5', '0', '12 34', 'k']) expect(parseAutocompactArg(w)).toEqual({ kind: 'bad' })
    })
})
