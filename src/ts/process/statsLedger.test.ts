// @vitest-environment node
// The persona's EVENT LEDGER on the client (statsSave.ts + statsGlue.ts; owner/L1 2026-11-06 "fold theo event id; regen thay cùng id; bỏ last-value-wins"):
// after a reply the turn's events go to POST /api/events/turn (a regenerated reply sends the same chat + turn again), before a request the fold of
// GET /api/persona/state is WRITTEN into the chat ($lvl, $stats, $stat_exp, $stat_exp_sig) instead of the max(chat, store) merge, which stays only as the
// fallback when the ledger answers nothing or fails. All through a fake fetch, the real sendTurn / fetchLedger / fetchCurrent.
import { describe, expect, test } from 'vitest'
import { statsAfterReply, statsBeforeRequest, type StatsDeps } from './statsGlue'
import { EXP_PENDING_KEY, TURN_EVENTS_KEY, fetchCurrent, fetchLedger, foldSkills, foldVars, sendTurn, turnEventsOf } from '../storage/statsSave'

const STATS = ['suc_manh', 'nhanh_nhen', 'the_luc', 'tinh_than', 'cam_nhan', 'y_chi']
const all = (v: number) => Object.fromEntries(STATS.map((k) => [k, v]))
const fold = (over: Record<string, unknown> = {}) => ({ persona: 'kenji', level: 3, exp: 40, rank: 1, stats: { ...all(1000), suc_manh: 1250 }, stat_exp: { ...all(0), suc_manh: 20 }, event_count: 5, ...over })
type Call = { url: string, method: string, body?: any }

/** A fake Risu server: routes answer from `answers` (a status and a body, or a thrown error), every call is recorded. */
function server(answers: Record<string, { status: number, body?: unknown } | 'throw' | 'hang'>) {
    const calls: Call[] = []
    const f = (async (url: string, init?: RequestInit) => {
        const path = url.split('?')[0]
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
        const a = answers[path]
        if (!a || a === 'throw') throw new Error('network')
        if (a === 'hang') return new Promise(() => {})
        return { status: a.status, json: async () => a.body }
    }) as unknown as typeof fetch
    const d = { fetch: f, auth: async () => 'tok' }
    const deps: StatsDeps = {
        persona: () => 'kenji',
        send: async () => 'saved',
        current: (p) => fetchCurrent(p, d),
        sendTurn: (b) => sendTurn(b, d),
        ledger: (p) => fetchLedger(p, d),
    }
    return { calls, deps }
}
const turnEvents = (turn: number, events: unknown[]) => JSON.stringify({ turn, events })
const train = (n: number) => ({ id: 'x', kind: 'train', idx: 1, level: n, stats: { suc_manh: n } })
const expTurn = (turn: number) => JSON.stringify({ turn, stats: JSON.stringify({ ...all(1000) }), stat_exp: JSON.stringify(all(0)), lvl: '{"e":7,"l":2}', ids: '', cuc: '', lines: [] })

