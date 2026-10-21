// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const req = createRequire(import.meta.url)
const merge = req('../../../server/node/dbMerge.cjs')
const { openDbSync } = req('../../../server/node/dbSync.cjs')

type Block = { type: number; comp: number; name: string; value?: any; raw?: Buffer }
function save(blocks: Block[]): Buffer {
    return merge.encodeSave(blocks.map((b) => (b.raw ? { type: b.type, comp: b.comp, name: b.name, data: b.raw } : merge.serializeBlock(b.type, b.comp, b.name, b.value))))
}
const read = (buf: Buffer, name: string) => {
    const b = merge.decodeSave(buf).find((x: any) => x.name === name)
    return b ? merge.parseBlock(b) : undefined
}
const names = (buf: Buffer) => merge.decodeSave(buf).map((b: any) => b.name)

function world(extra: Partial<{ chars: any[]; root: any; modules: any[] }> = {}) {
    const chars = extra.chars ?? [
        { chaId: 'c1', name: 'Shadow Slave', globalLore: [{ comment: 'a' }], chats: [{ id: 'k1', message: ['hi'] }, { id: 'k2', message: ['yo'] }] },
        { chaId: 'c2', name: 'Other', globalLore: [], chats: [{ id: 'k3', message: [] }] },
    ]
    const root = extra.root ?? { maxResponse: 1000, aiModel: 'reverse_proxy', language: 'vi' }
    const dir = ['preset', 'modules', ...chars.map((c) => c.chaId)]
    return save([
        { type: 1, comp: 0, name: 'root', value: { ...root, __directory: dir } },
        { type: 4, comp: 0, name: 'preset', value: [{ name: 'p' }] },
        { type: 5, comp: 0, name: 'modules', value: extra.modules ?? [{ id: 'm1', name: 'One' }] },
        ...chars.map((c) => ({ type: 2, comp: 0, name: c.chaId, value: c })),
        { type: 0, comp: 0, name: 'config', raw: Buffer.from('{"v":1}') },
    ])
}
function edit(buf: Buffer, fn: (get: (n: string) => any, set: (n: string, v: any) => void) => void) {
    const blocks = merge.decodeSave(buf)
    const get = (n: string) => merge.parseBlock(blocks.find((b: any) => b.name === n))
    const set = (n: string, v: any) => {
        const i = blocks.findIndex((b: any) => b.name === n)
        const nb = merge.serializeBlock(i >= 0 ? blocks[i].type : 2, i >= 0 ? blocks[i].comp : 0, n, v)
        if (i >= 0) blocks[i] = nb
        else blocks.push(nb)
    }
    fn(get, set)
    return merge.encodeSave(blocks)
}
const M = (base: Buffer, ours: Buffer, theirs: Buffer) => merge.mergeSaves(merge.manifestOf(base), ours, theirs)

describe('container', () => {
    test('decode then encode is the same bytes, for plain and gzipped blocks', () => {
        const buf = save([{ type: 1, comp: 1, name: 'root', value: { a: 1 } }, { type: 2, comp: 0, name: 'c1', value: { chats: [] } }, { type: 11, comp: 0, name: 'pluginStorage', raw: Buffer.alloc(0) }])
        expect(merge.encodeSave(merge.decodeSave(buf)).equals(buf)).toBe(true)
        expect(() => merge.decodeSave(buf.subarray(0, buf.length - 3))).toThrow()
        expect(() => merge.decodeSave(Buffer.from('nope'))).toThrow()
    })
})

