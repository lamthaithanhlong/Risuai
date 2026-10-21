// @vitest-environment node
// remotes/<chaId>.local.bin: with enableRemoteSaving a character and ALL its chats live in that file, which every page writes whole.
// database.bin only points at it, so dbMerge/dbSync never saw a chat and the last page to save erased the other's messages
// (tests/turns/repro.mjs --scenarios double: the first reply was gone after a later page write). The server now merges the file like a
// character block against the version the page last read or wrote (specs/chat/RemoteSync.tla: NoLostAck, NoResurrect).
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const req = createRequire(import.meta.url)
const merge = req('../../../server/node/dbMerge.cjs')
const { openDbSync } = req('../../../server/node/dbSync.cjs')

const msg = (id: string, data: string, time: number) => ({ chatId: id, role: 'user', data, time })
const file = (char: any) => Buffer.from(JSON.stringify(char), 'utf8')
const charOf = (buf: Buffer) => JSON.parse(buf.toString('utf8'))
const chatMsgs = (buf: Buffer, chat = 'k1') => charOf(buf).chats.find((c: any) => c.id === chat).message.map((m: any) => `${m.chatId}=${m.data}`)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const NAME = 'cha1'
const start = () => file({ chaId: NAME, name: 'Mailman', chatPage: 0, chats: [{ id: 'k1', name: 'one', message: [msg('m0', 'hello', 100)] }] })

/** a sync store with the file written once by the Mac, then read by the Mac and the phone */
function twoPages() {
    const s = openDbSync({ dbFile: ':memory:' })
    const v0 = start()
    s.onRemoteWrite('mac', NAME, v0, null)
    s.onRemoteRead('mac', NAME, v0)
    s.onRemoteRead('phone', NAME, v0)
    return { s, v0, mac: clone(charOf(v0)), phone: clone(charOf(v0)) }
}

