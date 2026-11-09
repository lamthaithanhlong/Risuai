import fixtureJson from './__fixtures__/multiTurnGates/session.json'
import { describe, expect, it } from 'vitest'
import { agencyHits, observeOnly } from './agencyGate'
import { continuityHits } from './continuityGate'

type SessionFixture = {
    playerName: string
    turns: { user: string; assistant: string; kind: string }[]
    poisonedEarlierAssistant: string
}

const fixture = fixtureJson as SessionFixture

const [observeTurn, askTurn, walkTurn] = fixture.turns
const hitsFor = (reply: string, user: string, previous: string[] = []) =>
    continuityHits(reply, user, previous, fixture.playerName)

describe('multi-turn agency and continuity gates', () => {
    it('keeps observe, ask, and walk decisions scoped to each current player turn', () => {
        expect(observeOnly(observeTurn.user)).toBe(true)
        expect(agencyHits(observeTurn.assistant, observeTurn.user, fixture.playerName)).toEqual([])
        expect(hitsFor(observeTurn.assistant, observeTurn.user)).toEqual([])

        expect(observeOnly(askTurn.user)).toBe(false)
        expect(agencyHits(askTurn.assistant, askTurn.user, fixture.playerName)).toEqual([])
        expect(hitsFor(askTurn.assistant, askTurn.user, [observeTurn.assistant])).toEqual([])

        expect(observeOnly(walkTurn.user)).toBe(false)
        expect(agencyHits(walkTurn.assistant, walkTurn.user, fixture.playerName)).toEqual([])
        expect(hitsFor(walkTurn.assistant, walkTurn.user, [observeTurn.assistant, askTurn.assistant])).toEqual([])
    })

    it('does not let slipped soft-lead or kinship in prior AI history authorize later acts', () => {
        expect(hitsFor(walkTurn.assistant, walkTurn.user, [fixture.poisonedEarlierAssistant])).toEqual([])
        expect(agencyHits(walkTurn.assistant, walkTurn.user, fixture.playerName)).toEqual([])
    })
})
