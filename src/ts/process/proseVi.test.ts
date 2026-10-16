import { describe, expect, it } from 'vitest'
import { storyInVietnamese, viProseRequest, VI_PROSE_REMINDER } from './proseVi'

const VI = 'Một phụ nữ đứng cạnh cửa hầm. Bà khoảng bốn mươi tuổi, tóc nâu buộc chặt sau gáy. Bà giữ một thanh gỗ ngang cửa bằng cả hai tay. Từ phía bên kia, có người đập mạnh ba lần.'
const EN = 'A woman stands by the cellar door. She is about forty, brown hair tied back. She holds a wooden bar across the door with both hands.'

describe('reported: the opening of a Vietnamese story read wrong (no speaker, "một phụ nữ", "có người")', () => {
    it('a story told in Vietnamese is told apart from one in English', () => {
        expect(storyInVietnamese([{ role: 'user', data: 'Có' }, { role: 'char', data: VI }])).toBe(true)
        expect(storyInVietnamese([{ role: 'char', data: EN }])).toBe(false)
        expect(storyInVietnamese([], VI)).toBe(true)                                   // no reply yet: the first message
    })
    it('the reminder goes at the end of the player\'s message, only when on and in Vietnamese', () => {
        const req = [{ role: 'system', content: 's' }, { role: 'user', content: 'Có' }]
        expect(viProseRequest(req, true, true)[1].content).toBe('Có' + VI_PROSE_REMINDER)
        expect(viProseRequest(req, false, true)).toBe(req)
        expect(viProseRequest(req, true, false)).toBe(req)
        expect(VI_PROSE_REMINDER).toContain('mọi câu thoại có tên hoặc cách gọi người nói đứng trước')
    })
})