describe('three-way merge of a write', () => {
    const base = world()

    test('a page that changed nothing does not overwrite what the server has (the phone tab that erased the lorebook)', () => {
        const theirs = edit(base, (g, s) => { const c = g('c1'); c.globalLore.push({ comment: 'new lore' }); s('c1', c) })
        const r = M(base, base, theirs)
        expect(r.merged).toBe(true)
        expect(read(r.buf, 'c1').globalLore).toHaveLength(2)
    })

    test('a stale page that only changed its chat keeps the lorebook and the settings the other page wrote', () => {
        const theirs = edit(base, (g, s) => {
            const c = g('c1'); c.globalLore.push({ comment: 'new lore' }); s('c1', c)
            const r = g('root'); r.maxResponse = 8000; s('root', r)
        })
        const ours = edit(base, (g, s) => { const c = g('c1'); c.chats[0].message.push('tiến lên'); s('c1', c) })
        const r = M(base, ours, theirs)
        const c1 = read(r.buf, 'c1')
        expect(c1.globalLore).toHaveLength(2)                         // the other page's lore
        expect(c1.chats[0].message).toEqual(['hi', 'tiến lên'])       // this page's chat
        expect(read(r.buf, 'root').maxResponse).toBe(8000)           // the other page's setting
    })

    test('both pages changed the same key: the writing page wins', () => {
        const theirs = edit(base, (g, s) => { const r = g('root'); r.maxResponse = 4096; s('root', r) })
        const ours = edit(base, (g, s) => { const r = g('root'); r.maxResponse = 2000; s('root', r) })
        expect(read(M(base, ours, theirs).buf, 'root').maxResponse).toBe(2000)
    })

    test('two pages chat in different chats of the same character: both chats keep their new messages', () => {
        const theirs = edit(base, (g, s) => { const c = g('c1'); c.chats[1].message.push('from the laptop'); s('c1', c) })
        const ours = edit(base, (g, s) => { const c = g('c1'); c.chats[0].message.push('from the phone'); s('c1', c) })
        const c1 = read(M(base, ours, theirs).buf, 'c1')
        expect(c1.chats.find((x: any) => x.id === 'k1').message).toEqual(['hi', 'from the phone'])
        expect(c1.chats.find((x: any) => x.id === 'k2').message).toEqual(['yo', 'from the laptop'])
    })

    test('a chat both sides added (the phone made it, the server turn worker answered it from the turn): the reply and the server state stay', () => {
        // specs/turns: the phone was put away before its autosave; the worker rebuilt the chat from the turn, answered it and saved;
        // then the phone's late autosave arrived with the chat as it made it. Taking the page's copy whole erased the reply.
        const mk = (msgs: any[], scriptstate: any) => ({ id: 'k9', message: msgs, scriptstate })
        const greet = { role: 'char', data: 'greeting', chatId: 'g', time: 1 }
        const input = { role: 'user', data: 'Tôi gõ cửa', chatId: 'in', time: 2 }
        const reply = { role: 'char', data: 'reply', chatId: 'r', time: 3 }
        const theirs = edit(base, (g, s) => { const c = g('c1'); c.chats.unshift(mk([greet, input, reply], { $hp: '9' })); s('c1', c) })
        const ours = edit(base, (g, s) => { const c = g('c1'); c.chats.unshift(mk([greet], {})); s('c1', c) })
        const k9 = read(M(base, ours, theirs).buf, 'c1').chats.find((x: any) => x.id === 'k9')
        expect(k9.message.map((m: any) => m.chatId)).toEqual(['g', 'in', 'r'])
        expect(k9.scriptstate).toEqual({ $hp: '9' })
    })

    test('a chat started on the other page is kept, and a chat deleted by this page stays deleted', () => {
        const theirs = edit(base, (g, s) => { const c = g('c1'); c.chats.push({ id: 'k9', message: ['new'] }); s('c1', c) })
        const ours = edit(base, (g, s) => { const c = g('c1'); c.chats = c.chats.filter((x: any) => x.id !== 'k2'); s('c1', c) })
        const ids = read(M(base, ours, theirs).buf, 'c1').chats.map((x: any) => x.id)
        expect(ids).toEqual(['k1', 'k9'])
    })

    test('a chat deleted on the other page stays deleted while this page chats in another chat (reported: a deleted chat came back)', () => {
        // the laptop deletes k2; the phone, which loaded k2, then sends a message in k1 and writes its whole save
        const theirs = edit(base, (g, s) => { const c = g('c1'); c.chats = c.chats.filter((x: any) => x.id !== 'k2'); s('c1', c) })
        const ours = edit(base, (g, s) => { const c = g('c1'); c.chats[0].message.push('from the phone'); s('c1', c) })
        const c1 = read(M(base, ours, theirs).buf, 'c1')
        expect(c1.chats.map((x: any) => x.id)).toEqual(['k1'])
        expect(c1.chats[0].message).toEqual(['hi', 'from the phone'])
    })

    test('a chat deleted on the other page but written to on this one is kept (no message is lost)', () => {
        const theirs = edit(base, (g, s) => { const c = g('c1'); c.chats = c.chats.filter((x: any) => x.id !== 'k2'); c.chats[0].message.push('x'); s('c1', c) })
        const ours = edit(base, (g, s) => { const c = g('c1'); c.chats[1].message.push('still writing here'); s('c1', c) })
        const ids = read(M(base, ours, theirs).buf, 'c1').chats.map((x: any) => x.id)
        expect(ids).toEqual(['k1', 'k2'])
    })

    test('a character created on the other page is kept and listed in the directory', () => {
        const theirs = edit(base, (g, s) => { s('c3', { chaId: 'c3', name: 'Brand new', chats: [] }); const r = g('root'); r.__directory.push('c3'); s('root', r) })
        const ours = edit(base, (g, s) => { const c = g('c2'); c.name = 'Renamed'; s('c2', c) })
        const r = M(base, ours, theirs)
        expect(names(r.buf)).toContain('c3')
        expect(read(r.buf, 'root').__directory).toEqual(['preset', 'modules', 'c1', 'c2', 'c3'])
        expect(read(r.buf, 'c2').name).toBe('Renamed')
    })

    test('two characters created on two pages are both listed', () => {
        const theirs = edit(base, (g, s) => { s('c3', { chaId: 'c3', chats: [] }); const r = g('root'); r.__directory.push('c3'); s('root', r) })
        const ours = edit(base, (g, s) => { s('c4', { chaId: 'c4', chats: [] }); const r = g('root'); r.__directory.push('c4'); s('root', r) })
        const r = M(base, ours, theirs)
        expect(names(r.buf)).toEqual(expect.arrayContaining(['c3', 'c4']))
        expect(read(r.buf, 'root').__directory).toEqual(['preset', 'modules', 'c1', 'c2', 'c4', 'c3'])
    })

    test('a character deleted on the other page stays deleted if this page did not touch it, and survives if it did', () => {
        const dropC2 = (buf: Buffer) => { const bl = merge.decodeSave(buf).filter((b: any) => b.name !== 'c2'); return merge.encodeSave(bl) }
        const theirs = edit(dropC2(base), (g, s) => { const r = g('root'); r.__directory = r.__directory.filter((n: string) => n !== 'c2'); s('root', r) })
        const untouched = edit(base, (g, s) => { const c = g('c1'); c.chats[0].message.push('x'); s('c1', c) })
        expect(names(M(base, untouched, theirs).buf)).not.toContain('c2')
        const touched = edit(base, (g, s) => { const c = g('c2'); c.name = 'edited here'; s('c2', c) })
        const r = M(base, touched, theirs)
        expect(read(r.buf, 'c2').name).toBe('edited here')
        expect(read(r.buf, 'root').__directory).toContain('c2')
    })

    test('a character this page deleted stays deleted when the server did not change it, and stays when the server edited it', () => {
        const dropC2 = (buf: Buffer) => merge.encodeSave(merge.decodeSave(buf).filter((b: any) => b.name !== 'c2'))
        const ours = edit(dropC2(base), (g, s) => { const r = g('root'); r.__directory = r.__directory.filter((n: string) => n !== 'c2'); s('root', r) })
        const quiet = edit(base, (g, s) => { const c = g('c1'); c.name = 'other edit'; s('c1', c) })
        expect(names(M(base, ours, quiet).buf)).not.toContain('c2')
        const edited = edit(base, (g, s) => { const c = g('c2'); c.name = 'edited there'; s('c2', c) })
        const r = M(base, ours, edited)
        expect(read(r.buf, 'c2').name).toBe('edited there')
        expect(read(r.buf, 'root').__directory).toContain('c2')
    })

    test('a block that is raw bytes (config) follows the server when this page did not change it, and wins when it did', () => {
        const withConfig = (buf: Buffer, raw: string) => merge.encodeSave(merge.decodeSave(buf).map((b: any) => (b.name === 'config' ? { ...b, data: Buffer.from(raw) } : b)))
        const theirs = withConfig(base, '{"v":2}')
        const quiet = edit(base, (g, s) => { const c = g('c1'); c.name = 'x'; s('c1', c) })
        expect(merge.decodeSave(M(base, quiet, theirs).buf).find((b: any) => b.name === 'config').data.toString()).toBe('{"v":2}')
        const changed = withConfig(base, '{"v":3}')
        expect(merge.decodeSave(M(base, changed, theirs).buf).find((b: any) => b.name === 'config').data.toString()).toBe('{"v":3}')
    })

    test('modules are merged by id: a module added on one page and one on the other both stay', () => {
        const theirs = edit(base, (g, s) => { s('modules', [...g('modules'), { id: 'm2', name: 'Prose' }]) })
        const ours = edit(base, (g, s) => { s('modules', [...g('modules'), { id: 'm3', name: 'Mine' }]) })
        const ids = read(M(base, ours, theirs).buf, 'modules').map((x: any) => x.id)
        expect(ids.sort()).toEqual(['m1', 'm2', 'm3'])
    })

    test('nobody else wrote: the result is exactly the page file', () => {
        const ours = edit(base, (g, s) => { const c = g('c1'); c.name = 'x'; s('c1', c) })
        expect(M(base, ours, base).buf.equals(ours)).toBe(true)
    })

    test('no base, or a file that cannot be read: the page file is used as it is, as before', () => {
        const ours = edit(base, (g, s) => { const c = g('c1'); c.name = 'x'; s('c1', c) })
        expect(merge.mergeSaves(null, ours, base)).toMatchObject({ merged: false })
        expect(merge.mergeSaves(merge.manifestOf(base), Buffer.from('garbage'), base)).toMatchObject({ merged: false })
        expect(merge.mergeSaves(merge.manifestOf(base), ours, Buffer.from('garbage'))).toMatchObject({ merged: false })
    })

    test('gzipped blocks are merged and stay gzipped', () => {
        const b = save([{ type: 1, comp: 1, name: 'root', value: { a: 1, b: 1, __directory: [] } }])
        const theirs = edit(b, (g, s) => { const r = g('root'); r.a = 2; s('root', r) })
        const ours = edit(b, (g, s) => { const r = g('root'); r.b = 5; s('root', r) })
        const r = M(b, ours, theirs)
        expect(merge.decodeSave(r.buf)[0].comp).toBe(1)
        expect(read(r.buf, 'root')).toMatchObject({ a: 2, b: 5 })
    })

    test('property: for flat objects the result follows the rule key by key (random edits on both sides)', () => {
        let seed = 11
        const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
        const keys = ['a', 'b', 'c', 'd', 'e', 'f']
        for (let n = 0; n < 400; n++) {
            const b: any = {}
            for (const k of keys) if (rnd() < 0.8) b[k] = Math.floor(rnd() * 3)
            const mutate = (src: any) => {
                const o = { ...src }
                for (const k of keys) {
                    const r = rnd()
                    if (r < 0.2) o[k] = 10 + Math.floor(rnd() * 3)
                    else if (r < 0.3) delete o[k]
                }
                return o
            }
            const o = mutate(b)
            const t = mutate(b)
            const base = save([{ type: 1, comp: 0, name: 'root', value: { ...b, __directory: [] } }])
            const ours = save([{ type: 1, comp: 0, name: 'root', value: { ...o, __directory: [] } }])
            const theirs = save([{ type: 1, comp: 0, name: 'root', value: { ...t, __directory: [] } }])
            const out = read(M(base, ours, theirs).buf, 'root')
            for (const k of keys) {
                const inO = k in o, inT = k in t, inB = k in b
                let expected: any
                let present: boolean
                if (inO && inT) { present = true; expected = inB && o[k] === b[k] ? t[k] : o[k] }
                else if (inO) { present = !(inB && o[k] === b[k]); expected = o[k] }
                else if (inT) { present = !(inB && t[k] === b[k]); expected = t[k] }
                else { present = false }
                expect(k in out).toBe(present)
                if (present) expect(out[k]).toBe(expected)
            }
        }
    })
})

