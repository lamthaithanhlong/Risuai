// @vitest-environment node
// The incident: lore written into the save behind the sync's back was put back to the old one by the next chat message.
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const req = createRequire(import.meta.url)
const merge = req('../../../server/node/dbMerge.cjs')
const { openDbSync } = req('../../../server/node/dbSync.cjs')
const { importLore, setCardImage } = req('../../../server/node/loreImport.cjs')
const FILE = '64617461626173652f64617461626173652e62696e'

function save(card: any) {
    return merge.encodeSave([
        merge.serializeBlock(1, 0, 'root', { __directory: ['ss'] }),
        merge.serializeBlock(2, 0, 'ss', card),
    ])
}
const card = (lore: string[], messages: string[]) => ({ chaId: 'ss-1', name: 'Shadow Slave', globalLore: lore.map((c) => ({ comment: c, content: c, key: '' })), chats: [{ id: 'k1', message: messages }] })
const read = (buf: Buffer) => merge.parseBlock(merge.decodeSave(buf).find((b: any) => b.name === 'ss'))

describe('lore import while a page is open', () => {
    test("the page's next write keeps the imported lore and its own new message", () => {
        const dir = mkdtempSync(join(tmpdir(), 'loreimp-')); const saveDir = join(dir, 'save'); mkdirSync(saveDir)
        const syncFile = saveDir + '.sync.sqlite'
        const loaded = save(card(['old lore'], ['hi']))
        writeFileSync(join(saveDir, FILE), loaded)
        // a page loads the save
        let sync = openDbSync({ dbFile: syncFile, log: () => {} }); sync.onRead('page', loaded); sync.close()
        // the lore is imported (server stopped)
        const lb = join(dir, 'lb.json'); writeFileSync(lb, JSON.stringify({ data: [{ comment: 'new lore', content: 'new lore', key: 'x' }, { comment: 'kill rule', content: 'kill rule', key: '' }] }))
        importLore(saveDir, [{ prefix: 'ss', entries: JSON.parse(readFileSync(lb, 'utf8')).data }])
        // the page, still holding the old lore, writes a new message
        const pageWrite = save(card(['old lore'], ['hi', 'a new message']))
        sync = openDbSync({ dbFile: syncFile, log: () => {} })
        const r = sync.onWrite('page', pageWrite, readFileSync(join(saveDir, FILE))); sync.close()
        const v = read(r.bytes)
        expect(r.how).toBe('merged')
        expect(v.globalLore.map((l: any) => l.comment)).toEqual(['new lore', 'kill rule'])
        expect(v.chats[0].message).toEqual(['hi', 'a new message'])
    })
    test('a card icon set while a page is open survives the page\'s next write; the picture is stored as Risu stores assets', () => {
        const dir = mkdtempSync(join(tmpdir(), 'cardimg-')); const saveDir = join(dir, 'save'); mkdirSync(saveDir)
        const syncFile = saveDir + '.sync.sqlite'
        const loaded = save(card(['lore'], ['hi']))
        writeFileSync(join(saveDir, FILE), loaded)
        let sync = openDbSync({ dbFile: syncFile, log: () => {} }); sync.onRead('page', loaded); sync.close()
        const png = Buffer.from('fake png bytes')
        const [r] = setCardImage(saveDir, ['ss'], png)
        expect(r.after).toMatch(/^assets\/[0-9a-f]{64}\.png$/)
        expect(readFileSync(join(saveDir, Buffer.from(r.after).toString('hex')))).toEqual(png)
        sync = openDbSync({ dbFile: syncFile, log: () => {} })
        const w = sync.onWrite('page', save(card(['lore'], ['hi', 'more'])), readFileSync(join(saveDir, FILE))); sync.close()
        expect(read(w.bytes).image).toBe(r.after)
        expect(read(w.bytes).chats[0].message).toEqual(['hi', 'more'])
    })
})
