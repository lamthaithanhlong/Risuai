// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { STORE_SLOTS_KEY, syncStoreSlots } from './statsGlue'

const view = (slots: (string | null)[]) => ({ persona: 'k', level: 12, rank: 2, slots_open: 3, max_storage: 140, stat_cap: 28, stat_caps: {}, skills: [], items: [], slots, skill_count: 0, item_count: 0 })
const fake = (status: number, body: unknown) => {
    const calls: string[] = []
    return { calls, f: (async (url: string) => { calls.push(url); return { status, json: async () => body } }) as any }
}
const auth = async () => 't'

describe('syncStoreSlots', () => {
    test('writes the equipped skill ids (non-null slots) as a JSON list, reading the persona at the chat Level', async () => {
        const chat = { scriptstate: { $lvl: '{"l":12,"e":0}' } as Record<string, string> }
        const { f, calls } = fake(200, view(['a', null, 'b', null]))
        await syncStoreSlots(chat, 'k', { fetch: f, auth })
        expect(chat.scriptstate[STORE_SLOTS_KEY]).toBe('["a","b"]')
        expect(calls[0]).toBe('/api/persona?persona=k&level=12')
    })
    test('empty slots write an empty list; a missing $lvl asks for Level 1', async () => {
        const chat = { scriptstate: {} as Record<string, string> }
        const { f, calls } = fake(200, view([null, null]))
        await syncStoreSlots(chat, 'k', { fetch: f, auth })
        expect(chat.scriptstate[STORE_SLOTS_KEY]).toBe('[]')
        expect(calls[0]).toContain('level=1')
    })
    test('a failed fetch (network, 502, bad shape) leaves the previous value; never throws', async () => {
        for (const f of [(async () => { throw new Error('x') }) as any, fake(502, {}).f, fake(200, { nope: 1 }).f]) {
            const chat = { scriptstate: { [STORE_SLOTS_KEY]: '["old"]' } as Record<string, string> }
            await syncStoreSlots(chat, 'k', { fetch: f, auth })
            expect(chat.scriptstate[STORE_SLOTS_KEY]).toBe('["old"]')
        }
        const none = { scriptstate: {} as Record<string, string> }
        await syncStoreSlots(none, 'k', { fetch: fake(502, {}).f, auth })
        expect(STORE_SLOTS_KEY in none.scriptstate).toBe(false)
        await syncStoreSlots(undefined, 'k', {})
    })
})
