import { describe, expect, test } from 'vitest'
import { isUsableTranslation } from './cacheValue'

describe('isUsableTranslation', () => {
    test('text is usable', () => {
        expect(isUsableTranslation('*Khang cười* Ngồi đi.')).toBe(true)
    })

    test('empty, blank and missing values are not', () => {
        expect(isUsableTranslation('')).toBe(false)
        expect(isUsableTranslation(' \n\t ')).toBe(false)
        expect(isUsableTranslation(null)).toBe(false)
        expect(isUsableTranslation(undefined)).toBe(false)
    })
})