describe('two pages write one remote character file', () => {
    test('each adds a message: both are kept (the old code kept only the last writer\'s)', () => {
        const { s, v0, mac, phone } = twoPages()
        mac.chats[0].message.push(msg('a1', 'from mac', 200))
        phone.chats[0].message.push(msg('p1', 'from phone', 210))
        const w1 = s.onRemoteWrite('mac', NAME, file(mac), v0)
        expect(w1.merged).toBe(false)
        const w2 = s.onRemoteWrite('phone', NAME, file(phone), w1.bytes)
        expect(w2.merged).toBe(true)
        expect(chatMsgs(w2.bytes)).toEqual(['m0=hello', 'a1=from mac', 'p1=from phone'])
    })

    test('the phone\'s next write still carries the Mac\'s message, and the Mac\'s delete of it is not undone', () => {
        const { s, v0, mac, phone } = twoPages()
        mac.chats[0].message.push(msg('a1', 'from mac', 200))
        const server1 = s.onRemoteWrite('mac', NAME, file(mac), v0).bytes
        phone.chats[0].message.push(msg('p1', 'from phone', 210))
        const server2 = s.onRemoteWrite('phone', NAME, file(phone), server1).bytes            // merged: a1 comes from the server
        // the Mac deletes a1; the phone, which never saw a1, adds p2
        mac.chats[0].message = mac.chats[0].message.filter((m: any) => m.chatId !== 'a1')
        s.onRemoteRead('mac', NAME, server2)
        const macAfter = clone(charOf(server2)); macAfter.chats[0].message = macAfter.chats[0].message.filter((m: any) => m.chatId !== 'a1')
        const server3 = s.onRemoteWrite('mac', NAME, file(macAfter), server2).bytes
        phone.chats[0].message.push(msg('p2', 'again', 300))
        const server4 = s.onRemoteWrite('phone', NAME, file(phone), server3).bytes
        expect(chatMsgs(server4)).toEqual(['m0=hello', 'p1=from phone', 'p2=again'])
    })

    test('a page that changed nothing since it read follows the server, byte for byte', () => {
        const { s, v0, mac, phone } = twoPages()
        mac.chats[0].message.push(msg('a1', 'from mac', 200))
        const server1 = s.onRemoteWrite('mac', NAME, file(mac), v0).bytes
        const w = s.onRemoteWrite('phone', NAME, file(phone), server1)     // the phone rewrote the old file as it was
        expect(w.merged).toBe(true)
        expect(w.bytes.equals(server1)).toBe(true)
    })

    test('a page that never read the file (the server did not know it) is stored as written', () => {
        const { s, v0 } = twoPages()
        const other = clone(charOf(v0)); other.chats[0].message.push(msg('x1', 'x', 400))
        const w = s.onRemoteWrite('stranger', NAME, file(other), v0)
        expect(w.how).toBe('unknown page')
        expect(w.bytes.equals(file(other))).toBe(true)
    })

    test('a chat both pages created, and a chat only one of them has, survive', () => {
        const { s, v0, mac, phone } = twoPages()
        mac.chats.push({ id: 'k2', name: 'mac chat', message: [msg('a1', 'new chat', 200)] })
        phone.chats.push({ id: 'k3', name: 'phone chat', message: [msg('p1', 'other chat', 210)] })
        const server1 = s.onRemoteWrite('mac', NAME, file(mac), v0).bytes
        const server2 = s.onRemoteWrite('phone', NAME, file(phone), server1).bytes
        expect(charOf(server2).chats.map((c: any) => c.id).sort()).toEqual(['k1', 'k2', 'k3'])
    })

    test('a top-level key the page did not change follows the server (the server moved chatPage), one it changed wins', () => {
        const { s, v0, mac, phone } = twoPages()
        mac.chatPage = 2
        const server1 = s.onRemoteWrite('mac', NAME, file(mac), v0).bytes
        phone.name = 'renamed on phone'
        const server2 = s.onRemoteWrite('phone', NAME, file(phone), server1).bytes
        expect(charOf(server2)).toMatchObject({ chatPage: 2, name: 'renamed on phone' })
    })

    test('a merge that took nothing from the server stores the page\'s own bytes and is not a merge', () => {
        const { s, v0, mac } = twoPages()
        // the server's file differs from the page's base in bytes only (same content, other spacing): nothing to take from it
        const respaced = Buffer.from(JSON.stringify(charOf(v0), null, 1), 'utf8')
        mac.chats[0].message.push(msg('a1', 'x', 200))
        const w = s.onRemoteWrite('mac', NAME, file(mac), respaced)
        expect(w.how).toBe('merged, nothing from the server')
        expect(w.merged).toBe(false)
        expect(w.bytes.equals(file(mac))).toBe(true)
    })

    test('the bases survive a restart of the store (a file database)', () => {
        const dbFile = join(mkdtempSync(join(tmpdir(), 'remote-sync-')), 'sync.sqlite')
        const s1 = openDbSync({ dbFile })
        const v0 = start()
        s1.onRemoteWrite('mac', NAME, v0, null)
        s1.onRemoteRead('phone', NAME, v0)
        s1.close()
        const s2 = openDbSync({ dbFile })
        const mac = clone(charOf(v0)); mac.chats[0].message.push(msg('a1', 'from mac', 200))
        const phone = clone(charOf(v0)); phone.chats[0].message.push(msg('p1', 'from phone', 210))
        const server1 = s2.onRemoteWrite('mac', NAME, file(mac), v0).bytes
        expect(chatMsgs(s2.onRemoteWrite('phone', NAME, file(phone), server1).bytes)).toEqual(['m0=hello', 'a1=from mac', 'p1=from phone'])
    })

    test('versions nobody has as its base are dropped, and another file is not mixed in', () => {
        const { s, v0, mac, phone } = twoPages()
        s.onRemoteRead('phone', 'other', file({ chaId: 'other', chats: [] }))
        mac.chats[0].message.push(msg('a1', 'from mac', 200))
        const server1 = s.onRemoteWrite('mac', NAME, file(mac), v0).bytes
        phone.chats[0].message.push(msg('p1', 'from phone', 210))
        expect(chatMsgs(s.onRemoteWrite('phone', NAME, file(phone), server1).bytes)).toHaveLength(3)
        // mac holds its own file, phone its own: two versions of NAME and one of 'other'
        expect(s.db.prepare('SELECT COUNT(*) AS n FROM sync_remote_blob').get().n).toBe(3)
    })

    test('not JSON: stored as written, never lost', () => {
        const { s, v0 } = twoPages()
        const junk = Buffer.from('not json')
        const w = s.onRemoteWrite('phone', NAME, junk, Buffer.concat([v0, Buffer.from(' ')]))
        expect(w.bytes.equals(junk)).toBe(true)
    })
})

describe('mergeRemote', () => {
    test('messages are interleaved by time, the page\'s own order kept', () => {
        const v0 = start()
        const base = merge.manifestOfRemote(v0)
        const ours = clone(charOf(v0)); ours.chats[0].message.push(msg('p1', 'phone', 300))
        const theirs = clone(charOf(v0)); theirs.chats[0].message.push(msg('a1', 'mac', 200))
        const r = merge.mergeRemote(base, file(ours), file(theirs))
        expect(chatMsgs(r.buf)).toEqual(['m0=hello', 'a1=mac', 'p1=phone'])
        expect(r.report.chatsMerged).toBe(1)
    })
})
