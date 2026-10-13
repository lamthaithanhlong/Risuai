import { describe, expect, test } from 'vitest'
import { looksVietnamese } from './vietnamese'

describe('looksVietnamese', () => {
    test('the sentences that were sent to the model on the phone', () => {
        expect(looksVietnamese('tui muốn xem chi tiết bầu ngực đó')).toBe(true)
        expect(looksVietnamese('tui nhìn dưới váy')).toBe(true)
    })

    test('a roleplay reply in Vietnamese with markup', () => {
        expect(looksVietnamese('*Khang nghiêng bản vẽ về phía em.* Chỗ này. <b>Anh</b> gõ đầu bút vào khoảng trống.')).toBe(true)
    })

    test('English is translated', () => {
        expect(looksVietnamese('Hi. No world yet. Type a genre, a work title, or a world you made.')).toBe(false)
    })

    test('Korean (the card text) is translated', () => {
        expect(looksVietnamese('좋아하는 세계의 상식을 마음대로 바꾸는 건에 대하여')).toBe(false)
    })

    test('Korean with a few Vietnamese words is still translated', () => {
        expect(looksVietnamese('좋아하는 세계의 상식을 마음대로 바꾸는 건에 대하여 안녕하세요 반갑습니다 Việt')).toBe(false)
    })

    test('too short to judge is translated; so is markup-only text', () => {
        expect(looksVietnamese('ừ')).toBe(false)
        expect(looksVietnamese('<style>.a{color:red}</style><div></div>')).toBe(false)
    })

    test('the thinking block does not decide the language', () => {
        expect(looksVietnamese('<Thoughts>Người dùng gửi lời chào bằng tiếng Việt rất dài</Thoughts>\nHello there friend')).toBe(false)
    })
})

describe('Korean inside a Vietnamese message', () => {
    test('finds the orange quote and the label inside the box, with the quote marks left in place', async () => {
        const { findForeignRuns } = await import('./vietnamese')
        const quote = '<span style="color:orange">“…공포라… 그 기분 좋은 작은 떨림…”</span>'
        expect(findForeignRuns(quote).map((r) => r.text)).toEqual(['공포라… 그 기분 좋은 작은 떨림'])
        const box = '<div>Áp lực bất thường quanh 헌터 전용 단말기 khuếch đại dữ dội khi bị soi xét. SP -8.</div>'
        expect(findForeignRuns(box).map((r) => r.text)).toEqual(['헌터 전용 단말기'])
    })

    test('tags, attributes and style blocks are not touched, Latin words end a passage', async () => {
        const { findForeignRuns } = await import('./vietnamese')
        expect(findForeignRuns('<img alt="한글" src="a.png"><style>.a{content:"한글"}</style>xin chào')).toEqual([])
        expect(findForeignRuns('ở Seoul 서울에서 đi 부산으로').map((r) => r.text)).toEqual(['서울에서', '부산으로'])
        expect(findForeignRuns('chỉ có tiếng Việt thôi')).toEqual([])
    })

    test('a numbered answer is put back in place', async () => {
        const { translateForeignRuns } = await import('./vietnamese')
        const body = 'Cô nói: “…공포라…” rồi nhìn 헌터 전용 단말기 lần nữa.'
        const out = await translateForeignRuns(body, async () => '[[1]] Nỗi sợ\n[[2]] thiết bị chuyên dụng của thợ săn', async () => '')
        expect(out).toBe('Cô nói: “…Nỗi sợ…” rồi nhìn thiết bị chuyên dụng của thợ săn lần nữa.')
    })

    test('a broken answer falls back to one request per passage', async () => {
        const { translateForeignRuns } = await import('./vietnamese')
        const asked: string[] = []
        const out = await translateForeignRuns('a 가나 b 다라 c', async () => 'xin lỗi, tôi không hiểu', async (r) => { asked.push(r); return r === '가나' ? 'một' : 'hai' })
        expect(out).toBe('a một b hai c')
        expect(asked).toEqual(['가나', '다라'])
    })

    test('an answer that still holds Korean is not accepted; the passage stays as it was', async () => {
        const { translateForeignRuns } = await import('./vietnamese')
        const out = await translateForeignRuns('x 가나 y', async () => '[[1]] 가나', async () => '가나')
        expect(out).toBe('x 가나 y')
    })

    test('nothing foreign: no request is made', async () => {
        const { translateForeignRuns } = await import('./vietnamese')
        let calls = 0
        const out = await translateForeignRuns('toàn tiếng Việt', async () => { calls++; return '' }, async () => { calls++; return '' })
        expect(out).toBe('toàn tiếng Việt')
        expect(calls).toBe(0)
    })
})
