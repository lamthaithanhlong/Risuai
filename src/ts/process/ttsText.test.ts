import { describe, expect, it } from 'vitest'
import { speakableText } from './ttsText'

// the newest Shadow Slave reply on the live save (2026-10-16), shortened: what the speaker button was given
const REPLY = "[[img: A stone granary cellar at night, grain sacks beside a barred wooden door, a small oil lamp lighting two figures, cold dust and deep shadows]]\n\nMột người phụ nữ đứng cạnh cửa. Chị khoảng bốn mươi tuổi, tóc nâu buộc thấp, mắt xám và choàng khăn xanh đã sờn. Chị giữ chặt đầu thanh chặn bằng cả hai tay. Dưới ánh đèn, Kenji thấy một vết máu khô trên cổ tay áo chị.\n\n😨 Người phụ nữ nói khẽ: “Tôi là Elise Moreau. Trên kia có tiếng bước chân từ lúc chuông ngừng reo. Anh có thấy lối nào khác không?”\n\n[[STATUS\nname: Kenji Park\ntitle: -\nclass: Nhân viên văn phòng\nrank: Aspirant\naspect: Dấu Mòn | Dormant\nlegacy: -\nfated: -\n]]\n\n[[LOOK Kenji Park | short black hair, brown eyes behind glasses, narrow face, lean build, age 25, coarse linen shirt and trousers]]\n[[LOOK Elise Moreau | brown hair tied low, gray eyes, lined face, sturdy build, age 40, worn blue shawl over plain work clothes]]"

describe('what is read aloud (reported: the speaker button read the picture prompt, the status panel and the emoji)', () => {
    const said = speakableText(REPLY)
    it('the story stays, word for word', () => {
        expect(said).toContain('Một người phụ nữ đứng cạnh cửa. Chị khoảng bốn mươi tuổi')
        expect(said).toContain('Người phụ nữ nói khẽ: “Tôi là Elise Moreau.')
    })
    it('the picture prompt, the status panel, the LOOK lines and the emoji go', () => {
        for (const gone of ['[[', 'granary', 'str:', 'agi:', 'Aspirant', 'short black hair', '😨']) expect(said, gone).not.toContain(gone)
    })
    it('a block still open at the end (cut while streaming), an inlay, HTML and markdown go too', () => {
        expect(speakableText('Chị gật đầu.\n\n[[STATUS\nname: Kenji\nstr: 3')).toBe('Chị gật đầu.')
        expect(speakableText('{{inlay::abc}}\n**Elise** <span style="x">thì thào</span>: “Đi.” ❤️👨‍👩‍👧')).toBe('Elise thì thào: “Đi.”')
        expect(speakableText('# Chương 1\n- Một\n> Hai')).toBe('Chương 1\nMột\nHai')
    })
    it('a reply that is only blocks says nothing', () => {
        expect(speakableText('[[REPLIES\n1. a\n]]\n[[img: x]]')).toBe('')
    })
})
