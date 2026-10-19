// @vitest-environment node
// The incident: lore written into the save behind the sync's back was put back to the old one by the next chat message.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const req = createRequire(import.meta.url)
const merge = req('../../../server/node/dbMerge.cjs')
const { openDbSync } = req('../../../server/node/dbSync.cjs')
const { importLore, setCardImage, setCardScript, setCardText, clearCardAssets, toRisuLore } = req('../../../server/node/loreImport.cjs')
// characters.ts updateLorebooks, copied (it needs a browser to import); the test below fails if the original changes
const updateLorebooks = (book: any[]) => book.map((v) => {
    v.bookVersion ??= 1
    if (v.bookVersion >= 2) return v
    if (v.activationPercent) { const perc = v.activationPercent; v.activationPercent = null; v.content = `@@probability ${perc}\n${v.content}` }
    v.content = v.content.replace(/@@@?end/g, '@@depth 0').replace(/\<(char|bot)\>/g, '{{char}}').replace(/\<(user)\>/g, '{{user}}')
    v.bookVersion = 2
    return v
})
const FILE = '64617461626173652f64617461626173652e62696e'
// every case runs on the files and on the sqlite store (saveStore.cjs): loreImport picks the backend from RISU_STORE
const { openSaveStore } = req('../../../server/node/saveStore.cjs')
let backend: 'files' | 'sqlite' = 'files'
const withStore = <T>(saveDir: string, use: (s: any) => T): T => { const s = openSaveStore({ saveDir, backend, fullfsync: false }); try { return use(s) } finally { s.close() } }
const putKey = (saveDir: string, key: string, data: Buffer) => withStore(saveDir, (s) => s.write(key, data))
const getKey = (saveDir: string, key: string): Buffer => withStore(saveDir, (s) => s.read(key))

function save(card: any) {
    return merge.encodeSave([
        merge.serializeBlock(1, 0, 'root', { __directory: ['ss'] }),
        merge.serializeBlock(2, 0, 'ss', card),
    ])
}
const card = (lore: string[], messages: string[]) => ({ chaId: 'ss-1', name: 'Shadow Slave', globalLore: lore.map((c) => ({ comment: c, content: c, key: '' })), chats: [{ id: 'k1', message: messages }] })
const read = (buf: Buffer) => merge.parseBlock(merge.decodeSave(buf).find((b: any) => b.name === 'ss'))

