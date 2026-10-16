import { describe, expect, it } from 'vitest'
import { oneSystemMessage } from './oneSystem'

describe('one system message for the Custom API (measured: Codex reads only the first)', () => {
    it('the leading system messages become one; a later one is sent as the user\'s', () => {
        const out = oneSystemMessage([
            { role: 'system', content: 'Main prompt' }, { role: 'system', content: 'Description' },
            { role: 'assistant', content: 'First message' }, { role: 'user', content: 'Có' },
            { role: 'system', content: 'Status window rules (@@depth 0)' }, { role: 'user', content: 'Tui hỏi.' },
        ])
        expect(out.map((m) => m.role)).toEqual(['system', 'assistant', 'user', 'user', 'user'])
        expect(out[0].content).toBe('Main prompt\n\nDescription')
        expect(out[3].content).toBe('system: Status window rules (@@depth 0)')
        expect(out.filter((m) => m.role === 'system')).toHaveLength(1)
    })
    it('no system message, or only one: unchanged', () => {
        const a = [{ role: 'user', content: 'x' }]
        expect(oneSystemMessage(a)).toEqual(a)
        const b = [{ role: 'system', content: 's' }, { role: 'user', content: 'x' }]
        expect(oneSystemMessage(b)).toEqual(b)
    })
    it('a system message with images is kept whole, as the user\'s', () => {
        const out = oneSystemMessage([{ role: 'system', content: 's' }, { role: 'user', content: 'x' }, { role: 'system', content: [{ type: 'image' }] }])
        expect(out[2]).toEqual({ role: 'user', content: [{ type: 'image' }] })
    })
})
