import { describe, expect, it } from 'vitest'
import { syncSelectedPersona } from './personaSync'

// measured on the live save, 2026-10-15
const LONG = '[{{user}} = Kenji Park, nam, 25 tuổi, đeo kính, nhân viên văn phòng, sống đơn độc, không gia đình…]'
const SHORT = '[{{user}} tên là Kenji Park, nam, 25 tuổi, đeo kính, nhân viên văn phòng.]'

describe('the selected persona entry follows what is shown and sent', () => {
    it('reported: Kenji Park\'s entry had 74 characters while 956 were sent', () => {
        const db = { selectedPersona: 0, username: 'Kenji Park', personaPrompt: LONG, userIcon: 'assets/b087.png', personas: [{ name: 'Kenji Park', personaPrompt: SHORT, icon: 'assets/b087.png' }] }
        expect(syncSelectedPersona(db)).toBe(true)
        expect(db.personas[0].personaPrompt).toBe(LONG)
        expect(syncSelectedPersona(db)).toBe(false)                    // nothing left to change
    })
    it('only the selected entry, and an empty working field never wipes it', () => {
        const db = { selectedPersona: 1, username: 'B', personaPrompt: '', personas: [{ name: 'A', personaPrompt: 'a' }, { name: 'old', personaPrompt: 'b' }] }
        syncSelectedPersona(db)
        expect(db.personas).toEqual([{ name: 'A', personaPrompt: 'a' }, { name: 'B', personaPrompt: 'b' }])
        expect(syncSelectedPersona({ selectedPersona: 3, personas: [] })).toBe(false)
    })
})

// asked 2026-10-15: "bug persona phải đc fix cho global risu" — every persona, every chat, any order of what a user does.
// Risu's own steps, as written in src/ts/persona.ts (saveUserPersona, changeUserPersona), src/lib/SideBars/SideChatList.svelte
// (bind) and src/ts/util.ts (checkPersonaBinded, getPersonaPrompt); syncOnEdit is the Persona page's new effect.
describe('any sequence of persona edits, switches, binds and reloads sends what was last typed', () => {
    type Db = { selectedPersona: number; username: string; personaPrompt: string; personas: { id: string; name: string; personaPrompt: string }[] }
    const run = (syncOnEdit: boolean, seed: number) => {
        let s = seed
        const rnd = (n: number) => { s = (s * 1103515245 + 12345) % 2 ** 31; return s % n }
        const db: Db = { selectedPersona: 0, username: 'P0', personaPrompt: 'v0-0', personas: [0, 1, 2].map((i) => ({ id: 'id' + i, name: 'P' + i, personaPrompt: `v${i}-0` })) }
        const chats: { binded: string }[] = [{ binded: '' }, { binded: '' }]
        const typed: Record<string, string> = { id0: 'v0-0', id1: 'v1-0', id2: 'v2-0' }
        const saveUserPersona = () => { const p = db.personas[db.selectedPersona]; p.name = db.username; p.personaPrompt = db.personaPrompt }
        const changeUserPersona = (i: number) => { saveUserPersona(); db.selectedPersona = i; db.username = db.personas[i].name; db.personaPrompt = db.personas[i].personaPrompt }
        const sent = (c: number) => chats[c].binded ? db.personas.find((p) => p.id === chats[c].binded)!.personaPrompt : db.personaPrompt
        const expected = (c: number) => typed[chats[c].binded || db.personas[db.selectedPersona].id]
        for (let step = 0; step < 40; step++) {
            const op = rnd(5)
            if (op === 0) {                                                       // the user edits the Persona page
                db.personaPrompt = `v${db.selectedPersona}-${step + 1}`
                typed[db.personas[db.selectedPersona].id] = db.personaPrompt
                if (syncOnEdit) syncSelectedPersona(db)
            } else if (op === 1) changeUserPersona(rnd(3))
            else if (op === 2) chats[rnd(2)].binded = db.personas[db.selectedPersona].id   // bind the current persona
            else if (op === 3) chats[rnd(2)].binded = ''                                    // unbind
            else if (syncOnEdit) syncSelectedPersona(db)                                   // a reload (the load-time sync)
            for (const c of [0, 1]) if (sent(c) !== expected(c)) return { step, chat: c, sent: sent(c), expected: expected(c) }
        }
        return null
    }
    it('with the sync: 2000 random sessions, none sends an old description', () => {
        const bad = Array.from({ length: 2000 }, (_, i) => run(true, i + 1)).filter(Boolean)
        expect(bad).toEqual([])
    })
    it('without it (Risu before the fix) some do: binding after an edit sent the old text', () => {
        const bad = Array.from({ length: 2000 }, (_, i) => run(false, i + 1)).filter(Boolean)
        expect(bad.length).toBeGreaterThan(100)
    })
})