describe.each(['files', 'sqlite'] as const)('lore import while a page is open (%s)', (b) => {
    let prev: string | undefined
    beforeEach(() => { backend = b; prev = process.env.RISU_STORE; process.env.RISU_STORE = b })
    afterEach(() => { if (prev === undefined) delete process.env.RISU_STORE; else process.env.RISU_STORE = prev })
    test("the page's next write keeps the imported lore and its own new message", () => {
        const dir = mkdtempSync(join(tmpdir(), 'loreimp-')); const saveDir = join(dir, 'save'); mkdirSync(saveDir)
        const syncFile = saveDir + '.sync.sqlite'
        const loaded = save(card(['old lore'], ['hi']))
        putKey(saveDir, FILE, loaded)
        // a page loads the save
        let sync = openDbSync({ dbFile: syncFile, log: () => {} }); sync.onRead('page', loaded); sync.close()
        // the lore is imported (server stopped)
        const lb = join(dir, 'lb.json'); writeFileSync(lb, JSON.stringify({ data: [{ comment: 'new lore', content: 'new lore', key: 'x' }, { comment: 'kill rule', content: 'kill rule', key: '' }] }))
        importLore(saveDir, [{ prefix: 'ss', entries: JSON.parse(readFileSync(lb, 'utf8')).data }])
        // the page, still holding the old lore, writes a new message
        const pageWrite = save(card(['old lore'], ['hi', 'a new message']))
        sync = openDbSync({ dbFile: syncFile, log: () => {} })
        const r = sync.onWrite('page', pageWrite, getKey(saveDir, FILE)); sync.close()
        const v = read(r.bytes)
        expect(r.how).toBe('merged')
        expect(v.globalLore.map((l: any) => l.comment)).toEqual(['new lore', 'kill rule'])
        expect(v.chats[0].message).toEqual(['hi', 'a new message'])
    })
    test('a card icon set while a page is open survives the page\'s next write; the picture is stored as Risu stores assets', () => {
        const dir = mkdtempSync(join(tmpdir(), 'cardimg-')); const saveDir = join(dir, 'save'); mkdirSync(saveDir)
        const syncFile = saveDir + '.sync.sqlite'
        const loaded = save(card(['lore'], ['hi']))
        putKey(saveDir, FILE, loaded)
        let sync = openDbSync({ dbFile: syncFile, log: () => {} }); sync.onRead('page', loaded); sync.close()
        const png = Buffer.from('fake png bytes')
        const [r] = setCardImage(saveDir, ['ss'], png)
        expect(r.after).toMatch(/^assets\/[0-9a-f]{64}\.png$/)
        expect(getKey(saveDir, Buffer.from(r.after).toString('hex'))).toEqual(png)
        sync = openDbSync({ dbFile: syncFile, log: () => {} })
        const w = sync.onWrite('page', save(card(['lore'], ['hi', 'more'])), getKey(saveDir, FILE)); sync.close()
        expect(read(w.bytes).image).toBe(r.after)
        expect(read(w.bytes).chats[0].message).toEqual(['hi', 'more'])
    })

    test("a new trigger script survives the next write of a page that loaded the old one", () => {
        const dir = mkdtempSync(join(tmpdir(), 'loreimp-s-')); const saveDir = join(dir, 'save'); mkdirSync(saveDir)
        const syncFile = saveDir + '.sync.sqlite'
        const old = { ...card(['lore'], ['hi']), triggerscript: [{ comment: 'panel', effect: [{ type: 'triggerlua', code: 'hp' }] }] }
        const loaded = save(old)
        putKey(saveDir, FILE, loaded)
        let sync = openDbSync({ dbFile: syncFile, log: () => {} }); sync.onRead('page', loaded); sync.close()
        const script = [{ comment: 'panel', effect: [{ type: 'triggerlua', code: 'runes' }] }]
        const [r] = setCardScript(saveDir, ['ss'], script, true)
        expect(r.after).toBeGreaterThan(0)
        sync = openDbSync({ dbFile: syncFile, log: () => {} })
        const w = sync.onWrite('page', save({ ...old, chats: [{ id: 'k1', message: ['hi', 'more'] }] }), getKey(saveDir, FILE)); sync.close()
        expect(read(w.bytes).triggerscript[0].effect[0].code).toBe('runes')
        expect(read(w.bytes).lowLevelAccess).toBe(true)
        expect(read(w.bytes).chats[0].message).toEqual(['hi', 'more'])
    })

    test('a new opening (description + first message) survives the next write of a page that loaded the old one', () => {
        const dir = mkdtempSync(join(tmpdir(), 'loreimp-t-')); const saveDir = join(dir, 'save'); mkdirSync(saveDir)
        const syncFile = saveDir + '.sync.sqlite'
        const old = { ...card(['lore'], ['hi']), desc: 'old rules', firstMessage: 'old prologue' }
        const loaded = save(old)
        putKey(saveDir, FILE, loaded)
        let sync = openDbSync({ dbFile: syncFile, log: () => {} }); sync.onRead('page', loaded); sync.close()
        const [r] = setCardText(saveDir, ['ss'], 'new rules: ask "Được chưa?"', 'new prologue, two ways to begin')
        expect(r.before).toEqual([9, 12])
        sync = openDbSync({ dbFile: syncFile, log: () => {} })
        const w = sync.onWrite('page', save({ ...old, chats: [{ id: 'k1', message: ['hi', 'more'] }] }), getKey(saveDir, FILE)); sync.close()
        expect(read(w.bytes).desc).toBe('new rules: ask "Được chưa?"')
        expect(read(w.bytes).firstMessage).toBe('new prologue, two ways to begin')
        expect(read(w.bytes).chats[0].message).toEqual(['hi', 'more'])
        expect(() => setCardText(saveDir, ['ss'], '', 'x')).toThrow()
    })

    test('clearing the image library survives the next write of a page that loaded it', () => {
        const dir = mkdtempSync(join(tmpdir(), 'loreimp-a-')); const saveDir = join(dir, 'save'); mkdirSync(saveDir)
        const syncFile = saveDir + '.sync.sqlite'
        const old = { ...card(['lore'], ['hi']), additionalAssets: [['a.jpg', 'assets/x.jpg', 'jpg'], ['b.jpg', 'assets/y.jpg', 'jpg']] }
        const loaded = save(old)
        putKey(saveDir, FILE, loaded)
        let sync = openDbSync({ dbFile: syncFile, log: () => {} }); sync.onRead('page', loaded); sync.close()
        const [r] = clearCardAssets(saveDir, ['ss'])
        expect(r.before).toBe(2)
        sync = openDbSync({ dbFile: syncFile, log: () => {} })
        const w = sync.onWrite('page', save({ ...old, chats: [{ id: 'k1', message: ['hi', 'more'] }] }), getKey(saveDir, FILE)); sync.close()
        expect(read(w.bytes).additionalAssets).toEqual([])
        expect(read(w.bytes).chats[0].message).toEqual(['hi', 'more'])
    })

    test('the copy of updateLorebooks above is still what Risu does', () => {
        const src = readFileSync(join(__dirname, '../characters.ts'), 'utf8')
        for (const line of ["v.bookVersion ??= 1", "v.content = v.content.replace(/@@@?end/g, '@@depth 0').replace(/\\<(char|bot)\\>/g, '{{char}}').replace(/\\<(user)\\>/g, '{{user}}')", "v.bookVersion = 2"]) expect(src).toContain(line)
    })

    test('an entry is written the way Risu normalizes it, so an open page never reads it as changed', () => {
        const e = { key: 'a', comment: 'c', content: 'He says @@end and <user> meets <char>.', insertorder: 5 }
        const written = toRisuLore(e)
        expect(written.bookVersion).toBe(2)
        // what the page does to it on load changes nothing
        expect(updateLorebooks([structuredClone(written)] as any)[0]).toEqual(written)
        expect(written.content).toBe('He says @@depth 0 and {{user}} meets {{char}}.')
    })

    test('the incident: a page that loaded the first import still holds it when the second import lands, and keeps the second', () => {
        const dir = mkdtempSync(join(tmpdir(), 'loreimp2-')); const saveDir = join(dir, 'save'); mkdirSync(saveDir)
        const syncFile = saveDir + '.sync.sqlite'
        putKey(saveDir, FILE, save(card([], ['hi'])))
        importLore(saveDir, [{ prefix: 'ss', entries: [{ comment: 'first', content: 'first lore', key: '' }] }])
        const loaded = getKey(saveDir, FILE)
        let sync = openDbSync({ dbFile: syncFile, log: () => {} }); sync.onRead('page', loaded); sync.close()
        // the page loads the save: Risu normalizes the lore in memory
        const inPage = merge.parseBlock(merge.decodeSave(loaded).find((b: any) => b.name === 'ss'))
        inPage.globalLore = updateLorebooks(inPage.globalLore as any)
        inPage.chats[0].message.push('typed on the page')
        // the second import lands behind it
        importLore(saveDir, [{ prefix: 'ss', entries: [{ comment: 'second', content: 'second lore with the Echo definition', key: '' }] }])
        sync = openDbSync({ dbFile: syncFile, log: () => {} })
        const w = sync.onWrite('page', save(inPage), getKey(saveDir, FILE)); sync.close()
        const v = read(w.bytes)
        expect(v.globalLore.map((l: any) => l.comment)).toEqual(['second'])
        expect(v.chats[0].message).toEqual(['hi', 'typed on the page'])
    })
})