describe('after a reply: the turn goes to the ledger', () => {
    test('sends {persona, chat, turn, events, base} once, the base is the state the turn started from ($exp_turn)', async () => {
        const { calls, deps } = server({ '/api/events/turn': { status: 200, body: { ok: true } } })
        const chat = { id: 'chat-1', scriptstate: { [TURN_EVENTS_KEY]: turnEvents(9, [train(12), { kind: 'kill', idx: 1, level: 60, stats: {} }]), $exp_turn: expTurn(9) } as Record<string, any> }
        await statsAfterReply(chat, deps)
        const posts = calls.filter((c) => c.url === '/api/events/turn')
        expect(posts.length).toBe(1)
        expect(posts[0].method).toBe('POST')
        expect(posts[0].body).toEqual({ persona: 'kenji', chat: 'chat-1', turn: 9,
            events: [{ kind: 'train', idx: 1, level: 12, stats: { suc_manh: 12 } }, { kind: 'kill', idx: 1, level: 60, stats: {} }],
            base: { lvl: { l: 2, e: 7 }, stats: all(1000), stat_exp: all(0) } })
        expect(chat.scriptstate[TURN_EVENTS_KEY]).toBe('')
        expect(chat.scriptstate[EXP_PENDING_KEY]).toBe('')
    })
    test('a regenerated reply sends the same chat + turn again with its own list (the ledger replaces); a reply with no event sends []', async () => {
        const { calls, deps } = server({ '/api/events/turn': { status: 200, body: { ok: true } } })
        const chat = { id: 'chat-1', scriptstate: { [TURN_EVENTS_KEY]: turnEvents(9, [train(20)]), $exp_turn: expTurn(9) } as Record<string, any> }
        await statsAfterReply(chat, deps)
        chat.scriptstate[TURN_EVENTS_KEY] = turnEvents(9, [train(5)])
        await statsAfterReply(chat, deps)
        chat.scriptstate[TURN_EVENTS_KEY] = turnEvents(9, [])
        await statsAfterReply(chat, deps)
        const posts = calls.filter((c) => c.url === '/api/events/turn').map((c) => [c.body.chat, c.body.turn, c.body.events.map((e: any) => e.level)])
        expect(posts).toEqual([['chat-1', 9, [20]], ['chat-1', 9, [5]], ['chat-1', 9, []]])
    })
    test('a card with its own engine: stats.lua $exp_out + $exp_out_turn are read when the module export is absent', async () => {
        const { calls, deps } = server({ '/api/events/turn': { status: 200, body: { ok: true } } })
        const chat = { id: 'c2', scriptstate: { $exp_out: JSON.stringify([train(12)]), $exp_out_turn: '4', $lvl: '{"e":0,"l":1}', $stats: JSON.stringify(all(1000)) } as Record<string, any> }
        await statsAfterReply(chat, deps)
        expect(calls[0].body.turn).toBe(4)
        expect(calls[0].body.base.lvl).toEqual({ l: 1, e: 0 })
        expect(calls[0].body.base.stat_exp).toBeUndefined()   // $stat_exp_sig is not $stats: the store derives the EXP from the stats, as stats.lua would
    })
    test('down: the turn waits in $exp_pending, a regen replaces the waiting one, and both go out in order later', async () => {
        const answers: Record<string, any> = { '/api/events/turn': 'throw' }
        const { calls, deps } = server(answers)
        const chat = { id: 'chat-1', scriptstate: { [TURN_EVENTS_KEY]: turnEvents(9, [train(20)]) } as Record<string, any> }
        await statsAfterReply(chat, deps)
        chat.scriptstate[TURN_EVENTS_KEY] = turnEvents(9, [train(5)])
        await statsAfterReply(chat, deps)
        chat.scriptstate[TURN_EVENTS_KEY] = turnEvents(11, [train(12)])
        await statsAfterReply(chat, deps)
        expect(JSON.parse(chat.scriptstate[EXP_PENDING_KEY]).map((b: any) => [b.turn, b.events[0].level])).toEqual([[9, 5], [11, 12]])
        answers['/api/events/turn'] = { status: 200, body: { ok: true } }
        calls.length = 0
        await statsAfterReply(chat, deps)
        expect(calls.map((c) => [c.body.turn, c.body.events[0].level])).toEqual([[9, 5], [11, 12]])
        expect(chat.scriptstate[EXP_PENDING_KEY]).toBe('')
    })
    test('a 400 (the store refused it) drops the turn; a bad chat id or a malformed list sends nothing', async () => {
        const { calls, deps } = server({ '/api/events/turn': { status: 400, body: { error: 'x' } } })
        const chat = { id: 'chat-1', scriptstate: { [TURN_EVENTS_KEY]: turnEvents(9, [train(20)]) } as Record<string, any> }
        await statsAfterReply(chat, deps)
        expect(calls.length).toBe(1)
        expect(chat.scriptstate[EXP_PENDING_KEY]).toBe('')
        expect(turnEventsOf({ [TURN_EVENTS_KEY]: turnEvents(9, []) }, 'bad/id', 'kenji')).toBeNull()
        expect(turnEventsOf({ [TURN_EVENTS_KEY]: turnEvents(9, [{ kind: 'loot', idx: 1, level: 1, stats: {} }]) }, 'c', 'kenji')).toBeNull()
        expect(turnEventsOf({}, 'c', 'kenji')).toBeNull()
    })
})

