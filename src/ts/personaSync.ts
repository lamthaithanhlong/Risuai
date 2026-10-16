// The selected persona has two copies: the working one the Persona page edits and every request sends (db.username,
// personaPrompt, userIcon, userNote), and its entry in db.personas, which a chat bound to the persona reads. Risu wrote the
// working copy back only when switching persona, so with a single persona it never was: measured on the live save
// (2026-10-15), Kenji Park's entry said 74 characters ("25 tuổi, đeo kính, nhân viên văn phòng") while 956 were being sent.
// The working copy is the one shown and sent, so it is the one kept.

export type PersonaFields = { name?: string; personaPrompt?: string; icon?: string; note?: string }
export type PersonaDb = { selectedPersona?: number; username?: string; personaPrompt?: string; userIcon?: string; userNote?: string; personas?: PersonaFields[] }

/** Writes the working copy into the selected persona's entry; true when something differed. */
export function syncSelectedPersona(db: PersonaDb): boolean {
    const p = db.personas?.[db.selectedPersona ?? 0]
    if (!p) return false
    let changed = false
    const set = <K extends keyof PersonaFields>(k: K, v: PersonaFields[K] | undefined) => {
        if (v !== undefined && v !== '' && p[k] !== v) { p[k] = v; changed = true }
    }
    set('name', db.username)
    set('personaPrompt', db.personaPrompt)
    set('icon', db.userIcon)
    set('note', db.userNote)
    return changed
}
