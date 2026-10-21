import { describe, expect, it } from 'vitest'
import { modeOf, snapshotAt, step } from './gmMachine'

describe('the GM machine (XState): quest, scene and combat lifecycles', () => {
    it('a quest opens with a seed; its beat keeps its step or moves one on, never back, never a skip', () => {
        let s = snapshotAt()
        expect(step(s, { type: 'BEAT', step: 1 })).toBeNull()            // no arc, no beat
        expect(step(s, { type: 'CLOSE' })).toBeNull()                    // nothing to close
        s = step(s, { type: 'SEED', step: null })!
        s = step(s, { type: 'BEAT', step: 1 })!
        expect(modeOf(s)).toEqual({ quest: 'open', scene: 'still', combat: 'peace', step: 1 })
        expect(step(s, { type: 'BEAT', step: 3 })).toBeNull()             // a skip
        expect(step(s, { type: 'SEED', step: 1 })).toBeNull()             // another arc while one is open
        s = step(s, { type: 'BEAT', step: 2 })!
        expect(step(s, { type: 'BEAT', step: 1 })).toBeNull()             // back
        expect(modeOf(step(s, { type: 'BEAT', step: 2 })!).step).toBe(2)  // a rewording
        expect(modeOf(step(s, { type: 'BEAT', step: null })!).step).toBe(2) // no number: a rewording
        expect(modeOf(step(s, { type: 'CLOSE' })!)).toMatchObject({ quest: 'none', step: null })
        expect(modeOf(step(s, { type: 'SET_ASIDE' })!)).toMatchObject({ quest: 'none', step: null })
    })
    it('a stored mode comes back as a snapshot', () => {
        expect(modeOf(step(snapshotAt({ quest: 'open', step: 4 }), { type: 'BEAT', step: 5 })!).step).toBe(5)
        expect(step(snapshotAt({ quest: 'open', step: 4 }), { type: 'BEAT', step: 6 })).toBeNull()
    })
    it('combat: peace -> fight -> aftermath -> peace; a fight never ends from peace', () => {
        let s = snapshotAt()
        expect(step(s, { type: 'DISENGAGE' })).toBeNull()
        s = step(s, { type: 'ENGAGE' })!
        expect(modeOf(s).combat).toBe('fight')
        expect(step(s, { type: 'SETTLE' })).toBeNull()                   // a fight is left first
        s = step(s, { type: 'DISENGAGE' })!
        expect(modeOf(s).combat).toBe('aftermath')
        expect(modeOf(step(s, { type: 'ENGAGE' })!).combat).toBe('fight')
        expect(modeOf(step(s, { type: 'SETTLE' })!).combat).toBe('peace')
    })
    it('scene: the regions move apart (a move while fighting keeps the fight)', () => {
        const s = step(step(snapshotAt(), { type: 'ENGAGE' })!, { type: 'MOVE' })!
        expect(modeOf(s)).toMatchObject({ scene: 'travel', combat: 'fight' })
        expect(modeOf(step(s, { type: 'REST' })!).scene).toBe('rest')
    })
})

import { modeAfterDecision, modeBefore, modeFromTurn, modeVar } from './gmMachine'
describe('the scene and the fight turn by turn', () => {
    it('the player\'s turn moves the scene; an attack starts a fight', () => {
        const calm = { scene: 'still', combat: 'peace' } as const
        expect(modeFromTurn(calm, 'Kenji ngồi xuống nghỉ')).toEqual({ scene: 'rest', combat: 'peace' })
        expect(modeFromTurn(calm, 'Kenji rời chợ, đi về phía cảng')).toEqual({ scene: 'travel', combat: 'peace' })
        expect(modeFromTurn(calm, 'Kenji chém thẳng vào gã')).toEqual({ scene: 'still', combat: 'fight' })
        expect(modeFromTurn(calm, 'Tôi nghỉ')).toEqual({ scene: 'rest', combat: 'peace' })          // a word ending in a Vietnamese letter
        expect(modeFromTurn(calm, 'Kenji nhìn quanh')).toEqual({ scene: 'still', combat: 'peace' })
        expect(modeFromTurn(calm, 'Kenji đi ăn')).toEqual({ scene: 'rest', combat: 'peace' })
    })
    it('a fight ends when no hostile is left in the scene, and settles the turn after', () => {
        const fight = { scene: 'still', combat: 'fight' } as const
        const gone = modeAfterDecision(fight, { turn: 'quiet', hostile: ['varn'], present: [], onstage: [] })
        expect(gone.combat).toBe('aftermath')
        expect(modeAfterDecision(gone, { turn: 'quiet', hostile: [], present: [], onstage: [] }).combat).toBe('peace')
        expect(modeAfterDecision(fight, { turn: 'build', hostile: ['varn'], present: ['varn'], onstage: [] }).combat).toBe('fight')
    })
    it('a reroll starts again from the mode before', () => {
        const vars = { $gm_mode: modeVar({}, 3, { scene: 'rest', combat: 'fight' }) }
        expect(modeBefore(vars, 4)).toEqual({ scene: 'rest', combat: 'fight' })   // the next turn
        expect(modeBefore(vars, 3)).toEqual({ scene: 'still', combat: 'peace' })  // the same reply again
    })
})
