// @vitest-environment node
// The FAtiMA sidecar's client (server/node/fatimaClient.cjs): spawn + READY line + token, restarts with backoff, the restart circuit, the
// call breaker (timeouts / 5xx), the deadline, attaching to an external sidecar. The child process and fetch are fakes; one live test spawns the
// built dll when it exists (server/sidecar/fatima: `npm run sidecar:build`).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { existsSync } from 'node:fs'

const req = createRequire(import.meta.url)
const { createFatimaClient, BACKOFF_MS, DEFAULT_DLL, DEFAULT_DOTNET } = req('../../../server/node/fatimaClient.cjs')

class FakeChild extends EventEmitter {
    stdout = new EventEmitter()
    stderr = new EventEmitter()
    killed: string[] = []
    constructor(public pid: number) { super() }
    kill(sig = 'SIGTERM') { this.killed.push(sig); queueMicrotask(() => this.emit('exit', null, sig)); return true }
    say(line: string) { this.stdout.emit('data', Buffer.from(line + '\n')) }
    die(code = 1) { this.emit('exit', code, null) }
}

type Call = { path: string; method: string; headers: Record<string, string>; body: any }
const reply = (status: number, data: any) => ({ ok: status >= 200 && status < 300, status, json: async () => data })

function rig(extra: Record<string, any> = {}) {
    const children: FakeChild[] = []
    const spawns: { cmd: string; args: string[]; env: Record<string, string> }[] = []
    const calls: Call[] = []
    const logs: string[] = []
    const h = {
        health: (): any => reply(200, { ok: true, version: 'fatima-sidecar/1' }),
        appraise: (_b: any): any => reply(200, { ms: 1, engine: 'fatima', cache: 'miss', npcs: [] }),
        reset: (): any => reply(200, { ok: true }),
        hang: false,   // /appraise never answers (until the abort)
    }
    const fetch = (url: string, init: any) => {
        const path = new URL(url).pathname
        const call: Call = { path, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined }
        calls.push(call)
        return new Promise<any>((resolve, reject) => {
            const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            if (init.signal?.aborted) return abort()
            init.signal?.addEventListener('abort', abort)
            if (path === '/appraise' && h.hang) return
            Promise.resolve().then(() => {
                if (path === '/health') return resolve(h.health())
                if (path === '/appraise') return resolve(h.appraise(call.body))
                if (path === '/reset') return resolve(h.reset())
                resolve(reply(404, {}))
            }).catch(reject)
        })
    }
    const spawn = (cmd: string, args: string[], o: any) => {
        spawns.push({ cmd, args, env: o.env })
        const c = new FakeChild(5000 + children.length)
        children.push(c)
        return c
    }
    const client = createFatimaClient({ spawn, fetch, log: (...a: any[]) => logs.push(a.join(' ')), dotnet: '/x/dotnet', dll: '/x/Fatima.Sidecar.dll', ...extra })
    return { client, children, spawns, calls, logs, h }
}

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

