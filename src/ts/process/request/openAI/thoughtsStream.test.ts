import { describe, expect, test } from 'vitest'
import { THINKING_PLACEHOLDER, composeStreamChunk } from './thoughtsStream'

describe('composeStreamChunk', () => {
    test('while only thinking, the text is the same constant however much was thought', () => {
        const a = composeStreamChunk('Đang nghĩ', {})
        const b = composeStreamChunk('Đang nghĩ rất lâu và rất dài', {})
        expect(a["0"]).toBe(THINKING_PLACEHOLDER)
        expect(b["0"]).toBe(a["0"])
    })

    test('once the reply starts, the thoughts and the reply are both there', () => {
        expect(composeStreamChunk('nghĩ', { "0": 'Chào em.' })["0"]).toBe('<Thoughts>\nnghĩ\n</Thoughts>\nChào em.')
    })

    test('no thoughts at all: the reply passes through untouched', () => {
        const readed = { "0": 'Chào em.' }
        expect(composeStreamChunk('', readed)).toBe(readed)
    })

    test('a tool call alone does not count as a reply, but is kept', () => {
        const out = composeStreamChunk('nghĩ', { "__tool_calls": '[{"id":1}]' })
        expect(out["0"]).toBe(THINKING_PLACEHOLDER)
        expect(out["__tool_calls"]).toBe('[{"id":1}]')
    })
})
