import { describe, expect, it } from 'vitest'
import { parseProfile, rulesKey, rulesOf, voiceReminder } from './storyVoice'

describe('the story voice, read once from the card (measured: Shadow Slave 0/6 -> 6/6, AH 4/4, LotM stays silent)', () => {
    it('reads the profiles the helper wrote for the three stories', () => {
        const ss = parseProfile('{"voice": "Nightmare Spell", "reports": ["kills", "Memories gained"], "format": "[You have slain an Awakened Beast.]"}')!
        expect(voiceReminder(ss)).toContain('[Nightmare Spell: when this reply has one of the events it reports (kills, Memories gained)')
        expect(voiceReminder(ss)).toContain('like [You have slain an Awakened Beast.]')
        const lotm = parseProfile('{"voice": null, "reports": [], "format": "The gas lamp flickers."}')!
        expect(lotm.voice).toBe(null)
        expect(voiceReminder(lotm)).toBe('')                                   // a story without a voice gets nothing
        expect(parseProfile('{"voice": "none", "reports": []}')!.voice).toBe(null)
        expect(parseProfile('not json')).toBe(null)
    })
    it('the rules are the description and the always-on lore; a change makes a new key', () => {
        const card = { desc: 'D', globalLore: [{ alwaysActive: true, content: 'Module 04' }, { alwaysActive: false, content: 'keyed' }] }
        expect(rulesOf(card)).toBe('D\n\nModule 04')
        expect(rulesKey(rulesOf(card))).not.toBe(rulesKey(rulesOf({ ...card, desc: 'D2' })))
        expect(rulesKey('abc')).toBe(rulesKey('abc'))
    })
})
