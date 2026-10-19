// @vitest-environment node
// story.sqlite (server/node/storyStore.cjs): the story of each chat, derived from the save after every stored write.
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, copyFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const req = createRequire(import.meta.url)
const merge = req('../../../server/node/dbMerge.cjs')
const { openStoryStore, deathsIn } = req('../../../server/node/storyStore.cjs')

const CHECKED = '[Checked against the novel claim by claim; where other lore about this place disagrees, this card is right.]\n'
function card(chats: any[], lore: any[] = []) {
    return { chaId: 'ss', name: 'Shadow Slave', globalLore: lore, chats }
}
function saveOf(chars: any[]) {
    return merge.encodeSave([
        merge.serializeBlock(1, 0, 'root', { __directory: chars.map((c) => c.chaId) }),
        ...chars.map((c) => merge.serializeBlock(2, 1, c.chaId, c)),
        { type: 0, comp: 0, name: 'config', data: Buffer.from('{}') },
    ])
}
const vars = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, v]) => ['$' + k, v]))
const LORE = [
    { comment: 'Region: Forgotten Shore', key: 'Forgotten Shore, Dark City, Thành Phố Bóng Tối, Bright Castle', content: CHECKED + 'x' },
    { comment: 'Canon appearance corrections', key: 'Sunny', content: 'y' },
    { comment: 'Kai (Nightingale)', key: 'Kai', content: CHECKED + 'z' },
    { comment: 'Shadow Slave Complete Lorebook', key: 'a', content: 'imported' },
]
const chat1 = (extra: Record<string, string> = {}, id = 'k1') => ({
    id, name: 'New Chat 2', message: [{ role: 'user', data: 'hi', time: 1000 }, { role: 'char', data: 'yo', time: 2000 }],
    scriptstate: vars({
        st_name: 'Kenji Park', st_rank: 'Aspirant (Ứng viên)', st_place: 'Dark City', st_frag: '12/1000',
        led_mem: 'Aiko | promised to guide me to the ruins by dawn\nno subject here',
        led_rel: 'Aiko | Kenji Park | trusts, owes a favor\nMara | Aiko | rivals',
        led_ev: 'Day 1, dawn | Aiko met Kenji in Dark City\nDay 2, dusk | Mara died at the gate\nDay 3, noon | Aiko left for Bright Castle',
        ...extra,
    }),
})
const fresh = () => openStoryStore({ dbFile: ':memory:', now: () => 1_000_000 })

