import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// the server-side CLI: patching a REMOTE card's lorebook without touching its chats
const require = createRequire(import.meta.url)
const { patchRemoteBytes, patchRemoteCard, hexKey, luaScriptsOf, luaHash, readCardLuaHash } = require('../../../server/node/remoteCardPatch.cjs')
const { openSaveStore } = require('../../../server/node/saveStore.cjs')

const card = () => ({
    name: 'Zombie', chaId: 'fc27f53b-0000', desc: 'd',
    globalLore: [
        { key: 'a', comment: 'Rules', content: 'old rules', mode: 'normal', alwaysActive: true },
        { key: 'b', comment: 'Evelyn', content: 'old evelyn', mode: 'normal', alwaysActive: false },
    ],
    triggerscript: [
        { comment: 'Status panel', type: 'output', conditions: [], effect: [{ type: 'triggerlua', code: '-- old status lua' }], lowLevelAccess: false },
        { comment: 'Owner script', type: 'output', conditions: [], effect: [{ type: 'triggerlua', code: '-- the owner wrote this' }], lowLevelAccess: false },
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

const lua = (comment: string, code: string) => ({ comment, type: 'output', conditions: [], effect: [{ type: 'triggerlua', code }], lowLevelAccess: false })
const built = (scripts: any[]) => ({ spec: 'chara_card_v3', data: { extensions: { risuai: { triggerscript: scripts } } } })

describe('--lua: Lua trigger scripts of the card', () => {
    it('replaces the script with the same comment, adds a new one, keeps the unknown one; lore, desc and chats stay', () => {
        const shipped = luaScriptsOf(built([lua('Status panel', '-- NEW status lua'), lua('Growth', '-- stats')]))
        const { out, report } = patchRemoteBytes(bytes(), { lua: { scripts: shipped } })
        const c = JSON.parse(out.toString('utf8'))
        expect(c.triggerscript.map((s: any) => [s.comment, s.effect[0].code])).toEqual([
            ['Status panel', '-- NEW status lua'], ['Owner script', '-- the owner wrote this'], ['Growth', '-- stats'],
        ])
        expect(c.globalLore).toEqual(card().globalLore)
        expect(c.desc).toBe('d')
        expect(c.chats).toEqual(card().chats)
        expect(report.lua.map((x: any) => [x.name, x.action])).toEqual([['Status panel', 'replace'], ['Growth', 'add'], ['Owner script', 'keep']])
        const sp = report.lua[0]
        expect(sp.before.bytes).toBe('-- old status lua'.length)
        expect(sp.after.bytes).toBe('-- NEW status lua'.length)
        expect(sp.after.sha).toMatch(/^[0-9a-f]{8}$/)
        expect(sp.before.sha).not.toBe(sp.after.sha)
        expect(report.luaHash).toBe(luaHash(shipped))
    })

    it('--lua-drop removes a renamed script; a drop that is also shipped is refused', () => {
        const shipped = luaScriptsOf(built([lua('Growth', '-- stats')]))
        const { out, report } = patchRemoteBytes(bytes(), { lua: { scripts: shipped, drop: ['Status panel'] } })
        expect(JSON.parse(out.toString('utf8')).triggerscript.map((s: any) => s.comment)).toEqual(['Owner script', 'Growth'])
        expect(report.lua[0]).toMatchObject({ name: 'Status panel', action: 'drop' })
        expect(() => patchRemoteBytes(bytes(), { lua: { scripts: shipped, drop: ['Growth'] } })).toThrow(/both shipped and dropped/)
    })

    it('a card json with no scripts is refused (a typo must not wipe the Lua); a patch without --lua leaves the Lua alone', () => {
        expect(() => luaScriptsOf(built([]))).toThrow(/no triggerscript/)
        expect(() => luaScriptsOf({ data: {} })).toThrow(/no triggerscript/)
        expect(() => patchRemoteBytes(bytes(), { lua: { scripts: [] } })).toThrow(/no Lua scripts/)
        const { out } = patchRemoteBytes(bytes(), { desc: 'x' })
        expect(JSON.parse(out.toString('utf8')).triggerscript).toEqual(card().triggerscript)
    })

    it('the same Lua again reports "same" and changes nothing', () => {
        const { out, report } = patchRemoteBytes(bytes(), { lua: { scripts: luaScriptsOf(built([card().triggerscript[0]])) } })
        expect(report.lua[0].action).toBe('same')
        expect(out).toEqual(bytes())
    })

    const setup = () => {
        const dir = mkdtempSync(join(tmpdir(), 'remote-patch-lua-'))
        const saveDir = join(dir, 'save')
        mkdirSync(saveDir, { recursive: true })
        const st = openSaveStore({ saveDir, backend: 'files' })
        st.write(hexKey('fc27f53b-0000'), bytes())
        return { dir, saveDir, st }
    }

    it('a dry run reports the diff and writes nothing (the file and its hash stay the old ones)', () => {
        const { dir, saveDir, st } = setup()
        try {
            const shipped = luaScriptsOf(built([lua('Status panel', '-- NEW status lua')]))
            const r = patchRemoteCard(saveDir, 'fc27', { lua: { scripts: shipped } }, { id: 'fc27f53b-0000', store: st, backupDir: join(dir, 'bk'), dryRun: true })
            expect(r.written).toBe(false)
            expect(r.report.lua[0].action).toBe('replace')
            expect(st.read(hexKey('fc27f53b-0000'))).toEqual(bytes())
            expect(readCardLuaHash(saveDir, 'fc27', shipped, { id: 'fc27f53b-0000', store: st }).hash).not.toBe(luaHash(shipped))
        } finally { st.close() }
    })

    it('a real write lands: the card in the store carries the built Lua and readCardLuaHash equals the candidate hash', () => {
        const { dir, saveDir, st } = setup()
        try {
            const shipped = luaScriptsOf(built([lua('Status panel', '-- NEW status lua'), lua('Growth', '-- stats')]))
            const r = patchRemoteCard(saveDir, 'fc27', { lua: { scripts: shipped } }, { id: 'fc27f53b-0000', store: st, backupDir: join(dir, 'bk') })
            expect(r.written).toBe(true)
            expect(readFileSync(r.backup)).toEqual(bytes())
            const got = readCardLuaHash(saveDir, 'fc27', shipped, { id: 'fc27f53b-0000', store: st })
            expect(got).toMatchObject({ hash: luaHash(shipped), found: 2, of: 2 })
            expect(JSON.parse(st.read(hexKey('fc27f53b-0000')).toString('utf8')).chats).toEqual(card().chats)
        } finally { st.close() }
    })
})
