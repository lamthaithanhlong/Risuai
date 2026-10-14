import { describe, expect, test } from 'vitest'
import { composeStreamChunk } from './thoughtsStream'
import { splitCoT } from '../../../parser/cot'

describe('composeStreamChunk', () => {
    test('while only thinking, the thought is in the message as an open block that grows with every chunk', () => {
        const a = composeStreamChunk('Đang nghĩ', {})["0"]
        const b = composeStreamChunk('Đang nghĩ rất lâu và rất dài', {})["0"]
        expect(a).toBe('<Thoughts>\nĐang nghĩ')
        expect(b.startsWith(a)).toBe(true)
        expect(splitCoT(b)).toMatchObject({ main: '', thinking: true })
        expect(splitCoT(b).thoughts.join('')).toContain('rất dài')
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
        expect(splitCoT(out["0"]).main).toBe('')
        expect(splitCoT(out["0"]).thinking).toBe(true)
        expect(out["__tool_calls"]).toBe('[{"id":1}]')
    })

    test('a stream of chunks: the thought only grows, the reply starts after it, the chat text never contains the thought', () => {
        const thought = 'Người dùng thở dài. Cân nhắc cảnh tiếp theo. '.repeat(40)
        const reply = 'Bụi giấy bùng lên theo từng bước chân. '.repeat(10)
        let prevThought = ''
        let prevMain = ''
        const seen: string[] = []
        for (let i = 1; i <= thought.length; i += 37) {
            const split = splitCoT(composeStreamChunk(thought.slice(0, i), {})["0"])
            const t = split.thoughts.join('')
            expect(t.startsWith(prevThought.trimEnd())).toBe(true)
            expect(split.main).toBe('')
            prevThought = t
            seen.push(t)
        }
        for (let j = 1; j <= reply.length; j += 29) {
            const split = splitCoT(composeStreamChunk(thought, { "0": reply.slice(0, j) })["0"])
            expect(split.thoughts.join('').trim()).toBe(thought.trim())
            expect(split.main.trim().startsWith(prevMain.trim())).toBe(true)
            expect(split.main).not.toContain('Người dùng')
            expect(split.thinking).toBe(false)
            prevMain = split.main
        }
        expect(seen.length).toBeGreaterThan(5)
    })
})
