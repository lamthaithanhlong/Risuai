// @vitest-environment node
// A page's acknowledged write is its new base (specs/chat/DbSync.tla AdvanceBase, NoLostUpdateSinceSync). Measured on 2026-10-19 with
// Toxiproxy against a copy of the save (S3c/S3d/S7/S7d in ~/.backend-review/work/risu-chat-measure/toxiproxy): the base stayed the
// revision the page LOADED, so its later writes carried its earlier ones as edits again and undid another page's edit or delete of
// them, also when the retry of a write whose answer was lost arrived after that edit.
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'

const req = createRequire(import.meta.url)
const merge = req('../../../server/node/dbMerge.cjs')
const { openDbSync } = req('../../../server/node/dbSync.cjs')

const msg = (id: string, data: string, time: number) => ({ chatId: id, role: 'user', data, time })
const file = (char: any) => merge.encodeSave([
    merge.serializeBlock(1, 0, 'root', { maxResponse: 4096, __directory: ['c1'] }),
    merge.serializeBlock(2, 0, 'c1', char),
])
const charOf = (buf: Buffer) => merge.parseBlock(merge.decodeSave(buf).find((b: any) => b.name === 'c1'))
const msgs = (buf: Buffer) => charOf(buf).chats[0].message.map((m: any) => `${m.chatId}=${m.data}`)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const loaded = () => file({ chaId: 'c1', chats: [{ id: 'k1', message: [msg('m0', 'a', 100)] }] })

function phoneWroteP1() {
    const s = openDbSync({ dbFile: ':memory:' })
    const base = loaded()
    s.onRead('phone', base)
    const phone = clone(charOf(base)); phone.chats[0].message.push(msg('p1', 'from phone', 200))
    const phoneFile = file(phone)
    const server1 = s.onWrite('phone', phoneFile, base).bytes            // acknowledged (or: committed, answer lost)
    s.onRead('mac', server1)                                             // the Mac loads after it: it has p1
    return { s, phone, phoneFile, server1 }
}

describe('a page\'s own acknowledged write is not an edit again in its next write', () => {
    test('the Mac edits p1, the phone then adds p2: p1 keeps the Mac\'s edit', () => {
        const { s, phone, server1 } = phoneWroteP1()
        const mac = clone(charOf(server1)); mac.chats[0].message[1].data = 'edited on mac'
        const server2 = s.onWrite('mac', file(mac), server1).bytes
        phone.chats[0].message.push(msg('p2', 'second', 300))
        const r = s.onWrite('phone', file(phone), server2)
        expect(msgs(r.bytes)).toEqual(['m0=a', 'p1=edited on mac', 'p2=second'])
    })

    test('the Mac deletes p1, the phone then adds p2: p1 stays deleted', () => {
        const { s, phone, server1 } = phoneWroteP1()
        const mac = clone(charOf(server1)); mac.chats[0].message.splice(1, 1)
        const server2 = s.onWrite('mac', file(mac), server1).bytes
        phone.chats[0].message.push(msg('p2', 'second', 300))
        const r = s.onWrite('phone', file(phone), server2)
        expect(msgs(r.bytes)).toEqual(['m0=a', 'p2=second'])
    })

    test('a lost answer: the retry of the same bytes arrives after the Mac edited p1, and does not undo it', () => {
        const { s, phoneFile, server1 } = phoneWroteP1()
        const mac = clone(charOf(server1)); mac.chats[0].message[1].data = 'edited on mac'
        const server2 = s.onWrite('mac', file(mac), server1).bytes
        const r = s.onWrite('phone', phoneFile, server2)
        expect(msgs(r.bytes)).toEqual(['m0=a', 'p1=edited on mac'])
    })

    test('after a merged write the page still merges: what the other page added is not dropped by its next write', () => {
        const s = openDbSync({ dbFile: ':memory:' })
        const base = loaded()
        s.onRead('phone', base); s.onRead('mac', base)
        const mac = clone(charOf(base)); mac.chats[0].message.push(msg('x1', 'from mac', 150))
        const server1 = s.onWrite('mac', file(mac), base).bytes
        const phone = clone(charOf(base)); phone.chats[0].message.push(msg('p1', 'from phone', 200))
        const server2 = s.onWrite('phone', file(phone), server1)
        expect(server2.merged).toBe(true)
        phone.chats[0].message.push(msg('p2', 'second', 300))            // the phone never saw x1
        const r = s.onWrite('phone', file(phone), server2.bytes)
        expect(msgs(r.bytes)).toEqual(['m0=a', 'x1=from mac', 'p1=from phone', 'p2=second'])
    })

    test('the manifest a write leaves behind is dropped unless another page has it as its base', () => {
        const s = openDbSync({ dbFile: ':memory:' })
        let cur = loaded()
        s.onRead('phone', cur)
        const phone = clone(charOf(cur))
        for (let i = 1; i <= 20; i++) {
            phone.chats[0].message.push(msg(`p${i}`, 'x', 100 + i))
            cur = s.onWrite('phone', file(phone), cur).bytes
        }
        expect(s.db.prepare('SELECT COUNT(*) AS n FROM sync_manifest').get().n).toBeLessThanOrEqual(2)
    })
})
