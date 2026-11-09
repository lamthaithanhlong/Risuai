import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { agencyHits, agencyNote, observeOnly, scrubAgency } from './agencyGate'
import { leadHits, scrubLead } from './continuityGate'

const PLAYER = 'Tui nhìn 3 người họ'
const BAD_FALLBACK = '“Thế thì ổn rồi.” Kenji Park đáp lại. Anh đưa tay vuốt nhẹ mái tóc đen của Aki, một cử chỉ thân mật.'
const CLEAN = 'Aki kéo tay áo Kenji Park. Naru quay sang nhìn Kenji, còn Aki im lặng quan sát. Kenji chỉ nhìn ba người họ.'
const LIVE_STYLE_AGENCY = '“Đừng đi đâu.” Kenji Park đáp lại. Kenji vuốt nhẹ mái tóc Aki. Aki cười khẽ. Aki nắm tay Kenji rồi kéo cậu vào đội hình. Naru đứng yên.'
const LIVE_STYLE_FULL = 'Tay vẫn siết chặt lấy áo của người cũ Yuuichi một cách vô thức. “Chào… mọi người.” Kenji Park đáp lại. Yuuichi đang đi cùng hai cô gái. Yuuichi kéo vạt áo của Aki và Kenji Park theo sau như thể họ là một đội hình cố định.'

const liveReply = existsSync('/tmp/risu-check/live-reply.txt')
    ? readFileSync('/tmp/risu-check/live-reply.txt', 'utf8')
    : BAD_FALLBACK

describe('agencyGate', () => {
    it('detects invented speech and advances in the live-style reply', () => {
        const hits = agencyHits(liveReply, PLAYER, 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).toContain('pc-speech')
        expect(hits.map((hit) => hit.rule)).toContain('pc-advance')
    })

    it('flags and scrubs speech, advance, and NPC dragging as whole sentences', () => {
        const reply = `${LIVE_STYLE_AGENCY} ${CLEAN}`
        const hits = agencyHits(reply, PLAYER, 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).toEqual(expect.arrayContaining(['pc-speech', 'pc-advance', 'pc-dragged']))
        const scrubbed = scrubAgency(reply, PLAYER, 'Kenji Park')
        expect(scrubbed).not.toMatch(/đáp lại|vuốt|đội hình/i)
        expect(scrubbed).not.toContain('“Đừng đi đâu.”')
        expect(scrubbed).not.toContain('Kenji Park đáp lại')
        expect(scrubbed).toContain('Naru đứng yên.')
        expect(scrubAgency(CLEAN, PLAYER, 'Kenji Park')).toBe(CLEAN)
        expect(agencyHits(scrubbed, PLAYER, 'Kenji Park')).toEqual([])
    })

    it('detects and removes all measured live-reply agency and soft-lead bugs', () => {
        const hits = agencyHits(liveReply, PLAYER, 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).toEqual(expect.arrayContaining(['pc-speech', 'pc-advance', 'pc-dragged']))
        const agencyScrubbed = scrubAgency(liveReply, PLAYER, 'Kenji Park')
        const finalScrubbed = scrubLead(agencyScrubbed, PLAYER, [], 'Kenji Park')
        expect(agencyHits(agencyScrubbed, PLAYER, 'Kenji Park')).toEqual([])
        expect(agencyHits(finalScrubbed, PLAYER, 'Kenji Park')).toEqual([])
        expect(leadHits(finalScrubbed, PLAYER, 'Kenji Park', [])).toEqual([])
        expect(finalScrubbed).not.toMatch(/người cũ|siết chặt lấy áo|đi cùng hai cô gái|đội hình cố định/i)
    })

    it('flags and scrubs inline live-style combo', () => {
        const hits = agencyHits(LIVE_STYLE_FULL, PLAYER, 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).toEqual(expect.arrayContaining(['pc-speech', 'pc-dragged']))
        const scrubbed = scrubLead(scrubAgency(LIVE_STYLE_FULL, PLAYER, 'Kenji Park'), PLAYER, [], 'Kenji Park')
        expect(agencyHits(scrubbed, PLAYER, 'Kenji Park')).toEqual([])
        expect(leadHits(scrubbed, PLAYER, 'Kenji Park', [])).toEqual([])
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
        expect(scrubbed).not.toContain('“Đừng nhìn tôi như thế.”')
        expect(agencyHits(scrubbed, PLAYER, 'Kenji Park')).toEqual([])
    })

    it('scrubs named quoted speech attributed with thầm nghĩ', () => {
        const reply = 'Aki mỉm cười. “Cậu ổn chứ?” Kenji Park thầm nghĩ. Naru quay đi.'
        const scrubbed = scrubAgency(reply, PLAYER, 'Kenji Park')
        expect(scrubbed).not.toContain('“Cậu ổn chứ?”')
        expect(scrubbed).not.toContain('Kenji Park thầm nghĩ')
        expect(agencyHits(scrubbed, PLAYER, 'Kenji Park')).toEqual([])
    })

    it('leaves non-observe replies unchanged', () => {
        const reply = BAD_FALLBACK
        expect(scrubAgency(reply, 'Tui hỏi Naru tên cô ấy', 'Kenji Park')).toBe(reply)
    })

    it('builds a hidden rewrite note mentioning no PC drag', () => {
        const note = agencyNote([{ rule: 'pc-advance', text: 'vuốt tóc' }])
        expect(note).toContain('hidden, never named')
        expect(note).toContain('NPC-initiated actions toward the player may remain')
        expect(note).toContain('do not have an NPC drag')
    })
})
