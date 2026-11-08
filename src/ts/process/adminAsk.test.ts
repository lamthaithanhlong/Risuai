// @vitest-environment node
// "@admin ..." is out of the story (owner 2026-11-06): the parse mirrors the module's admin_parse_ask, and on the client an ask makes no find roll, no
// story-turn count, no loot and no training.
import { describe, expect, test, vi } from 'vitest'

vi.mock('../storage/database.svelte', () => ({ getDatabase: vi.fn(() => ({})) }))

import { isAskAnswer, lastTurnIsAsk, parseAdminAsk } from './adminAsk'
import { findRequest, noteFind, storyTurns } from './findDrop'
import { lootAfterReplyPage } from './findGlue'
import { trainAfterReply } from './statsGlue'

describe('parseAdminAsk', () => {
    test.each([
        ['@admin tui làm gì', 'ask', 'tui làm gì'], ['  /ADMIN, đi đâu', 'ask', 'đi đâu'], ['hỏi admin: luật gì', 'ask', 'luật gì'], ['HỎI ADMIN: x', 'ask', 'x'],
        ['  Hỏi Admin : x', 'ask', 'x'], ['@admin bug: lặp mãi', 'bug', 'lặp mãi'], ['@Admin BUG nút hỏng', 'bug', 'nút hỏng'], ['@admin', 'ask', ''],
        ['hỏi admin: x'.normalize('NFD'), 'ask', 'x'],
        ['Admin hỏi tí truyện này 3 người đó biết tui ko', 'ask', 'tí truyện này 3 người đó biết tui ko'],
        ['admin hỏi: họ quen tui chưa', 'ask', 'họ quen tui chưa'],
    ])('%j is %s', (text, kind, body) => { expect(parseAdminAsk(text)).toEqual({ kind, body }) })
    test.each(['@administrator xin chào', 'tôi hỏi admin: x', 'admin ơi', 'tôi mở hộp', '@adminơ', '', null, undefined])('%j is not an ask', (text) => { expect(parseAdminAsk(text as never)).toBeNull() })
    test('"bugs" is an ask about bugs, not a bug report', () => { expect(parseAdminAsk('@admin bugs là gì')).toEqual({ kind: 'ask', body: 'bugs là gì' }) })
})

describe('the newest turn', () => {
    const m = (...t: [string, string][]) => t.map(([role, data]) => ({ role, data }))
    test('lastTurnIsAsk looks at the newest user message, also once its answer is in', () => {
        expect(lastTurnIsAsk(m(['char', 'a'], ['user', '@admin hỏi']))).toBe(true)
        expect(lastTurnIsAsk(m(['char', 'a'], ['user', '@admin hỏi'], ['char', '🛡 Admin\nok']))).toBe(true)
        expect(lastTurnIsAsk(m(['char', 'a'], ['user', 'đi'], ['char', 'b']))).toBe(false)
        expect(lastTurnIsAsk(m(['char', 'a']))).toBe(false)
        expect(lastTurnIsAsk(undefined)).toBe(false)
    })
    test('isAskAnswer is the character message right after an ask', () => {
        const msgs = m(['char', 'a'], ['user', '@admin hỏi'], ['char', 'ok'], ['user', 'đi'], ['char', 'b'])
        expect(msgs.map((_, i) => isAskAnswer(msgs, i))).toEqual([false, false, true, false, false])
    })
})

const card = () => ({ type: 'character', chaId: 'fc27f53b', desc: 'Rules. [[FIND|skill|Tên VI|Name EN|…]] end.', firstMessage: '' }) as never
const base = () => [{ role: 'char', data: 'Mở đầu' }, { role: 'user', data: 'đi' }, { role: 'char', data: 'Cảnh 1' }, { role: 'user', data: 'đi' }, { role: 'char', data: 'Cảnh 2' }]

