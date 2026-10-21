import { describe, expect, it } from 'vitest'
import { finalOf, newTurnKey, planReroll, planSend, prunePending, sseText, turnAnswered, turnInputId } from './turnCore'

const m = (role: string, chatId: string, data = 'x') => ({ role, data, chatId })

describe('turnCore', () => {
    it('a turn key names its chat, and the input id is fixed by the key', () => {
        expect(newTurnKey('chat-1', 'abc-123')).toBe('chat-1:abc-123')
        expect(newTurnKey('bad id', 'abc')).toBeNull()
        expect(turnInputId('chat-1:abc-123')).toBe('abc-123')
    })

    it('planSend: the worker types the input once; a run again cuts only what followed its own input (TurnApply.dfy B)', () => {
        const before = [m('char', 'a'), m('user', 'b'), m('char', 'c')]
        expect(planSend(before, 'in')).toEqual({ typed: false, messages: before })
        const partial = [...before, m('user', 'in'), m('char', 'half')]
        expect(planSend(partial, 'in')).toEqual({ typed: true, messages: [...before, m('user', 'in')] })
        // the old resume cut at an index (slice(0, previousLength)): a message the Mac wrote before the input survives here
        const withMac = [m('char', 'a'), m('user', 'mac-msg'), m('user', 'in')]
        expect(planSend(withMac, 'in').messages).toEqual(withMac)
    })

    it('planReroll: reroll the target, generate when the old reply is gone, nothing when this turn already wrote one', () => {
        expect(planReroll([m('user', 'u'), m('char', 'r1')], 'r1')).toBe('reroll')
        expect(planReroll([m('user', 'u')], 'r1')).toBe('generate')
        expect(planReroll([m('user', 'u'), m('char', 'r2')], 'r1')).toBe('done')
        expect(planReroll([], 'r1')).toBe('done')
    })

    it('turnAnswered: a reply with words after where the turn started', () => {
        const vis = (s: string) => s.replace(/<[^>]*>/g, '')
        expect(turnAnswered([m('user', 'u'), m('char', 'r', 'hello')], 1, vis)).toBe(true)
        expect(turnAnswered([m('user', 'u'), m('char', 'r', '<b></b>')], 1, vis)).toBe(false)
        expect(turnAnswered([m('user', 'u')], 1, vis)).toBe(false)
    })

    it('sseText reads the words of a stream, a line cut in two included', () => {
        const a = 'data: {"choices":[{"delta":{"content":"Xin"}}]}\n\ndata: {"choices":[{"delta":{"content":" chào"}}]}\n\ndata: {"cho'
        expect(sseText(a)).toBe('Xin chào')
        expect(sseText(a + 'ices":[{"delta":{"content":"!"}}]}\n\ndata: [DONE]\n')).toBe('Xin chào!')
    })

    it('finalOf ends on saved, failed and cancelled only', () => {
        expect(finalOf({ type: 'state', state: 'saved' })).toBe('done')
        expect(finalOf({ type: 'state', state: 'failed' })).toBe('error')
        expect(finalOf({ type: 'state', state: 'cancelled' })).toBe('error')
        expect(finalOf({ type: 'state', state: 'retrying' })).toBeNull()
        expect(finalOf({ type: 'state', state: 'generating' })).toBeNull()
    })

    it('prunePending drops stale and malformed notes', () => {
        const now = 10_000_000_000
        const ok = { key: 'c:1', chaId: 'x', chatId: 'c', kind: 'send' as const, text: '', at: now - 1000 }
        expect(prunePending([ok, { ...ok, key: 'c:2', at: now - 49 * 3600_000 }, null as any, { at: now } as any], now)).toEqual([ok])
    })
})
