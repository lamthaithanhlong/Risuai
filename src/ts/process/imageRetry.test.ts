import { describe, expect, test, vi } from 'vitest'
import { failureSummary, hasPicture, imageErrorText, modelChain, requestWithFallback, retryDelayMs, type ImageResponse } from './imageRetry'

const ok: ImageResponse = { ok: true, data: { data: [{ b64_json: 'AAAA' }] } }
const terminated: ImageResponse = { ok: false, data: { error: { message: '[codex/gpt-5.6-luna-image] terminated (reset after 30s)' } } }
const slowLimit: ImageResponse = { ok: false, data: { error: { message: "[codex/gpt-image-2.5] [400]: {\"detail\":\"The 'gpt-5.5' model is not supported\"} (reset after 30m)" } } }
const refused: ImageResponse = { ok: false, data: { error: { message: 'Your request was rejected by the safety system' } } }

describe('what a response says', () => {
    test('the error text is found in each shape', () => {
        expect(imageErrorText(terminated)).toContain('terminated')
        expect(imageErrorText({ data: 'plain text error' })).toBe('plain text error')
        expect(imageErrorText({ data: { message: 'm' } })).toBe('m')
        expect(imageErrorText(null)).toBe('no response')
    })

    test('a picture is recognised', () => {
        expect(hasPicture(ok)).toBe(true)
        expect(hasPicture(terminated)).toBe(false)
        expect(hasPicture({ ok: true, data: { data: [] } })).toBe(false)
    })
})

describe('retryDelayMs', () => {
    test('"reset after 30s" waits 33 seconds', () => {
        expect(retryDelayMs(terminated)).toBe(33000)
    })

    test('a limit of minutes or hours is not retried, a limit of a minute is', () => {
        expect(retryDelayMs(slowLimit)).toBeNull()
        expect(retryDelayMs({ ok: false, data: { error: { message: 'x (reset after 1h)' } } })).toBeNull()
        expect(retryDelayMs({ ok: false, data: { error: { message: 'x (reset after 60s)' } } })).toBe(63000)
        expect(retryDelayMs({ ok: false, data: { error: { message: 'x (reset after 61s)' } } })).toBeNull()
    })

    test('transient words and server statuses wait 8 seconds', () => {
        expect(retryDelayMs({ ok: false, data: 'socket hang up (connection reset)' })).toBe(8000)
        expect(retryDelayMs({ ok: false, status: 503, data: {} })).toBe(8000)
        expect(retryDelayMs({ ok: false, status: 429, data: {} })).toBe(8000)
        expect(retryDelayMs({ ok: false, status: 0, data: {} })).toBe(8000)
    })

    test('a refusal, a success, and a client error are not retried', () => {
        expect(retryDelayMs(refused)).toBeNull()
        expect(retryDelayMs(ok)).toBeNull()
        expect(retryDelayMs({ ok: false, status: 400, data: { error: { message: 'bad prompt' } } })).toBeNull()
    })
})

describe('modelChain', () => {
    test('the primary model comes first, then the fallbacks in order, without empties or repeats', () => {
        expect(modelChain('a', 'b, c ,, a\nd')).toEqual(['a', 'b', 'c', 'd'])
        expect(modelChain(' a ', undefined)).toEqual(['a'])
    })

    test('with no primary the fallbacks still form a chain, and with nothing at all it is empty', () => {
        expect(modelChain('', 'b,c')).toEqual(['b', 'c'])
        expect(modelChain('', '')).toEqual([])
    })
})

