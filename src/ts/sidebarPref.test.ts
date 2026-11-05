import { describe, expect, test } from 'vitest'
import { loadSidebarOpen, saveSidebarOpen, SIDEBAR_KEY } from './sidebarPref'

function mem(initial: Record<string, string> = {}) {
    const m = { ...initial }
    return {
        data: m,
        getItem: (k: string) => (k in m ? m[k] : null),
        setItem: (k: string, v: string) => { m[k] = v },
    }
}
const throwing = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') },
}

describe('sidebarPref', () => {
    test('nothing saved -> null so the width default applies', () => {
        expect(loadSidebarOpen(mem())).toBeNull()
    })
    test('save then load round-trips both states', () => {
        const s = mem()
        saveSidebarOpen(false, s)
        expect(s.data[SIDEBAR_KEY]).toBe('0')
        expect(loadSidebarOpen(s)).toBe(false)
        saveSidebarOpen(true, s)
        expect(loadSidebarOpen(s)).toBe(true)
    })
    test('garbage value is ignored', () => {
        expect(loadSidebarOpen(mem({ [SIDEBAR_KEY]: 'maybe' }))).toBeNull()
    })
    test('storage that throws never breaks the page', () => {
        expect(loadSidebarOpen(throwing)).toBeNull()
        expect(() => saveSidebarOpen(true, throwing)).not.toThrow()
    })
    test('no storage at all (undefined) is fine', () => {
        expect(loadSidebarOpen(undefined)).toBeNull()
        expect(() => saveSidebarOpen(true, undefined)).not.toThrow()
    })
})
