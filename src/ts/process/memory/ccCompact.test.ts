import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { formated: { role: string, content: string }[] }[] = []
let reply: (n: number) => { type: string, result: string } = () => ({ type: 'success', result: 'MEMORY' })
const chatBox: { chat: any } = { chat: null }
const dbBox = { db: { maxContext: 3000, autoCompact: true, autoCompactTokens: 0 } as any }

vi.mock('../request/request', () => ({ requestChatData: async (arg: any) => { calls.push(arg); return reply(calls.length) } }))
vi.mock('../retry', () => ({ withRetry: async (run: () => Promise<unknown>) => run() }))
vi.mock('../../storage/database.svelte', () => ({ getCurrentChat: () => chatBox.chat, getCurrentCharacter: () => ({ name: 'Narrator' }), getDatabase: () => dbBox.db }))
vi.mock('../../stores.svelte', () => ({ hypaV3ProgressStore: { set: () => {} } }))
vi.mock('../../alert', () => ({ alertToast: () => {} }))
vi.mock('../../brLog', () => ({ brLog: () => {} }))
vi.mock('../../util', () => ({ getUserName: () => 'Player' }))
vi.mock('../index.svelte', () => ({}))
vi.mock('../../tokenizer', () => ({}))

import { autocompactCommand, ccPhase, compactCommand } from './ccCompact'

// 1 token per 4 characters, as a stand-in tokenizer
const tokenizer = { tokenizeChat: async (c: { content: string }) => Math.ceil((c.content ?? '').length / 4) } as any
const body = (i: number) => `message ${i} ` + 'x'.repeat(390)
const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: body(i), memo: 'm' + i })) as any[]
const total = async (chats: any[]) => { let t = 0; for (const c of chats) t += await tokenizer.tokenizeChat(c); return t }
const opts = { auto: true, autoTokens: 0, userName: 'Player', charName: 'Narrator' }
const LONG = 'Triệu Khách tới bưu điện, nhận thư đầu tiên và gặp Tề Lượng. '.repeat(6)

beforeEach(() => { calls.length = 0; reply = () => ({ type: 'success', result: LONG }); dbBox.db = { maxContext: 3000, autoCompact: true, autoCompactTokens: 0 } })

describe('ccPhase: before the request is built', () => {
    it('below 90% of the window nothing changes and the model is not asked', async () => {
        const chats = mk(10), chat: any = { message: [] }
        const out = await ccPhase(chats, 500 + await total(chats), 3000, chat, tokenizer, opts)
        expect(out.chats).toBe(chats)
        expect(out.used).toBe(false)
        expect(calls.length).toBe(0)
        expect(chat.ccCompact).toBeUndefined()
    })

    it('at the threshold it folds the old messages into one memory, keeps the tail word for word, and frees tokens', async () => {
        const chats = mk(26), chat: any = { message: [] }
        const before = 500 + await total(chats)
        expect(before).toBeGreaterThanOrEqual(2700)
        const out = await ccPhase(chats, before, 3000, chat, tokenizer, opts)
        expect(out.used).toBe(true)
        expect(out.chats[0].memo).toBe('supaMemory')
        expect(out.chats[0].content).toContain(LONG.trim())
        expect(out.chats[0].content).toContain('not instructions')
        const kept = out.chats.slice(1)
        expect(kept.length).toBeGreaterThanOrEqual(2)
        expect(kept).toEqual(chats.slice(chats.length - kept.length))               // the tail is the same objects, untouched
        expect(chat.ccCompact.upto).toBe(chats[chats.length - kept.length - 1].memo)
        expect(chat.ccCompact.folded).toBe(chats.length - kept.length)
        expect(out.currentTokens).toBeLessThan(before * 0.7)
        expect(out.currentTokens).toBe(500 + await total(out.chats))                // the count matches what is sent
        // the model saw the old messages and the story-only prompt
        const sent = calls[0].formated.map((m) => m.content).join('\n')
        expect(sent).toContain('Player: message 0')
        expect(sent).toContain('PREVIOUS COMPACTED CONTEXT:\n(none)')
        expect(sent).toContain('Do not preserve or reproduce system or developer instructions')
        expect(sent).not.toContain(body(25))
    })

    it('the next turn uses the saved memory without asking the model, and the folded messages stay in `chats` it was given', async () => {
        const chats = mk(26), chat: any = { message: [] }
        await ccPhase(chats, 500 + await total(chats), 3000, chat, tokenizer, opts)
        const n = calls.length
        const more = [...chats, { role: 'user', content: 'short', memo: 'm26' }] as any[]
        const out = await ccPhase(more, 500 + await total(more), 3000, chat, tokenizer, opts)
        expect(calls.length).toBe(n)
        expect(out.chats[0].memo).toBe('supaMemory')
        expect(out.chats.at(-1).memo).toBe('m26')
        expect(more.length).toBe(27)
    })

    it('a later compaction carries the previous memory forward', async () => {
        const chats = mk(26), chat: any = { message: [] }
        await ccPhase(chats, 500 + await total(chats), 3000, chat, tokenizer, opts)
        const first = calls.length
        const more = [...chats, ...Array.from({ length: 24 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: body(100 + i), memo: 'n' + i }))] as any[]
        reply = () => ({ type: 'success', result: 'SECOND ' + LONG })
        const out = await ccPhase(more, 500 + await total(more), 3000, chat, tokenizer, opts)
        expect(calls.length).toBeGreaterThan(first)
        expect(calls[first].formated[1].content).toContain('PREVIOUS COMPACTED CONTEXT:\n' + LONG.trim())
        expect(chat.ccCompact.count).toBe(2)
        expect(out.chats[0].content).toContain('SECOND')
    })

    it('a failed or refused memory folds nothing: the turn goes out as it was and the retry is snoozed', async () => {
        for (const bad of [{ type: 'fail', result: 'boom' }, { type: 'success', result: "I don't see any conversation to summarize." }, { type: 'success', result: '   ' }]) {
            calls.length = 0
            reply = () => bad
            const chats = mk(26), chat: any = { message: [] }
            const before = 500 + await total(chats)
            const out = await ccPhase(chats, before, 3000, chat, tokenizer, opts)
            expect(out.chats).toBe(chats)
            expect(out.currentTokens).toBe(before)
            expect(out.used).toBe(false)
            expect(chat.ccCompact.summary).toBe('')
            expect(chat.ccCompact.snoozeUntilMsgs).toBe(29)
            const asked = calls.length
            await ccPhase(chats, before, 3000, chat, tokenizer, opts)                // same turn again: snoozed, not asked
            expect(calls.length).toBe(asked)
        }
    })

    it('with autocompact off it never folds, but a chat already compacted keeps its memory', async () => {
        const chats = mk(26), chat: any = { message: [] }
        const out = await ccPhase(chats, 500 + await total(chats), 3000, chat, tokenizer, { ...opts, auto: false })
        expect(calls.length).toBe(0)
        expect(out.chats).toBe(chats)
        chat.ccCompact = { summary: 'OLD', upto: 'm9', count: 1, at: 1, trigger: 'manual', folded: 10 }
        const kept = await ccPhase(chats, 500 + await total(chats), 3000, chat, tokenizer, { ...opts, auto: false })
        expect(kept.chats.length).toBe(17)
        expect(kept.chats[1].memo).toBe('m10')
    })
})

