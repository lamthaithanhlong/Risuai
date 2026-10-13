import { describe, expect, test } from 'vitest'
import { shouldSkipLocalEmbedding } from './embeddingGuard'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

describe('shouldSkipLocalEmbedding', () => {
    test('a local model on an iPhone is skipped', () => {
        expect(shouldSkipLocalEmbedding(true, IPHONE)).toBe(true)
    })
    test('a remote model on an iPhone is kept: it costs the phone nothing', () => {
        expect(shouldSkipLocalEmbedding(false, IPHONE)).toBe(false)
    })
    test('a local model on a desktop is kept', () => {
        expect(shouldSkipLocalEmbedding(true, MAC, 16)).toBe(false)
        expect(shouldSkipLocalEmbedding(true, MAC)).toBe(false)
    })
    test('a small-memory Android device is skipped, a larger one is not', () => {
        expect(shouldSkipLocalEmbedding(true, 'Mozilla/5.0 (Linux; Android 14)', 2)).toBe(true)
        expect(shouldSkipLocalEmbedding(true, 'Mozilla/5.0 (Linux; Android 14)', 8)).toBe(false)
    })
})