describe('per page bookkeeping', () => {
    const fresh = () => openDbSync({ dbFile: ':memory:' })
    const base = world()

    test('a page that is alone is stored as it wrote it (fast path), whatever the number of saves', () => {
        const s = fresh()
        s.onRead('A', base)
        let cur = base
        for (let i = 0; i < 5; i++) {
            const ours = edit(cur, (g, set) => { const c = g('c1'); c.chats[0].message.push('m' + i); set('c1', c) })
            const r = s.onWrite('A', ours, cur)
            expect(r.how).toBe('fast')
            expect(r.bytes.equals(ours)).toBe(true)
            cur = r.bytes
        }
    })

    test('the incident: a stale page saves after another page changed the lorebook and the settings', () => {
        const s = fresh()
        s.onRead('phone', base)
        s.onRead('mac', base)
        // the mac changes lore and Max Response, saves (fast: nobody else wrote)
        const macFile = edit(base, (g, set) => { const c = g('c1'); c.globalLore.push({ comment: 'new' }); set('c1', c); const r = g('root'); r.maxResponse = 8000; set('root', r) })
        const w1 = s.onWrite('mac', macFile, base)
        expect(w1.how).toBe('fast')
        // the phone chats with its old copy and saves: merged, the mac's work stays
        const phoneFile = edit(base, (g, set) => { const c = g('c1'); c.chats[0].message.push('tiến lên'); set('c1', c) })
        const w2 = s.onWrite('phone', phoneFile, w1.bytes)
        expect(w2).toMatchObject({ how: 'merged', merged: true })
        expect(read(w2.bytes, 'c1').globalLore).toHaveLength(2)
        expect(read(w2.bytes, 'c1').chats[0].message).toEqual(['hi', 'tiến lên'])
        expect(read(w2.bytes, 'root').maxResponse).toBe(8000)
        // and again: the phone saves a second time with the same old base, still nothing of the mac's is lost
        const phoneFile2 = edit(phoneFile, (g, set) => { const c = g('c1'); c.chats[0].message.push('thêm'); set('c1', c) })
        const w3 = s.onWrite('phone', phoneFile2, w2.bytes)
        expect(w3.how).toBe('merged')
        expect(read(w3.bytes, 'c1').globalLore).toHaveLength(2)
        expect(read(w3.bytes, 'root').maxResponse).toBe(8000)
        expect(read(w3.bytes, 'c1').chats[0].message).toEqual(['hi', 'tiến lên', 'thêm'])
    })

    test('a page the server never saw load is stored as it wrote (as before) and becomes known', () => {
        const s = fresh()
        s.onRead('A', base)
        const w1 = s.onWrite('X', edit(base, (g, set) => { const c = g('c1'); c.name = 'x'; set('c1', c) }), base)
        expect(w1.how).toBe('unknown page')
        // X is known now: its later write is compared with what it wrote, so another page's change in between is kept
        const aFile = edit(w1.bytes, (g, set) => { const r = g('root'); r.language = 'en'; set('root', r) })
        const wa = s.onWrite('A', aFile, w1.bytes)
        // A's file already has X's change, so the merge takes nothing from the server and is stored as a plain write
        expect(['merged', 'fast', 'merged, nothing from the server']).toContain(wa.how)
        const xFile = edit(w1.bytes, (g, set) => { const c = g('c1'); c.name = 'y'; set('c1', c) })
        const w2 = s.onWrite('X', xFile, wa.bytes)
        expect(w2.how).toBe('merged')
        expect(read(w2.bytes, 'root').language).toBe('en')
        expect(read(w2.bytes, 'c1').name).toBe('y')
    })

    test('revisions and bases survive a restart', () => {
        const file = join(mkdtempSync(join(tmpdir(), 'dbsync-')), 's.sqlite')
        let s = openDbSync({ dbFile: file })
        s.onRead('phone', base)
        s.onRead('mac', base)
        const macFile = edit(base, (g, set) => { const r = g('root'); r.maxResponse = 8000; set('root', r) })
        const w1 = s.onWrite('mac', macFile, base)
        s.close()
        s = openDbSync({ dbFile: file })
        expect(s.currentRev()).toBe(w1.rev)
        const phoneFile = edit(base, (g, set) => { const c = g('c1'); c.name = 'chat'; set('c1', c) })
        const w2 = s.onWrite('phone', phoneFile, w1.bytes)
        expect(w2.how).toBe('merged')
        expect(read(w2.bytes, 'root').maxResponse).toBe(8000)
    })

    test('a block of the server file that is broken is replaced by the page copy, never carried into the result', () => {
        const s = fresh()
        s.onRead('A', base)
        s.onRead('B', base)
        const aFile = edit(base, (g, set) => { const r = g('root'); r.maxResponse = 8000; set('root', r) })
        s.onWrite('A', aFile, base)
        const broken = merge.encodeSave(merge.decodeSave(aFile).map((b: any) => (b.name === 'c1' ? { ...b, data: Buffer.from('{not json') } : b)))
        const r = s.onWrite('B', edit(base, (g, set) => { const c = g('c1'); c.name = 'q'; set('c1', c) }), broken)
        expect(read(r.bytes, 'c1').name).toBe('q')
        expect(() => merge.validateSave(r.bytes)).not.toThrow()
        expect(read(r.bytes, 'root').maxResponse).toBe(8000)
    })

    test('validateSave rejects what would not read back', () => {
        const ok = world()
        expect(merge.validateSave(ok)).toBeGreaterThan(3)
        const broken = merge.encodeSave(merge.decodeSave(ok).map((b: any) => (b.name === 'c1' ? { ...b, data: Buffer.from('{not json') } : b)))
        expect(() => merge.validateSave(broken)).toThrow()
        expect(() => merge.validateSave(ok.subarray(0, ok.length - 2))).toThrow()
    })

    test('a page open for longer than `keep` revisions keeps its base: its write is merged, not stored whole (F4)', () => {
        const s = openDbSync({ dbFile: ':memory:', keep: 2 })
        s.onRead('phone', base)
        let cur = base
        for (let i = 0; i < 6; i++) {
            const f = edit(cur, (g, set) => { const r = g('root'); r.maxResponse = 100 + i; set('root', r) })
            cur = s.onWrite('mac', f, cur).bytes
            if (i === 5) s.onRead('mac', cur)   // a read prunes revisions older than rev - keep
        }
        const r = s.onWrite('phone', edit(base, (g, set) => { const c = g('c1'); c.name = 'z'; set('c1', c) }), cur)
        expect(r.how).toBe('merged')
        expect(read(r.bytes, 'root').maxResponse).toBe(105)   // was 1000 again: the stale file was stored whole ('base pruned')
        expect(read(r.bytes, 'c1').name).toBe('z')
        // revisions nobody has as a base are still pruned. The phone's merged write makes its own file its base (a negative id,
        // dbSync.cjs; specs/chat/DbSync.tla AdvanceBase), so rev 1, which it held until then, goes too; 7 is the Mac's read
        const kept = s.db.prepare('SELECT rev FROM sync_manifest ORDER BY rev').all().map((x: any) => x.rev)
        expect(kept).toEqual([-1, 7])
    })
})

