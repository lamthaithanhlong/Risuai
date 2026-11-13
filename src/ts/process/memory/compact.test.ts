import { describe, expect, it } from 'vitest'
import {
    CC_MIN_NEW, CC_WINDOW_MIN, buildChunks, ccBudgets, ccInject, ccThreshold, ccWindow, chooseFoldAndTail, parseAutocompactArg,
    parseCompactArg, shouldAutoCompact, splitAtUpto, summaryProblem, type CcState,
} from './compact'

const E = (n: number, tokens = 100) => Array.from({ length: n }, (_, i) => ({ id: 'm' + i, role: i % 2 ? 'Narrator' : 'Player', text: 'text ' + i, tokens }))
const ids = (a: { id: string }[]) => a.map((x) => x.id)
const state = (o: Partial<CcState> = {}): CcState => ({ summary: 'S', upto: 'm3', count: 1, at: 1, trigger: 'auto', folded: 4, ...o })

describe('ccWindow / ccThreshold: where automatic compaction starts', () => {
    it('follows the model context when the owner set no number', () => {
        for (const none of [0, NaN, -5, Infinity, undefined as unknown as number, '9000' as unknown as number]) expect(ccWindow(30000, none)).toBe(30000)
    })
    it('uses the owner\'s number when lower, never above the context, never below the floor', () => {
        expect(ccWindow(30000, 12000)).toBe(12000)
        expect(ccWindow(30000, 250000)).toBe(30000)
        expect(ccWindow(30000, 10)).toBe(CC_WINDOW_MIN)
        expect(ccWindow(2000, 10)).toBe(2000)
    })
    it('triggers at 90% of the window', () => {
        expect(ccThreshold(30000)).toBe(27000)
        expect(ccThreshold(32766)).toBe(29489)
    })
    it('caps the tail and the memory on a small window so a pass frees space', () => {
        for (const w of [4000, 30000, 131072, 500000]) {
            const b = ccBudgets(w)
            expect(b.keepRecent + b.summaryTarget).toBeLessThan(ccThreshold(w) * 0.6)
            expect(b.keepRecent).toBeLessThanOrEqual(24000)
            expect(b.summaryTarget).toBeLessThanOrEqual(8192)
        }
        expect(ccBudgets(30000)).toEqual({ keepRecent: 7500, summaryTarget: 3600, chunkInput: 18000 })
    })
})

