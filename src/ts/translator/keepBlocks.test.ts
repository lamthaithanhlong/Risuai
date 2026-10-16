import { describe, expect, it } from 'vitest'
import { keepMachineBlocks } from './keepBlocks'

// reported 2026-10-15: the auto-translation turned 네, 가요. | Vâng, đi thôi. into Vâng, đi thôi. | Vâng, đi thôi.
describe('the blocks for the bar are not translated', () => {
    const MSG = 'Elise stands by Kenji.\n\n[[REPLIES\n네, 가요. | Vâng, đi thôi.\n]]\n[[LOOK Elise | grey eyes]]'
    it('they go out as tokens and come back as they were', () => {
        const k = keepMachineBlocks(MSG)
        expect(k.text).toBe('Elise stands by Kenji.\n\n[[KEEP-0]]\n[[KEEP-1]]')
        const translated = 'Elise đứng cạnh Kenji.\n\n[[KEEP-0]]\n[[KEEP-1]]'
        expect(k.restore(translated)).toBe('Elise đứng cạnh Kenji.\n\n[[REPLIES\n네, 가요. | Vâng, đi thôi.\n]]\n[[LOOK Elise | grey eyes]]')
    })
    it('a token the model dropped: the block goes at the end, never lost', () => {
        const k = keepMachineBlocks(MSG)
        expect(k.restore('Elise đứng cạnh Kenji.\n[[KEEP-1]]')).toBe('Elise đứng cạnh Kenji.\n[[LOOK Elise | grey eyes]]\n[[REPLIES\n네, 가요. | Vâng, đi thôi.\n]]')
        expect(keepMachineBlocks('no blocks').restore('không có')).toBe('không có')
    })
    it('a $ in a block is put back as written', () => {
        const k = keepMachineBlocks('[[CHECK $1 → $2 | why]]')
        expect(k.restore('[[KEEP-0]]')).toBe('[[CHECK $1 → $2 | why]]')
    })
})
