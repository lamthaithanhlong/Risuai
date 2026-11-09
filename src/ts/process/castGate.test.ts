import { describe, expect, test } from 'vitest'
import { allowedCast, castHits, scrubCast } from './castGate'

const FM = '유우이치의 등 뒤로 미즈하라 아키가 서 있었다. 이치노세 나루였다. 세 사람은 복도로'
const BAD = `Kenji Park đứng yên nhìn ba bóng người.

[🖼️|aki_schooluniform_spacey|👁️]
[🖼️|naru_schooluniform_angry|👁️]

Naru hét lên. Aki đứng cạnh Yuuichi.

[🖼️|sayaka_casual_relieved|👁️]

"Chắc chắn rồi, mọi thứ ổn cả."

Sayaka nói khẽ từ phía sau.

[[LOOK sayaka | navy bob cut]]
`
const ROSTER = ['Aki', 'Naru', 'Yuuichi', 'Sayaka', 'kenji_park']

describe('castGate', () => {
    test('Korean firstMessage unlocks Aki/Naru/Yuuichi', () => {
        const allowed = allowedCast(FM, [], 'Tui nhìn 3 người họ', 'Kenji Park', ROSTER)
        expect(allowed.map((n) => n.toLowerCase())).toEqual(
            expect.arrayContaining(['aki', 'naru', 'yuuichi', 'kenji park']),
        )
    })
    test('flags Sayaka invented off opening cast', () => {
        const allowed = allowedCast(FM, [], 'Tui nhìn 3 người họ', 'Kenji Park', ROSTER)
        const hits = castHits(BAD, allowed, ROSTER)
        expect(hits.map((h) => h.text.toLowerCase())).toEqual(['sayaka'])
    })
    test('scrubCast removes Sayaka and tags', () => {
        const allowed = allowedCast(FM, [], 'Tui nhìn 3 người họ', 'Kenji Park', ROSTER)
        const hits = castHits(BAD, allowed, ROSTER)
        const scrubbed = scrubCast(BAD, hits)
        expect(scrubbed.toLowerCase()).not.toContain('sayaka')
        expect(castHits(scrubbed, allowed, ROSTER)).toEqual([])
        expect(scrubbed).toContain('Aki')
        expect(scrubbed).toContain('Naru')
    })
})
