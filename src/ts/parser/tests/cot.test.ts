import { describe, expect, test } from 'vitest'
import { splitCoT, thoughtText } from '../cot'

const OPEN = '<Thoughts>'
const CLOSE = '</Thoughts>'

// small deterministic generator: random strings built from the pieces that matter
function gen(seed: number): string {
    let s = seed
    const next = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32
    const pieces = [OPEN, CLOSE, '<think>', '</think>', 'abc ', '\n', 'Tôi bước tới. ', '<b>', '</Thought', '<Thoughts', '<thin', '*x*']
    let out = ''
    const n = Math.floor(next() * 14)
    for (let i = 0; i < n; i++) out += pieces[Math.floor(next() * pieces.length)]
    return out
}

describe('splitCoT', () => {
    test('a reply with no thought is returned untouched', () => {
        const r = splitCoT('Chào em.')
        expect(r).toMatchObject({ main: 'Chào em.', thoughts: [], thinking: false })
    })

    test('a closed thought leaves only the reply in main', () => {
        const r = splitCoT(`${OPEN}\nnghĩ\n${CLOSE}\n*Khang cười* Ngồi đi.`)
        expect(r.main).toBe('\n*Khang cười* Ngồi đi.')
        expect(thoughtText(r)).toBe('nghĩ')
        expect(r.thinking).toBe(false)
    })

    test('an unclosed thought is still being written: everything after the tag is the thought', () => {
        const r = splitCoT(`Trước. ${OPEN}đang nghĩ dở`)
        expect(r.main).toBe('Trước. ')
        expect(r.thoughts).toEqual(['đang nghĩ dở'])
        expect(r.thinking).toBe(true)
    })

    test('tags inside a thought stay part of the thought, a stray closing tag is text', () => {
        const r = splitCoT(`${OPEN}a${OPEN}b${CLOSE}c${CLOSE}rest${CLOSE}`)
        expect(r.thoughts).toEqual([`a${OPEN}b${CLOSE}c`])
        expect(r.main).toBe(`rest${CLOSE}`)
    })

    test('several thoughts keep their order', () => {
        const r = splitCoT(`${OPEN}1${CLOSE}x${OPEN}2${CLOSE}y`)
        expect(r.thoughts).toEqual(['1', '2'])
        expect(r.main).toBe('xy')
    })

    test('models that write <think> in the reply: the thought goes to the panel (as in a saved reply)', () => {
        const r = splitCoT('<think>\nNgười dùng nói tiếng Việt.\nĐang cân nhắc.\n</think>\n\nKinh nghiệm đầu tiên.')
        expect(r.thoughts).toEqual(['\nNgười dùng nói tiếng Việt.\nĐang cân nhắc.\n'])
        expect(r.main).toBe('\n\nKinh nghiệm đầu tiên.')
        expect(r.thinking).toBe(false)
    })

    test('<thinking> and a mix of tag kinds', () => {
        const r = splitCoT('<thinking>a</thinking>x<Thoughts>b</Thoughts>y<think>c</think>z')
        expect(r.thoughts).toEqual(['a', 'b', 'c'])
        expect(r.main).toBe('xyz')
    })

    test('<think> still being written, and half of its tag at the end', () => {
        expect(splitCoT('<think>\nđang nghĩ')).toMatchObject({ main: '', thoughts: ['\nđang nghĩ'], thinking: true })
        expect(splitCoT('Trước. <thin').main).toBe('Trước. ')
        expect(splitCoT('<think>nghĩ </thi').thoughts).toEqual(['nghĩ '])
    })

    test('reasoning with the opening tag left out: the text before </think> is the thought', () => {
        const r = splitCoT('nghĩ trước</think>\nTrả lời.')
        expect(r.thoughts).toEqual(['nghĩ trước'])
        expect(r.main).toBe('\nTrả lời.')
        // but not when a thought was already found, and a stray </Thoughts> stays text
        expect(splitCoT('a<think>b</think>c</think>d').main).toBe('acd')
        expect(splitCoT('x</Thoughts>y').main).toBe('x</Thoughts>y')
    })

    test('property: nothing is lost, thoughts never leak into main', () => {
        for (let seed = 1; seed <= 3000; seed++) {
            const d = gen(seed)
            const r = splitCoT(d)
            expect(r.parts.map((p) => p.text).join('')).toBe(d)
            expect(r.parts.filter((p) => p.kind === 'text').map((p) => p.text).join('').replace(/<\/think(?:ing)?>/g, '')).toBe(r.main)
            // an opening tag in main would be a thought that was not taken out
            expect(r.main.includes(OPEN) || r.main.includes('<think>') || r.main.includes('</think>')).toBe(false)
            expect(r.thinking).toBe(r.parts.some((p) => p.unclosed))
            // splitting the displayed text again changes nothing, except that a half tag at its very end is held back
            const again = splitCoT(r.main).main
            expect(r.main.startsWith(again)).toBe(true)
            expect(r.main.length - again.length).toBeLessThan('<thinking>'.length)
        }
    })

    test('streaming: the text typed so far is always a prefix of what the finished reply shows (thought first, reply after)', () => {
        // the shape models produce: one thought, then the reply. Each prefix of the stream must show a prefix of the final reply
        // and a prefix of the final thought, so the panel and the chat only ever grow.
        for (let seed = 1; seed <= 300; seed++) {
            const clean = (x: string) => x.split(OPEN).join('').split(CLOSE).join('').split('<think>').join('').split('</think>').join('')
            const thought = clean(gen(seed))
            const reply = clean(gen(seed + 9000))
            const d = `${OPEN}${thought}${CLOSE}${reply}`
            const full = splitCoT(d)
            for (let cut = 0; cut <= d.length; cut++) {
                const r = splitCoT(d.slice(0, cut))
                expect(full.main.startsWith(r.main.replace(/<$/, ''))).toBe(true)
                // a lone "<" at the end may be the start of the closing tag; it is shown for one chunk
                expect(thought.startsWith(r.thoughts.join('').replace(/<$/, ''))).toBe(true)
            }
        }
    })

    test('linear time: 200 KB of unclosed opening tags is split in well under a second', () => {
        const d = OPEN.repeat(20000)
        const t = performance.now()
        const r = splitCoT(d)
        expect(performance.now() - t).toBeLessThan(500)
        expect(r.thinking).toBe(true)
    })

    test('a 10 800-character thought plus a reply splits in under 5 ms', () => {
        const d = `${OPEN}${'nghĩ '.repeat(2160)}${CLOSE}\n${'Tôi bước tới. '.repeat(100)}`
        const t = performance.now()
        for (let i = 0; i < 100; i++) splitCoT(d)
        expect((performance.now() - t) / 100).toBeLessThan(5)
    })
})
