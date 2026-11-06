import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { parseTrain, sendTrain, trainBody } from './trainSave'
import { lastReplyRaw, trainAfterReply } from '../process/statsGlue'

const require = createRequire(import.meta.url)
const { saveTrain, trainOf } = require('../../../server/node/statsBridge.cjs')

describe('parseTrain: the first [[TRAIN|stat+stat|level]] of a raw reply', () => {
    it('reads the four levels, with or without accents', () => {
        for (const [word, level] of [['nhe', 'nhe'], ['nhẹ', 'nhe'], ['vua', 'vua'], ['vừa', 'vua'], ['manh', 'manh'], ['Mạnh', 'manh'], ['cuc', 'cuc'], ['cực', 'cuc'], ['cực hạn', 'cuc']] as const) {
            expect(parseTrain(`Anh chạy.\n[[TRAIN|the_luc|${word}]]`)).toEqual({ stats: ['the_luc'], level })
        }
    })
    it('keeps at most two stats, drops unknown and repeated ones, reads display names', () => {
        expect(parseTrain('[[TRAIN|the_luc+nhanh_nhen+y_chi|manh]]')?.stats).toEqual(['the_luc', 'nhanh_nhen'])
        expect(parseTrain('[[TRAIN|tien_bac+y_chi+y_chi|vua]]')?.stats).toEqual(['y_chi'])
        expect(parseTrain('[[TRAIN|Thể lực+Ý chí|vua]]')?.stats).toEqual(['the_luc', 'y_chi'])
        expect(parseTrain('[[TRAIN|the-luc|vua]]')?.stats).toEqual(['the_luc'])
    })
    it('reads the shapes the narrator gets slightly wrong: first pipe missing, spaces, case, the close missing', () => {
        for (const t of ['[[TRAIN the_luc|manh]]', '[[ train|the_luc|manh]]', '[[Train|the_luc|manh]]', '[[TRAIN|the_luc|manh]', '[[TRAIN|the_luc|manh']) expect(parseTrain('a\n' + t)).toEqual({ stats: ['the_luc'], level: 'manh' })
    })
    it('drops the whole tag on a bad level or no valid stat, and says nothing for a reply without one', () => {
        expect(parseTrain('[[TRAIN|the_luc|khung]]')).toBeNull()
        expect(parseTrain('[[TRAIN|the_luc]]')).toBeNull()
        expect(parseTrain('[[TRAIN|tien_bac|manh]]')).toBeNull()
        expect(parseTrain('[[TRAINING|the_luc|manh]] [[ACT|x|the_luc|normal|]]')).toBeNull()
        expect(parseTrain('Gió lùa qua hành lang.')).toBeNull()
        expect(parseTrain(undefined)).toBeNull()
    })
    it('only the first tag counts', () => {
        expect(parseTrain('[[TRAIN|the_luc|manh]]\n[[TRAIN|suc_manh|cuc]]')).toEqual({ stats: ['the_luc'], level: 'manh' })
    })
})

describe('sendTrain', () => {
    const body = trainBody({ stats: ['the_luc'], level: 'manh' }, { persona: 'p1', card: 'mailman', chat: 'c1', turn: 5 })
    const reply = (status: number, json: unknown) => (async () => ({ status, json: async () => json })) as unknown as typeof fetch
    it('posts the body with the auth header and tells saved from skipped', async () => {
        let seen: { url: string, init: RequestInit } | null = null
        const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return { status: 200, json: async () => ({ applied: true }) } }) as unknown as typeof fetch
        expect(await sendTrain(body, { fetch: f, auth: async () => 'tok' })).toBe('saved')
        expect(seen!.url).toBe('/api/train')
        expect((seen!.init.headers as Record<string, string>)['risu-auth']).toBe('tok')
        expect(JSON.parse(String(seen!.init.body))).toEqual({ persona: 'p1', card: 'mailman', chat: 'c1', turn: 5, stats: ['the_luc'], level: 'manh' })
        expect(await sendTrain(body, { fetch: reply(200, { applied: false, reason: 'off' }), auth: async () => 't' })).toBe('skipped')
    })
    it('never throws: a refusal, a server error, a network error and an auth error are a drop', async () => {
        expect(await sendTrain(body, { fetch: reply(400, {}), auth: async () => 't' })).toBe('drop')
        expect(await sendTrain(body, { fetch: reply(502, {}), auth: async () => 't' })).toBe('drop')
        expect(await sendTrain(body, { fetch: (async () => { throw new Error('down') }) as unknown as typeof fetch, auth: async () => 't' })).toBe('drop')
        expect(await sendTrain(body, { fetch: reply(200, {}), auth: async () => { throw new Error('no auth') } })).toBe('drop')
    })
})

