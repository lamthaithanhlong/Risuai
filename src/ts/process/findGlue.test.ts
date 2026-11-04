// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'

vi.mock('../storage/database.svelte', () => ({ getDatabase: vi.fn(() => ({ characters: [] })) }))

import { CARD_SLUGS, KNOWN_TTL_MS, cardSlugOf, chapterOf, drainPending, fetchKnownNames, findHandler, knownProvider } from './findGlue'
import type { FindRecord } from './findDrop'
import { PENDING_KEY, parsePending, type SendResult } from '../storage/findsSave'

const rec = (en = 'Muffled Footsteps'): FindRecord => ({
    id: en.toLowerCase().replace(/\s+/g, '-'), kind: 'skill', name: { vi: 'Nghe bước chân', en }, source: { card: 'fc27f53b-0000-4000', chapter: '' },
    effect: 'Nghe bước chân qua tường mỏng.', rarity: 'uncommon', conditions: 'Cần yên tĩnh', portable: true,
})
const ctx = { chatId: 'c1', card: 'fc27f53b-0000-4000', turn: 5 }
const tick = () => new Promise((r) => setTimeout(r, 0))
type Chat = { scriptstate: Record<string, string> }

describe('findHandler', () => {
    test('saves the record with the card slug and the story place', async () => {
        const chat: Chat = { scriptstate: { $st_day: 'Ngày 2', $st_place: 'Chung cư Kisaragi' } }
        const sent: FindRecord[] = []
        findHandler({ chatOf: () => chat, send: async (r) => { sent.push(r); return 'saved' } })(rec(), ctx)
        await tick()
        expect(sent).toHaveLength(1)
        expect(sent[0].source).toEqual({ card: 'zombie', chapter: 'Ngày 2, Chung cư Kisaragi' })
        expect(chat.scriptstate[PENDING_KEY]).toBeUndefined()
    })

    test('a 502 queues the find on the chat, once', async () => {
        const chat: Chat = { scriptstate: {} }
        const h = findHandler({ chatOf: () => chat, send: async () => 'queue' })
        h(rec(), ctx); h(rec(), ctx)
        await tick()
        const left = parsePending(chat.scriptstate[PENDING_KEY])
        expect(left.map((r) => r.id)).toEqual(['muffled-footsteps'])
        expect(left[0].source.card).toBe('zombie')
    })

    test('a send that throws is queued too', async () => {
        const chat: Chat = { scriptstate: {} }
        findHandler({ chatOf: () => chat, send: async () => { throw new Error('boom') } })(rec(), ctx)
        await tick()
        expect(parsePending(chat.scriptstate[PENDING_KEY])).toHaveLength(1)
    })

    test('a card with no slug saves nothing; with no panel the chapter is a short text', async () => {
        const sent: FindRecord[] = []
        const send = async (r: FindRecord) => { sent.push(r); return 'saved' as SendResult }
        findHandler({ chatOf: () => ({ scriptstate: {} }), send })(rec(), { ...ctx, card: 'deadbeef-1' })
        findHandler({ chatOf: () => undefined, send })(rec(), ctx)
        await tick()
        expect(sent).toHaveLength(1)
        expect(sent[0].source.chapter).toBe('Lượt 5')
    })
})

describe('slug and chapter', () => {
    test('the zombie chat card maps to zombie, case-insensitively, others to nothing', () => {
        expect(CARD_SLUGS.fc27f53b).toBe('zombie')
        expect(cardSlugOf('FC27F53B-1234')).toBe('zombie')
        expect(cardSlugOf('abc')).toBe('')
        expect(cardSlugOf('')).toBe('')
    })
    test('chapter joins day and place, either alone, none', () => {
        expect(chapterOf({ $st_day: 'Ngày 3', $st_place: 'Bến xe' })).toBe('Ngày 3, Bến xe')
        expect(chapterOf({ $st_place: 'Bến xe' })).toBe('Bến xe')
        expect(chapterOf({ $st_day: 'null' })).toBe('')
        expect(chapterOf(undefined)).toBe('')
    })
})

