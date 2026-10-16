import { describe, expect, it } from 'vitest'
import { replyShape, shapeReminder, shapeRequest, storyShape } from './replyFormat'

const STATUS = '☆ [Date: 2025-10-05 (Sun) | Time: Evening | Location: Bus 70 | EXP: 50 / 200 | SP: 17 / 100]'
const PROFILE = '[💡Request Profile| None ]'
const AH = (body = 'Xe xóc qua một ổ gà.\n\nÔng mặc áo khoác xám quay sang.') => `<Thoughts>\nplan\n</Thoughts>\n${body}\n\n${PROFILE}\n\n${STATUS}`

describe('the shape of a story\'s replies (asked: for every story)', () => {
    it('the panels at the end of an Alternate Hunters reply, in their order', () => {
        expect(replyShape(AH())).toEqual({ head: [], tail: ['[💡Request Profile|', '☆ [Date:'] })
    })
    it('in-story system text and script blocks are not a shape (Shadow Slave, Lord of the Mysteries)', () => {
        expect(replyShape('{{image::cellar.jpg}}\n\nCánh cửa biến mất.\n\n[Ngươi đã bước vào Cơn Ác Mộng Đầu Tiên.]\n\nChị gật đầu.\n\n[[STATUS\nhp: 70\n]]')).toEqual({ head: [], tail: [] })
        expect(shapeReminder(replyShape('Chỉ có truyện.\n\nHết.'))).toBe('')
    })
    it('the shape most recent replies share, not the last one alone (it had lost its status line)', () => {
        const lost = `Một đoạn.\n\nHai đoạn.\n\n${PROFILE}`
        expect(storyShape([AH(), AH(), AH(), lost]).tail).toEqual(['[💡Request Profile|', '☆ [Date:'])
        expect(storyShape([AH()]).tail).toEqual([])                                   // one reply is not a rule
    })
    it('the reminder goes at the end of the player\'s message', () => {
        const req = [{ role: 'system', content: 's' }, { role: 'user', content: 'Tui hỏi.' }]
        const out = shapeRequest(req, [{ role: 'char', data: AH() }, { role: 'user', data: 'a' }, { role: 'char', data: AH() }])
        expect(out[1].content).toContain('end with "[💡Request Profile| …]", then "☆ [Date: …]", in this order')
        expect(shapeRequest(req, [{ role: 'char', data: 'truyện' }, { role: 'char', data: 'truyện' }])).toBe(req)
    })
})
