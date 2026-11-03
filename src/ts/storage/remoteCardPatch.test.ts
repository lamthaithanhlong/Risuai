import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// the server-side CLI: patching a REMOTE card's lorebook without touching its chats
const require = createRequire(import.meta.url)
const { patchRemoteBytes, patchRemoteCard, hexKey } = require('../../../server/node/remoteCardPatch.cjs')
const { openSaveStore } = require('../../../server/node/saveStore.cjs')

const card = () => ({
    name: 'Zombie', chaId: 'fc27f53b-0000', desc: 'd',
    globalLore: [
        { key: 'a', comment: 'Rules', content: 'old rules', mode: 'normal', alwaysActive: true },
        { key: 'b', comment: 'Evelyn', content: 'old evelyn', mode: 'normal', alwaysActive: false },
    ],
    chats: [{ id: 'c1', name: 'Chat 1', message: [{ role: 'user', data: 'xin chào' }, { role: 'char', data: 'Evelyn hiện ra' }] }],
})
const bytes = () => Buffer.from(JSON.stringify(card()), 'utf8')

describe('patchRemoteBytes', () => {
    it('replaces the entry with that comment, keeps the other entry and every message', () => {
        const { out, report } = patchRemoteBytes(bytes(), { entry: { comment: 'Evelyn', key: 'b', content: 'new evelyn' } })
        const c = JSON.parse(out.toString('utf8'))
        expect(c.globalLore.find((e: any) => e.comment === 'Evelyn').content).toBe('new evelyn')
        expect(c.globalLore.find((e: any) => e.comment === 'Rules').content).toBe('old rules')
        expect(c.chats).toEqual(card().chats)
        expect(report.lore).toEqual([2, 2])
        expect(report.messages).toBe(2)
    })

    it('replaces the description with --desc and leaves the lore and every message alone', () => {
        const { out } = patchRemoteBytes(bytes(), { desc: 'new description' })
        const c = JSON.parse(out.toString('utf8'))
        expect(c.desc).toBe('new description')
        expect(c.globalLore).toEqual(card().globalLore)
        expect(c.chats).toEqual(card().chats)
    })

    it('refuses an empty description', () => {
        expect(() => patchRemoteBytes(bytes(), { desc: '  ' })).toThrow(/empty/)
    })

    it('adds an entry whose comment is new', () => {
        const { out } = patchRemoteBytes(bytes(), { entry: { comment: 'Haruto', key: 'h', content: 'x' } })
        expect(JSON.parse(out.toString('utf8')).globalLore).toHaveLength(3)
    })

    it('replaces the whole book with --lore', () => {
        const { out } = patchRemoteBytes(bytes(), { lore: [{ comment: 'Only', key: 'o', content: 'one' }] })
        expect(JSON.parse(out.toString('utf8')).globalLore.map((e: any) => e.comment)).toEqual(['Only'])
    })

    it('refuses an empty file and a file without a lorebook', () => {
        expect(() => patchRemoteBytes(Buffer.alloc(0), { lore: [] })).toThrow(/empty or missing/)
        expect(() => patchRemoteBytes(Buffer.from('{"chats":[]}'), { lore: [] })).toThrow(/no globalLore/)
    })
})

describe('patchRemoteCard on a real store', () => {
    const setup = () => {
        const dir = mkdtempSync(join(tmpdir(), 'remote-patch-'))
        const saveDir = join(dir, 'save')
        mkdirSync(saveDir, { recursive: true })
        const st = openSaveStore({ saveDir, backend: 'files' })
        st.write(hexKey('fc27f53b-0000'), bytes())
        return { dir, saveDir, st }
    }

    it('backs up the old file, writes the patch, and the backup is the old bytes', () => {
        const { dir, saveDir, st } = setup()
        try {
            const r = patchRemoteCard(saveDir, 'fc27', { entry: { comment: 'Evelyn', key: 'b', content: 'new evelyn' } }, { id: 'fc27f53b-0000', store: st, backupDir: join(dir, 'bk') })
            expect(r.written).toBe(true)
            expect(readFileSync(r.backup)).toEqual(bytes())
            const now = JSON.parse(st.read(hexKey('fc27f53b-0000')).toString('utf8'))
            expect(now.globalLore.find((e: any) => e.comment === 'Evelyn').content).toBe('new evelyn')
            expect(now.chats).toEqual(card().chats)
        } finally { st.close() }
    })

    it('a dry run backs up but writes nothing', () => {
        const { dir, saveDir, st } = setup()
        try {
            const r = patchRemoteCard(saveDir, 'fc27', { lore: [{ comment: 'x', key: 'x', content: 'y' }] }, { id: 'fc27f53b-0000', store: st, backupDir: join(dir, 'bk'), dryRun: true })
            expect(r.written).toBe(false)
            expect(existsSync(r.backup)).toBe(true)
            expect(st.read(hexKey('fc27f53b-0000'))).toEqual(bytes())
        } finally { st.close() }
    })

    it('a card that is not remote (no file) writes nothing and leaves no backup', () => {
        const { dir, saveDir, st } = setup()
        try {
            expect(() => patchRemoteCard(saveDir, 'zz', { lore: [] }, { id: 'nope', store: st, backupDir: join(dir, 'bk') })).toThrow(/empty or missing/)
            expect(existsSync(join(dir, 'bk')) ? readdirSync(join(dir, 'bk')) : []).toEqual([])
        } finally { st.close() }
    })
})