describe('a page that holds something other than what it read (F7: a backup, read-without-replace)', () => {
    // 2026-10-19: chat 4c9bb225 was restored at rev 1688 and gone again at 1699. The page then DID hold it (its first save, rev 1692,
    // and the backup it wrote with it list both chats), so that loss was the page's own removal. But one path really deletes what a page
    // never had: the server records the base at GET database.bin, and bootstrap.ts loads a dbbackup-*.bin when that file does not
    // decode. The page then holds the backup, while its base says it holds the served file; everything newer than the backup is
    // "missing from the page" = deleted by it.
    const served = world()   // the server's file: chats k1 and k2
    const backup = edit(served, (g, set) => { const c = g('c1'); c.chats = [c.chats[0]]; set('c1', c) })   // older: only k1

    test('without onLoaded (the code before): the page writes its backup plus an edit and the chat it never had (k2) is deleted', () => {
        const s = openDbSync({ dbFile: ':memory:' })
        s.onRead('A', served)
        const ours = edit(backup, (g, set) => { const c = g('c1'); c.chats[0].message.push('after reload'); set('c1', c) })
        const r = s.onWrite('A', ours, served)
        // this is what the server did: fast path, the page's file stored whole
        expect(r.how).toBe('fast')
        expect(read(r.bytes, 'c1').chats.map((c: any) => c.id)).toEqual(['k1'])
    })

    test('with the fix: the page says what it loaded (onLoaded), its write is merged against that, and k2 stays', () => {
        const s = openDbSync({ dbFile: ':memory:' })
        s.onRead('A', served)
        s.onLoaded('A', backup)
        const ours = edit(backup, (g, set) => { const c = g('c1'); c.chats[0].message.push('after reload'); set('c1', c) })
        const r = s.onWrite('A', ours, served)
        expect(r.how).toBe('merged')
        const chats = read(r.bytes, 'c1').chats
        expect(chats.map((c: any) => c.id).sort()).toEqual(['k1', 'k2'])
        expect(chats.find((c: any) => c.id === 'k1').message).toEqual(['hi', 'after reload'])
        // and it stays merged on the next write (its memory is still the backup plus its edits), until it reads again
        const r2 = s.onWrite('A', edit(ours, (g, set) => { const c = g('c1'); c.name = 'n'; set('c1', c) }), r.bytes)
        expect(r2.how).toBe('merged')
        expect(read(r2.bytes, 'c1').chats.map((c: any) => c.id).sort()).toEqual(['k1', 'k2'])
        s.onRead('A', r2.bytes)
        expect(s.onWrite('A', r2.bytes, r2.bytes).how).toBe('fast')
    })

    test('a page that deletes a chat it DID load still deletes it (the rule is unchanged for what it holds)', () => {
        const s = openDbSync({ dbFile: ':memory:' })
        s.onRead('A', served)
        s.onLoaded('A', served)
        const ours = edit(served, (g, set) => { const c = g('c1'); c.chats = [c.chats[0]]; set('c1', c) })
        const r = s.onWrite('A', ours, served)
        expect(read(r.bytes, 'c1').chats.map((c: any) => c.id)).toEqual(['k1'])
    })

    test('the loaded base is pinned against pruning and does not stop write rows from being pruned', () => {
        const s = openDbSync({ dbFile: ':memory:', keep: 2 })
        s.onRead('A', served)
        s.onLoaded('A', backup)
        let cur = served
        for (let i = 0; i < 6; i++) {
            const f = edit(cur, (g, set) => { const r = g('root'); r.maxResponse = 100 + i; set('root', r) })
            cur = s.onWrite('B', f, cur).bytes
            s.onRead('B', cur)
        }
        const r = s.onWrite('A', edit(backup, (g, set) => { const c = g('c1'); c.name = 'z'; set('c1', c) }), cur)
        expect(r.how).toBe('merged')
        expect(read(r.bytes, 'root').maxResponse).toBe(105)
        expect(read(r.bytes, 'c1').chats.map((c: any) => c.id).sort()).toEqual(['k1', 'k2'])
        const writes = s.db.prepare('SELECT COUNT(*) AS n FROM sync_write').get().n
        expect(writes).toBeLessThan(7)
    })
})