describe('drainPending', () => {
    test('a find queued on one turn is sent on the next and the list is cleared', async () => {
        const chat: Chat = { scriptstate: {} }
        findHandler({ chatOf: () => chat, send: async () => 'queue' })(rec(), ctx)
        await tick()
        const got: string[] = []
        await drainPending(chat, async (r) => { got.push(r.id); return 'saved' })
        expect(got).toEqual(['muffled-footsteps'])
        expect(chat.scriptstate[PENDING_KEY]).toBe('')
    })

    test('still down: it stays; one saved and one down keeps only the down one', async () => {
        const chat: Chat = { scriptstate: {} }
        const h = findHandler({ chatOf: () => chat, send: async () => 'queue' })
        h(rec('Muffled Footsteps'), ctx); h(rec('Rusty Key'), ctx)
        await tick()
        await drainPending(chat, async (r) => (r.id === 'rusty-key' ? 'saved' : 'queue'))
        expect(parsePending(chat.scriptstate[PENDING_KEY]).map((r) => r.id)).toEqual(['muffled-footsteps'])
    })

    test('a find queued while the drain was in flight is not lost', async () => {
        const chat: Chat = { scriptstate: {} }
        findHandler({ chatOf: () => chat, send: async () => 'queue' })(rec('Muffled Footsteps'), ctx)
        await tick()
        await drainPending(chat, async () => {
            findHandler({ chatOf: () => chat, send: async () => 'queue' })(rec('Rusty Key'), ctx)
            await tick()
            return 'saved'
        })
        expect(parsePending(chat.scriptstate[PENDING_KEY]).map((r) => r.id)).toEqual(['rusty-key'])
    })

    test('nothing waiting: no send', async () => {
        const send = vi.fn(async () => 'saved' as SendResult)
        await drainPending({ scriptstate: {} }, send)
        expect(send).not.toHaveBeenCalled()
    })
})

describe('known names', () => {
    const resp = (status: number, body: unknown) => (async () => ({ status, json: async () => body })) as never
    test('reads both names of every find; auth header is sent', async () => {
        const f = vi.fn(resp(200, { finds: [{ name: { vi: 'Chìa khoá gỉ', en: 'Rusty Key' } }] }))
        expect(await fetchKnownNames({ fetch: f, auth: async () => 'tok' })).toEqual(['Chìa khoá gỉ', 'Rusty Key'])
        expect(f).toHaveBeenCalledWith('/api/assets/finds', { headers: { 'risu-auth': 'tok' } })
    })
    test('a 502, a throw and a bad body are null, never an error', async () => {
        expect(await fetchKnownNames({ fetch: resp(502, {}), auth: async () => 't' })).toBeNull()
        expect(await fetchKnownNames({ fetch: (async () => { throw new Error('x') }) as never, auth: async () => 't' })).toBeNull()
        expect(await fetchKnownNames({ fetch: resp(200, { nope: 1 }), auth: async () => 't' })).toBeNull()
    })
    test('the provider answers at once, caches 60 s, ignores a failed load and keeps the old names', async () => {
        let t = 0
        const loads: (string[] | null)[] = [['A'], null, ['B']]
        const load = vi.fn(async () => loads.shift() ?? null)
        const p = knownProvider(load, () => t)
        expect(p()).toEqual([])
        await tick()
        expect(p()).toEqual(['A'])
        expect(load).toHaveBeenCalledTimes(1)
        t += KNOWN_TTL_MS
        expect(p()).toEqual(['A'])
        await tick()
        expect(p()).toEqual(['A'])
        expect(load).toHaveBeenCalledTimes(2)
        t += KNOWN_TTL_MS
        p(); await tick()
        expect(p()).toEqual(['B'])
    })
    test('a load that never answers does not block', () => {
        const p = knownProvider(() => new Promise(() => {}))
        expect(p()).toEqual([])
        expect(p()).toEqual([])
    })
})
