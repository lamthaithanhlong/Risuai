import { describe, expect, it } from 'vitest'
import { parseScene, sceneNote, seedScene } from './sceneMemory'

describe('per-chat scene memory', () => {
    it('accepts a quoted current place but rejects a date with no quote in the turn', () => {
        const turn = 'Kenji vươn vai khỏi mép hồ. Thầy nhắc nộp hồ sơ trong buổi họp chiều.'
        const answer = '[[SCENE\nplace: mép hồ bơi\nplace_source: mép hồ\ndate: buổi chiều\ndate_source: chiều nay đã đến\n]]'
        expect(parseScene(answer, turn, {})).toEqual({ $scene_place: 'mép hồ bơi', $scene_place_source: 'mép hồ' })
        expect(sceneNote({ $scene_place: 'mép hồ bơi' })).toContain('current location: mép hồ bơi')
    })

    it('backfills an old chat once, without taking a future appointment as current time', async () => {
        const chat = { scriptstate: {}, message: [
            { role: 'user', data: 'Tôi tập bơi.', chatId: 'u1' },
            { role: 'char', data: 'Thầy nhìn Kenji ở mép hồ.', chatId: 'r1' },
            { role: 'user', data: 'Tôi hỏi về buổi họp chiều.', chatId: 'u2' },
            { role: 'char', data: 'Thầy vẫn đứng bên hồ và dặn Kenji mang hồ sơ chiều nay.', chatId: 'r2' },
            { role: 'user', data: 'Tôi chờ.', chatId: 'u3' },
        ] }
        let calls = 0
        const ask = async (prompt: string) => {
            calls++
            expect(prompt).not.toContain('PLAYER: Tôi chờ.')
            return '[[SCENE\nplace: bên hồ\nplace_source: đứng bên hồ\n]]'
        }
        expect(await seedScene(chat, ask)).toBe(true)
        expect(chat.scriptstate).toMatchObject({ $scene_place: 'bên hồ', $scene_seeded_reply: 'r2' })
        expect(chat.scriptstate).not.toHaveProperty('$scene_date')
        expect(await seedScene(chat, ask)).toBe(false)
        expect(calls).toBe(1)
    })

    it('drops an answer when the reply was rerolled while the helper was running', async () => {
        const old = { role: 'char', data: 'Bước vào lớp.', chatId: 'r1' }
        const chat = { scriptstate: {}, message: [old] }
        expect(await seedScene(chat, async () => {
            chat.message.splice(0, 1, { role: 'char', data: 'Ở lại hồ.', chatId: 'r2' })
            return '[[SCENE\nplace: lớp học\nplace_source: vào lớp\n]]'
        })).toBe(false)
        expect(chat.scriptstate).not.toHaveProperty('$scene_place')
    })

    it('lets the story continue when the helper fails', async () => {
        const chat = { scriptstate: {}, message: [{ role: 'char', data: 'Ở mép hồ.', chatId: 'r1' }] }
        expect(await seedScene(chat, async () => { throw new Error('helper unavailable') })).toBe(false)
        expect(chat.scriptstate).not.toHaveProperty('$scene_seeded_reply')
    })
})
