import { describe, expect, test } from 'vitest'
import { wrapThoughts } from '../thoughts'

describe('wrapThoughts', () => {
    test('still thinking: only a Thinking... line, the thought text stays hidden', () => {
        const out = wrapThoughts('<Thoughts>\nĐang nghĩ bí mật…\n</Thoughts>\n', 'CoT')
        expect(out).toContain('Thinking...')
        expect(out).not.toContain('bí mật')
        expect(out).not.toContain('<details')
    })

    test('reply arrived: the block folds and the reply follows', () => {
        expect(wrapThoughts('<Thoughts>\nnghĩ\n</Thoughts>\n*Khang cười* Ngồi đi.', 'CoT'))
            .toBe('<details><summary>CoT</summary>\nnghĩ\n</details>\n*Khang cười* Ngồi đi.')
    })

    test('an unclosed block is left as text', () => {
        expect(wrapThoughts('<Thoughts>nghĩ dở', 'CoT')).toBe('<Thoughts>nghĩ dở')
    })

    test('text without thoughts is untouched', () => {
        expect(wrapThoughts('Chào em.', 'CoT')).toBe('Chào em.')
    })
})
