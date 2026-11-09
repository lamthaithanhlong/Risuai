import { describe, expect, test } from 'vitest'
import { continuityHits, continuityNote, kinshipHits, leadHits, scrubKinship, scrubLead, viewpointHits } from './continuityGate'

const BAD =
    'Gã nhìn 3 người họ.\n\nYuuichi thì đang bước đi… bị bạn gái mình và người em họ cùng lúc bám lấy. Ở giữa là Aki…'

describe('continuityGate', () => {
    test('flags invented bạn gái / em họ when prior story never said them', () => {
        const hits = kinshipHits(BAD, 'Tui nhìn 3 người họ', ['Kenji Park bước chậm trong hành lang.'])
        expect(hits.map((h) => h.text.toLowerCase())).toEqual(expect.arrayContaining(['bạn gái', 'em họ']))
    })
    test('allows a label already in the player turn or prior reply', () => {
        expect(kinshipHits('Aki là bạn gái của Kenji.', 'Aki là bạn gái của tui', [])).toEqual([])
        expect(kinshipHits('em họ Naru chạy theo.', 'đi', ['Naru, em họ của Aki, đứng đó.'])).toEqual([])
    })
    test('flags invented parent and child labels with empty prior', () => {
        expect(kinshipHits('Yuki, mẹ của Aki.', 'đi', []).map((h) => h.text.toLowerCase())).toContain('mẹ')
        expect(kinshipHits('Aki là con gái.', 'đi', []).map((h) => h.text.toLowerCase())).toContain('con gái')
    })
    test('scrubs unsupported bạn đời labels from the measured reply', () => {
        const user = 'Tui nhìn 3 người họ'
        const reply = 'Hai người bạn đời trẻ tuổi kia; người bạn đời của Aki; hai người bạn đời chưa kịp kết hôn.'
        expect(kinshipHits(reply, user, []).map((hit) => hit.text.toLowerCase())).toContain('bạn đời')
        const scrubbed = scrubKinship(reply, user, [])
        expect(scrubbed.toLowerCase()).not.toContain('bạn đời')
        expect(scrubbed.toLowerCase()).not.toContain('người người')
        expect(kinshipHits(scrubbed, user, [])).toEqual([])
    })
    test('preserves labels already present in a prior reply', () => {
        const reply = 'Hai người bạn đời trẻ tuổi kia.'
        expect(scrubKinship(reply, 'đi', ['Aki có bạn đời.'])).toBe(reply)
    })
    test('allows mẹ already present in a prior reply', () => {
        expect(kinshipHits('Aki gọi mẹ.', 'đi', ['Yuki, mẹ của Aki.'])).toEqual([])
    })
    test('viewpoint recognizes Vietnamese observation token boundaries', () => {
        expect(viewpointHits('Bạn đời của Aki bước qua.', 'Tui nhìn 3 người họ', 'Kenji')).toHaveLength(1)
    })
    test('viewpoint: observing + romance hub without player name', () => {
        const hits = viewpointHits(BAD, 'Tui nhìn 3 người họ', 'Kenji Park')
        expect(hits).toHaveLength(1)
        expect(hits[0].rule).toBe('viewpoint')
    })
    test('viewpoint: ok when player name stays in the reply', () => {
        expect(viewpointHits('Kenji Park nhìn Aki và Naru đứng cạnh nhau.', 'Tui nhìn họ', 'Kenji Park')).toEqual([])
    })
    test('lead detects named cling framing only on observation turns', () => {
        const LIVE = 'Aki thì cứ thế mà bám lấy Yuuichi, như thể cậu là điểm tựa duy nhất giữa thế giới này.'
        const hits = leadHits(LIVE, 'Tui nhìn 3 người họ', 'Kenji Park', [])
        expect(hits.length).toBeGreaterThan(0)
        expect(hits.some((hit) => hit.text.includes('Yuuichi'))).toBe(true)
        expect(leadHits(LIVE, 'Tui hỏi họ tên', 'Kenji Park', [])).toEqual([])
    })
    test('lead scrubs unsupported cling framing while preserving names and prior context', () => {
        const LIVE = 'Aki thì cứ thế mà bám lấy Yuuichi, như thể cậu là điểm tựa duy nhất giữa thế giới này.'
        const scrubbed = scrubLead(LIVE, 'Tui nhìn 3 người họ', [], 'Kenji Park')
        expect(scrubbed).not.toContain('bám lấy')
        expect(scrubbed).not.toContain('điểm tựa')
        expect(scrubbed).toContain('Yuuichi')
        expect(scrubbed).toContain('Aki')
        expect(leadHits(scrubbed, 'Tui nhìn 3 người họ', 'Kenji Park', [])).toEqual([])
        expect(leadHits(LIVE, 'Tui nhìn 3 người họ', 'Kenji Park', ['Aki bám lấy Yuuichi. Điểm tựa của Aki là Yuuichi.'])).toEqual([])
    })
    test('continuityNote names the hits', () => {
        const note = continuityNote(continuityHits(BAD, 'Tui nhìn 3 người họ', [], 'Kenji'))
        expect(note).toContain('bạn gái')
        expect(note).toContain('Keep the player')
    })

    // --- New soft-lead patterns ---

    test('lead detects "người cũ + ProperName" on observation turns', () => {
        const reply = 'Người cũ Aki đứng gần cổng, mắt không rời Kenji.'
        const hits = leadHits(reply, 'Tui nhìn 3 người họ', 'Kenji Park', [])
        expect(hits.length).toBeGreaterThan(0)
        expect(hits.some((hit) => hit.text.toLowerCase().includes('người cũ aki'))).toBe(true)
        expect(leadHits(reply, 'Tui hỏi thăm', 'Kenji Park', [])).toEqual([])
    })

    test('lead scrubs "người cũ + ProperName" while preserving the name', () => {
        const reply = 'Người cũ Aki đứng gần cổng, mắt không rời Kenji.'
        const scrubbed = scrubLead(reply, 'Tui nhìn 3 người họ', [], 'Kenji Park')
        expect(scrubbed).not.toContain('người cũ')
        expect(scrubbed).toContain('Aki')
        expect(leadHits(scrubbed, 'Tui nhìn 3 người họ', 'Kenji Park', [])).toEqual([])
    })

    test('allows "người cũ + ProperName" when already in prior context', () => {
        const reply = 'Người cũ Aki đứng gần cổng.'
        expect(leadHits(reply, 'Tui nhìn', 'Kenji', ['Người cũ Aki đã đến.'])).toEqual([])
    })

    test('lead detects "siết … áo của + ProperName" on observation turns', () => {
        const reply = 'Naru siết chặt áo của Yuuichi, run rẩy.'
        const hits = leadHits(reply, 'Tui nhìn 3 người họ', 'Kenji Park', [])
        expect(hits.length).toBeGreaterThan(0)
        expect(hits.some((hit) => hit.text.toLowerCase().includes('siết') && hit.text.toLowerCase().includes('áo của yuuichi'))).toBe(true)
        expect(leadHits(reply, 'Tui nói chuyện', 'Kenji Park', [])).toEqual([])
    })

    test('lead scrubs "siết … áo của + ProperName" to neutral "nắm áo của" while preserving names', () => {
        const reply = 'Naru siết chặt áo của Yuuichi, run rẩy.'
        const scrubbed = scrubLead(reply, 'Tui nhìn 3 người họ', [], 'Kenji Park')
        expect(scrubbed).not.toContain('siết')
        expect(scrubbed).toContain('nắm áo của Yuuichi')
        expect(scrubbed).toContain('Naru')
        expect(scrubbed).toContain('Yuuichi')
        expect(leadHits(scrubbed, 'Tui nhìn 3 người họ', 'Kenji Park', [])).toEqual([])
    })

    test('allows "siết áo của" when already in prior context', () => {
        const reply = 'Naru siết áo của Yuuichi.'
        expect(leadHits(reply, 'Tui nhìn', 'Kenji', ['Naru siết áo của Yuuichi hôm qua.'])).toEqual([])
    })

    test('lead detects "đi cùng hai cô gái / đi cùng 2 cô gái" on observation turns', () => {
        const reply1 = 'Yuuichi đi cùng hai cô gái qua hành lang.'
        const reply2 = 'Yuuichi đi cùng 2 cô gái qua hành lang.'
        const hits1 = leadHits(reply1, 'Tui nhìn 3 người họ', 'Kenji Park', [])
        const hits2 = leadHits(reply2, 'Tui nhìn 3 người họ', 'Kenji Park', [])
        expect(hits1.length).toBeGreaterThan(0)
        expect(hits2.length).toBeGreaterThan(0)
        expect(hits1.some((hit) => hit.text.toLowerCase().includes('đi cùng hai cô gái'))).toBe(true)
        expect(hits2.some((hit) => hit.text.toLowerCase().includes('đi cùng 2 cô gái'))).toBe(true)
        expect(leadHits(reply1, 'Tui hỏi tên', 'Kenji Park', [])).toEqual([])
    })

    test('lead scrubs "đi cùng hai cô gái" to neutral "đi cùng hai người"', () => {
        const reply = 'Yuuichi đi cùng hai cô gái qua hành lang.'
        const scrubbed = scrubLead(reply, 'Tui nhìn 3 người họ', [], 'Kenji Park')
        expect(scrubbed).not.toContain('cô gái')
        expect(scrubbed).toContain('đi cùng hai người')
        expect(scrubbed).toContain('Yuuichi')
        expect(leadHits(scrubbed, 'Tui nhìn 3 người họ', 'Kenji Park', [])).toEqual([])
    })

    test('allows "đi cùng hai cô gái" when already in prior context', () => {
        const reply = 'Yuuichi đi cùng hai cô gái.'
        expect(leadHits(reply, 'Tui nhìn', 'Kenji', ['Yuuichi đi cùng hai cô gái hôm qua.'])).toEqual([])
    })

    test('lead detects "đội hình cố định" near a named hub on observation turns', () => {
        const reply = 'Đội hình cố định Aki, Naru và Yuuichi di chuyển cùng nhau.'
        const hits = leadHits(reply, 'Tui nhìn 3 người họ', 'Kenji Park', [])
        expect(hits.length).toBeGreaterThan(0)
        expect(hits.some((hit) => hit.text.toLowerCase().includes('đội hình cố định') && hit.text.includes('Aki'))).toBe(true)
        expect(leadHits(reply, 'Tui hỏi thăm', 'Kenji Park', [])).toEqual([])
    })

    test('lead scrubs "đội hình cố định" near named hub to neutral "nhóm Name" while preserving names', () => {
        const reply = 'Đội hình cố định Aki, Naru và Yuuichi di chuyển cùng nhau.'
        const scrubbed = scrubLead(reply, 'Tui nhìn 3 người họ', [], 'Kenji Park')
        expect(scrubbed).not.toContain('đội hình cố định')
        expect(scrubbed).toContain('nhóm Aki')
        expect(scrubbed).toContain('Naru')
        expect(scrubbed).toContain('Yuuichi')
        expect(leadHits(scrubbed, 'Tui nhìn 3 người họ', 'Kenji Park', [])).toEqual([])
    })

    test('allows "đội hình cố định" when already in prior context', () => {
        const reply = 'Đội hình cố định Aki, Naru và Yuuichi.'
        expect(leadHits(reply, 'Tui nhìn', 'Kenji', ['Đội hình cố định Aki, Naru, Yuuichi từ trước.'])).toEqual([])
    })

    test('continuityNote reflects neutral-observation wording for new patterns', () => {
        const reply = 'Người cũ Aki siết áo của Naru. Đội hình cố định Yuuichi đi cùng hai cô gái.'
        const note = continuityNote(continuityHits(reply, 'Tui nhìn 3 người họ', [], 'Kenji'))
        expect(note).toContain('người cũ')
        expect(note).toContain('cling-grip')
        expect(note).toContain('fixed-lineup')
        expect(note).toContain('couple walk')
        expect(note).toContain('neutral observation')
    })
})
