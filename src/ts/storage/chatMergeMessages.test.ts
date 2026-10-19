// @vitest-environment node
// F1 (specs/chat/ChatMerge.als, MessageMerge.dfy): a chat both pages changed is merged message by message. Failed on d588ddef.
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'

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
const ids = (buf: Buffer, chat = 0) => charOf(buf).chats[chat].message.map((m: any) => m.chatId)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

describe('F1: a chat both pages changed is merged message by message', () => {
    test('the phone adds 4 messages, the Mac (loaded before) adds 1: all 5 stay, in the order they were written', () => {
        const s = openDbSync({ dbFile: ':memory:' })
        const base = file({ chaId: 'c1', chats: [{ id: 'k1', message: [msg('m0', 'user', 'a', 100)] }] })
        s.onRead('mac', base); s.onRead('phone', base)
        const phone = clone(charOf(base))
        phone.chats[0].message.push(msg('p1', 'char', 'b', 200), msg('p2', 'user', 'c', 300), msg('p3', 'char', 'd', 400), msg('p4', 'user', 'e', 600))
        const server = s.onWrite('phone', file(phone), base).bytes
        const mac = clone(charOf(base)); mac.chats[0].message.push(msg('x1', 'user', 'f', 500))
        const r = s.onWrite('mac', file(mac), server)
        expect(r.merged).toBe(true)
        expect(ids(r.bytes)).toEqual(['m0', 'p1', 'p2', 'p3', 'x1', 'p4'])
    })

    test('without times the page keeps its order and the server\'s new messages follow', () => {
        const base = file({ chaId: 'c1', chats: [{ id: 'k1', message: [msg('m0', 'user', 'a')] }] })
        const theirs = clone(charOf(base)); theirs.chats[0].message.push(msg('p1', 'char', 'b'))
        const ours = clone(charOf(base)); ours.chats[0].message.push(msg('x1', 'user', 'f'))
        const r = merge.mergeSaves(merge.manifestOf(base), file(ours), file(theirs))
        expect(ids(r.buf)).toEqual(['m0', 'x1', 'p1'])
    })

    test('an edit on the page, a reroll on the server and a delete on the page each keep their side', () => {
        const base = file({ chaId: 'c1', chats: [{ id: 'k1', note: '', message: [msg('m0', 'user', 'a'), msg('m1', 'char', 'b'), msg('m2', 'user', 'c'), msg('m3', 'char', 'd')] }] })
        const theirs = clone(charOf(base)); theirs.chats[0].message[3].data = 'd rerolled'; theirs.chats[0].message.push(msg('p9', 'user', 'new on phone'))
        const ours = clone(charOf(base)); ours.chats[0].message[0].data = 'a edited'; ours.chats[0].message.splice(2, 1); ours.chats[0].note = 'mac note'
        const r = merge.mergeSaves(merge.manifestOf(base), file(ours), file(theirs))
        const chat = charOf(r.buf).chats[0]
        expect(chat.message.map((m: any) => `${m.chatId}=${m.data}`)).toEqual(['m0=a edited', 'm1=b', 'm3=d rerolled', 'p9=new on phone'])
        expect(chat.note).toBe('mac note')
        expect(r.report.chatsMerged).toBe(1)
    })

    test('no message appears twice and the result still reads back', () => {
        const base = file({ chaId: 'c1', chats: [{ id: 'k1', message: [msg('m0', 'user', 'a')] }] })
        const theirs = clone(charOf(base)); theirs.chats[0].message.push(msg('same', 'char', 'from phone'))
        const ours = clone(charOf(base)); ours.chats[0].message.push(msg('same', 'char', 'from mac'))
        const r = merge.mergeSaves(merge.manifestOf(base), file(ours), file(theirs))
        expect(ids(r.buf)).toEqual(['m0', 'same'])
        expect(charOf(r.buf).chats[0].message[1].data).toBe('from mac')   // both added the same id: the writing page wins
        expect(merge.validateSave(r.buf)).toBe(2)
    })
})
