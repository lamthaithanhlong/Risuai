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
