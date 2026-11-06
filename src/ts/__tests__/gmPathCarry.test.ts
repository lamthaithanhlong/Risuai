import { describe, expect, it } from 'vitest'
import { gmNote, type GmState, type GmDice, type GmPhase } from '../process/gameMaster'

const GM_PATH_VALUE = 'đi một mình | tự đi | chưa có tên tuổi'

const baseDice: GmDice = {
    pace: 'advance',
    surface: 'the antagonist',
    consequence: false,
    canon: false,
}

const baseState: GmState = {
    gm_arc: 'a debt to the Black Lantern crew | Varn, a crew enforcer who wants her Memory | pay or break the debt | her brother\'s safety',
    gm_beat: '2 | Varn\'s man watches the shelter | collection night in two days',
    gm_threats: 'Collection | 2/4 | Varn takes the brother',
    gm_rewards_due: 'a forged permit | when the crew\'s ledger is stolen',
    gm_consequences_due: 'the shelter warden turns her out | if she brings the crew to the door',
    gm_canon: 'Day 3 of the First Nightmare | far to the east the Forgotten Shore party is still crossing the labyrinth',
    gm_beat_at: '4',
}

describe('gmNote gm_path carry-through', () => {
    it('case (a): gm_path set at turn 14, turns 15-17 output each contains the gm_path value', () => {
        const stateWithPath: GmState = { ...baseState, gm_path: GM_PATH_VALUE, gm_path_at: '14' }
        for (const turn of [15, 16, 17]) {
            const out = gmNote('run', stateWithPath, baseDice, 'a rival')
            expect(out).toContain(GM_PATH_VALUE)
        }
    })

    it('case (b): gm_path unset, output has no side line and no focus line mentioning a side', () => {
        const stateNoPath: GmState = { ...baseState, gm_path: '', gm_path_at: '' }
        const out = gmNote('run', stateNoPath, baseDice, 'a rival')
        expect(out).not.toContain('Path:')
        expect(out).not.toContain('focus: the side')
        expect(out).not.toContain('focus: the path')
        expect(out).toContain('No side yet')
    })

    it('case (c): output for a turn before gm_path is set does not contain it', () => {
        const stateBeforePath: GmState = { ...baseState, gm_path: '', gm_path_at: '' }
        const out = gmNote('run', stateBeforePath, baseDice, 'a rival')
        expect(out).not.toContain(GM_PATH_VALUE)
    })
})