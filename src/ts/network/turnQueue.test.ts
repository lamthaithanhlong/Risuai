// @vitest-environment node
// server/node/turnQueue.cjs: the properties specs/turns checks on the model, on the real store (SQLite, injected clock).
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const { openTurnQueue, backoffMs } = createRequire(import.meta.url)('../../../server/node/turnQueue.cjs')

let dir: string
let clock: number
const opened: any[] = []
const open = (extra: Record<string, unknown> = {}) => {
    const q = openTurnQueue(join(dir, 'turns.sqlite'), { now: () => clock, leaseMs: 60000, maxAttempts: 3, ...extra })
    opened.push(q)
    return q
}
const key = (chat: string, n: number) => `${chat}:0000000${n}-aaaa`
const turn = (chat: string, n: number, kind = 'send') => ({ key: key(chat, n), chat, cha: 'cha-1', kind, input: { text: `input ${n}` } })
const states = (q: any, k: string) => q.eventsFrom(k).map((e: any) => e.event.state)

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'tq-')); clock = 1_000_000 })
afterEach(() => { for (const q of opened.splice(0)) { try { q.close() } catch { /* closed */ } } rmSync(dir, { recursive: true, force: true }) })

describe('turnQueue', () => {
    it('a key makes one turn: asking again (the answer was lost) gets the same row', () => {
        const q = open()
        expect(q.create(turn('chatA', 1)).created).toBe(true)
        const again = q.create(turn('chatA', 1))
        expect(again.created).toBe(false)
        expect(again.turn.key).toBe(key('chatA', 1))
        expect(q.open().length).toBe(1)
    })

    it('refuses a key that does not name its chat, and a malformed one', () => {
        const q = open()
        expect(() => q.create({ ...turn('chatA', 1), chat: 'chatB' })).toThrow(TypeError)
        expect(() => q.create({ ...turn('chatA', 1), key: 'nope' })).toThrow(TypeError)
        expect(() => q.create({ ...turn('chatA', 1), kind: 'delete' })).toThrow(TypeError)
    })

    it('one active turn per chat; the second send waits and goes after, in order (OneTurnPerChat, InOrder)', () => {
        const q = open()
        q.create(turn('chatA', 1)); q.create(turn('chatA', 2)); q.create(turn('chatB', 3))
        const a = q.lease('w')
        expect(a.key).toBe(key('chatA', 1))
        const b = q.lease('w')
        expect(b.key).toBe(key('chatB', 3))            // another chat is free to go
        expect(q.lease('w')).toBeNull()                // chatA's second turn waits for its first
        expect(q.finish(a.key, 'w', { ok: true, result: { message: [] } })).toBe('saved')
        expect(q.lease('w').key).toBe(key('chatA', 2))
    })

    it('a model error is tried again after a backoff, keeps its place ahead of later turns, then fails for good (RetryBeforeGivingUp)', () => {
        const q = open()
        q.create(turn('chatA', 1)); q.create(turn('chatA', 2))
        let t = q.lease('w')
        expect(q.finish(t.key, 'w', { ok: false, error: '500', retryable: true })).toBe('retrying')
        expect(q.lease('w')).toBeNull()                // in backoff, and turn 2 may not overtake it
        clock += backoffMs(1)
        t = q.lease('w'); expect(t.key).toBe(key('chatA', 1)); expect(t.attempt).toBe(2)
        expect(q.finish(t.key, 'w', { ok: false, error: '500', retryable: true })).toBe('retrying')
        clock += backoffMs(2)
        t = q.lease('w'); expect(t.attempt).toBe(3)
        expect(q.finish(t.key, 'w', { ok: false, error: '500', retryable: true })).toBe('failed')
        expect(q.get(t.key).error).toBe('500')
        expect(q.lease('w').key).toBe(key('chatA', 2))
        expect(states(q, key('chatA', 1))).toEqual(['queued', 'assembling', 'retrying', 'assembling', 'retrying', 'assembling', 'failed'])
    })

    it('an error that cannot get better fails at once', () => {
        const q = open()
        q.create(turn('chatA', 1))
        const t = q.lease('w')
        expect(q.finish(t.key, 'w', { ok: false, error: 'chat not found', retryable: false })).toBe('failed')
    })

    it('a lease that runs out puts the turn back with the same key; the dead worker can no longer save it', () => {
        const q = open()
        q.create(turn('chatA', 1))
        const t = q.lease('dead')
        clock += 30000
        expect(q.renew(t.key, 'dead')).toBe(true)      // alive: the lease moves on
        clock += 59000
        expect(q.expire()).toBe(0)
        clock += 2000
        expect(q.expire()).toBe(1)
        expect(q.get(t.key).state).toBe('retrying')
        clock += backoffMs(1)
        const again = q.lease('new')
        expect(again.key).toBe(t.key)
        expect(q.finish(t.key, 'dead', { ok: true, result: {} })).toBe('assembling')   // not the holder: nothing changes
        expect(q.renew(t.key, 'dead')).toBe(false)
        expect(q.finish(t.key, 'new', { ok: true, result: { message: ['r'] } })).toBe('saved')
        expect(q.result(t.key)).toEqual({ message: ['r'] })
    })

    it('a finished turn never changes again (FinalStaysFinal)', () => {
        const q = open()
        q.create(turn('chatA', 1))
        const t = q.lease('w')
        q.finish(t.key, 'w', { ok: true, result: {} })
        expect(q.finish(t.key, 'w', { ok: false, error: 'late' })).toBe('saved')
        expect(q.cancel(t.key).state).toBe('saved')
        expect(q.phase(t.key, null, 'generating')).toBe(false)
        clock += 10 * 60000
        expect(q.expire()).toBe(0)
        expect(q.get(t.key).state).toBe('saved')
    })

    it('cancel stops a waiting or a running turn and frees the chat', () => {
        const q = open()
        q.create(turn('chatA', 1)); q.create(turn('chatA', 2))
        const t = q.lease('w')
        expect(q.cancel(t.key)).toMatchObject({ state: 'cancelled', wasActive: true, owner: 'w' })
        expect(q.renew(t.key, 'w')).toBe(false)        // the worker learns at its next beat and stops
        expect(q.lease('w').key).toBe(key('chatA', 2))
    })

    it('phases go forward for the lease holder, and the stream hook finds the chat\'s active turn', () => {
        const q = open()
        q.create(turn('chatA', 1))
        const t = q.lease('w')
        expect(q.activeOfChat('chatA').key).toBe(t.key)
        expect(q.phase(t.key, 'other', 'generating')).toBe(false)
        expect(q.phase(t.key, null, 'generating', 'job-1')).toBe(true)
        expect(q.phase(t.key, null, 'generating', 'job-1')).toBe(false)   // the same again is no event
        expect(q.phase(t.key, 'w', 'tidying')).toBe(true)
        expect(q.get(t.key).jobId).toBe('job-1')
        expect(q.eventsFrom(t.key, 3)).toEqual([
            { seq: 3, event: { type: 'state', state: 'generating', attempt: 1, jobId: 'job-1' } },
            { seq: 4, event: { type: 'state', state: 'tidying', attempt: 1 } },
        ])
    })

    it('survives a restart: the rows and the event log are on disk', () => {
        let q = open()
        q.create(turn('chatA', 1))
        q.lease('w')
        q.close()
        q = open()
        expect(q.get(key('chatA', 1)).state).toBe('assembling')
        clock += 61000
        expect(q.expire()).toBe(1)                    // the old process's lease runs out: the turn is run again
        expect(states(q, key('chatA', 1))).toEqual(['queued', 'assembling', 'retrying'])
    })

    it('random runs keep every invariant of the model', () => {
        // the TLC model's invariants on the real store: one active turn per chat, final states final, attempts bounded
        let seed = 7
        const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
        for (let run = 0; run < 30; run++) {
            const q = open({ maxAttempts: 3 })
            const final = new Map<string, string>()
            let made = 0
            for (let step = 0; step < 120; step++) {
                const r = rnd(7)
                const chat = ['c1', 'c2'][rnd(2)]
                if (r === 0 && made < 8) q.create(turn(chat, ++made))
                else if (r === 1) q.lease(['w1', 'w2'][rnd(2)])
                else if (r === 2) { const a = q.activeOfChat(chat); if (a) q.finish(a.key, ['w1', 'w2'][rnd(2)], rnd(2) ? { ok: true, result: {} } : { ok: false, error: 'x' }) }
                else if (r === 3) clock += [1000, 10000, 70000][rnd(3)]
                else if (r === 4) q.expire()
                else if (r === 5) { const all = q.open(); if (all.length) q.cancel(all[rnd(all.length)].key) }
                else { const a = q.activeOfChat(chat); if (a) q.phase(a.key, null, ['generating', 'tidying'][rnd(2)]) }
                for (const c of ['c1', 'c2']) {
                    const active = q.ofChat(c, 1e12).filter((t: any) => ['assembling', 'generating', 'tidying'].includes(t.state))
                    expect(active.length).toBeLessThanOrEqual(1)
                }
                for (const t of [...q.ofChat('c1', 1e12), ...q.ofChat('c2', 1e12)]) {
                    expect(t.attempt).toBeLessThanOrEqual(3)
                    if (final.has(t.key)) expect(t.state).toBe(final.get(t.key))
                    if (['saved', 'failed', 'cancelled'].includes(t.state)) final.set(t.key, t.state)
                }
            }
            q.close()
            rmSync(join(dir, 'turns.sqlite'), { force: true }); rmSync(join(dir, 'turns.sqlite-wal'), { force: true }); rmSync(join(dir, 'turns.sqlite-shm'), { force: true })
        }
    })
})
