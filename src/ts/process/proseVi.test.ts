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
    it("the measured rules: the player's own lines named too, a sound not 'ai đó', ages in numbers", () => {
        const r = viProseReminder('Kenji Park')
        expect(r).toContain('kể cả lời nhân vật chính (Kenji Park hỏi: “…”)')     // the 3-4 speakerless lines left were the player's
        expect(r).toContain('không khẳng định "có người" hay "ai đó"')
        expect(r).toContain('người 40 tuổi với người 25 tuổi là chị hoặc cô, không phải bà')
        expect(viProseReminder()).toContain('(nhân vật chính hỏi: “…”)')          // no persona name: still a sentence
        expect(r).toContain('không kể vị, mùi, cảm giác hay ý nghĩ trong đầu người khác')   // MiniMax POV 6 -> 1
        expect(r).toContain('người lạ mới gặp lần đầu thì phản ứng như người lạ')          // a stranger treated as known: 2/8 -> 0/8
    })
    it('reported 2026-10-19 "văn đọc thấy ngu ngu": novel rhythm, speaker forms varied, the emoji not on every line, no record read out', () => {
        const r = viProseReminder('Kenji Park')
        expect(r).toContain('câu dài ngắn đan xen')                                  // not "Anh đứng đó. Gió thổi. Áo có vết vá."
        expect(r).toContain('(“…” Evelyn nói khẽ.)')                                // the tag after the line is allowed
        expect(r).toContain('(Evelyn liếc chiếc chìa khóa. “…”)')                    // or a gesture of the speaker
        expect(r).toContain('không mở mọi câu thoại cùng một kiểu')
        expect(r).not.toContain('mở bằng emoji cảm xúc')                             // the old "😐 Evelyn nói khẽ:" on every line
        // the save's emoji module still says every line; DeepSeek obeys a module over the reminder unless the reminder says it wins
        expect(r).toContain('không bao giờ đứng một mình trước dấu ngoặc (không viết 😨 “…”)')
        expect(r).toContain('không gắn vào mọi câu thoại')
        expect(r).toContain('điều này thắng mọi luật emoji ở trên')
        expect(r).toContain('không đọc bảng trạng thái ra trong lời kể')            // "Những dòng chữ… ghi tên…, hai Thuộc Tính…"
        expect(r).toContain('không viết kiểu "Tiếng Anh (tiếng Việt)" trong lời kể')  // "Aspirant (Ứng viên)!"
        expect(r).toContain('người nhân vật chính đã quen (trong persona hay đã gặp) thì là người quen')
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
