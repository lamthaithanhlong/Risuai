import { describe, expect, it } from 'vitest'
import { playerWritesVietnamese, storyInVietnamese, viProseReminder, viProseRequest, wantsVietnameseProse } from './proseVi'

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
        expect(viProseRequest(req, true, true, 'Kenji Park')[1].content).toBe('Có' + viProseReminder('Kenji Park'))
        expect(viProseRequest(req, false, true)).toBe(req)
        expect(viProseRequest(req, true, false)).toBe(req)
    })
    it("the measured rules: the player's own lines named too, the emoji before the name, a sound not 'ai đó', ages in numbers", () => {
        const r = viProseReminder('Kenji Park')
        expect(r).toContain('kể cả lời nhân vật chính (Kenji Park hỏi: “…”)')     // the 3-4 speakerless lines left were the player's
        expect(r).toContain('😨 Người phụ nữ thì thào: “…”')                       // not "Người phụ nữ 😨 thì thào"
        expect(r).toContain('không khẳng định "có người" hay "ai đó"')
        expect(r).toContain('người 40 tuổi với người 25 tuổi là chị hoặc cô, không phải bà')
        expect(viProseReminder()).toContain('(nhân vật chính hỏi: “…”)')          // no persona name: still a sentence
        // across models: DeepSeek obeyed the emoji module over the reminder (14 speakerless -> 1 once it says it wins)
        expect(r).toContain('kể cả khi luật emoji ở trên bảo đặt emoji ngay trước lời thoại — luật này thắng')
        expect(r).toContain('không kể vị, mùi, cảm giác hay ý nghĩ trong đầu người khác')   // MiniMax POV 6 -> 1
    })
})

describe('the gate (docs/specs/ProseGate.tla): the opening reply of a card with an English first message', () => {
    const opening = [{ role: 'char', data: EN }, { role: 'user', data: 'Có' }]
    it('reported case: English first message, the player answers "Có" -> reminded (the old gate said no)', () => {
        expect(storyInVietnamese(opening, EN)).toBe(false)                         // what the old gate read
        expect(wantsVietnameseProse(opening, EN)).toBe(true)
        expect(wantsVietnameseProse([{ role: 'char', data: EN }, { role: 'user', data: 'ok' }], EN, 'vi')).toBe(true)  // translator to vi
    })
    it('one tone mark makes a short line Vietnamese; Spanish, French and English lines do not', () => {
        for (const vi of ['Có', 'Tui ngồi xuống', 'ừ', 'đi thôi']) expect(playerWritesVietnamese(vi), vi).toBe(true)
        for (const no of ['Sí, por favor', '¿Qué pasa?', 'Très bien, à demain', 'Ça va', 'Yes, I open the door', 'ok']) expect(playerWritesVietnamese(no), no).toBe(false)
    })
    it('English story, English player, translator off -> no reminder', () => {
        expect(wantsVietnameseProse([{ role: 'char', data: EN }, { role: 'user', data: 'I open the door.' }], EN, '')).toBe(false)
    })
})