describe('sync', () => {
    test('state, ledger, npcs and lore of a chat, from chat.scriptstate ($-prefixed, as setChatVar stores them)', () => {
        const s = fresh()
        const r = s.sync(saveOf([card([chat1()], LORE)]), 10)
        expect(r).toMatchObject({ characters: 1, chats: 1, archived: 0 })
        const st = s.story('k1')
        expect(st.chat).toMatchObject({ id: 'k1', name: 'New Chat 2', character: 'Shadow Slave', messages: 2, last_message_at: 2000, synced_rev: 10 })
        expect(st.state.st_rank).toBe('Aspirant (Ứng viên)')
        expect(st.state.led_ev).toBeUndefined()          // the ledger goes to its own tables
        expect(st.memories).toEqual([
            { pos: 0, subject: 'Aiko', text: 'promised to guide me to the ruins by dawn', first_rev: 10 },
            { pos: 1, subject: null, text: 'no subject here', first_rev: 10 },
        ])
        expect(st.relations[1]).toMatchObject({ a: 'Mara', b: 'Aiko', how: 'rivals' })
        expect(st.timeline.map((e: any) => e.at)).toEqual(['Day 1, dawn', 'Day 2, dusk', 'Day 3, noon'])
        // the player is not an NPC; Mara died; Aiko was last seen in the Bright Castle line, a place named by a Region card's keys
        expect(st.npcs).toEqual([
            { name: 'Aiko', status: 'seen', last_seen_at: 'Day 3, noon', last_seen_place: 'Bright Castle', last_event: 'Aiko left for Bright Castle', source: 'memory,relation' },
            { name: 'Mara', status: 'dead', last_seen_at: 'Day 2, dusk', last_seen_place: null, last_event: 'Mara died at the gate', source: 'relation' },
        ])
        const lore = s.lore('ss')
        expect(lore.map((l: any) => [l.title, l.canon])).toEqual([
            ['Region: Forgotten Shore', 1], ['Canon appearance corrections', 1], ['Kai (Nightingale)', 1], ['Shadow Slave Complete Lorebook', 0],
        ])
        expect(lore[0].keys).toContain('Dark City')
        expect(lore[0].hash).toMatch(/^[0-9a-f]{16}$/)
    })

    test('the same file twice changes nothing (idempotent by content hash)', () => {
        const s = fresh()
        const buf = saveOf([card([chat1()], LORE)])
        s.sync(buf, 10)
        const before = JSON.stringify(s.story('k1'))
        expect(s.sync(buf, 11)).toMatchObject({ characters: 0, chats: 0, skipped: 1 })
        expect(JSON.stringify(s.story('k1'))).toBe(before)
        // a new message only (variables unchanged) updates the counts, not the story
        const more = chat1()
        more.message.push({ role: 'user', data: 'again', time: 3000 })
        expect(s.sync(saveOf([card([more], LORE)]), 12)).toMatchObject({ characters: 1, chats: 0 })
        expect(s.story('k1').chat).toMatchObject({ messages: 3, last_message_at: 3000 })
    })

    test('a rank change is kept with its revision; a timeline line keeps the revision it first appeared at', () => {
        const s = fresh()
        s.sync(saveOf([card([chat1()])]), 10)
        expect(s.history('k1')).toEqual([])              // the first sight of a chat is not a change
        const c = chat1({ st_rank: 'Sleeper (Người Ngủ)', led_ev: 'Day 1, dawn | Aiko met Kenji in Dark City\nDay 2, dusk | Mara died at the gate\nDay 3, noon | Aiko left for Bright Castle\nDay 4, dawn | survived the First Nightmare' })
        s.sync(saveOf([card([c])]), 14)
        expect(s.history('k1')).toEqual([{ key: 'st_rank', rev: 14, old_value: 'Aspirant (Ứng viên)', new_value: 'Sleeper (Người Ngủ)', at: 1_000_000 }])
        expect(s.story('k1').timeline.map((e: any) => e.first_rev)).toEqual([10, 10, 10, 14])
    })

    test('the Game Master state (gm_*) is kept with its history, without the page\'s rollback bookkeeping', () => {
        const s = fresh()
        s.sync(saveOf([card([chat1({ gm_path: 'Song clan | servant | low', gm_prev: '{}', gm_at: 'r1' })])]), 1)
        s.sync(saveOf([card([chat1({ gm_path: 'Nephis\'s cohort | newcomer | distrusted', gm_left: 'Song clan | left', gm_prev: '{"x":1}', gm_at: 'r2' })])]), 2)
        expect(s.story('k1').state.gm_path).toBe('Nephis\'s cohort | newcomer | distrusted')
        const h = s.history('k1').filter((x: any) => x.key.startsWith('gm_'))
        expect(h.map((x: any) => [x.key, x.rev, x.old_value, x.new_value])).toEqual([
            ['gm_left', 2, null, 'Song clan | left'],
            ['gm_path', 2, 'Song clan | servant | low', 'Nephis\'s cohort | newcomer | distrusted'],
        ])
    })
    test('a chat deleted from the save is archived (deleted_at, deleted_rev) and comes back if the save has it again', () => {
        const s = fresh()
        s.sync(saveOf([card([chat1(), chat1({}, 'k2')])]), 10)
        const r = s.sync(saveOf([card([chat1()])]), 11)
        expect(r.archived).toBe(1)
        expect(s.story('k2')).toBeNull()
        expect(s.chatRow('k2')).toMatchObject({ deleted_at: 1_000_000, deleted_rev: 11 })
        expect(s.db.prepare('SELECT COUNT(*) AS n FROM timeline WHERE chat_id = ?').get('k2').n).toBe(3)   // kept, archived
        expect(s.story('k1')).not.toBeNull()
        const back = s.sync(saveOf([card([chat1(), chat1({}, 'k2')])]), 12)
        expect(back.restored).toBe(1)
        expect(s.story('k2')).not.toBeNull()
        expect(s.chatRow('k2').deleted_at).toBeNull()
    })

    test('a character removed from the save archives its chats; a block that is there but unreadable does not', () => {
        const s = fresh()
        s.sync(saveOf([card([chat1()]), { chaId: 'o', name: 'Other', globalLore: [], chats: [{ id: 'k9', message: [] }] }]), 10)
        // 'o' becomes raw bytes (a remote character): not gone
        const blocks = merge.decodeSave(saveOf([card([chat1()]), { chaId: 'o', name: 'Other', globalLore: [], chats: [{ id: 'k9', message: [] }] }]))
        const raw = merge.encodeSave(blocks.map((b: any) => (b.name === 'o' ? { ...b, type: 6, data: Buffer.from('remote') } : b)))
        expect(s.sync(raw, 11).archived).toBe(0)
        expect(s.story('k9')).not.toBeNull()
        expect(s.sync(saveOf([card([chat1()])]), 12).archived).toBe(1)
        expect(s.chatRow('k9').deleted_rev).toBe(12)
    })

    test('archived chats older than archiveDays are dropped', () => {
        let t = 0
        const s = openStoryStore({ dbFile: ':memory:', now: () => t, archiveDays: 30 })
        s.sync(saveOf([card([chat1(), chat1({}, 'k2')])]), 1)
        s.sync(saveOf([card([chat1()])]), 2)
        t = 31 * 24 * 3600 * 1000
        s.sync(saveOf([card([chat1({ st_frag: '13/1000' })])]), 3)
        expect(s.chatRow('k2')).toBeNull()
    })

    test('a file that is not a save is reported, not thrown', () => {
        expect(fresh().sync(Buffer.from('nope'), 1)).toEqual({ error: 'not a RISUSAVE file' })
    })

    test('death words apply to the nearest name before them ("Kai found Mara dead": Mara)', () => {
        expect([...deathsIn('Kai found Mara, who had died', ['kai', 'mara'])]).toEqual(['mara'])
        expect([...deathsIn('Kai found Mara, who had died', ['mara', 'kai'])]).toEqual(['mara'])   // whatever order the names come in
        expect([...deathsIn('Kai giết Mara', ['kai', 'mara'])]).toEqual([])
        expect([...deathsIn('Mara bị giết ở cổng', ['kai', 'mara'])]).toEqual(['mara'])
    })
})

