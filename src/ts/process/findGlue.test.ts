// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'

vi.mock('../storage/database.svelte', () => ({ getDatabase: vi.fn(() => ({ characters: [] })) }))

import { CARD_SLUGS, KNOWN_TTL_MS, cardSlugOf, chapterOf, drainPending, fetchKnownNames, findHandler, knownProvider } from './findGlue'
import type { FindRecord } from './findDrop'
import { PENDING_KEY, parsePending, type SendResult } from '../storage/findsSave'

const rec = (en = 'Muffled Footsteps'): FindRecord => ({
    id: en.toLowerCase().replace(/\s+/g, '-'), kind: 'skill', name: { vi: 'Nghe bước chân', en }, source: { card: 'fc27f53b-0000-4000', chapter: '' },
    effect: 'Nghe bước chân qua tường mỏng.', rarity: 'silver', conditions: 'Cần yên tĩnh', portable: true,
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

describe('loot to the persona store', () => {
    // a fake fetch that stands for the persona bridge: the real lootPersona and its POST body
    const bridge = (status: number, body: unknown) => {
        const calls: { url: string, body: any }[] = []
        const f = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return { status, json: async () => body } }) as any
        return { f, calls }
    }
    const wire = async (chat: Chat, fetchLike: any, sent: FindRecord[]) => {
        const { lootPersona } = await import('../storage/personaStore')
        return findHandler({
            chatOf: () => chat, send: async (r) => { sent.push(r); return 'saved' }, persona: () => 'nhan-vat',
            loot: (id, kind, entry, level) => lootPersona(id, kind, entry, level, { fetch: fetchLike, auth: async () => 't' }),
        })
    }
    test('a skill goes with mastery 0, the Vietnamese name, the tier, the card slug as source and the Level from $lvl; the find is saved too', async () => {
        const chat: Chat = { scriptstate: { $lvl: '{"l":23,"e":5}' } }
        const { f, calls } = bridge(200, { ok: true })
        const sent: FindRecord[] = []
        ;(await wire(chat, f, sent))({ ...rec(), rarity: 'gold' }, ctx)
        await tick(); await tick(); await tick()
        expect(calls).toHaveLength(1)
        expect(calls[0].url).toBe('/api/persona/loot')
        expect(calls[0].body).toEqual({ persona: 'nhan-vat', kind: 'skill', level: 23, entry: { id: 'muffled-footsteps', name: 'Nghe bước chân', tier: 'gold', source: 'zombie', mastery: 0 } })
        expect(sent).toHaveLength(1)
        expect(chat.scriptstate.$find_line).toBeUndefined()
    })
    test('an item goes with qty 1 and no mastery; a legacy word is sent as the new tier', async () => {
        const chat: Chat = { scriptstate: {} }
        const { f, calls } = bridge(200, { ok: true })
        ;(await wire(chat, f, []))({ ...rec('Torch'), kind: 'item', rarity: 'rare' as never }, ctx)
        await tick(); await tick(); await tick()
        expect(calls[0].body.kind).toBe('item'); expect(calls[0].body.level).toBe(1)
        expect(calls[0].body.entry).toEqual({ id: 'torch', name: 'Nghe bước chân', tier: 'gold', source: 'zombie', qty: 1 })
    })
    test("a full store (ok:false, reason 'full'): the line says so, the find is not saved or queued, nothing is deleted", async () => {
        const chat: Chat = { scriptstate: { $find_line: '🎲 d20 14 vs 11: OK — nhận Nghe bước chân' } }
        const { f, calls } = bridge(200, { ok: false, reason: 'full', max_storage: 100, count: 100 })
        const sent: FindRecord[] = []
        ;(await wire(chat, f, sent))(rec(), ctx)
        await tick(); await tick(); await tick()
        expect(chat.scriptstate.$find_line).toBe('Kho đầy: không nhận được Nghe bước chân')
        expect(sent).toHaveLength(0)
        expect(chat.scriptstate[PENDING_KEY]).toBeUndefined()
        expect(calls.every((c) => c.url === '/api/persona/loot')).toBe(true)
    })
    test('a network failure of the persona store never blocks: the find is still saved and the line is left alone', async () => {
        const chat: Chat = { scriptstate: { $find_line: 'giữ' } }
        const sent: FindRecord[] = []
        ;(await wire(chat, (async () => { throw new Error('down') }) as any, sent))(rec(), ctx)
        await tick(); await tick(); await tick()
        expect(sent).toHaveLength(1)
        expect(chat.scriptstate.$find_line).toBe('giữ')
        // and a loot dep that throws outright
        const sent2: FindRecord[] = []
        findHandler({ chatOf: () => chat, send: async (r) => { sent2.push(r); return 'saved' }, persona: () => { throw new Error('x') }, loot: async () => ({ ok: true }) })(rec(), ctx)
        await tick(); await tick(); await tick()
        expect(sent2).toHaveLength(1)
    })
    test('a card that is not a saving card still loots to the persona but does not save the find', async () => {
        const chat: Chat = { scriptstate: {} }
        const { f, calls } = bridge(200, { ok: true })
        const sent: FindRecord[] = []
        ;(await wire(chat, f, sent))(rec(), { ...ctx, card: 'zzzz-other' })
        await tick(); await tick(); await tick()
        expect(calls).toHaveLength(1); expect(calls[0].body.entry.source).toBe('zzzz-other'); expect(sent).toHaveLength(0)
    })
})