describe('the server bridge: POST /api/train', () => {
    const ok = { persona: 'p1', card: 'mailman', chat: 'c1', turn: 5, stats: ['the_luc'], level: 'manh' }
    it('forwards only the known fields to the asset manager and passes its answer through', async () => {
        let sent: any = null
        const fetch = (async (url: string, init: any) => { sent = { url, body: JSON.parse(init.body) }; return { status: 200, json: async () => ({ applied: true, gained: { the_luc: 1 } }) } }) as any
        const r = await saveTrain({ ...ok, evil: 'x' }, { target: 'http://am', fetch })
        expect(r).toEqual({ status: 200, body: { applied: true, gained: { the_luc: 1 } } })
        expect(sent).toEqual({ url: 'http://am/api/train', body: ok })
    })
    it('400 for a body with no stats list; 400 when the store refuses; 502 and 504 when it is down or slow', async () => {
        expect((await saveTrain(null)).status).toBe(400)
        expect((await saveTrain({ ...ok, stats: 'the_luc' })).status).toBe(400)
        expect(trainOf([])).toBeNull()
        expect((await saveTrain(ok, { fetch: (async () => ({ status: 400, json: async () => ({ error: 'level' }) })) as any })).status).toBe(400)
        expect((await saveTrain(ok, { fetch: (async () => ({ status: 500, json: async () => ({}) })) as any })).status).toBe(502)
        expect((await saveTrain(ok, { fetch: (async () => { throw new Error('refused') }) as any })).status).toBe(502)
        const slow = ((_: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('abort'))))) as any
        expect((await saveTrain(ok, { fetch: slow, timeoutMs: 20 })).status).toBe(504)
    })
})

describe('trainAfterReply: only a card with no engine of its own posts, once, with the right turn', () => {
    const chat = { id: 'chat-1', message: [{ role: 'char', data: 'Mở đầu.' }, { role: 'user', data: 'tôi chạy' }, { role: 'char', data: 'Anh chạy.\n[[TRAIN|the_luc|manh]]' }] }
    const run = async (card: { desc?: string, type?: string } | undefined, c: typeof chat | undefined, raw: string, cardId = 'mailman') => {
        const calls: any[] = []
        await trainAfterReply(card, c, raw, { persona: () => 'p1', cardId: () => cardId, send: async (b) => { calls.push(b); return 'saved' } })
        return calls
    }
    it('posts the tag of the reply with persona, card, chat and turn', async () => {
        expect(await run({ desc: 'no growth rule' }, chat, chat.message[2].data)).toEqual([{ persona: 'p1', card: 'mailman', chat: 'chat-1', turn: 3, stats: ['the_luc'], level: 'manh' }])
    })
    it('a card whose description teaches [[ACT| keeps its own count: nothing is posted', async () => {
        expect(await run({ desc: 'rule [[ACT|id|stat|normal|]]' }, chat, chat.message[2].data)).toEqual([])
    })
    it('no tag, no card, a group, no card id, a bad chat id: nothing is posted, nothing throws', async () => {
        expect(await run({ desc: '' }, chat, 'Gió lùa.')).toEqual([])
        expect(await run(undefined, chat, chat.message[2].data)).toEqual([])
        expect(await run({ type: 'group' }, chat, chat.message[2].data)).toEqual([])
        expect(await run({ desc: '' }, chat, chat.message[2].data, '')).toEqual([])
        expect(await run({ desc: '' }, { ...chat, id: 'bad id!' }, chat.message[2].data)).toEqual([])
        await expect(trainAfterReply({ desc: '' }, chat, chat.message[2].data, { persona: () => { throw new Error('x') }, cardId: () => 'm', send: async () => 'saved' })).resolves.toBeUndefined()
    })
    it('lastReplyRaw is the newest character message, with its tags', () => {
        expect(lastReplyRaw(chat)).toContain('[[TRAIN|the_luc|manh]]')
        expect(lastReplyRaw({ message: [{ role: 'user', data: 'x' }] })).toBe('')
        expect(lastReplyRaw(undefined)).toBe('')
    })
})
