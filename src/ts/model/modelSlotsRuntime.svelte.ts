// Applies the pure model-slot operations (modelSlots.ts) to the database and keeps the active slot honest.
//   * pickModelSlot / addModelSlot / ... read the state, call the verified function, and write the result back in one synchronous block.
//   * A watcher detaches the active slot when something else (the settings page, a preset switch) changes the model fields so that they
//     no longer show it: the chat menu then says "custom" instead of naming a slot that is not in use.
import { DBState } from 'src/ts/stores.svelte'
import { v4 } from 'uuid'
import {
    addSlot, addSlotFromCurrent, editSlot, isValid, legacyChanged, removeSlot, selectSlot,
    type ModelSlot, type SlotState,
} from './modelSlots'

function read(): SlotState {
    const db = DBState.db
    return { slots: db.modelSlots ?? [], active: db.activeModelSlot ?? '', model: db.aiModel, req: db.customProxyRequestModel ?? '' }
}

function write(next: SlotState) {
    const db = DBState.db
    // never write a state the proofs do not cover
    if (!isValid(next)) {
        return
    }
    db.modelSlots = next.slots
    db.activeModelSlot = next.active
    db.aiModel = next.model
    db.customProxyRequestModel = next.req
}

export const pickModelSlot = (id: string) => write(selectSlot(read(), id))
export const addModelSlot = (slot: Omit<ModelSlot, 'id'>) => write(addSlot(read(), { id: v4(), ...slot }))
export const addCurrentAsModelSlot = (name: string) => write(addSlotFromCurrent(read(), v4(), name))
export const removeModelSlot = (id: string) => write(removeSlot(read(), id))
export const editModelSlot = (id: string, fields: { name: string, model: string, req: string }) => write(editSlot(read(), id, fields))

$effect.root(() => {
    $effect(() => {
        const db = DBState.db
        if (!db) {
            return
        }
        // read every field the check depends on so the effect re-runs when any of them changes
        const st = read()
        void st.slots.map((s) => s.model + s.req + s.id)
        if (st.active === '') {
            return
        }
        const fixed = legacyChanged(st, st.model, st.req)
        if (fixed.active !== st.active) {
            db.activeModelSlot = fixed.active
        }
    })
})
