// @vitest-environment node
// F2 (specs/chat/uppaal/settle_*.xml): a reply a server job is still generating is not settled as cut off. Failed on d588ddef.
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { fetchRunningStreamChats, settleCharacterOnLoad, STREAM_ALIVE_MS, PARTIAL_NOTE } from '../process/emptyReply'

const req = createRequire(import.meta.url)
const merge = req('../../../server/node/dbMerge.cjs')
const { openDbSync } = req('../../../server/node/dbSync.cjs')

const msg = (id: string, role: 'user' | 'char', data: string, time?: number) => (time === undefined ? { chatId: id, role, data } : { chatId: id, role, data, time })
function file(char: any, root: any = { maxResponse: 4096 }) {
    return merge.encodeSave([
        merge.serializeBlock(1, 0, 'root', { ...root, __directory: ['c1'] }),
        merge.serializeBlock(2, 0, 'c1', char),
    ])
}
const charOf = (buf: Buffer) => merge.parseBlock(merge.decodeSave(buf).find((b: any) => b.name === 'c1'))
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe('F2: a reply the server is still generating is not settled as cut off', () => {
    const t0 = 1_000_000
    const streaming = () => ({ chaId: 'c1', streamingAt: t0, chats: [{ id: 'k1', isStreaming: true, message: [msg('u1', 'user', 'hỏi'), msg('r1', 'char', 'Phần đầu')] }] })

    test('the stamp is 46 s old (the phone is locked) but the server says the job runs: the chat is left as saved', () => {
        const c = streaming()
        settleCharacterOnLoad(c, t0 + STREAM_ALIVE_MS + 1000, new Set(['k1']))
        expect(c.chats[0].message[1].data).toBe('Phần đầu')
        expect(c.chats[0].isStreaming).toBe(true)
        expect(c.streamingAt).toBe(t0)
    })

    test('the whole story: the Mac loads while the phone is locked, the phone finishes, the Mac saves later: the full reply stays', () => {
        const s = openDbSync({ dbFile: ':memory:' })
        let server = file(streaming())
        s.onRead('phone', server)
        s.onRead('mac', server)
        const macChar = clone(charOf(server))
        settleCharacterOnLoad(macChar, t0 + STREAM_ALIVE_MS + 1000, new Set(['k1']))
        server = s.onWrite('mac', file(macChar), server).bytes
        const full = streaming() as any
        full.chats[0].isStreaming = false
        full.streamingAt = undefined
        full.chats[0].message[1].data = 'Phần đầu và toàn bộ câu trả lời'
        server = s.onWrite('phone', file(full), server).bytes
        const r = s.onWrite('mac', file(macChar, { maxResponse: 1000 }), server)
        expect(charOf(r.bytes).chats[0].message[1].data).toBe('Phần đầu và toàn bộ câu trả lời')
    })

    test('a page that really died is still settled once no job runs for its chat', () => {
        const c = streaming()
        settleCharacterOnLoad(c, t0 + STREAM_ALIVE_MS + 1000, new Set(['another-chat']))
        expect(c.chats[0].message[1].data).toBe('Phần đầu' + PARTIAL_NOTE)
        expect(c.chats[0].isStreaming).toBe(false)
    })

    test('the page asks the server; an old server or an error gives null (the stamp alone decides, as before)', async () => {
        const ok = await fetchRunningStreamChats(async () => new Response(JSON.stringify({ chats: ['k1', 3] }), { status: 200 }), async () => 'auth')
        expect(ok).toEqual(['k1'])
        expect(await fetchRunningStreamChats(async () => new Response('no', { status: 404 }), async () => 'auth')).toBeNull()
        expect(await fetchRunningStreamChats(async () => { throw new Error('offline') }, async () => 'auth')).toBeNull()
    })
})
