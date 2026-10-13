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