describe('requestWithFallback', () => {
    const sleep = () => vi.fn(async () => undefined)
    const byModel = (map: Record<string, ImageResponse | Error>) => vi.fn(async (m: string | undefined) => {
        const r = map[m ?? '(none)']
        if (r instanceof Error) throw r
        return r ?? refused
    })

    test('the first model that draws wins and the rest are not asked', async () => {
        const run = byModel({ a: ok, b: ok })
        const r = await requestWithFallback(['a', 'b'], run, { sleep: sleep() })
        expect(r.model).toBe('a')
        expect(r.failures).toEqual([])
        expect(run).toHaveBeenCalledTimes(1)
    })

    test('a model that fails is skipped at once and the next one draws, with no waiting', async () => {
        const s = sleep()
        const run = byModel({ a: slowLimit, b: ok })
        const seen: string[] = []
        const r = await requestWithFallback(['a', 'b'], run, { sleep: s, onFallback: (m, _w, next) => seen.push(`${m}->${next}`) })
        expect(r.model).toBe('b')
        expect(r.response).toBe(ok)
        expect(r.failures.map((f) => f.model)).toEqual(['a'])
        expect(s).not.toHaveBeenCalled()
        expect(seen).toEqual(['a->b'])
    })

    test('the body of each request carries its own model', async () => {
        const run = byModel({ a: terminated, b: terminated, c: ok })
        await requestWithFallback(['a', 'b', 'c'], run, { sleep: sleep(), rounds: 1 })
        expect(run.mock.calls.map((c) => c[0])).toEqual(['a', 'b', 'c'])
    })

    test('when every model failed for a temporary reason it waits the shortest time and goes round once more', async () => {
        const s = sleep()
        let n = 0
        const run = vi.fn(async (m: string | undefined) => (++n <= 2 ? terminated : m === 'b' ? ok : terminated))
        const r = await requestWithFallback(['a', 'b'], run, { sleep: s })
        expect(s).toHaveBeenCalledWith(33000)
        expect(run).toHaveBeenCalledTimes(4)   // round 1: a, b fail; round 2: a fails, b draws
        expect(r.model).toBe('b')
    })

    test('with different stated times it waits the shortest one', async () => {
        const s = sleep()
        const long: ImageResponse = { ok: false, data: { error: { message: 'x (reset after 50s)' } } }
        const short: ImageResponse = { ok: false, data: { error: { message: 'y (reset after 20s)' } } }
        const run = byModel({ a: long, b: short })
        await requestWithFallback(['a', 'b'], run, { sleep: s, rounds: 2 })
        expect(s).toHaveBeenCalledWith(23000)
    })

    test('when every failure is permanent it does not wait or repeat', async () => {
        const s = sleep()
        const run = byModel({ a: slowLimit, b: refused })
        const r = await requestWithFallback(['a', 'b'], run, { sleep: s })
        expect(run).toHaveBeenCalledTimes(2)
        expect(s).not.toHaveBeenCalled()
        expect(r.model).toBe('')
        expect(r.response.ok).toBe(false)
    })

    test('after the last round it gives up with a summary of every model and why it failed', async () => {
        const run = byModel({ a: terminated, b: slowLimit })
        const r = await requestWithFallback(['a', 'b'], run, { sleep: sleep(), rounds: 2 })
        expect(run).toHaveBeenCalledTimes(4)
        const text = imageErrorText(r.response)
        expect(text).toContain('Image generation failed on every model')
        expect(text).toContain('a: ')
        expect(text).toContain('b: ')
        expect(r.failures).toHaveLength(2)
    })

    test('a request that throws counts as a temporary failure of that model', async () => {
        const run = byModel({ a: new Error('network down'), b: ok })
        const r = await requestWithFallback(['a', 'b'], run, { sleep: sleep() })
        expect(r.model).toBe('b')
        expect(r.failures[0].why).toContain('network down')
    })

    test('with no model configured it sends one plain request', async () => {
        const run = byModel({ '(none)': ok })
        const r = await requestWithFallback([], run, { sleep: sleep() })
        expect(run).toHaveBeenCalledWith(undefined)
        expect(r.response).toBe(ok)
    })

    test('rounds: 1 means one pass over the list', async () => {
        const run = byModel({ a: terminated, b: terminated })
        const s = sleep()
        await requestWithFallback(['a', 'b'], run, { rounds: 1, sleep: s })
        expect(run).toHaveBeenCalledTimes(2)
        expect(s).not.toHaveBeenCalled()
    })
})

describe('failureSummary', () => {
    test('names each model and cuts long reasons', () => {
        const t = failureSummary([{ model: 'a', why: 'x'.repeat(300) }, { model: 'b', why: 'short' }])
        expect(t).toContain('a: ' + 'x'.repeat(140))
        expect(t).not.toContain('x'.repeat(141))
        expect(t).toContain('b: short')
    })
})
