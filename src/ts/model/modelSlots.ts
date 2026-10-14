// Model slots: up to 4 named model choices, one of them active, set in the settings and picked from the chat menu.
// A port of specs/modelslots/ModelSlots.dfy, where every operation is proved to keep the state valid. The request code keeps reading
// the two legacy fields (aiModel, customProxyRequestModel); a slot is applied by writing them, so that code does not change.
//
// Valid state: at most MAX_MODEL_SLOTS slots, unique non-empty ids, the active id names a slot (or is empty), and the legacy fields show
// the active slot (its model, and for the Custom API its request model).

export const MAX_MODEL_SLOTS = 4
export const CUSTOM_API = 'reverse_proxy'

export interface ModelSlot {
    id: string
    name: string
    model: string       // an aiModel id; "reverse_proxy" is the Custom API
    req: string         // the request model name, used only when model is the Custom API
}

export interface SlotState {
    slots: ModelSlot[]
    active: string      // a slot id, or '' for none
    model: string       // the legacy field db.aiModel
    req: string         // the legacy field db.customProxyRequestModel
}

const indexOf = (slots: ModelSlot[], id: string) => slots.findIndex((s) => s.id === id)

export function shows(slot: ModelSlot, model: string, req: string): boolean {
    return slot.model === model && (slot.model !== CUSTOM_API || slot.req === req)
}

export function isValid(st: SlotState): boolean {
    if (st.slots.length > MAX_MODEL_SLOTS) return false
    if (new Set(st.slots.map((s) => s.id)).size !== st.slots.length) return false
    if (st.active === '') return true
    const k = indexOf(st.slots, st.active)
    return k >= 0 && shows(st.slots[k], st.model, st.req)
}

function apply(slot: ModelSlot, st: SlotState): SlotState {
    return { slots: st.slots, active: slot.id, model: slot.model, req: slot.model === CUSTOM_API ? slot.req : st.req }
}

/** The "add" button: refused (state unchanged) when full, when the id is empty or taken. The active slot does not change. */
export function addSlot(st: SlotState, slot: ModelSlot): SlotState {
    if (st.slots.length < MAX_MODEL_SLOTS && slot.id !== '' && indexOf(st.slots, slot.id) < 0) {
        return { ...st, slots: [...st.slots, slot] }
    }
    return st
}

/** "Save the current model as a slot": the new slot shows the legacy fields and becomes the active one. */
export function addSlotFromCurrent(st: SlotState, id: string, name: string): SlotState {
    if (st.slots.length < MAX_MODEL_SLOTS && id !== '' && indexOf(st.slots, id) < 0) {
        return { slots: [...st.slots, { id, name, model: st.model, req: st.req }], active: id, model: st.model, req: st.req }
    }
    return st
}

/** Removing the active slot detaches it; the legacy fields keep their values, so the model in use does not change. */
export function removeSlot(st: SlotState, id: string): SlotState {
    const k = indexOf(st.slots, id)
    if (k < 0) return st
    return { ...st, slots: st.slots.filter((_, i) => i !== k), active: st.active === id ? '' : st.active }
}

/** Picks a slot: an unknown id changes nothing. */
export function selectSlot(st: SlotState, id: string): SlotState {
    const k = indexOf(st.slots, id)
    return k < 0 ? st : apply(st.slots[k], st)
}

/** The legacy fields were edited directly: if they no longer show the active slot, detach it. */
export function legacyChanged(st: SlotState, model: string, req: string): SlotState {
    const next = { ...st, model, req }
    const k = st.active === '' ? -1 : indexOf(st.slots, st.active)
    return k >= 0 && !shows(st.slots[k], model, req) ? { ...next, active: '' } : next.active !== '' && k < 0 ? { ...next, active: '' } : next
}

/** Edits a slot; when it is the active one the legacy fields follow it. */
export function editSlot(st: SlotState, id: string, fields: { name: string, model: string, req: string }): SlotState {
    const k = indexOf(st.slots, id)
    if (k < 0) return st
    const slot: ModelSlot = { id, ...fields }
    const next = { ...st, slots: st.slots.map((s, i) => (i === k ? slot : s)) }
    return st.active === id ? apply(slot, next) : next
}

/** Any stored data becomes a valid state: first slot of each id kept, empty ids dropped, at most 4, a stale active id cleared. */
export function normalizeSlots(stored: Partial<SlotState> | undefined, legacy: { model: string, req: string }): SlotState {
    const seen = new Set<string>()
    const slots: ModelSlot[] = []
    const raw = Array.isArray(stored?.slots) ? stored!.slots! : []
    for (const s of raw) {
        if (slots.length >= MAX_MODEL_SLOTS) break
        if (!s || typeof s.id !== 'string' || s.id === '' || seen.has(s.id)) continue
        seen.add(s.id)
        slots.push({ id: s.id, name: typeof s.name === 'string' ? s.name : '', model: typeof s.model === 'string' ? s.model : '', req: typeof s.req === 'string' ? s.req : '' })
    }
    const base: SlotState = { slots, active: typeof stored?.active === 'string' ? stored.active : '', model: legacy.model, req: legacy.req }
    const k = base.active === '' ? -1 : indexOf(slots, base.active)
    return k >= 0 && shows(slots[k], base.model, base.req) ? base : { ...base, active: '' }
}
