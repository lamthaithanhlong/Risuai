// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { STORE_SLOTS_KEY, STORE_ITEM_SLOTS_KEY, STORE_EFFECTS_KEY, syncStoreSlots } from './statsGlue'

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
    test('$store_item_slots is the JSON list of the non-null item slots; an old server (no item_slots) gives []', async () => {
        const chat = { scriptstate: {} as Record<string, string> }
        const isl = [null, 'i1', null, 'i2', ...Array(7).fill(null)]
        await syncStoreSlots(chat, 'k', { fetch: fake(200, { ...view(['a']), item_slots: isl, item_slots_open: 4 }).f, auth })
        expect(chat.scriptstate[STORE_ITEM_SLOTS_KEY]).toBe('["i1","i2"]')
        expect(chat.scriptstate[STORE_SLOTS_KEY]).toBe('["a"]')
        await syncStoreSlots(chat, 'k', { fetch: fake(200, view(['a'])).f, auth })
        expect(chat.scriptstate[STORE_ITEM_SLOTS_KEY]).toBe('[]')
    })
    test('a failed read leaves the old $store_item_slots', async () => {
        for (const f of [(async () => { throw new Error('x') }) as any, fake(502, {}).f, fake(200, { nope: 1 }).f]) {
            const chat = { scriptstate: { [STORE_ITEM_SLOTS_KEY]: '["old"]' } as Record<string, string> }
            await syncStoreSlots(chat, 'k', { fetch: f, auth })
            expect(chat.scriptstate[STORE_ITEM_SLOTS_KEY]).toBe('["old"]')
        }
    })
    test('$store_effects: {id: {name, effect, conditions}} for the EQUIPPED skills and items only; an empty effect gets the fallback; failed read keeps the old value', async () => {
        const chat = { scriptstate: {} as Record<string, string> }
        const v = {
            ...view(['wall-vibration-listening', null]),
            skills: [
                { id: 'wall-vibration-listening', name: 'Nghe rung tường', tier: 'gold', exp: 62, effect: 'Nghe qua tường', conditions: 'Cần yên tĩnh' },
                { id: 'rhythm-separation', name: 'Tách nhịp', tier: 'bronze', exp: 0, effect: 'x' },
            ],
            items: [{ id: 'rusty-knife', name: 'Dao gỉ', tier: 'bronze', qty: 1, effect: '' }, { id: 'old-laptop', name: 'Laptop', tier: 'silver', qty: 1, effect: 'y' }],
            item_slots: ['rusty-knife', ...Array(10).fill(null)],
        }
        await syncStoreSlots(chat, 'k', { fetch: fake(200, v).f, auth })
        const e = JSON.parse(chat.scriptstate[STORE_EFFECTS_KEY])
        expect(Object.keys(e).sort()).toEqual(['rusty-knife', 'wall-vibration-listening'])
        expect(e['wall-vibration-listening']).toEqual({ name: 'Nghe rung tường', effect: 'Nghe qua tường', conditions: 'Cần yên tĩnh' })
        expect(e['rusty-knife'].name).toBe('Dao gỉ')
        expect(e['rusty-knife'].effect).toContain('slot trang bị')
        expect(e['rusty-knife'].conditions).toBe('')
        for (const f of [(async () => { throw new Error('x') }) as any, fake(502, {}).f]) {
            await syncStoreSlots(chat, 'k', { fetch: f, auth })
            expect(Object.keys(JSON.parse(chat.scriptstate[STORE_EFFECTS_KEY])).length).toBe(2)
        }
    })
})