describe('before a request: the chat starts from the fold', () => {
    test('writes $lvl, $stats, $stat_exp and $stat_exp_sig from the fold, even LOWER than the chat (no max): a taken-back EXP stays taken back', async () => {
        const { deps } = server({ '/api/persona/state': { status: 200, body: fold() }, '/api/assets/stats': { status: 200, body: { stats: all(5000), skills: { s1: 300 } } } })
        const chat = { id: 'chat-1', scriptstate: { $stats: JSON.stringify({ ...all(1000), suc_manh: 1400 }), $lvl: '{"e":0,"l":5}', $skills: '{}' } as Record<string, any> }
        await statsBeforeRequest(chat, deps)
        const v = chat.scriptstate
        expect(JSON.parse(v.$stats)).toEqual({ ...all(1000), suc_manh: 1250 })
        expect(JSON.parse(v.$lvl)).toEqual({ l: 3, e: 40 })
        expect(JSON.parse(v.$stat_exp)).toEqual({ ...all(0), suc_manh: 20 })
        expect(v.$stat_exp_sig).toBe(v.$stats)
        expect(JSON.parse(v.$skills)).toEqual({ s1: { m: 300, eq: 0 } })   // this fold carries no skills (an older asset manager): the store's merge still brings them
    })
    test('falls back to the old max(chat, store) merge when the ledger fails, has no event yet, or answers a bad shape', async () => {
        for (const led of ['throw', { status: 502, body: {} }, { status: 200, body: fold({ event_count: 0 }) }, { status: 200, body: { level: 'x' } }] as const) {
            const { deps } = server({ '/api/persona/state': led as any, '/api/assets/stats': { status: 200, body: { stats: { suc_manh: 1300 }, skills: {} } } })
            const chat = { id: 'chat-1', scriptstate: { $stats: JSON.stringify(all(1000)), $lvl: '{"e":0,"l":5}' } as Record<string, any> }
            await statsBeforeRequest(chat, deps)
            expect(JSON.parse(chat.scriptstate.$stats).suc_manh, JSON.stringify(led)).toBe(1300)
            expect(chat.scriptstate.$lvl).toBe('{"e":0,"l":5}')
            expect(chat.scriptstate.$stat_exp_sig).toBeUndefined()
        }
    })
    test('a turn of this chat still waiting for the ledger: the fold lacks it, so the chat is not overwritten from it', async () => {
        const { calls, deps } = server({ '/api/events/turn': 'throw', '/api/persona/state': { status: 200, body: fold() }, '/api/assets/stats': { status: 200, body: { stats: {}, skills: {} } } })
        const chat = { id: 'chat-1', scriptstate: { $stats: JSON.stringify({ ...all(1000), suc_manh: 1400 }), [EXP_PENDING_KEY]: JSON.stringify([{ persona: 'kenji', chat: 'chat-1', turn: 9, events: [] }]) } as Record<string, any> }
        await statsBeforeRequest(chat, deps)
        expect(JSON.parse(chat.scriptstate.$stats).suc_manh).toBe(1400)
        expect(calls.some((c) => c.url.startsWith('/api/persona/state'))).toBe(false)
    })
    test('the waiting turns go out first, then the fold is read and written', async () => {
        const { calls, deps } = server({ '/api/events/turn': { status: 200, body: { ok: true } }, '/api/persona/state': { status: 200, body: fold() }, '/api/assets/stats': { status: 200, body: { stats: {}, skills: {} } } })
        const chat = { id: 'chat-1', scriptstate: { [EXP_PENDING_KEY]: JSON.stringify([{ persona: 'kenji', chat: 'chat-1', turn: 9, events: [] }]) } as Record<string, any> }
        await statsBeforeRequest(chat, deps)
        expect(calls.map((c) => c.url.split('?')[0]).filter((u) => u !== '/api/assets/stats')).toEqual(['/api/events/turn', '/api/persona/state'])
        expect(JSON.parse(chat.scriptstate.$lvl)).toEqual({ l: 3, e: 40 })
    })
    test('never holds the request longer than the wait', async () => {
        const { deps } = server({ '/api/persona/state': 'hang', '/api/assets/stats': 'hang' })
        const chat = { id: 'chat-1', scriptstate: {} as Record<string, any> }
        const t = Date.now()
        await statsBeforeRequest(chat, deps, 100)
        expect(Date.now() - t).toBeLessThan(1000)
    })
    test('skill mastery comes from the fold: the chat keeps eq / link / name and takes m as it is (lower too); a skill only the fold knows joins', async () => {
        const { deps } = server({ '/api/persona/state': { status: 200, body: fold({ skills: { axe: 1210, 'stair-ear': 40, rope: 0 } }) }, '/api/assets/stats': { status: 200, body: { stats: {}, skills: { axe: 5000, ghost: 700 } } } })
        const chat = { id: 'chat-1', scriptstate: {
            $skills: JSON.stringify({ axe: { m: 1300, eq: 1, link: ['suc_manh'], name: 'Rìu' }, knot: { m: 90, eq: 0 } }),
            $store_slots: JSON.stringify(['stair-ear']) } as Record<string, any> }
        await statsBeforeRequest(chat, deps)
        expect(JSON.parse(chat.scriptstate.$skills)).toEqual({
            axe: { m: 1210, eq: 1, link: ['suc_manh'], name: 'Rìu' },   // the fold, not max(1300, 5000): a regenerated reply's mastery stays taken back
            knot: { m: 90, eq: 0 },                                     // only the chat knows it: untouched
            'stair-ear': { m: 40, eq: 1 },                              // joins, equipped because the persona's slots hold it
            rope: { m: 0, eq: 0 },                                      // joins unequipped
        })                                                              // 'ghost' (the old store only) does not come back through the merge
    })
    test('skill mastery falls back to the old max-merge: no event yet, no skills from the server (older asset manager, unreadable persona store), a turn waiting', async () => {
        const cases: [string, Record<string, any>, Record<string, any>][] = [
            ['no event', { '/api/persona/state': { status: 200, body: fold({ event_count: 0, skills: { axe: 10 } }) } }, {}],
            ['no skills field', { '/api/persona/state': { status: 200, body: fold() } }, {}],
            ['skills null', { '/api/persona/state': { status: 200, body: fold({ skills: null, skills_error: 'x' }) } }, {}],
            ['ledger down', { '/api/persona/state': 'throw' }, {}],
            ['a turn waiting', { '/api/events/turn': 'throw', '/api/persona/state': { status: 200, body: fold({ skills: { axe: 10 } }) } }, { [EXP_PENDING_KEY]: JSON.stringify([{ persona: 'kenji', chat: 'chat-1', turn: 9, events: [] }]) }],
        ]
        for (const [label, answers, extra] of cases) {
            const { deps } = server({ ...answers, '/api/assets/stats': { status: 200, body: { stats: {}, skills: { axe: 2000, ghost: 700 } } } })
            const chat = { id: 'chat-1', scriptstate: { $skills: JSON.stringify({ axe: { m: 1300, eq: 1 } }), ...extra } as Record<string, any> }
            await statsBeforeRequest(chat, deps)
            expect(JSON.parse(chat.scriptstate.$skills), label).toEqual({ axe: { m: 2000, eq: 1 }, ghost: { m: 700, eq: 0 } })
        }
    })
    test('the fold with skills and nothing to change leaves $skills as it was (no rewrite)', async () => {
        const { deps } = server({ '/api/persona/state': { status: 200, body: fold({ skills: { axe: 1300 } }) }, '/api/assets/stats': { status: 200, body: { stats: {}, skills: { axe: 9000 } } } })
        const text = '{"axe":{"eq":1,"m":1300}}'
        const chat = { id: 'chat-1', scriptstate: { $skills: text } as Record<string, any> }
        await statsBeforeRequest(chat, deps)
        expect(chat.scriptstate.$skills).toBe(text)
    })
    test('after a reply: the events carry the awarded mastery (kind find too); bad or zero gains are dropped, an empty Lua table [] is none', async () => {
        const { calls, deps } = server({ '/api/events/turn': { status: 200, body: { ok: true } } })
        const chat = { id: 'chat-1', scriptstate: { [TURN_EVENTS_KEY]: turnEvents(9, [
            { kind: 'act', idx: 1, level: 2, stats: { suc_manh: 2 }, skills: { axe: 1, 'bad id': 3, neg: -1, zero: 0, big: 10001, frac: 1.5 } },
            { kind: 'mission', idx: 'q', level: 50, stats: [], skills: [] },
            { kind: 'find', idx: 1, level: 0, stats: {}, skills: { axe: 100 } }]), $exp_turn: expTurn(9) } as Record<string, any> }
        await statsAfterReply(chat, deps)
        expect(calls[0].body.events).toEqual([
            { kind: 'act', idx: 1, level: 2, stats: { suc_manh: 2 }, skills: { axe: 1 } },
            { kind: 'mission', idx: 'q', level: 50, stats: {} },
            { kind: 'find', idx: 1, level: 0, stats: {}, skills: { axe: 100 } }])
    })
    test('fetchLedger reads skills (ints 0..10000 by skill id), null when absent or not an object', async () => {
        const read = async (body: unknown) => fetchLedger('kenji', { fetch: (async () => ({ status: 200, json: async () => body })) as unknown as typeof fetch, auth: async () => 'tok' })
        expect((await read(fold({ skills: { axe: 10, x: 'y', 'a b': 1, big: 20000 } })))!.skills).toEqual({ axe: 10 })
        expect((await read(fold()))!.skills).toBeNull()
        expect((await read(fold({ skills: [] })))!.skills).toBeNull()
        expect(foldSkills({}, null)).toBeNull()
        expect(foldSkills({ $skills: '{}' }, { level: 1, exp: 0, stats: all(1000), stat_exp: all(0), event_count: 2, skills: {} })).toBeNull()
    })
    test('foldVars: nothing for an empty ledger; the texts stats.lua writes', () => {
        expect(foldVars(null)).toBeNull()
        expect(foldVars({ level: 1, exp: 0, stats: all(1000), stat_exp: all(0), event_count: 0 })).toBeNull()
        const f = foldVars({ level: 2, exp: 4, stats: all(1000), stat_exp: all(0), event_count: 1 })!
        expect(f.$lvl).toBe('{"e":4,"l":2}')
        expect(Object.keys(JSON.parse(f.$stats))).toEqual(STATS)
    })
})