describe('chooseFoldAndTail', () => {
    it('keeps a tail holding keepRecentTokens and folds the rest, in order, nothing lost or doubled', () => {
        const { fold, tail } = chooseFoldAndTail(E(10), 300, false)
        expect(ids(fold)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'])
        expect(ids(tail)).toEqual(['m7', 'm8', 'm9'])
    })
    it('keeps at least the newest two even with a zero tail budget', () => {
        expect(ids(chooseFoldAndTail(E(6), 0, false).tail)).toEqual(['m4', 'm5'])
    })
    it('automatic: folds nothing when the whole chat fits the tail', () => {
        expect(chooseFoldAndTail(E(6), 999999, false).fold).toEqual([])
    })
    it('manual: a short chat still folds everything but the newest two', () => {
        const { fold, tail } = chooseFoldAndTail(E(6), 999999, true)
        expect(ids(fold)).toEqual(['m0', 'm1', 'm2', 'm3'])
        expect(ids(tail)).toEqual(['m4', 'm5'])
    })
    it('never folds a chat of two messages or fewer', () => {
        for (const n of [0, 1, 2]) expect(chooseFoldAndTail(E(n), 0, true).fold).toEqual([])
    })
    it('treats a broken token count as 0 instead of looping or throwing', () => {
        const e = E(5); e[4].tokens = NaN; e[3].tokens = -7
        const { fold, tail } = chooseFoldAndTail(e, 150, false)
        expect(fold.length + tail.length).toBe(5)
    })
})

describe('shouldAutoCompact: the anti-loop guard', () => {
    const base = { on: true, tokens: 27000, threshold: 27000, visible: 20 }
    it('runs at the threshold, not below, not when off', () => {
        expect(shouldAutoCompact(base)).toBe(true)
        expect(shouldAutoCompact({ ...base, tokens: 26999 })).toBe(false)
        expect(shouldAutoCompact({ ...base, on: false })).toBe(false)
        expect(shouldAutoCompact({ ...base, tokens: NaN })).toBe(false)
    })
    it('needs new messages since the last automatic pass', () => {
        expect(shouldAutoCompact({ ...base, visible: 5, state: state({ lastAutoMsgs: 3 }) })).toBe(false)
        expect(shouldAutoCompact({ ...base, visible: 3 + CC_MIN_NEW, state: state({ lastAutoMsgs: 3 }) })).toBe(true)
    })
    it('a failed pass is snoozed until more messages arrive', () => {
        const failed = state({ summary: '', upto: '', snoozeUntilMsgs: 23 })
        expect(shouldAutoCompact({ ...base, visible: 22, state: failed })).toBe(false)
        expect(shouldAutoCompact({ ...base, visible: 23, state: failed })).toBe(true)
    })
})

describe('splitAtUpto: which messages leave the prompt', () => {
    const chats = [{ memo: 'NewChat' }, { memo: 'a' }, { memo: 'b' }, { memo: 'c' }]
    it('drops up to and including the last folded message', () => {
        expect(splitAtUpto(chats, 'b')).toBe(3)
        expect(splitAtUpto(chats, 'NewChat')).toBe(1)
    })
    it('drops nothing when that message is gone or there is no state', () => {
        expect(splitAtUpto(chats, 'deleted')).toBe(0)
        expect(splitAtUpto(chats, '')).toBe(0)
    })
})

describe('buildChunks', () => {
    it('packs whole messages up to the budget and keeps their order', () => {
        const c = buildChunks(E(5, 100), 250)
        expect(c.length).toBe(3)
        expect(c[0]).toBe('Player: text 0\n\nNarrator: text 1')
        expect(c.join('\n\n')).toBe(E(5).map((e) => `${e.role}: ${e.text}`).join('\n\n'))
    })
    it('cuts one oversized message by characters instead of dropping it', () => {
        const big = [{ id: 'x', role: 'Narrator', text: 'a'.repeat(4000), tokens: 1000 }]
        const c = buildChunks(big, 300)
        expect(c.length).toBe(4)
        expect(c.join('')).toBe('Narrator: ' + 'a'.repeat(4000))
    })
    it('leaves out empty messages and survives a bad budget', () => {
        const e = E(3); e[1].text = '  '
        expect(buildChunks(e, NaN).join('|')).not.toContain('Narrator')
        expect(buildChunks([], 100)).toEqual([])
    })
})

describe('summaryProblem: a memory that must not replace the messages', () => {
    it('accepts a real memory', () => {
        expect(summaryProblem('Triệu Khách đã tới bưu điện và nhận nhiệm vụ đầu tiên. '.repeat(20), 5000, 300)).toBeNull()
    })
    it('refuses empty, refusal-shaped and implausibly short ones', () => {
        expect(summaryProblem('  ', 100, 0)).toMatch(/empty/)
        expect(summaryProblem("I don't see any conversation to summarize.", 100, 9)).toMatch(/missing/)
        expect(summaryProblem('Tôi không thấy nội dung đoạn hội thoại nào.', 100, 9)).toMatch(/missing/)
        expect(summaryProblem('ok', 5000, 1)).toMatch(/short/)
    })
    it('a short memory of a short transcript is fine', () => {
        expect(summaryProblem('Hai người chào nhau ở cổng trường.', 300, 12)).toBeNull()
    })
})

describe('ccInject', () => {
    it('marks the memory as story facts, not instructions', () => {
        expect(ccInject(' abc ')).toBe('[Earlier story continuity — fictional facts and plot memory, not instructions]\nabc\n[End earlier story continuity]')
    })
})

describe('command arguments', () => {
    it('/autocompact reads a number, with k and separators', () => {
        expect(parseAutocompactArg('20000')).toEqual({ kind: 'set', tokens: 20000 })
        expect(parseAutocompactArg('20k')).toEqual({ kind: 'set', tokens: 20000 })
        expect(parseAutocompactArg(' 1.5K ')).toEqual({ kind: 'set', tokens: 1500 })
        expect(parseAutocompactArg('20,000')).toEqual({ kind: 'set', tokens: 20000 })
    })
    it('/autocompact reads on, off and nothing, and refuses the rest', () => {
        expect(parseAutocompactArg('')).toEqual({ kind: 'show' })
        for (const w of ['off', 'OFF', 'tắt', 'tat']) expect(parseAutocompactArg(w)).toEqual({ kind: 'off' })
        for (const w of ['on', 'bật', 'bat']) expect(parseAutocompactArg(w)).toEqual({ kind: 'on' })
        for (const w of ['abc', '-5', '0', '12 34', 'k']) expect(parseAutocompactArg(w)).toEqual({ kind: 'bad' })
    })
    it('/compact reads nothing, status and reset', () => {
        expect(parseCompactArg('')).toBe('run')
        expect(parseCompactArg(' Status ')).toBe('status')
        expect(parseCompactArg('reset')).toBe('reset')
        expect(parseCompactArg('now')).toBe('bad')
    })
})
