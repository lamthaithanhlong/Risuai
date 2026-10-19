import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

type Store = {
    createJob(id: string, idem?: string, now?: number): void
    append(id: string, event: unknown, now?: number): number
    eventsFrom(id: string, from?: number, limit?: number): { seq: number, event: any }[]
    getJob(id: string): { status: string } | null
    finish(id: string, status: string, now?: number): void
    findReusable(idem: string | undefined, maxAgeMs: number, now?: number): { id: string, status: string } | null
    interruptRunning(now?: number): number
    beat(now?: number): number
    runningChats(): string[]
    prune(before: number): number
    close(): void
}
type StoreOpts = { boot?: string, pid?: number, isAlive?: (pid: number) => boolean }
const { openJobStore } = createRequire(import.meta.url)('../../../server/node/jobStore.cjs') as { openJobStore: (file: string, opts?: StoreOpts) => Store }

let dir: string
let file: string
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jobstore-'))
    file = join(dir, 'jobs.sqlite')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('jobStore events', () => {
    test('events come back in order with 1-based sequence numbers, from any cursor', () => {
        const s = openJobStore(file)
        s.createJob('j', 'k')
        expect([1, 2, 3].map((n) => s.append('j', { type: 'chunk', n }))).toEqual([1, 2, 3])
        expect(s.eventsFrom('j', 1).map((e) => e.seq)).toEqual([1, 2, 3])
        expect(s.eventsFrom('j', 3).map((e) => e.event.n)).toEqual([3])
        expect(s.eventsFrom('j', 4)).toEqual([])
        s.close()
    })

    test('a client that dropped after seq 2 gets exactly the rest, never a repeat', () => {
        const s = openJobStore(file)
        s.createJob('j')
        for (let n = 1; n <= 5; n++) s.append('j', { type: 'chunk', n })
        const received = s.eventsFrom('j', 1, 2)
        const lastSeq = received.at(-1)!.seq
        const rest = s.eventsFrom('j', lastSeq + 1)
        expect([...received, ...rest].map((e) => e.event.n)).toEqual([1, 2, 3, 4, 5])
        s.close()
    })

    test('everything survives closing and reopening the store (a server restart)', () => {
        const a = openJobStore(file)
        a.createJob('j', 'k')
        a.append('j', { type: 'chunk', n: 1 })
        a.close()
        const b = openJobStore(file)
        expect(b.eventsFrom('j', 1)).toHaveLength(1)
        expect(b.append('j', { type: 'chunk', n: 2 })).toBe(2)
        b.close()
    })
})

describe('jobStore reuse by idempotency key', () => {
    test('a running or finished job is found by its key', () => {
        const s = openJobStore(file)
        s.createJob('j1', 'key', 1000)
        expect(s.findReusable('key', 60_000, 2000)?.id).toBe('j1')
        s.finish('j1', 'done', 1500)
        expect(s.findReusable('key', 60_000, 2000)?.id).toBe('j1')
        s.close()
    })

    test('a failed, aborted or interrupted job is not reused: ask the model again', () => {
        const s = openJobStore(file)
        for (const [i, status] of ['error', 'aborted', 'interrupted'].entries()) {
            s.createJob(`j${i}`, `k${i}`, 1000)
            s.finish(`j${i}`, status, 1100)
            expect(s.findReusable(`k${i}`, 60_000, 2000)).toBeNull()
        }
        s.close()
    })

    test('an old job, an unknown key and no key are not reused', () => {
        const s = openJobStore(file)
        s.createJob('j', 'key', 1000)
        expect(s.findReusable('key', 500, 5000)).toBeNull()
        expect(s.findReusable('other', 60_000, 2000)).toBeNull()
        expect(s.findReusable(undefined, 60_000, 2000)).toBeNull()
        s.close()
    })

    test('a job keeps its first outcome', () => {
        const s = openJobStore(file)
        s.createJob('j')
        s.finish('j', 'done')
        s.finish('j', 'error')
        expect(s.getJob('j')?.status).toBe('done')
        s.close()
    })
})

