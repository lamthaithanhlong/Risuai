import { describe, expect, test } from 'vitest'
import { NO_REPLY_NOTE, PARTIAL_NOTE, isStalledPlaceholder, settleChatOnLoad, settleInterrupted, shouldRetryEmptyReply, visibleReply } from './emptyReply'

describe('visibleReply', () => {
    test('reasoning alone is not a reply', () => {
        expect(visibleReply('<Thoughts>\n…\n</Thoughts>\n')).toBe('')
        expect(visibleReply('<Thoughts>nghĩ</Thoughts>')).toBe('')
        expect(visibleReply('')).toBe('')
    })

    test('words after the reasoning are the reply', () => {
        expect(visibleReply('<Thoughts>nghĩ</Thoughts>\n*Khang cười*')).toBe('*Khang cười*')
    })

    test('an image tag alone is still a reply', () => {
        expect(visibleReply('<img="Choi Yoo-jin smile">')).not.toBe('')
    })
})

describe('shouldRetryEmptyReply', () => {
    test('a bot message with no words is retried, up to two times', () => {
        expect(shouldRetryEmptyReply('char', '<Thoughts>\n…\n</Thoughts>\n', 0)).toBe(true)
        expect(shouldRetryEmptyReply('char', '', 1)).toBe(true)
        expect(shouldRetryEmptyReply('char', '', 2)).toBe(false)
    })

    test('a real reply or a user message is never retried', () => {
        expect(shouldRetryEmptyReply('char', 'Chào em.', 0)).toBe(false)
        expect(shouldRetryEmptyReply('user', '', 0)).toBe(false)
        expect(shouldRetryEmptyReply(undefined, undefined, 0)).toBe(false)
    })
})

describe('isStalledPlaceholder', () => {
    test('only the exact stand-in counts, never a real reply or real reasoning', () => {
        expect(isStalledPlaceholder('<Thoughts>\n…\n</Thoughts>\n')).toBe(true)
        expect(isStalledPlaceholder('<Thoughts>\n…\n</Thoughts>')).toBe(true)
        expect(isStalledPlaceholder('<Thoughts>\nsuy nghĩ thật\n</Thoughts>\n')).toBe(false)
        expect(isStalledPlaceholder('<Thoughts>\n…\n</Thoughts>\nChào em.')).toBe(false)
        expect(isStalledPlaceholder(undefined)).toBe(false)
        expect(NO_REPLY_NOTE).not.toBe('')
    })
})

describe('settleInterrupted', () => {
    test('text saved while streaming and then cut off is kept and marked, so it is not taken for the answer', () => {
        expect(settleInterrupted('*Khang nhìn bản vẽ, rồi')).toBe('*Khang nhìn bản vẽ, rồi' + PARTIAL_NOTE)
        expect(settleInterrupted('<Thoughts>nghĩ</Thoughts>\nChào em, anh')).toBe('<Thoughts>nghĩ</Thoughts>\nChào em, anh' + PARTIAL_NOTE)
    })

    test('nothing visible becomes the no-reply note', () => {
        expect(settleInterrupted('')).toBe(NO_REPLY_NOTE)
        expect(settleInterrupted('<Thoughts>\n…\n</Thoughts>\n')).toBe(NO_REPLY_NOTE)
        expect(settleInterrupted(undefined)).toBe(NO_REPLY_NOTE)
    })

    test('it is idempotent: loading the same chat twice does not stack notes', () => {
        const once = settleInterrupted('dở dang')
        expect(settleInterrupted(once)).toBe(once)
        expect(settleInterrupted(NO_REPLY_NOTE)).toBe(NO_REPLY_NOTE)
    })
})

describe('settleChatOnLoad', () => {
    const chat = (isStreaming: boolean | undefined, ...messages: [string, string][]) => ({ isStreaming, message: messages.map(([role, data]) => ({ role, data })) })

    test('a chat that was streaming gets its cut-off last reply marked', () => {
        const c = chat(true, ['user', 'Chào'], ['char', 'Chào em, anh'])
        settleChatOnLoad(c)
        expect(c.message[1].data).toBe('Chào em, anh' + PARTIAL_NOTE)
        expect(c.message[0].data).toBe('Chào')
    })

    test('a chat that was NOT streaming is never marked, however its last message looks', () => {
        const c = chat(false, ['user', 'Chào'], ['char', 'Chào em, anh'])
        settleChatOnLoad(c)
        expect(c.message[1].data).toBe('Chào em, anh')
        const d = chat(undefined, ['char', 'Ừ.'])
        settleChatOnLoad(d)
        expect(d.message[0].data).toBe('Ừ.')
    })

    test('a user message at the end is left alone even if the chat was streaming', () => {
        const c = chat(true, ['char', 'Xin chào'], ['user', 'Ừ'])
        settleChatOnLoad(c)
        expect(c.message.map((m) => m.data)).toEqual(['Xin chào', 'Ừ'])
    })

    test('only the last message is touched, and old "Thinking..." stand-ins become the note', () => {
        const c = chat(true, ['char', '<Thoughts>\n…\n</Thoughts>\n'], ['user', 'Sao nữa'], ['char', 'Dạ, để anh'])
        settleChatOnLoad(c)
        expect(c.message[0].data).toBe(NO_REPLY_NOTE)
        expect(c.message[2].data).toBe('Dạ, để anh' + PARTIAL_NOTE)
    })

    test('loading twice changes nothing the second time', () => {
        const c = chat(true, ['char', 'dở dang'])
        settleChatOnLoad(c)
        const once = c.message[0].data
        settleChatOnLoad(c)
        expect(c.message[0].data).toBe(once)
    })

    test('an empty or missing message list is fine', () => {
        expect(() => settleChatOnLoad({ isStreaming: true })).not.toThrow()
        expect(() => settleChatOnLoad({ isStreaming: true, message: [] })).not.toThrow()
    })
})
