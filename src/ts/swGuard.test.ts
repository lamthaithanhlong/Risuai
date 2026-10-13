import { describe, expect, test } from 'vitest'
import { clearSwReload, takeSwReload } from './swGuard'

const fake = () => {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

describe('takeSwReload', () => {
    test('the first miss may reload, the second never does', () => {
        const s = fake()
        expect(takeSwReload(s)).toBe(true)
        expect(takeSwReload(s)).toBe(false)
        expect(takeSwReload(s)).toBe(false)
    })

    test('after the worker answered once the next session may reload again', () => {
        const s = fake()
        expect(takeSwReload(s)).toBe(true)
        clearSwReload(s)
        expect(takeSwReload(s)).toBe(true)
    })

    test('no storage (private mode throws): never reload, a loop is worse than no worker', () => {
        expect(takeSwReload(undefined)).toBe(false)
        const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
        expect(takeSwReload(broken)).toBe(false)
    })
})