describe('jobStore restart and cleanup', () => {
    test('jobs that were running when the server died become interrupted, with an error event to read', () => {
        const a = openJobStore(file)
        a.createJob('j', 'k')
        a.append('j', { type: 'chunk', n: 1 })
        a.close()
        const b = openJobStore(file)
        expect(b.interruptRunning()).toBe(1)
        expect(b.getJob('j')?.status).toBe('interrupted')
        expect(b.eventsFrom('j', 1).at(-1)!.event.type).toBe('error')
        expect(b.findReusable('k', 60_000)).toBeNull()
        b.close()
    })

    test('pruning removes old jobs and their events only', () => {
        const s = openJobStore(file)
        s.createJob('old', undefined, 1000)
        s.append('old', { type: 'chunk' }, 1000)
        s.createJob('new', undefined, Date.now())
        s.append('new', { type: 'chunk' })
        expect(s.prune(Date.now() - 10_000)).toBe(1)
        expect(s.getJob('old')).toBeNull()
        expect(s.eventsFrom('old', 1)).toEqual([])
        expect(s.eventsFrom('new', 1)).toHaveLength(1)
        s.close()
    })
})

describe('reuse window (the page may come back hours later)', () => {
    const require = createRequire(import.meta.url)
    const { JOB_REUSE_MAX_AGE_MS } = require('../../../server/node/jobStore.cjs')
    const open = () => {
        const dir = mkdtempSync(join(tmpdir(), 'jobwin-'))
        const s = require('../../../server/node/jobStore.cjs').openJobStore(join(dir, 'j.sqlite')) as Store
        return { s, dir }
    }

    test('a finished reply is handed back 23 hours later, not 25', () => {
        const { s, dir } = open()
        try {
            const t0 = 1_000_000
            s.createJob('j1', 'K', t0)
            s.append('j1', { type: 'chunk' }, t0)
            s.finish('j1', 'done', t0)
            expect(s.findReusable('K', JOB_REUSE_MAX_AGE_MS, t0 + 23 * 3600_000)?.id).toBe('j1')
            expect(s.findReusable('K', JOB_REUSE_MAX_AGE_MS, t0 + 25 * 3600_000)).toBeNull()
        } finally {
            s.close(); rmSync(dir, { recursive: true, force: true })
        }
    })
})

describe('two servers on one jobs file (F5: a test run started a second server.cjs with the owner\'s HOME)', () => {
    const alive = new Set([111, 222])
    const isAlive = (pid: number) => alive.has(pid)

    test('a server that starts leaves the running jobs of a live server alone', () => {
        const live = openJobStore(file, { pid: 111, isAlive })
        live.interruptRunning()
        live.createJob('reply', 'k1:gen#0')
        live.append('reply', { type: 'chunk', n: 1 })
        const second = openJobStore(file, { pid: 222, isAlive })
        expect(second.interruptRunning()).toBe(0)
        expect(live.getJob('reply')?.status).toBe('running')
        expect(live.append('reply', { type: 'chunk', n: 2 })).toBe(2)   // used to fail: UNIQUE constraint on events.seq
        second.close(); live.close()
    })

    test('jobs of a server whose process is gone are interrupted at once; of one that stopped beating, by the next beat', () => {
        const hung = openJobStore(file, { pid: 111, isAlive })      // alive process, but it stops beating
        hung.interruptRunning(1000)
        hung.createJob('b', 'k2:y#0')
        const old = openJobStore(file, { pid: 333, isAlive })      // 333 is not alive: a crash
        old.interruptRunning(1000)
        old.createJob('a', 'k1:x#0')
        const fresh = openJobStore(file, { pid: 222, isAlive })
        expect(fresh.interruptRunning(2000)).toBe(1)
        expect(fresh.getJob('a')?.status).toBe('interrupted')
        expect(fresh.getJob('b')?.status).toBe('running')
        expect(fresh.beat(1000 + 31_000)).toBe(1)
        expect(fresh.getJob('b')?.status).toBe('interrupted')
        fresh.close(); hung.close(); old.close()
    })

    test('the chats with a running job are read from the key prefix', () => {
        const s = openJobStore(file)
        s.createJob('a', 'chat-1:g1#0')
        s.createJob('b', 'chat-1:g1#1')
        s.createJob('c', 'chat-2:g2#0')
        s.createJob('d', 'plain-uuid#0')
        s.finish('c', 'done')
        expect(s.runningChats()).toEqual(['chat-1'])
        s.close()
    })
})

