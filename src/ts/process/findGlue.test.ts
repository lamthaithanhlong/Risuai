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

describe('loot of a reply by loot id (chat, turn) to the persona store', () => {
    // a fake fetch standing for the persona bridge: the real sendLootTurn and its POST body; answers come from `answer`
    const bridge = (answer: (body: any, n: number) => { status: number, body?: unknown } | 'throw') => {
        const calls: { url: string, body: any }[] = []
        const f = (async (url: string, init: any) => {
            const body = JSON.parse(init.body); calls.push({ url, body })
            const a = answer(body, calls.length)
            if (a === 'throw') throw new Error('down')
            return { status: a.status, json: async () => a.body }
        }) as any
        return { f, calls }
    }
    // the server's rule in small: per (chat, turn) the loots REPLACE the earlier ones; same list again = kept
    const store = () => {
        const turns = new Map<string, string>()
        const qty = new Map<string, number>()
        const answer = (b: any) => {
            const key = `${b.chat}|${b.turn}`
            const was = turns.get(key)
            const now = JSON.stringify(b.loots)
            if (was === now) return { status: 200, body: { ok: true, written: false, results: b.loots.map((_: unknown, idx: number) => ({ idx, ok: true, added: 'kept' })) } }
            for (const l of JSON.parse(was ?? '[]')) qty.set(l.entry.id, (qty.get(l.entry.id) ?? 0) - 1)
            for (const l of b.loots) qty.set(l.entry.id, (qty.get(l.entry.id) ?? 0) + 1)
            turns.set(key, now)
            return { status: 200, body: { ok: true, written: true, results: b.loots.map((_: unknown, idx: number) => ({ idx, ok: true, added: 'new' })) } }
        }
        return { answer, qty }
    }
    const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'char' : 'user', data: '' }))
    type LChat = { id: string, scriptstate: Record<string, any>, message: unknown[] }
    const mk = (extra: Record<string, any> = {}): LChat => ({ id: 'chat-1', scriptstate: { $lvl: '{"l":23,"e":5}', ...extra }, message: msgs(6) })
    const run = async (chat: LChat, f: any, saved: FindRecord[] = []) => {
        const { sendLootTurn } = await import('../storage/personaStore')
        const { lootAfterReply } = await import('./findGlue')
        await lootAfterReply(chat as never, { persona: () => 'nhan-vat', sendLoot: (b) => sendLootTurn(b, { fetch: f, auth: async () => 't' }), send: async (r) => { saved.push(r); return 'saved' } })
        await tick(); await tick()
    }
    const find = (chat: LChat, r = rec()) => findHandler({ chatOf: () => chat as never, send: async () => 'saved', recordLoot: true })(r, ctx)

    test('the handler only records the loot on the chat; nothing is posted until after the reply', async () => {
        const chat = mk()
        find(chat, { ...rec(), rarity: 'gold' })
        await tick()
        const pending = JSON.parse(chat.scriptstate.$loot_pending)
        expect(pending).toHaveLength(1)
        expect(pending[0]).toMatchObject({ kind: 'skill', at: 6, entry: { id: 'muffled-footsteps', name: 'Nghe bước chân', tier: 'gold', source: 'zombie', exp: 0 } })
        expect(pending[0].find.source.card).toBe('zombie')
    })

    test('success: one POST for (chat, turn) with the loot and the Level; the find is saved; $loot_pending cleared', async () => {
        const chat = mk()
        find(chat)
        const { f, calls } = bridge(() => ({ status: 200, body: { ok: true, results: [{ idx: 0, ok: true, added: 'new' }] } }))
        const saved: FindRecord[] = []
        await run(chat, f, saved)
        expect(calls).toHaveLength(1)
        expect(calls[0].url).toBe('/api/persona/loot/turn')
        expect(calls[0].body).toEqual({ persona: 'nhan-vat', chat: 'chat-1', turn: 6, level: 23,
            loots: [{ kind: 'skill', entry: { id: 'muffled-footsteps', name: 'Nghe bước chân', tier: 'silver', source: 'zombie', exp: 0, effect: 'Nghe bước chân qua tường mỏng.', conditions: 'Cần yên tĩnh' } }] })
        expect(saved.map((r) => r.id)).toEqual(['muffled-footsteps'])
        expect(chat.scriptstate.$loot_pending).toBe('')
        expect(chat.scriptstate.$loot_turn_pending).toBeFalsy()
    })

    test('an item goes with qty 1 and a legacy word as the new tier', async () => {
        const chat = mk()
        find(chat, { ...rec('Torch'), kind: 'item', rarity: 'rare' as never })
        const { f, calls } = bridge(() => ({ status: 200, body: { ok: true, results: [{ idx: 0, ok: true, added: 'new' }] } }))
        await run(chat, f)
        expect(calls[0].body.loots[0]).toEqual({ kind: 'item', entry: { id: 'torch', name: 'Nghe bước chân', tier: 'gold', source: 'zombie', qty: 1, effect: 'Nghe bước chân qua tường mỏng.', conditions: 'Cần yên tĩnh' } })
    })

    test('a regenerated reply with other loot replaces the turn: same (chat, turn), the old loot is gone from the store', async () => {
        const s = store()
        const { f, calls } = bridge((b) => s.answer(b))
        const chat = mk()
        find(chat, rec('Muffled Footsteps'))
        await run(chat, f)
        find(chat, rec('Iron Pipe'))          // the same reply regenerated: same message count
        await run(chat, f)
        expect(calls.map((c) => [c.body.turn, c.body.loots.map((l: any) => l.entry.id)])).toEqual([[6, ['muffled-footsteps']], [6, ['iron-pipe']]])
        expect(s.qty.get('muffled-footsteps')).toBe(0)
        expect(s.qty.get('iron-pipe')).toBe(1)
    })

    test('a regenerated reply with no find sends [] for the turn, which takes the earlier loot back', async () => {
        const s = store()
        const { f, calls } = bridge((b) => s.answer(b))
        const chat = mk()
        find(chat)
        await run(chat, f)
        await run(chat, f)                    // regenerated, no find
        expect(calls[1].body).toMatchObject({ chat: 'chat-1', turn: 6, loots: [] })
        expect(s.qty.get('muffled-footsteps')).toBe(0)
    })

    test('a replay (same loot again) is kept by the store: counted once, the find is not saved twice', async () => {
        const s = store()
        const { f, calls } = bridge((b) => s.answer(b))
        const saved: FindRecord[] = []
        const chat = mk()
        find(chat); await run(chat, f, saved)
        find(chat); await run(chat, f, saved)
        expect(calls).toHaveLength(2)
        expect(s.qty.get('muffled-footsteps')).toBe(1)
        expect(saved).toHaveLength(1)
    })

    test("full: the panel line says so and the find is not saved", async () => {
        const chat = mk({ $find_line: '🎲 d20 14 vs 11: OK — nhận Nghe bước chân' })
        find(chat)
        const { f } = bridge(() => ({ status: 200, body: { ok: true, results: [{ idx: 0, ok: false, reason: 'full' }] } }))
        const saved: FindRecord[] = []
        await run(chat, f, saved)
        expect(chat.scriptstate.$find_line).toBe('Kho đầy: không nhận được Nghe bước chân')
        expect(saved).toHaveLength(0)
        expect(chat.scriptstate[PENDING_KEY]).toBeUndefined()
    })

    test('network failure: the turn waits in $loot_turn_pending (newest per turn wins) and is sent before the next one', async () => {
        const chat = mk()
        find(chat)
        let down = true
        const { f, calls } = bridge(() => down ? 'throw' : { status: 200, body: { ok: true, results: [] } })
        await run(chat, f)
        find(chat, rec('Iron Pipe'))          // regenerated while the store is down: replaces the waiting turn
        await run(chat, f)
        let q = JSON.parse(chat.scriptstate.$loot_turn_pending)
        expect(q).toHaveLength(1)
        expect(q[0].loots.map((l: any) => l.entry.id)).toEqual(['iron-pipe'])
        expect(chat.scriptstate.$find_line).toBeUndefined()
        down = false
        chat.message = msgs(8)                // the next reply
        calls.length = 0
        await run(chat, f)
        expect(calls.map((c) => [c.body.turn, c.body.loots.length])).toEqual([[6, 1], [8, 0]])
        expect(chat.scriptstate.$loot_turn_pending).toBe('')
    })

    test('a 400 drops the turn; a stale loot of an earlier reply is never sent under a later turn', async () => {
        const chat = mk()
        find(chat)
        chat.message = msgs(8)
        const { f, calls } = bridge(() => ({ status: 400, body: { error: 'x' } }))
        await run(chat, f)
        expect(calls[0].body.turn).toBe(8)
        expect(calls[0].body.loots).toEqual([])
        expect(chat.scriptstate.$loot_turn_pending).toBeFalsy()
    })

    test('without recordLoot the find is saved at once (no persona store)', async () => {
        const chat = mk()
        const sent: FindRecord[] = []
        findHandler({ chatOf: () => chat as never, send: async (r) => { sent.push(r); return 'saved' } })(rec(), ctx)
        await tick()
        expect(sent).toHaveLength(1)
        expect(chat.scriptstate.$loot_pending).toBeUndefined()
    })
})

describe('lootEntry carries the find\'s effect and conditions', () => {
    test('effect and conditions go with the entry; blanks are left out', async () => {
        const { lootEntry } = await import('./findGlue')
        const rec: any = { id: 'a-b', kind: 'item', name: { vi: 'Dao', en: 'Knife' }, effect: 'Cắt dây', conditions: 'Còn bén', rarity: 'bronze', source: { card: 'c', chapter: '' } }
        expect(lootEntry(rec, 'c')).toMatchObject({ id: 'a-b', name: 'Dao', qty: 1, effect: 'Cắt dây', conditions: 'Còn bén' })
        const e = lootEntry({ ...rec, kind: 'skill', conditions: ' ' }, 'c')
        expect(e).toMatchObject({ exp: 0, effect: 'Cắt dây' }); expect('conditions' in e).toBe(false)
    })
})
