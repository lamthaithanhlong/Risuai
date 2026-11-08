import { describe, expect, test } from 'vitest'
import { continuityHits, continuityNote, kinshipHits, viewpointHits } from './continuityGate'

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
    test('viewpoint: observing + romance hub without player name', () => {
        const hits = viewpointHits(BAD, 'Tui nhìn 3 người họ', 'Kenji Park')
        expect(hits).toHaveLength(1)
        expect(hits[0].rule).toBe('viewpoint')
    })
    test('viewpoint: ok when player name stays in the reply', () => {
        expect(viewpointHits('Kenji Park nhìn Aki và Naru đứng cạnh nhau.', 'Tui nhìn họ', 'Kenji Park')).toEqual([])
    })
    test('continuityNote names the hits', () => {
        const note = continuityNote(continuityHits(BAD, 'Tui nhìn 3 người họ', [], 'Kenji'))
        expect(note).toContain('bạn gái')
        expect(note).toContain('Keep the player')
    })
})