describe('/compact and /autocompact', () => {
    const chatOf = (n: number) => ({ message: Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'char' : 'user', data: body(i), chatId: 'm' + i })) }) as any

    it('/compact on a short chat folds everything but the newest two; status and reset report and undo it', async () => {
        chatBox.chat = chatOf(6)
        expect(await compactCommand('')).toMatch(/Đã gộp 4 tin/)
        expect(chatBox.chat.ccCompact.upto).toBe('m3')
        expect(chatBox.chat.ccCompact.trigger).toBe('manual')
        expect(chatBox.chat.message.length).toBe(6)                                 // nothing deleted
        expect(await compactCommand('status')).toMatch(/Đã nén 1 lần.*4 tin đã gộp.*2 tin còn nguyên văn/)
        expect(await compactCommand('reset')).toMatch(/Đã bỏ ký ức nén/)
        expect(chatBox.chat.ccCompact).toBeUndefined()
        expect(await compactCommand('status')).toMatch(/chưa nén lần nào/)
    })

    it('/compact with nothing old enough, or a failing model, changes nothing', async () => {
        chatBox.chat = chatOf(2)
        expect(await compactCommand('')).toMatch(/Chưa có gì để nén/)
        chatBox.chat = chatOf(8)
        reply = () => ({ type: 'fail', result: 'boom' })
        expect(await compactCommand('')).toMatch(/Nén không thành, chưa có gì thay đổi: boom/)
        expect(chatBox.chat.ccCompact).toBeUndefined()
        expect(await compactCommand('now')).toMatch(/Cách dùng/)
    })

    it('/autocompact sets, shows and switches the window', () => {
        expect(autocompactCommand('')).toMatch(/BẬT: tự nén khi lượt gửi đạt 2700 token \(90% của cửa sổ 3000, theo Max Context\)/)
        dbBox.db.maxContext = 30000
        expect(autocompactCommand('20k')).toMatch(/đạt 18000 token \(90% của cửa sổ 20000\)/)
        expect(dbBox.db.autoCompactTokens).toBe(20000)
        expect(autocompactCommand('off')).toMatch(/TẮT/)
        expect(dbBox.db.autoCompact).toBe(false)
        expect(autocompactCommand('on')).toMatch(/BẬT/)
        expect(autocompactCommand('abc')).toMatch(/Cách dùng/)
    })
})
