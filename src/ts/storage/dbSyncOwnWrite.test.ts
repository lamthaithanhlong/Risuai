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

// After one merged write the page's base was a negative manifest for good, so every later save of it was merged again although the
// merge took nothing from the server (live log, 2026-10-19: "0 parts from the server, 0 both-changed" on every save, ~120-150 ms of the
// event loop each). specs/chat/DbSync.tla AfterMerge = "ifempty" (_EMPTYPLAIN green, _ALWAYSPLAIN red).
describe('a merge that took nothing from the server is a plain write', () => {
    function otherPageWroteSame() {
        const s = openDbSync({ dbFile: ':memory:' })
        const base = loaded()
        s.onRead('phone', base); s.onRead('mac', base)
        const server1 = s.onWrite('mac', base, base).bytes               // the Mac saves what it loaded: foreign for the phone
        return { s, base, server1 }
    }

    test('the page\'s own bytes are stored, it is not told "merged", and its next save takes the fast path', () => {
        const { s, base, server1 } = otherPageWroteSame()
        const phone = clone(charOf(base)); phone.chats[0].message.push(msg('p1', 'from phone', 200))
        const phoneFile = file(phone)
        const r = s.onWrite('phone', phoneFile, server1)
        expect(r.how).toBe('merged, nothing from the server')
        expect(r.merged).toBe(false)
        expect(Buffer.compare(r.bytes, phoneFile)).toBe(0)
        expect(s.db.prepare('SELECT base_rev FROM sync_client WHERE client = ?').get('phone').base_rev).toBe(r.rev)
        phone.chats[0].message.push(msg('p2', 'second', 300))
        const r2 = s.onWrite('phone', file(phone), r.bytes)
        expect(r2.how).toBe('fast')
        expect(msgs(r2.bytes)).toEqual(['m0=a', 'p1=from phone', 'p2=second'])
    })

    test('a later write of the other page is still merged into the page\'s next save', () => {
        const { s, base, server1 } = otherPageWroteSame()
        const phone = clone(charOf(base)); phone.chats[0].message.push(msg('p1', 'from phone', 200))
        const server2 = s.onWrite('phone', file(phone), server1).bytes
        const mac = clone(charOf(base)); mac.chats[0].message.push(msg('x1', 'from mac', 250))
        const server3 = s.onWrite('mac', file(mac), server2)
        expect(server3.merged).toBe(true)                                // the Mac takes p1 from the server
        phone.chats[0].message.push(msg('p2', 'second', 300))
        const r = s.onWrite('phone', file(phone), server3.bytes)
        expect(r.how).toBe('merged')
        expect(msgs(r.bytes)).toEqual(['m0=a', 'p1=from phone', 'x1=from mac', 'p2=second'])
    })

    // what the merge takes from the server is counted three ways; each one alone must keep the write merged
    const rootFile = (root: any, char: any) => merge.encodeSave([
        merge.serializeBlock(1, 0, 'root', { maxResponse: 4096, __directory: ['c1'], ...root }),
        merge.serializeBlock(2, 0, 'c1', char),
    ])
    test('the other page changed another key of the same block (fromServer): it is kept, now and in the next save', () => {
        const { s, base } = otherPageWroteSame()
        const server2 = s.onWrite('mac', rootFile({ maxResponse: 8000 }, charOf(base)), base).bytes
        const r = s.onWrite('phone', rootFile({ language: 'vi' }, charOf(base)), server2)
        expect([r.how, r.report.fromServer, r.report.blocksFromServer, r.report.conflicts]).toEqual(['merged', 1, 0, 0])
        expect(merge.parseBlock(merge.decodeSave(r.bytes)[0])).toMatchObject({ maxResponse: 8000, language: 'vi' })
        const r2 = s.onWrite('phone', rootFile({ language: 'en' }, charOf(base)), r.bytes)
        expect(merge.parseBlock(merge.decodeSave(r2.bytes)[0])).toMatchObject({ maxResponse: 8000, language: 'en' })
    })

    test('the other page changed a block the page did not touch (blocksFromServer): it is kept, now and in the next save', () => {
        const { s, base } = otherPageWroteSame()
        const server2 = s.onWrite('mac', rootFile({ maxResponse: 8000 }, charOf(base)), base).bytes
        const phone = clone(charOf(base)); phone.chats[0].message.push(msg('p1', 'from phone', 200))
        const r = s.onWrite('phone', rootFile({}, phone), server2)
        expect([r.how, r.report.fromServer, r.report.blocksFromServer, r.report.conflicts]).toEqual(['merged', 0, 1, 0])
        expect(merge.parseBlock(merge.decodeSave(r.bytes)[0]).maxResponse).toBe(8000)
        phone.chats[0].message.push(msg('p2', 'second', 300))
        const r2 = s.onWrite('phone', rootFile({}, phone), r.bytes)
        expect(merge.parseBlock(merge.decodeSave(r2.bytes)[0]).maxResponse).toBe(8000)
        expect(msgs(r2.bytes)).toEqual(['m0=a', 'p1=from phone', 'p2=second'])
    })

    test('a key both pages changed is a conflict: the page wins and the write stays merged; the next one finds nothing and is plain', () => {
        const { s, base } = otherPageWroteSame()
        const rootOf = (n: number, char: any) => rootFile({ maxResponse: n }, char)
        const server2 = s.onWrite('mac', rootOf(1000, charOf(base)), base).bytes
        const r = s.onWrite('phone', rootOf(2000, charOf(base)), server2)
        expect(r.report.conflicts).toBe(1)
        expect(r.how).toBe('merged')
        const r2 = s.onWrite('phone', rootOf(2000, charOf(base)), r.bytes)
        expect(r2.how).toBe('merged, nothing from the server')
    })

    test('a page that loaded a backup and takes a newer chat from the server stays merged (F7)', () => {
        const s = openDbSync({ dbFile: ':memory:' })
        const backup = loaded()
        const newer = clone(charOf(backup)); newer.chats.push({ id: 'k2', message: [msg('n1', 'newer chat', 150)] })
        const served = file(newer)
        s.onRead('phone', served)
        s.onLoaded('phone', backup)
        const phone = clone(charOf(backup)); phone.chats[0].message.push(msg('p1', 'from phone', 200))
        const r = s.onWrite('phone', file(phone), served)
        expect(r.how).toBe('merged')
        expect(charOf(r.bytes).chats.map((c: any) => c.id)).toEqual(['k1', 'k2'])
        const r2 = s.onWrite('phone', file(phone), r.bytes)
        expect(r2.how).toBe('merged')                                    // the phone still lacks k2: never a fast write that drops it
        expect(charOf(r2.bytes).chats.map((c: any) => c.id)).toEqual(['k1', 'k2'])
    })
})

