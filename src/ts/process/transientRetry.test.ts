import { describe, expect, test } from 'vitest'
import { TRANSIENT_RETRY_DELAYS_MS, isTransientFailure } from './transientRetry'

describe('isTransientFailure', () => {
    test('the failures seen on the DeepSeek route are retried', () => {
        expect(isTransientFailure('{"error":{"code":"model_not_found","message":"No available channel for model deepseek-v4.1-flash under group grok (distributor)","type":"new_api_error"}}')).toBe(true)
        expect(isTransientFailure('[mvn/deepseek-v4.1-flash] [503]: upstream overloaded')).toBe(true)
        expect(isTransientFailure('Error: 502 Bad Gateway')).toBe(true)
        expect(isTransientFailure('TypeError: fetch failed')).toBe(true)
    })

    test('each provider phrase counts on its own', () => {
        expect(isTransientFailure('{"error":{"code":"model_not_found"}}')).toBe(true)
        expect(isTransientFailure('No available channel for model x')).toBe(true)
        expect(isTransientFailure('upstream request timed out')).toBe(true)
    })

    test('a limit that lasts minutes, a bad key and a bad request are not retried', () => {
        expect(isTransientFailure('[codex/gpt-6-sol[1m]] [429]: The usage limit has been reached (reset after 10m 10s)')).toBe(false)
        expect(isTransientFailure('[401]: Invalid API key')).toBe(false)
        expect(isTransientFailure('[400]: max_tokens is too large')).toBe(false)
        expect(isTransientFailure('')).toBe(false)
    })

    test('rate limits are not retried: waiting two or six seconds does not outlast them, the owner should see them', () => {
        expect(isTransientFailure('[429]: Too many requests (reset after 32s)')).toBe(false)
        expect(isTransientFailure('[429]: rate limit exceeded')).toBe(false)
        expect(isTransientFailure('[503]: busy (reset after 2h)')).toBe(false)
    })

    test('503 is found as a number, not inside another one', () => {
        expect(isTransientFailure('status 503.')).toBe(true)
        expect(isTransientFailure('id 15039 failed')).toBe(false)
    })

    test('at most two more attempts, with a growing wait', () => {
        expect(TRANSIENT_RETRY_DELAYS_MS).toEqual([2000, 6000])
    })
})
