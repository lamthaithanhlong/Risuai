import { describe, expect, it } from 'vitest'
import { indexedHistory, INDEX_MEMO, KEEP_RECENT, MIN_OLD, parsePicks, parseToc, splitForIndex } from './historyIndex'

const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `message ${i + 1}`, memo: `id${i + 1}` }))
const head = [{ role: 'system', content: '[Start a new chat]', memo: 'NewChat' }, { role: 'assistant', content: 'First message' }]
const ids = (n: number) => new Set(Array.from({ length: n }, (_, i) => `id${i + 1}`))

describe('the history through a table of contents (measured: recall 12/12, -33% tokens)', () => {
    it('a short chat is sent as it is', () => {
        expect(splitForIndex([...head, ...msgs(KEEP_RECENT + MIN_OLD - 1)], ids(KEEP_RECENT + MIN_OLD - 1))).toBe(null)
    })
    it('a long chat: the old messages are the ones before the last six; the first message and the marker stay', () => {
        const chats = [...head, ...msgs(20)]
        const sp = splitForIndex(chats, ids(20))!
        expect(sp.old.length).toBe(14)
        expect(sp.recent.map((i) => chats[i].memo)).toEqual(['id15', 'id16', 'id17', 'id18', 'id19', 'id20'])
    })
    it('the old messages become one block in their place: the table, then the picked ones in full', () => {
        const chats = [...head, ...msgs(20)]
        const sp = splitForIndex(chats, ids(20))!
        const lines = sp.old.map((_, k) => `line ${k + 1}`)
        const out = indexedHistory(chats, sp.old, lines, [3, 1], (content) => ({ role: 'system', content, memo: INDEX_MEMO }))
        expect(out.length).toBe(head.length + 1 + KEEP_RECENT)
        expect(out[2].memo).toBe(INDEX_MEMO)
        expect(out[2].content).toContain('#14: line 14')
        expect(out[2].content).toMatch(/#1 PLAYER: message 1[\s\S]*#3 PLAYER: message 3/)       // in story order
        expect(out.slice(-KEEP_RECENT).map((c) => c.memo)).toEqual(['id15', 'id16', 'id17', 'id18', 'id19', 'id20'])
    })
    it('the helper\'s answers are read safely', () => {
        expect([...parseToc('#1: Kenji chào.\n#2: Choi hỏi tên.\nrác').entries()]).toEqual([[1, 'Kenji chào.'], [2, 'Choi hỏi tên.']])
        expect(parsePicks('3, 14, 99, 3, 7, 8', 14)).toEqual([3, 14, 7])
        expect(parsePicks('none', 14)).toEqual([])
    })
})
