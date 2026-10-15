import { describe, expect, it } from 'vitest'
import { allowCoach, DETAIL_BUTTON, detailPrompt, installDetailButton, lessonHtml, parseDetail, parseLesson, parseParts } from './grammarCoach'
import { memoryNote } from './learningMemory'
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

// the answer the story model gave for the detail button (measured 2026-10-15, Korean, 6.8 s)
const KO_DETAIL = 'Đây: {"pattern":"Trạng từ + động từ + 자","words":[{"word":"다시","role":"trạng từ","meaning":"lại, lần nữa","note":""},'
    + '{"word":"침착하게","role":"trạng từ chỉ cách thức","meaning":"một cách bình tĩnh","note":"침착하다 + 게"},{"word":"생각하자","role":"động từ + đuôi câu rủ rê","meaning":"hãy nghĩ","note":"-자 = cùng làm"}],'
    + '"changes":["침착하다 → 침착하게: cần trạng từ để bổ nghĩa cho động từ"]}'

describe('the lesson shows the Việt-ji and a "Chi tiết" button (asked: thêm phiên âm tiếng Việt, nút chi tiết)', () => {
    it('the natural sentence and each part carry their reading', () => {
        const html = splitCheck('Ừ.\n[[CHECK grammar 당신 해야하다 침착하다 → 침착해야 해요 | 침착하다 → 침착해야: phải | 아/어야 하다 = phải]]').note
        expect(html).toContain('🔍 Chi tiết')
        expect(html).toMatch(/침착해야 해요<\/b><span style="[^"]*f2c76b[^"]*">[^<]+<\/span>/)
    })
    it('the Sửa note has the reading and the button too', () => {
        const html = splitCheck('Ừ.\n[[CHECK 먹다 → 마시다 | uống]]').note
        expect(html).toContain('f2c76b')
        expect(html).toContain('🔍 Chi tiết')
    })
    it('reads the measured detail answer, prose around it or not', () => {
        const d = parseDetail(KO_DETAIL)!
        expect(d.words.map((w) => w.word)).toEqual(['다시', '침착하게', '생각하자'])
        expect(d.words[1].role).toBe('trạng từ chỉ cách thức')
        expect(d.changes).toHaveLength(1)
        expect(parseDetail('không có json')).toBe(null)
        expect(parseDetail('{"words":[]}')).toBe(null)
        expect(parseDetail('{"words": [ broken')).toBe(null)
    })
    it('pressing the button hands over the sentence and what was written', () => {
        const div = document.createElement('div')
        div.innerHTML = lessonHtml({ wrote: '당신 해야하다', fix: '침착해야 해요', parts: [], point: '' }).trim()
        document.body.appendChild(div)
        const got: string[][] = []
        const off = installDetailButton((f, w) => got.push([f, w]))
        ;(div.querySelector('[title="Chi tiết ngữ pháp"]') as HTMLElement).click()
        off()
        ;(div.querySelector('[title="Chi tiết ngữ pháp"]') as HTMLElement).click()
        expect(got).toEqual([['침착해야 해요', '당신 해야하다']])
        div.remove()
        expect(DETAIL_BUTTON).toContain('Chi tiết ngữ pháp')
    })
    it('the detail requests are rate limited', () => {
        const t = 10_000_000
        expect(allowCoach(t)).toBe(true)
        expect(allowCoach(t + 500)).toBe(false)                  // too soon
        for (let k = 1; k < 6; k++) expect(allowCoach(t + k * 3_000)).toBe(true)
        expect(allowCoach(t + 20_000)).toBe(false)               // 6 in a minute
        expect(allowCoach(t + 61_000)).toBe(true)
    })
})

describe('reported: "tui nghĩ cô nên bình tĩnh lại" was coached as 다시 침착해야 해요 (again; I think dropped)', () => {
    it('the coach is told to keep every idea and that lại after a verb is not again', () => {
        const note = memoryNote([], [], [], Date.now(), { grammarLater: true })
        expect(note).toContain('keeps every idea')
        expect(note).toContain('bình tĩnh lại = calm down')
        expect(detailPrompt('침착해야 해요', '당신 해야하다 침착하다 다시', 'ko')).toContain('bình tĩnh lại is calm down')
    })
})

describe('reported: the Sửa note of a Chinese reply had no Việt-ji', () => {
    it('with the pinyin list loaded, a Chinese sentence gets its reading', async () => {
        const { readFileSync } = await import('fs')
        const { setHanReadings, phraseVietji } = await import('./vietji')
        setHanReadings(JSON.parse(readFileSync('public/dict/zh-pinyin.json', 'utf8')).words)
        expect(phraseVietji('你怎么问这么蠢的问题？')).toBeTruthy()
        const html = splitCheck('好。\n[[CHECK 我 问 句 什么 蠢 这样 → 你怎么问这么蠢的问题？ | Muốn hỏi "Sao cô hỏi câu ngớ ngẩn thế?"]]').note
        expect(html).toContain('f2c76b')
        setHanReadings(null)
    })
})

describe('reported: some Korean in the explanations had no Việt-ji', () => {
    it('every Korean run in an explanation gets its reading, the text stays escaped', async () => {
        const { readInline } = await import('./grammarCoach')
        const html = readInline('Dạng lịch sự của 아프다; <b>병</b> là bệnh')
        expect(html.match(/f2c76b/g)).toHaveLength(2)
        expect(html).not.toContain('<b>')
        expect(readInline('không có chữ Hàn')).toBe('không có chữ Hàn')
    })
    it('the lesson reads what was written, and the parts\' why', () => {
        const html = lessonHtml({ wrote: '병', fix: '아파요', parts: [{ wrong: '병', right: '아파요', why: '병 là bệnh' }], point: '아프다 = đau' })
        expect(html.match(/f2c76b/g)!.length).toBeGreaterThanOrEqual(5)
    })
})