/** starts the client and has its sidecar announce itself */
async function startReady(r: ReturnType<typeof rig>, port = 4321, n = r.children.length) {
    const p = r.client.start()
    await flush()
    r.children[n].say(`FATIMA_READY ${port}`)
    await vi.advanceTimersByTimeAsync(0)
    return p
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('spawn, READY, token', () => {
    test('spawns dotnet with the dll, a fresh token and an OS-chosen port; ready after READY + health + one warm call', async () => {
        const r = rig()
        const p = r.client.start()
        await flush()
        expect(r.spawns).toHaveLength(1)
        expect(r.spawns[0].cmd).toBe('/x/dotnet')
        expect(r.spawns[0].args).toEqual(['/x/Fatima.Sidecar.dll'])
        expect(r.spawns[0].env.FATIMA_PORT).toBe('0')
        expect(r.spawns[0].env.FATIMA_TOKEN).toMatch(/^[0-9a-f]{32}$/)
        expect(r.spawns[0].env.DOTNET_CLI_TELEMETRY_OPTOUT).toBe('1')
        expect(r.spawns[0].env.FATIMA_PARENT_PID).toBe(String(process.pid))
        expect(r.client.ready()).toBe(false)   // nothing printed yet
        await expect(r.client.appraise({}, 50)).rejects.toMatchObject({ code: 'NOT_READY' })
        r.children[0].say('FATIMA_READY 4321')
        expect(await p).toBe(true)
        expect(r.client.ready()).toBe(true)
        expect(r.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /health', 'POST /appraise', 'POST /reset'])   // health, then the warm call, then it cleans up
        expect(r.calls[1].body.chatId).toBe('__warm')
        expect(r.client.stats()).toMatchObject({ state: 'ready', breaker: 'closed', url: 'http://127.0.0.1:4321', attached: false, restarts: 0 })
        await r.client.stop()
    })

    test('the READY line may arrive in pieces and after other output', async () => {
        const r = rig()
        const p = r.client.start()
        await flush()
        r.children[0].stdout.emit('data', Buffer.from('starting...\nFATIMA_REA'))
        r.children[0].stdout.emit('data', Buffer.from('DY 5555\n'))
        expect(await p).toBe(true)
        expect(r.client.stats().url).toBe('http://127.0.0.1:5555')
        await r.client.stop()
    })

    test('every request carries x-fatima-token, the same one the child was given', async () => {
        const r = rig()
        await startReady(r)
        await r.client.appraise({ chatId: 'c', npcs: [], events: [] }, 100)
        const token = r.spawns[0].env.FATIMA_TOKEN
        expect(r.calls.length).toBeGreaterThanOrEqual(4)
        for (const c of r.calls) expect(c.headers['x-fatima-token']).toBe(token)
        await r.client.stop()
    })

    test('two clients get two different tokens', async () => {
        const a = rig(); const b = rig()
        a.client.start(); b.client.start()
        await flush()
        expect(a.spawns[0].env.FATIMA_TOKEN).not.toBe(b.spawns[0].env.FATIMA_TOKEN)
        await a.client.stop(); await b.client.stop()
    })

    test('appraise posts the payload and returns the answer; stats counts it', async () => {
        const r = rig()
        await startReady(r)
        r.h.appraise = (b: any) => reply(200, { ms: 2, engine: 'fatima', cache: 'hit', npcs: [{ id: b.npcs[0].id }] })
        const out = await r.client.appraise({ chatId: 'c1', npcs: [{ id: 'marek' }], events: [] }, 100)
        expect(out.npcs[0].id).toBe('marek')
        const s = r.client.stats()
        expect(s.calls).toBe(1)
        expect(s.ok).toBe(1)
        expect(s.timeouts).toBe(0)
        await r.client.stop()
    })

    test('no READY within 15 s: the child is killed and started again', async () => {
        const r = rig()
        const p = r.client.start()
        await flush()
        await vi.advanceTimersByTimeAsync(15000)
        expect(await p).toBe(false)
        expect(r.children[0].killed).toContain('SIGKILL')
        await vi.advanceTimersByTimeAsync(1000)   // the first backoff
        expect(r.spawns).toHaveLength(2)
        await r.client.stop()
    })

    test('a failing health check kills the child and restarts', async () => {
        const r = rig()
        r.h.health = () => reply(503, {})
        const p = r.client.start()
        await flush()
        r.children[0].say('FATIMA_READY 4321')
        expect(await p).toBe(false)
        expect(r.client.ready()).toBe(false)
        expect(r.children[0].killed).toContain('SIGKILL')
        await r.client.stop()
    })

    test('a warm call that fails does not stop it from being ready', async () => {
        const r = rig()
        r.h.appraise = () => reply(500, { error: 'boom' })
        await startReady(r)
        expect(r.client.ready()).toBe(true)
        expect(r.logs.some((l) => l.includes('warm call failed'))).toBe(true)
        await r.client.stop()
    })

    test('start() twice is one spawn', async () => {
        const r = rig()
        const a = r.client.start(); const b = r.client.start()
        expect(a).toBe(b)
        await flush()
        expect(r.spawns).toHaveLength(1)
        await r.client.stop()
    })
})

describe('supervisor: restarts, backoff, circuit', () => {
    async function die(r: ReturnType<typeof rig>, n: number) {
        r.children[n].die(1)
        await vi.advanceTimersByTimeAsync(0)
    }

    test('restart backoff is 1, 2, 4, 8, 16 s', async () => {
        expect(BACKOFF_MS).toEqual([1000, 2000, 4000, 8000, 16000, 30000])
        const r = rig()
        await startReady(r)
        for (let i = 0; i < 5; i++) {
            await die(r, i)
            expect(r.client.ready()).toBe(false)
            const wait = BACKOFF_MS[i]
            await vi.advanceTimersByTimeAsync(wait - 1)
            expect(r.spawns).toHaveLength(i + 1)                 // not yet
            await vi.advanceTimersByTimeAsync(1)
            expect(r.spawns).toHaveLength(i + 2)                 // now
            r.children[i + 1].say('FATIMA_READY ' + (4400 + i))
            await vi.advanceTimersByTimeAsync(0)
            expect(r.client.ready()).toBe(true)
        }
        expect(r.client.stats().restarts).toBe(5)
        await r.client.stop()
    })

    test('the 6th death inside 10 minutes opens the circuit for 10 minutes; then it tries again', async () => {
        const r = rig()
        await startReady(r)
        for (let i = 0; i < 5; i++) {
            await die(r, i)
            await vi.advanceTimersByTimeAsync(BACKOFF_MS[i])
            r.children[i + 1].say('FATIMA_READY ' + (4400 + i))
            await vi.advanceTimersByTimeAsync(0)
        }
        expect(r.spawns).toHaveLength(6)
        await die(r, 5)   // the 6th death
        expect(r.client.stats().state).toBe('open')
        expect(r.logs.filter((l) => l.includes('circuit open for')).length).toBe(1)   // logged once
        await vi.advanceTimersByTimeAsync(9 * 60 * 1000)
        expect(r.spawns).toHaveLength(6)                       // still waiting
        expect(r.client.ready()).toBe(false)
        await expect(r.client.appraise({}, 50)).rejects.toMatchObject({ code: 'NOT_READY' })
        await vi.advanceTimersByTimeAsync(60 * 1000)
        expect(r.spawns).toHaveLength(7)                       // 10 minutes passed: another go
        r.children[6].say('FATIMA_READY 4999')
        await vi.advanceTimersByTimeAsync(0)
        expect(r.client.ready()).toBe(true)
        await r.client.stop()
    })

    test('deaths spread over more than 10 minutes never open the circuit', async () => {
        const r = rig()
        await startReady(r)
        for (let i = 0; i < 8; i++) {
            await die(r, i)
            await vi.advanceTimersByTimeAsync(1000)   // stableMs not reached: the backoff grows, but...
            await vi.advanceTimersByTimeAsync(0)
            r.children[i + 1].say('FATIMA_READY ' + (4400 + i))
            await vi.advanceTimersByTimeAsync(0)
            await vi.advanceTimersByTimeAsync(3 * 60 * 1000)   // ...three quiet minutes pass before the next death
        }
        expect(r.client.stats().state).toBe('ready')
        await r.client.stop()
    })

    test('a sidecar that stayed up a minute restarts from the first backoff again', async () => {
        const r = rig()
        await startReady(r)
        await die(r, 0)
        await vi.advanceTimersByTimeAsync(1000)
        r.children[1].say('FATIMA_READY 4400')
        await vi.advanceTimersByTimeAsync(0)
        await die(r, 1)   // died at once: the backoff grew to 2 s
        await vi.advanceTimersByTimeAsync(1999)
        expect(r.spawns).toHaveLength(2)
        await vi.advanceTimersByTimeAsync(1)
        expect(r.spawns).toHaveLength(3)
        r.children[2].say('FATIMA_READY 4401')
        await vi.advanceTimersByTimeAsync(61 * 1000)          // stable
        await die(r, 2)
        await vi.advanceTimersByTimeAsync(999)
        expect(r.spawns).toHaveLength(3)
        await vi.advanceTimersByTimeAsync(1)
        expect(r.spawns).toHaveLength(4)                       // 1 s, not 4
        await r.client.stop()
    })

    test('a spawn that throws is retried with the backoff', async () => {
        let n = 0
        const children: FakeChild[] = []
        const client = createFatimaClient({
            log: () => {}, dotnet: '/x', dll: '/y', fetch: async () => reply(200, { ok: true }),
            spawn: () => { n++; if (n === 1) throw new Error('ENOENT'); const c = new FakeChild(1); children.push(c); return c },
        })
        client.start()
        await flush()
        expect(n).toBe(1)
        await vi.advanceTimersByTimeAsync(1000)
        expect(n).toBe(2)
        await client.stop()
    })

    test('stop() kills the child and nothing is restarted afterwards', async () => {
        const r = rig()
        await startReady(r)
        const stopped = r.client.stop()
        await vi.advanceTimersByTimeAsync(0)
        await stopped
        expect(r.children[0].killed).toEqual(['SIGTERM'])
        expect(r.client.ready()).toBe(false)
        await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
        expect(r.spawns).toHaveLength(1)
        await expect(r.client.appraise({}, 50)).rejects.toMatchObject({ code: 'NOT_READY' })
        expect(r.client.stats().state).toBe('stopped')
    })

    test('stop() while waiting for a restart cancels it', async () => {
        const r = rig()
        await startReady(r)
        await die(r, 0)
        await r.client.stop()
        await vi.advanceTimersByTimeAsync(60 * 1000)
        expect(r.spawns).toHaveLength(1)
    })

    test('a child that will not die on SIGTERM is killed hard after 2 s', async () => {
        const r = rig()
        await startReady(r)
        r.children[0].kill = function (this: FakeChild, sig = 'SIGTERM') { this.killed.push(sig); return true }   // ignores everything (until the second call exits)
        const stopped = r.client.stop()
        await vi.advanceTimersByTimeAsync(2000)
        await stopped
        expect(r.children[0].killed).toEqual(['SIGTERM', 'SIGKILL'])
    })
})

describe('the call: deadline and breaker', () => {
    test('a call that does not answer within the budget throws TIMEOUT', async () => {
        const r = rig()
        await startReady(r)
        r.h.hang = true
        const p = r.client.appraise({ chatId: 'c' }, 110)
        const caught = p.catch((e: any) => e)
        await vi.advanceTimersByTimeAsync(109)
        let settled = false
        caught.then(() => { settled = true })
        await flush()
        expect(settled).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(await caught).toMatchObject({ code: 'TIMEOUT' })
        expect(r.client.stats().timeouts).toBe(1)
        await r.client.stop()
    })

    test('the default deadline is timeoutMs', async () => {
        const r = rig({ timeoutMs: 40 })
        await startReady(r)
        r.h.hang = true
        const caught = r.client.appraise({}).catch((e: any) => e)
        await vi.advanceTimersByTimeAsync(40)
        expect(await caught).toMatchObject({ code: 'TIMEOUT' })
        await r.client.stop()
    })

    async function failTimes(r: ReturnType<typeof rig>, n: number) {
        r.h.hang = true
        for (let i = 0; i < n; i++) {
            const c = r.client.appraise({}, 10).catch((e: any) => e)
            await vi.advanceTimersByTimeAsync(10)
            await c
        }
        r.h.hang = false
    }

    test('3 timeouts in a row open the breaker: ready() is false and appraise throws at once, without a request', async () => {
        const r = rig()
        await startReady(r)
        await failTimes(r, 2)
        expect(r.client.ready()).toBe(true)
        await failTimes(r, 1)
        expect(r.client.ready()).toBe(false)
        expect(r.client.stats().breaker).toBe('open')
        const before = r.calls.length
        await expect(r.client.appraise({}, 50)).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' })
        expect(r.calls.length).toBe(before)
        await r.client.stop()
    })

    test('a success in between resets the count', async () => {
        const r = rig()
        await startReady(r)
        await failTimes(r, 2)
        await r.client.appraise({}, 50)
        await failTimes(r, 2)
        expect(r.client.ready()).toBe(true)
        await r.client.stop()
    })

    test('3 answers of 500 open it too', async () => {
        const r = rig()
        await startReady(r)
        r.h.appraise = () => reply(500, { error: 'boom' })
        for (let i = 0; i < 3; i++) await expect(r.client.appraise({}, 50)).rejects.toMatchObject({ code: 'HTTP_5XX' })
        expect(r.client.ready()).toBe(false)
        await r.client.stop()
    })

    test('422 and 400 throw but never open the breaker (the sidecar is fine, the request was not)', async () => {
        const r = rig()
        await startReady(r)
        r.h.appraise = () => reply(422, { error: 'unknown tag: tickle', tag: 'tickle' })
        for (let i = 0; i < 5; i++) await expect(r.client.appraise({}, 50)).rejects.toMatchObject({ code: 'UNKNOWN_TAG' })
        r.h.appraise = () => reply(400, { error: 'bad json' })
        for (let i = 0; i < 5; i++) await expect(r.client.appraise({}, 50)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
        expect(r.client.ready()).toBe(true)
        expect(r.client.stats().breaker).toBe('closed')
        await r.client.stop()
    })

    test('half-open after 30 s: one probe goes through; a good one closes it', async () => {
        const r = rig()
        await startReady(r)
        await failTimes(r, 3)
        await vi.advanceTimersByTimeAsync(29999)
        expect(r.client.ready()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(r.client.ready()).toBe(true)
        expect(r.client.stats().breaker).toBe('half-open')
        await r.client.appraise({}, 50)
        expect(r.client.stats().breaker).toBe('closed')
        expect(r.client.ready()).toBe(true)
        await r.client.stop()
    })

    test('half-open: only one probe at a time; a failed probe starts the 30 s again', async () => {
        const r = rig()
        await startReady(r)
        await failTimes(r, 3)
        await vi.advanceTimersByTimeAsync(30000)
        r.h.hang = true
        const probe = r.client.appraise({}, 10).catch((e: any) => e)
        expect(r.client.ready()).toBe(false)                     // the probe is in flight: nobody else gets through
        await expect(r.client.appraise({}, 10)).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' })
        await vi.advanceTimersByTimeAsync(10)
        expect(await probe).toMatchObject({ code: 'TIMEOUT' })
        expect(r.client.ready()).toBe(false)
        await vi.advanceTimersByTimeAsync(29999)
        expect(r.client.ready()).toBe(false)
        await vi.advanceTimersByTimeAsync(1)
        expect(r.client.ready()).toBe(true)
        await r.client.stop()
    })

    test('stats: p50 / p95 of the good calls', async () => {
        const r = rig()
        await startReady(r)
        let i = 0
        r.h.appraise = () => reply(200, { npcs: [], i: i++ })
        const realFetch = r.client
        for (let k = 0; k < 20; k++) await realFetch.appraise({}, 100)
        const s = r.client.stats()
        expect(s.ok).toBe(20)
        expect(s.p50).toBeGreaterThanOrEqual(0)
        expect(s.p95).toBeGreaterThanOrEqual(s.p50)
        await r.client.stop()
    })
})

describe('RISU_FATIMA_URL: an external sidecar', () => {
    test('no spawn, no warm call; health, then calls with the given token', async () => {
        const r = rig({ url: 'http://127.0.0.1:7777/', token: 'abc' })
        expect(await r.client.start()).toBe(true)
        expect(r.spawns).toHaveLength(0)
        expect(r.client.ready()).toBe(true)
        expect(r.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /health'])
        await r.client.appraise({ chatId: 'c' }, 100)
        expect(r.calls.at(-1)!.path).toBe('/appraise')
        for (const c of r.calls) expect(c.headers['x-fatima-token']).toBe('abc')
        expect(r.client.stats()).toMatchObject({ attached: true, url: 'http://127.0.0.1:7777' })
        await r.client.stop()
    })

    test('a sidecar that is not there yet is looked for again with the backoff', async () => {
        const r = rig({ url: 'http://127.0.0.1:7777' })
        r.h.health = () => { throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' }) }
        expect(await r.client.start()).toBe(false)
        expect(r.client.ready()).toBe(false)
        r.h.health = () => reply(200, { ok: true })
        await vi.advanceTimersByTimeAsync(1000)
        expect(r.client.ready()).toBe(true)
        await r.client.stop()
    })

    test('the breaker works the same way', async () => {
        const r = rig({ url: 'http://127.0.0.1:7777' })
        await r.client.start()
        r.h.appraise = () => reply(500, {})
        for (let i = 0; i < 3; i++) await r.client.appraise({}, 50).catch(() => {})
        expect(r.client.ready()).toBe(false)
        await r.client.stop()
    })
})

describe('defaults', () => {
    test('dotnet defaults to the absolute path (launchd has none on PATH), the dll to the built one', () => {
        expect(DEFAULT_DOTNET).toBe('/opt/homebrew/bin/dotnet')
        expect(DEFAULT_DLL.replace(/\\/g, '/')).toMatch(/server\/sidecar\/fatima\/bin\/Release\/net10\.0\/Fatima\.Sidecar\.dll$/)
    })
})

// ---- live: the real binary, if it has been built ----
const LIVE_OK = existsSync(DEFAULT_DLL) && existsSync(DEFAULT_DOTNET)
describe('the built sidecar', () => {
    test.skipIf(!LIVE_OK)('spawns, becomes ready, answers one appraise, and stop() ends the process', async () => {
        vi.useRealTimers()
        const lines: string[] = []
        const client = createFatimaClient({ log: (...a: any[]) => lines.push(a.join(' ')), timeoutMs: 5000 })
        expect(await client.start()).toBe(true)
        const pid = client.stats().pid
        expect(client.ready()).toBe(true)
        const out = await client.appraise({
            chatId: 'live', world: 'w', turn: 2, present: ['marek'],
            npcs: [{ id: 'marek', name: 'Marek', traits: { open: 50, consc: 50, extra: 50, agree: 50, neuro: 50 }, importance: 5, speech: 'gruff', tags: [], hasSecret: false, hasAgenda: false, seed: { player: { trust: 60, affection: 50, debt: 0, grudge: 5 } } }],
            events: [{ turn: 1, who: 'player', tag: 'help', target: 'marek' }, { turn: 2, who: 'player', tag: 'betray', target: 'marek' }],
        }, 5000)
        expect(out.engine).toBe('fatima')
        expect(out.npcs[0].id).toBe('marek')
        expect(out.npcs[0].emotions.map((e: any) => e.type)).toContain('hate')
        expect(out.npcs[0].rel.player.trust).toBeLessThan(60)
        await client.stop()
        await new Promise((r) => setTimeout(r, 300))
        expect(() => process.kill(pid, 0)).toThrow()   // gone
    }, 40000)
})
