import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { agencyHits, agencyNote, observeOnly, scrubAgency } from './agencyGate'

const PLAYER = 'Tui nhìn 3 người họ'
const BAD_FALLBACK = '“Thế thì ổn rồi.” Kenji Park đáp lại. Anh đưa tay vuốt nhẹ mái tóc đen của Aki, một cử chỉ thân mật.'
const CLEAN = 'Aki kéo tay áo Kenji Park. Naru quay sang nhìn Kenji, còn Aki im lặng quan sát. Kenji chỉ nhìn ba người họ.'

const liveReply = existsSync('/tmp/risu-check/live-reply.txt')
    ? readFileSync('/tmp/risu-check/live-reply.txt', 'utf8')
    : BAD_FALLBACK

describe('agencyGate', () => {
    it('detects invented speech and advances in the live-style reply', () => {
        const hits = agencyHits(liveReply, PLAYER, 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).toContain('pc-speech')
        expect(hits.map((hit) => hit.rule)).toContain('pc-advance')
    })

    it('allows NPC-only activity and the player merely looking', () => {
        expect(agencyHits(CLEAN, PLAYER, 'Kenji Park')).toEqual([])
    })

    it('does not apply observe rules when the player asks a question', () => {
        expect(observeOnly('Tui hỏi Naru tên cô ấy')).toBe(false)
        expect(agencyHits(BAD_FALLBACK, 'Tui hỏi Naru tên cô ấy', 'Kenji Park')).toEqual([])
    })

    it('scrubs New Chat 2-style Kenji speech and advance sentences', () => {
        const reply = 'Kenji Park thầm nghĩ, “Đừng nhìn tôi như thế.”\n\nAnh đưa tay vuốt mái tóc của Aki.'
        const scrubbed = scrubAgency(reply, PLAYER, 'Kenji Park')
        expect(scrubbed).toBe('')
        expect(agencyHits(scrubbed, PLAYER, 'Kenji Park')).toEqual([])
    })

    it('scrubs named quoted speech attributed with thầm nghĩ', () => {
        const reply = 'Aki mỉm cười. “Cậu ổn chứ?” Kenji Park thầm nghĩ. Naru quay đi.'
        const scrubbed = scrubAgency(reply, PLAYER, 'Kenji Park')
        expect(scrubbed).toBe('')
        expect(agencyHits(scrubbed, PLAYER, 'Kenji Park')).toEqual([])
    })

    it('leaves non-observe replies unchanged', () => {
        const reply = BAD_FALLBACK
        expect(scrubAgency(reply, 'Tui hỏi Naru tên cô ấy', 'Kenji Park')).toBe(reply)
    })

    it('builds a hidden rewrite note', () => {
        const note = agencyNote([{ rule: 'pc-advance', text: 'vuốt tóc' }])
        expect(note).toContain('hidden, never named')
        expect(note).toContain('NPC-initiated actions toward the player may remain')
    })
})
