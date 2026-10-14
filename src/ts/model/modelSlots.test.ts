import { describe, expect, it } from 'vitest'
import { CUSTOM_API, MAX_MODEL_SLOTS, addSlot, addSlotFromCurrent, editSlot, isValid, legacyChanged, normalizeSlots, removeSlot, selectSlot, type ModelSlot, type SlotState } from './modelSlots'

const slot = (id: string, model = CUSTOM_API, req = 'main'): ModelSlot => ({ id, name: id, model, req })
const empty: SlotState = { slots: [], active: '', model: CUSTOM_API, req: 'main' }

describe('model slots (specs/modelslots/ModelSlots.dfy, ModelSlots.als)', () => {
    it('adds up to 4 slots, refuses the 5th, an empty id and a duplicate id', () => {
        let st = empty
        for (const id of ['a', 'b', 'c', 'd']) st = addSlot(st, slot(id))
        expect(st.slots.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd'])
        expect(addSlot(st, slot('e'))).toBe(st)
        expect(addSlot(empty, slot(''))).toBe(empty)
        expect(addSlot({ ...empty, slots: [slot('a')] }, slot('a', 'gpt4'))).toEqual({ ...empty, slots: [slot('a')] })
    })

    it('selecting a slot writes the legacy fields; an unknown id changes nothing', () => {
        const st = addSlot(addSlot(empty, slot('grok', CUSTOM_API, 'main')), slot('codex', CUSTOM_API, 'cx/gpt-6-sol'))
        const s = selectSlot(st, 'codex')
        expect(s).toMatchObject({ active: 'codex', model: CUSTOM_API, req: 'cx/gpt-6-sol' })
        expect(isValid(s)).toBe(true)
        expect(selectSlot(s, 'nope')).toBe(s)
    })

    it('a slot for another provider does not touch the request model field', () => {
        const st = addSlot({ ...empty, req: 'main' }, slot('gpt', 'gpt4o', 'ignored'))
        const s = selectSlot(st, 'gpt')
        expect(s).toMatchObject({ active: 'gpt', model: 'gpt4o', req: 'main' })
        expect(isValid(s)).toBe(true)
    })

    it('removing the active slot detaches it and keeps the model in use', () => {
        let st = selectSlot(addSlot(addSlot(empty, slot('a')), slot('b', CUSTOM_API, 'x')), 'b')
        st = removeSlot(st, 'b')
        expect(st).toMatchObject({ active: '', model: CUSTOM_API, req: 'x' })
        expect(st.slots.map((s) => s.id)).toEqual(['a'])
        expect(isValid(st)).toBe(true)
    })

    it('removing another slot keeps the active one', () => {
        let st = selectSlot(addSlot(addSlot(empty, slot('a')), slot('b', CUSTOM_API, 'x')), 'b')
        st = removeSlot(st, 'a')
        expect(st.active).toBe('b')
        expect(isValid(st)).toBe(true)
    })

    it('editing the model field directly detaches the active slot only when it no longer matches', () => {
        const st = selectSlot(addSlot(empty, slot('a', CUSTOM_API, 'x')), 'a')
        expect(legacyChanged(st, CUSTOM_API, 'x').active).toBe('a')
        expect(legacyChanged(st, CUSTOM_API, 'y').active).toBe('')
        expect(legacyChanged(st, 'gpt4o', 'x').active).toBe('')
    })

    it('editing the active slot moves the legacy fields with it', () => {
        const st = selectSlot(addSlot(empty, slot('a', CUSTOM_API, 'x')), 'a')
        const e = editSlot(st, 'a', { name: 'A', model: CUSTOM_API, req: 'z' })
        expect(e).toMatchObject({ active: 'a', req: 'z' })
        expect(isValid(e)).toBe(true)
    })

    it('"save the current model" makes a slot that shows it and activates it', () => {
        const st = addSlotFromCurrent({ ...empty, req: 'main' }, 'cur', 'Current')
        expect(st.active).toBe('cur')
        expect(st.slots[0]).toEqual({ id: 'cur', name: 'Current', model: CUSTOM_API, req: 'main' })
        expect(isValid(st)).toBe(true)
    })

    it('normalize turns damaged stored data into a valid state', () => {
        const dirty = normalizeSlots({
            slots: [slot('a'), slot('a', 'x'), slot(''), null as any, { id: 7 } as any, slot('b'), slot('c'), slot('d'), slot('e'), slot('f')],
            active: 'ghost',
        }, { model: CUSTOM_API, req: 'main' })
        expect(dirty.slots.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd'])
        expect(dirty.active).toBe('')
        expect(isValid(dirty)).toBe(true)
        expect(normalizeSlots(undefined, { model: 'm', req: 'r' })).toEqual({ slots: [], active: '', model: 'm', req: 'r' })
        expect(normalizeSlots({ slots: 'oops' as any, active: 5 as any }, { model: 'm', req: 'r' }).slots).toEqual([])
        // an active slot that does not show the legacy fields is detached
        expect(normalizeSlots({ slots: [slot('a', CUSTOM_API, 'x')], active: 'a' }, { model: CUSTOM_API, req: 'other' }).active).toBe('')
        expect(normalizeSlots({ slots: [slot('a', CUSTOM_API, 'x')], active: 'a' }, { model: CUSTOM_API, req: 'x' }).active).toBe('a')
    })

    it('property: any sequence of operations from a valid state stays valid, and normalize of random garbage is valid', () => {
        let state = 20241014
        const rnd = (n: number) => Math.floor(((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * n)
        const ids = ['a', 'b', 'c', 'd', 'e', 'f', '']
        const models = [CUSTOM_API, 'gpt4o', 'claude']
        const reqs = ['main', 'x', 'y']
        for (let trial = 0; trial < 400; trial++) {
            let st: SlotState = { slots: [], active: '', model: models[rnd(3)], req: reqs[rnd(3)] }
            for (let step = 0; step < 30; step++) {
                const id = ids[rnd(ids.length)]
                switch (rnd(7)) {
                    case 0: st = addSlot(st, { id, name: id, model: models[rnd(3)], req: reqs[rnd(3)] }); break
                    case 1: st = removeSlot(st, id); break
                    case 2: st = selectSlot(st, id); break
                    case 3: st = legacyChanged(st, models[rnd(3)], reqs[rnd(3)]); break
                    case 4: st = editSlot(st, id, { name: id, model: models[rnd(3)], req: reqs[rnd(3)] }); break
                    case 5: st = addSlotFromCurrent(st, id, id); break
                    default: st = normalizeSlots(st, { model: st.model, req: st.req })
                }
                expect(isValid(st)).toBe(true)
                expect(st.slots.length).toBeLessThanOrEqual(MAX_MODEL_SLOTS)
            }
            const garbage = normalizeSlots({
                slots: Array.from({ length: rnd(9) }, () => ({ id: ids[rnd(ids.length)], name: 'n', model: models[rnd(3)], req: reqs[rnd(3)] })),
                active: ids[rnd(ids.length)],
            }, { model: models[rnd(3)], req: reqs[rnd(3)] })
            expect(isValid(garbage)).toBe(true)
        }
    })
})
