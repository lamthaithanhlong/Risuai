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
})
