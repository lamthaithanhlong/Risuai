import { describe, expect, it } from 'vitest'
import { lessonHtml, parseLesson, parseParts } from './grammarCoach'
import { parseCheck, splitCheck } from './learningMemory'

// the check lines the story model wrote when asked (2026-10-15)
const ZH = '[[CHECK grammar 她 是 傻 → 她很傻 | 是 → 很: Tính từ như 傻 thường đi sau 很, không đi sau 是; 她 → 她: đúng vị trí chủ ngữ | Nói “cô ấy ngốc”: dùng 她很傻.]]'
const ES = '[[CHECK grammar yo pienso ella es tonta → Yo pienso que ella es tonta. | pienso ella → pienso que ella: cần «que» để nối ý nghĩ với câu theo sau | Sau «pienso», dùng «que» trước một câu hoàn chỉnh.]]'

describe('the grammar lesson under a reply (asked: after sending, how it should be said and why, for every language)', () => {
    it('reads the sentence, each part with why, and the point', () => {
        const c = parseCheck('Haru cười.\n' + ZH) as any
        expect(c).toMatchObject({ grammar: true, wrong: '她 是 傻', right: '她很傻', why: 'Nói “cô ấy ngốc”: dùng 她很傻.' })
        expect(c.parts[0]).toEqual({ wrong: '是', right: '很', why: 'Tính từ như 傻 thường đi sau 很, không đi sau 是' })
        expect((parseCheck(ES) as any).parts[0].right).toBe('pienso que ella')
    })
    it('shows "nên nói", each part and why, and what to remember, under the reply', () => {
        const { main, note } = splitCheck('Haru cười.\n' + ZH)
        expect(main).toBe('Haru cười.')
        expect(note).toContain('Ngữ pháp · nên nói:')
        expect(note).toContain('<b>她很傻</b>')
        expect(note).toContain('<s style="opacity:.65">是</s> → <b>很</b>')
        expect(note).toContain('Nhớ:')
    })
    it('the older two-field form still reads, as the point', () => {
        expect(parseLesson('a → b | trật tự')).toEqual({ wrote: 'a', fix: 'b', parts: [], point: 'trật tự' })
        expect(parseLesson('a → b | x → y: vì sao')).toMatchObject({ parts: [{ wrong: 'x', right: 'y', why: 'vì sao' }], point: '' })
    })
    it('never more than three parts, and nothing breaks the HTML', () => {
        expect(parseParts('a → b; c → d; e → f; g → h')).toHaveLength(3)
        expect(lessonHtml({ wrote: '<x>', fix: '"y"', parts: [], point: '' })).not.toContain('<x>')
    })
})
