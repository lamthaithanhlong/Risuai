import { describe, expect, test } from 'vitest'
import { wrapThoughts } from '../thoughts'

// The first, quadratic implementation, kept as the reference the linear one must agree with.
function wrapThoughtsReference(data: string, label: string): string {
    let result = '', i = 0
    while (i < data.length) {
        if (data.slice(i, i + 10) === '<Thoughts>') {
            let j = i + 10, depth = 1
            while (j < data.length && depth > 0) {
                if (data.slice(j, j + 10) === '<Thoughts>') depth++
                if (data.slice(j, j + 11) === '</Thoughts>') depth--
                j++
            }
            if (depth === 0) {
                const thinking = data.slice(j + 10).trim() === ''
                result += thinking
                    ? `<div class="x-risu-thinking" style="opacity:.65;font-style:italic">Thinking...</div>`
                    : `<details><summary>${label}</summary>${data.substring(i + 10, j - 1)}</details>`
                i = j + 10
                continue
            }
        }
        result += data[i++]
    }
    return result
}


function lcg(seed: number) {
    let s = seed >>> 0
    return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

const PIECES = ['<Thoughts>', '</Thoughts>', 'a', ' ', '\n', 'xin chào', '<Thought', '</Thoughts', '<Thoughts>x']

describe('wrapThoughts agrees with the first implementation', () => {
    test('5000 random strings built from tags, text and broken tags', () => {
        for (let seed = 1; seed <= 5000; seed++) {
            const rnd = lcg(seed)
            const n = Math.floor(rnd() * 14)
            let s = ''
            for (let i = 0; i < n; i++) {
                s += PIECES[Math.floor(rnd() * PIECES.length)]
            }
            expect(wrapThoughts(s, 'CoT'), JSON.stringify(s)).toBe(wrapThoughtsReference(s, 'CoT'))
        }
    })
})

describe('wrapThoughts cost', () => {
    const filler = (n: number) => 'Choi Yoo-jin nghe tiếng ok vọng lại. '.repeat(Math.ceil(n / 37)).slice(0, n)

    test('3,333 unclosed openings in 200 KB (the old one took 4.9 s)', () => {
        const many = Array.from({ length: 3333 }, () => '<Thoughts>' + filler(50)).join('')
        const t0 = performance.now()
        const out = wrapThoughts(many, 'CoT')
        const ms = performance.now() - t0
        expect(out).toBe(many)
        expect(ms).toBeLessThan(150)
    })

    test('3,333 closed blocks followed by a reply', () => {
        const blocks = Array.from({ length: 3333 }, () => '<Thoughts>' + filler(40) + '</Thoughts>').join('') + 'câu trả lời'
        const t0 = performance.now()
        const out = wrapThoughts(blocks, 'CoT')
        const ms = performance.now() - t0
        expect(out.split('<details>').length - 1).toBe(3333)
        expect(ms).toBeLessThan(150)
    })
})