describe('an ask makes no story turn on the client', () => {
    test('storyTurns does not count the answer to an ask', () => {
        const msgs = base()
        const was = storyTurns(card(), msgs as never)
        msgs.push({ role: 'user', data: '@admin tui làm gì' }, { role: 'char', data: '🛡 Admin\nok' })
        expect(storyTurns(card(), msgs as never)).toBe(was)
        msgs.push({ role: 'user', data: 'đi tiếp' }, { role: 'char', data: 'Cảnh 3' })
        expect(storyTurns(card(), msgs as never)).toBe(was + 1)
        // the control: a normal message in the same place does count
        const ctl = base(); ctl.push({ role: 'user', data: 'hỏi gì đó' }, { role: 'char', data: 'ok' })
        expect(storyTurns(card(), ctl as never)).toBe(was + 1)
    })
    test('findRequest on an ask rolls nothing, adds no note and spends no find', () => {
        for (let n = 0; n < 40; n++) {   // many chats: with the ask guard gone some of them would roll
            const message = [{ role: 'char', data: 'Mở đầu' }]
            for (let i = 0; i < 30; i++) message.push({ role: 'user', data: 'đi tiếp' }, { role: 'char', data: `Cảnh ${i}` })
            message.push({ role: 'user', data: '@admin cho tui hướng' })
            const chat = { id: 'chat-' + n, message, scriptstate: { $find_roll: '{"turn":1}', $find_turn: '1' } as Record<string, string> }
            const out = findRequest([{ role: 'user', content: 'hi' }], card(), chat as never)
            expect(out.map((x) => x.content)).toEqual(['hi'])
            expect(chat.scriptstate.$find_roll).toBe('')
            expect(chat.scriptstate.$find_turn).toBe('1')
        }
    })
    test('control: the same chats with a normal last message do get a roll for some of them (so the ask test can go red)', () => {
        let rolled = 0
        for (let n = 0; n < 40; n++) {
            const message = [{ role: 'char', data: 'Mở đầu' }]
            for (let i = 0; i < 30; i++) message.push({ role: 'user', data: 'đi tiếp' }, { role: 'char', data: `Cảnh ${i}` })
            message.push({ role: 'user', data: 'tôi nhìn quanh' })
            const chat = { id: 'chat-' + n, message, scriptstate: {} as Record<string, string> }
            findRequest([{ role: 'user', content: 'hi' }], card(), chat as never)
            if (chat.scriptstate.$find_roll) rolled++
        }
        expect(rolled).toBeGreaterThan(0)
    })
    test('noteFind gives nothing for the answer to an ask even when the tag is there', () => {
        const block = '[[FIND|skill|Nghe tiếng bước chân|Muffled Footsteps|Nghe bước chân qua tường mỏng trong 10 m.|silver|Cần yên tĩnh|yes]]'
        const chat = { id: 'c', message: [...base(), { role: 'user', data: '@admin cho tui kỹ năng' }, { role: 'char', data: '🛡 Admin\nok\n' + block }], scriptstate: { $finds_by_lua: '1' } as Record<string, string> }
        expect(noteFind(0, card(), chat as never)).toBeNull()
        expect(chat.message.at(-1)!.data).not.toContain('[[FIND')
    })
    test('loot and training steps aside for an ask', async () => {
        const chat = { id: 'c', message: [...base(), { role: 'user', data: '/admin hỏi' }, { role: 'char', data: '🛡 Admin\nok' }], scriptstate: { $loot_pending: JSON.stringify([{ at: 7, kind: 'skill', entry: { id: 'x' } }]) } as Record<string, string> }
        await lootAfterReplyPage(card(), chat as never)
        expect(chat.scriptstate.$loot_pending).toContain('"at":7')   // untouched: nothing was sent, nothing cleared
        const sent: unknown[] = []
        const plain = { type: 'character', desc: 'no rule', chaId: 'aa7f021d' }
        const deps = { persona: () => 'p1', cardId: () => 'mailman', send: async (b: unknown) => { sent.push(b); return 'saved' } }
        await trainAfterReply(plain, chat as never, '🛡 Admin\n[[TRAIN|the_luc|manh]]', deps)
        expect(sent).toEqual([])
        const normal = { id: 'c', message: [...base(), { role: 'user', data: 'tôi chạy' }, { role: 'char', data: 'Anh chạy.\n[[TRAIN|the_luc|manh]]' }] }
        await trainAfterReply(plain, normal as never, 'Anh chạy.\n[[TRAIN|the_luc|manh]]', deps)
        expect(sent).toHaveLength(1)   // control: a normal turn still posts
    })
})