// A COPY of the owner's save, if this machine has it: the sync must read every block of the real file (never the live file itself)
const LIVE = join(__dirname, '../../../save', Buffer.from('database/database.bin').toString('hex'))
describe.skipIf(!existsSync(LIVE))('a copy of the real save', () => {
    test('syncs, finds the Shadow Slave chats with their runes and the region cards as canon, and is idempotent', () => {
        const dir = mkdtempSync(join(tmpdir(), 'story-copy-'))
        copyFileSync(LIVE, join(dir, 'database.bin'))
        const buf = readFileSync(join(dir, 'database.bin'))
        const s = openStoryStore({ dbFile: join(dir, 'story.sqlite') })
        const r = s.sync(buf, 1)
        expect(r.error).toBeUndefined()
        expect(r.characters).toBeGreaterThan(0)
        const ss = s.db.prepare("SELECT char_id FROM characters WHERE name LIKE 'Shadow Slave%'").get()
        if (ss) expect(s.db.prepare("SELECT COUNT(*) AS n FROM lore WHERE char_id = ? AND canon = 1 AND title LIKE 'Region%'").get(ss.char_id).n).toBeGreaterThan(0)
        expect(s.sync(buf, 2)).toMatchObject({ characters: 0, chats: 0 })
        s.close()
    })
})
