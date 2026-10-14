// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const { openSaveQueue } = createRequire(import.meta.url)('../../../server/node/saveQueue.cjs')

type Row = { key: string, op: string, data: Uint8Array | null }
let dir: string
let save: string
let dbFile: string
let clock: number
const opened: any[] = []

const open = (extra: Record<string, unknown> = {}) => {
    const q = openSaveQueue({ dbFile, saveDir: save, now: () => clock, isImmutable: (k: string) => k.startsWith('assets'), closeWaitMs: 50, fullfsync: false, ...extra })
    opened.push(q)
    return q
}
const buf = (s: string) => Buffer.from(s)
const onDisk = (key: string) => (existsSync(join(save, key)) ? readFileSync(join(save, key), 'utf8') : null)
const never = () => new Promise<void>(() => {})

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sq-'))
    save = join(dir, 'save')
    mkdirSync(save)
    dbFile = join(dir, 'save.queue.sqlite')
    clock = 1_000_000
})
afterEach(async () => {
    for (const q of opened.splice(0)) await q.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
})

describe('saveQueue (specs/core/SaveQueue.tla)', () => {
    it('serves an acknowledged write before it reaches the directory, then applies it', async () => {
        const q = open({ apply: never })
        q.enqueueWrite('db', buf('v1'))
        expect(q.readPending('db')).toEqual({ op: 'write', data: buf('v1') })
        expect(onDisk('db')).toBeNull()
        await q.close().catch(() => {})
        const q2 = open()
        await q2.flush()
        expect(onDisk('db')).toBe('v1')
        expect(q2.readPending('db')).toBeNull()
    })

    it('coalesces: many writes of one key apply once, with the newest bytes', async () => {
        const applied: string[] = []
        const q = open({ apply: async (row: Row) => { applied.push(Buffer.from(row.data!).toString()) } })
        for (let i = 1; i <= 50; i++) q.enqueueWrite('db', buf(`v${i}`))
        await q.flush()
        expect(applied).toEqual(['v50'])
    })

    it('applies keys in the order they were first written, and a rewritten database moves behind the assets written after it', async () => {
        const order: string[] = []
        const q = open({ apply: async (row: Row) => { order.push(row.key) } })
        q.enqueueWrite('db', buf('1'))
        q.enqueueWrite('assets_B', buf('b'))
        q.enqueueWrite('db', buf('2'))      // replaces the first row, now behind assets_B which it may point at
        await q.flush()
        expect(order).toEqual(['assets_B', 'db'])
    })

    it('an asset written again while pending keeps its place, so the database cannot overtake it (the TLC trace)', async () => {
        const order: string[] = []
        const q = open({ apply: async (row: Row) => { order.push(row.key) } })
        q.enqueueWrite('assets_A', buf('same bytes'))
        q.enqueueWrite('db', buf('points at assets_A'))
        q.enqueueWrite('assets_A', buf('same bytes'))   // saved again: replacing the row would move it behind db
        await q.flush()
        expect(order).toEqual(['assets_A', 'db'])
    })

    it('recovers after a crash before the worker ran', async () => {
        const q1 = open({ apply: never })
        q1.enqueueWrite('assets_A', buf('A'))
        q1.enqueueWrite('db', buf('D'))
        const q2 = open()               // the process restarted: same SQLite file
        q2.start()
        await q2.flush()
        expect([onDisk('assets_A'), onDisk('db')]).toEqual(['A', 'D'])
        expect(q2.status().pending).toBe(0)
    })

    it('recovers after a crash between writing the file and deleting the row, applying it again harmlessly', async () => {
        let wrote = false
        const q1 = open({
            apply: async (row: Row) => {
                writeFileSync(join(save, row.key), Buffer.from(row.data!))
                wrote = true
                await never()
            },
        })
        q1.enqueueWrite('db', buf('D1'))
        await new Promise((r) => setTimeout(r, 30))
        expect(wrote).toBe(true)
        const q2 = open()
        await q2.flush()
        expect(onDisk('db')).toBe('D1')
        expect(q2.status().pending).toBe(0)
    })

    it('a write that replaces a row while it is being applied is not lost', async () => {
        let release!: () => void
        const gate = new Promise<void>((r) => (release = r))
        const applied: string[] = []
        const q = open({
            apply: async (row: Row) => {
                applied.push(Buffer.from(row.data!).toString())
                if (applied.length === 1) await gate
            },
        })
        q.enqueueWrite('db', buf('v1'))
        await new Promise((r) => setTimeout(r, 20))        // the worker is inside apply(v1)
        q.enqueueWrite('db', buf('v2'))
        release()
        await q.flush()
        expect(applied).toEqual(['v1', 'v2'])
        expect(q.status().pending).toBe(0)
    })

    it('deletes through the queue, readers see the delete at once, and a list can tell', async () => {
        writeFileSync(join(save, 'old'), 'x')
        const q = open({ apply: never })
        q.enqueueDelete('old')
        expect(q.readPending('old')).toEqual({ op: 'delete', data: null })
        expect(q.pendingKeys()).toEqual([{ key: 'old', op: 'delete' }])
        await q.close().catch(() => {})
        const q2 = open()
        await q2.flush()
        expect(onDisk('old')).toBeNull()
    })

    it('retries a failing apply with a growing delay, then succeeds', async () => {
        let calls = 0
        const q = open({ apply: async (row: Row) => { calls++; if (calls <= 3) throw new Error('EBUSY'); writeFileSync(join(save, row.key), Buffer.from(row.data!)) } })
        q.enqueueWrite('db', buf('D'))
        const seen: number[] = []
        for (let i = 0; i < 6; i++) {
            await q.flush()
            seen.push(calls)
            clock += 40_000                                   // past any backoff
        }
        expect(onDisk('db')).toBe('D')
        expect(calls).toBe(4)
        expect(q.status().pending).toBe(0)
    })

    it('keeps retrying a failing row and blocks the rows behind it: nothing overtakes it, also while it is in backoff (review finding 1)', async () => {
        const order: string[] = []
        let assetFails = true
        const q = open({
            apply: async (row: Row) => {
                if (row.key === 'assets_A' && assetFails) throw new Error('EBUSY')
                order.push(row.key)
            },
        })
        q.enqueueWrite('assets_A', buf('A'))
        await q.flush()                                   // the asset fails once and is now in backoff
        q.enqueueWrite('db', buf('points at assets_A'))
        await q.flush()
        expect(order).toEqual([])                         // the database did NOT jump the queue
        expect(q.status().stuck[0].key).toBe('assets_A')
        assetFails = false
        clock += 40_000
        await q.flush()
        expect(order).toEqual(['assets_A', 'db'])
        expect(q.status().pending).toBe(0)
    })

    it('a stuck row is never given up: after many failures it still applies once the problem is gone, and readers saw it all along', async () => {
        let fail = true
        const q = open({ apply: async (row: Row) => { if (fail) throw new Error('ENOSPC'); writeFileSync(join(save, row.key), Buffer.from(row.data!)) } })
        q.enqueueWrite('db', buf('D'))
        for (let i = 0; i < 25; i++) { await q.flush(); clock += 40_000 }
        expect(q.status().stuck[0].attempts).toBeGreaterThanOrEqual(20)
        expect(q.readPending('db')).toEqual({ op: 'write', data: buf('D') })
        fail = false
        await q.flush()
        expect(onDisk('db')).toBe('D')
        expect(q.status().pending).toBe(0)
    })

    it('an immutable key rewritten with different bytes while it is being applied is applied again (review finding 2)', async () => {
        let release!: () => void
        const gate = new Promise<void>((r) => (release = r))
        const applied: string[] = []
        const q = open({
            apply: async (row: Row) => {
                applied.push(Buffer.from(row.data!).toString())
                if (applied.length === 1) await gate
            },
        })
        q.enqueueWrite('assets_X', buf('old'))
        await new Promise((r) => setTimeout(r, 20))
        q.enqueueWrite('assets_X', buf('new'))            // same key, different bytes, the row is in flight
        release()
        await q.flush()
        expect(applied).toEqual(['old', 'new'])
        expect(q.status().pending).toBe(0)
    })

    it('a failure inside the worker itself (the clock throws, as SQLITE_FULL would) does not become an unhandled rejection (review finding 7)', async () => {
        const seen: unknown[] = []
        const handler = (e: unknown) => seen.push(e)
        process.on('unhandledRejection', handler)
        let calls = 0
        // the first call is enqueueWrite's own, the second is the worker's
        const q = open({ now: () => { if (++calls === 2) throw new Error('SQLITE_FULL'); return clock }, log: () => {} })
        q.enqueueWrite('db', buf('D'))
        await new Promise((r) => setTimeout(r, 60))
        process.off('unhandledRejection', handler)
        expect(seen).toEqual([])
    })

    it('an apply that hangs is cut off by the p-queue timeout and retried like any failure', async () => {
        let calls = 0
        const q = open({
            applyTimeoutMs: 40,
            apply: async (row: Row) => {
                calls++
                if (calls === 1) await never()                 // the first attempt never returns
                writeFileSync(join(save, row.key), Buffer.from(row.data!))
            },
        })
        q.enqueueWrite('db', buf('D'))
        await q.flush()
        await new Promise((r) => setTimeout(r, 120))
        expect(q.status().stuck[0]?.last_error).toBe('apply timed out')
        clock += 40_000
        await q.flush()
        expect(calls).toBe(2)
        expect(onDisk('db')).toBe('D')
        expect(q.status().pending).toBe(0)
    })

    it('property: whatever the interleaving of writes, deletes and drains, the directory ends with the last acknowledged state of every key', async () => {
        let state = 2024
        const rnd = (n: number) => Math.floor(((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * n)
        for (let trial = 0; trial < 15; trial++) {
            rmSync(save, { recursive: true, force: true }); mkdirSync(save)
            rmSync(dbFile, { force: true }); rmSync(dbFile + '-wal', { force: true }); rmSync(dbFile + '-shm', { force: true })
            const q = open()
            const want = new Map<string, string | null>()
            for (let step = 0; step < 30; step++) {
                const key = ['k0', 'k1', 'k2', 'assets_X'][rnd(4)]
                const r = rnd(5)
                if (r < 3) { const v = `v${step}`; q.enqueueWrite(key, buf(v)); want.set(key, v) }
                else if (r === 3) { q.enqueueDelete(key); want.set(key, null) }
                else await q.flush()
            }
            await q.flush()
            for (const [key, v] of want) expect(onDisk(key)).toBe(v)
            expect(readdirSync(save).sort()).toEqual([...want].filter(([, v]) => v !== null).map(([k]) => k).sort())
            await q.close()
        }
    }, 30000)
})
