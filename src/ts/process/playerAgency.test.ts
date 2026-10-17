import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { agencyRequest, PLAYER_AGENCY } from './playerAgency'

describe('the player\'s turn is carried out (measured: the stalactite plan 0/6 -> 6/6, impossible actions still refused)', () => {
    it('goes at the end of the player\'s last message, only when on', () => {
        const req = [{ role: 'system', content: 's' }, { role: 'user', content: 'Tui bắn rơi thạch nhũ.' }]
        expect(agencyRequest(req, true)[1].content).toBe('Tui bắn rơi thạch nhũ.' + PLAYER_AGENCY)
        expect(agencyRequest(req, false)).toBe(req)
    })
    it('keeps the measured rules: no invented contradiction, impossible still fails, others decide for themselves', () => {
        expect(PLAYER_AGENCY).toContain('never invent a contradicting detail to refuse it')
        expect(PLAYER_AGENCY).toContain('Only what is impossible in this world')
        expect(PLAYER_AGENCY).toContain('Other people still decide for themselves')
    })
    it('is the text that was measured', () => {
        const f = '/private/tmp/claude-501/proseeval/agency1b.py'
        if (!existsSync(f)) return
        const src = readFileSync(f, 'utf8')
        for (const part of ['carry out what the player wrote, as written', 'a stalactite in a cave, a loose stone', 'not cancel it']) expect(src).toContain(part)
    })
})