// The rule above stores the page's bytes instead of the merge's result. That is only right if a merge whose report counts nothing
// from the server and no conflict yields exactly the page's file; this checks it on random saves (both sides edit keys, chats,
// messages, an id list, a raw block, whole blocks), with the merge's own blocks and values compared, not their order or bytes.
describe('mergeSaves: nothing counted from the server means the result is the page\'s file', () => {
    let seed = 7
    const rnd = (n: number) => {                                         // mulberry32: a fixed sequence, every bit random
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) % n
    }
    const pick = <T>(xs: T[]): T => xs[rnd(xs.length)]
    type Save = Map<string, { type: number, value: any }>
    // like the page (risuSave.ts encode): the root's __directory lists every other block. A file that does not is repaired by the
    // merge (repairDirectory) and stored as it is by the fast path; a page never writes one.
    const encode = (sv: Save) => {
        const root = sv.get('root')
        if (root) root.value.__directory = [...sv.keys()].filter((k) => k !== 'root')
        return merge.encodeSave([...sv].map(([name, b]) =>
            b.type === 0 ? { type: 0, comp: 0, name, data: Buffer.from(String(b.value)) } : merge.serializeBlock(b.type, rnd(2), name, b.value)))
    }
    const canon = (buf: Buffer) => Object.fromEntries(merge.decodeSave(buf).map((b: any) =>
        [b.name, b.type === 0 ? 'raw:' + b.data.toString() : merge.hashValue(merge.parseBlock(b))]))
    const start = (): Save => new Map<string, { type: number, value: any }>([
        ['root', { type: 1, value: { maxResponse: 4096, a: 1, b: 'x', __directory: ['c1', 'c2', 'presets', 'cfg'] } }],
        ['c1', { type: 2, value: { chaId: 'c1', name: 'one', chats: [{ id: 'k1', message: [msg('m0', 'a', 100), msg('m1', 'b', 110)] }] } }],
        ['c2', { type: 2, value: { chaId: 'c2', name: 'two', chats: [{ id: 'k2', message: [msg('n0', 'a', 100)] }, { id: 'k3', message: [msg('q0', 'q', 90)] }] } }],
        ['presets', { type: 3, value: [{ id: 'p1', v: 1 }, { id: 'p2', v: 2 }] }],
        ['cfg', { type: 0, value: 'raw-1' }],
    ])
    const copy = (sv: Save): Save => new Map([...sv].map(([k, b]) => [k, { type: b.type, value: clone(b.value) }]))
    // one random edit, as a function so that the same edit can be applied to both sides
    function randomEdit(): (sv: Save) => void {
        const v = rnd(5) + 1
        const which = rnd(12)
        const ch = pick(['c1', 'c2'])
        return (sv) => {
            const blk = sv.get(ch)?.value
            const chat = blk?.chats?.[0]
            switch (which) {
                case 0: if (sv.get('root')) sv.get('root')!.value.a = v; break
                case 1: if (sv.get('root')) delete sv.get('root')!.value.b; break
                case 2: if (sv.get('root')) sv.get('root')!.value['new' + v] = v; break
                case 3: if (chat) chat.message.push(msg('x' + v, 'add' + v, 200 + v)); break
                case 4: if (chat && chat.message.length > 1) chat.message[0].data = 'edit' + v; break
                case 5: if (chat && chat.message.length > 1) chat.message.splice(1, 1); break
                case 6: if (blk) blk.name = 'name' + v; break
                case 7: if (blk?.chats?.length > 1) blk.chats.pop(); else if (blk) blk.chats.push({ id: 'k' + (10 + v), message: [msg('z' + v, 'z', 300)] }); break
                case 8: { const pr = sv.get('presets'); if (pr) pr.value = [...pr.value.filter((e: any) => e.id !== 'p' + v), { id: 'p' + v, v: v * 10 }] } break
                case 9: if (sv.get('cfg')) sv.get('cfg')!.value = 'raw-' + v; break
                case 10: if (sv.has(ch)) sv.delete(ch); else sv.set(ch, { type: 2, value: { chaId: ch, name: 'back' + v, chats: [] } }); break
                case 11: sv.set('extra' + (v % 2), { type: 4, value: { k: v } }); break
            }
        }
    }

    test('3000 random three-way merges', () => {
        let empty = 0
        let nonEmpty = 0
        for (let i = 0; i < 3000; i++) {
            const base = start()
            const edits = Array.from({ length: 1 + rnd(4) }, randomEdit)
            const ours = copy(base); for (const e of edits) e(ours)
            // the server has: what the page loaded, some of the page's own edits (an earlier save of it), and sometimes another page's
            const theirs = copy(base)
            for (const e of edits) if (rnd(2)) e(theirs)
            if (rnd(2)) for (let j = rnd(3); j >= 0; j--) randomEdit()(theirs)
            const baseBuf = encode(base)
            const oursBuf = encode(ours)
            const r = merge.mergeSaves(merge.manifestOf(baseBuf), oursBuf, encode(theirs))
            expect(r.merged).toBe(true)
            if (r.report.fromServer === 0 && r.report.blocksFromServer === 0 && r.report.conflicts === 0) {
                empty++
                expect(canon(r.buf)).toEqual(canon(oursBuf))
            } else {
                nonEmpty++
            }
        }
        expect(empty).toBeGreaterThan(250)
        expect(nonEmpty).toBeGreaterThan(250)
    })
})
