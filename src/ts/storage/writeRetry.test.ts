import { describe, expect, test } from 'vitest'
import { WRITE_MAX_ATTEMPTS, retryDelayMs, writeFailureMessage } from './writeRetry'

describe('retryDelayMs', () => {
    test('a rate limit waits for the time the server named, plus a little', () => {
        expect(retryDelayMs(429, 0, '12')).toBe(12_250)
        expect(retryDelayMs(429, 0, '9999')).toBe(70_250)
    })

    test('a rate limit with no usable header backs off exponentially, capped', () => {
        expect(retryDelayMs(429, 0, null)).toBe(1000)
        expect(retryDelayMs(429, 3, 'soon')).toBe(8000)
        expect(retryDelayMs(429, WRITE_MAX_ATTEMPTS - 2, undefined)).toBeLessThanOrEqual(30_000)
    })

    test('a lost connection and gateway errors are retried quickly, capped at 5 s', () => {
        expect(retryDelayMs(0, 0)).toBe(500)
        expect(retryDelayMs(503, 2)).toBe(2000)
        expect(retryDelayMs(504, 4)).toBe(5000)
    })

    test('a bad request, a refused login or a too-big upload is not retried', () => {
        for (const status of [400, 401, 403, 404, 413, 500]) {
            expect(retryDelayMs(status, 0)).toBeNull()
        }
    })

    test('it stops after the last attempt', () => {
        expect(retryDelayMs(429, WRITE_MAX_ATTEMPTS - 1, '1')).toBeNull()
    })
})

describe('writeFailureMessage', () => {
    test('carries the status and the server message', () => {
        expect(writeFailureMessage(429, '{"error":"Too many requests. Please retry shortly."}')).toBe('setItem Error 429: {"error":"Too many requests. Please retry shortly."}')
    })

    test('a network failure says so', () => {
        expect(writeFailureMessage(0)).toBe('setItem Error network')
    })
})
