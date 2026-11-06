// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { fetchPersona, lootPersona, deleteEntry, equipSkill, unequipSkill } from './personaStore'

const auth = async () => 'tok'
function fake(status: number, body: unknown) {
    const calls: { url: string, init: any }[] = []
    const f = (async (url: string, init: any) => { calls.push({ url, init }); return { status, json: async () => body } }) as any
    return { f, calls }
}
const down = (async () => { throw new Error('x') }) as any
const view = { persona: 'k', level: 12, rank: 2, slots_open: 3, max_storage: 140, stat_cap: 28, stat_caps: {}, skills: [], items: [], slots: [], skill_count: 0, item_count: 0 }

describe('personaStore', () => {
    it('GET sends persona, level and the auth header', async () => {
        const { f, calls } = fake(200, view)
        const r = await fetchPersona('k k', 12.9, { fetch: f, auth })
        expect(r.ok && r.data.rank).toBe(2)
        expect(calls[0].url).toBe('/api/persona?persona=k%20k&level=12')
        expect(calls[0].init.headers['risu-auth']).toBe('tok')
    })
    it('GET: bad shape, bad status and no network are network failures', async () => {
        expect(await fetchPersona('k', 1, { fetch: fake(200, { x: 1 }).f, auth })).toEqual({ ok: false, reason: 'network' })
        expect(await fetchPersona('k', 1, { fetch: fake(502, {}).f, auth })).toEqual({ ok: false, reason: 'network' })
        expect(await fetchPersona('k', 1, { fetch: down, auth })).toEqual({ ok: false, reason: 'network' })
        expect(await fetchPersona('k', 1, { fetch: fake(200, view).f, auth: async () => { throw new Error('no') } })).toEqual({ ok: false, reason: 'network' })
    })
    it('POST bodies are exactly the bridge fields', async () => {
        const { f, calls } = fake(200, { ok: true })
        await deleteEntry('k', 'skill', 's1', 5, { fetch: f, auth })
        await equipSkill('k', 2, 's1', 5, { fetch: f, auth })
        await unequipSkill('k', 2, 5, { fetch: f, auth })
        await lootPersona('k', 'item', { id: 'i' }, 5, { fetch: f, auth })
        expect(calls.map((c) => c.url)).toEqual(['/api/persona/delete', '/api/persona/equip', '/api/persona/unequip', '/api/persona/loot'])
        expect(JSON.parse(calls[0].init.body)).toEqual({ persona: 'k', kind: 'skill', id: 's1', level: 5 })
        expect(JSON.parse(calls[1].init.body)).toEqual({ persona: 'k', slot: 2, skillId: 's1', level: 5 })
        expect(JSON.parse(calls[2].init.body)).toEqual({ persona: 'k', slot: 2, level: 5 })
        expect(JSON.parse(calls[3].init.body)).toEqual({ persona: 'k', kind: 'item', entry: { id: 'i' }, level: 5 })
        expect(calls[0].init.headers['risu-auth']).toBe('tok')
        expect(calls[0].init.method).toBe('POST')
    })
    it('rule failures come back as ok:false with the reason', async () => {
        const r = await equipSkill('k', 9, 's', 1, { fetch: fake(200, { ok: false, reason: 'slot_locked', slots_open: 2 }).f, auth })
        expect(r).toMatchObject({ ok: false, reason: 'slot_locked' })
        expect(await deleteEntry('k', 'item', 'x', 1, { fetch: fake(200, { ok: false }).f, auth })).toMatchObject({ ok: false, reason: 'unknown' })
    })
    it('HTTP 400/502 and network failure never throw', async () => {
        expect(await unequipSkill('k', 0, 1, { fetch: fake(400, { error: 'x' }).f, auth })).toEqual({ ok: false, reason: 'network' })
        expect(await equipSkill('k', 0, 's', 1, { fetch: down, auth })).toEqual({ ok: false, reason: 'network' })
    })
})
