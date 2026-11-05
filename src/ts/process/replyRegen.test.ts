import { describe, expect, it } from 'vitest'
import { replyHits } from './replyCheck.mjs'
import { settleReply, strongRegenerationNote, type NpcCheckOpts } from './replyRegen'
// @ts-ignore plain JS module
import { npcHits, npcRewriteNote } from './npcCheck.mjs'

// The real gate miss (Evelyn run 1, turn 15, label g1.16): her new line repeats the previous reply's speech at 60% token overlap.
const PREV = 'Evelyn dừng ở chân cầu thang. “Tớ không biết cửa trên đó có mở được không.”'
const REPEATING = 'Evelyn chỉ xuống dưới. “Cậu nhìn kỹ bậc dưới cùng xem… có gì mắc ở đó không?”'
const FRESH = 'Evelyn ngồi xuống bậc thềm, tay ôm gối. “Dưới kia có mùi khét, cậu ngửi thấy chưa nhỉ.”'
const BAD2 = 'Evelyn lại chỉ xuống. “Cậu nhìn kỹ bậc dưới cùng xem… có gì mắc ở đó không? Tớ không biết cửa trên đó có mở được không.”'

describe('second redo for a repeat-type hit', () => {
    it('fixture: the repeating line is a repeat hit', () => {
        expect(replyHits(REPEATING, [PREV]).map((h) => h.rule)).toEqual(['repeat'])
        expect(replyHits(FRESH, [PREV])).toEqual([])
    })
    it('first redo repeats again, second is different: clean draft, redos=2, strong note names the line', async () => {
        const notes: string[] = []; const rec: any[] = []
        const outs = [REPEATING, FRESH]
        const out = await settleReply(REPEATING, [PREV], async (n) => { notes.push(n); return outs.shift() as string }, () => {}, (r) => rec.push(r))
        expect(out).toBe(FRESH)
        expect(notes).toHaveLength(2)
        expect(notes[1]).toContain('đừng lặp câu đã nói')
        expect(notes[1]).toContain('có gì mắc ở đó không?')
        expect(notes[1]).toContain('viết hướng khác hẳn')
        expect(rec).toEqual([{ fired: ['repeat'], left: [], redoFailed: false, redos: 2, afterFirst: ['repeat'] }])
    })
    it('never a third redo; the draft with fewer hits is kept when the second redo is also bad', async () => {
        let calls = 0; const rec: any[] = []
        const warns: string[] = []
        // first redo: 1 hit (the same line); second redo: more hits than that -> the first redo's draft is kept
        const outs = [REPEATING, BAD2]
        const out = await settleReply(REPEATING, [PREV], async () => { calls++; return outs.shift() as string }, (m) => warns.push(m), (r) => rec.push(r))
        expect(calls).toBe(2)
        expect(replyHits(BAD2, [PREV]).length).toBeGreaterThan(replyHits(REPEATING, [PREV]).length)
        expect(out).toBe(REPEATING)
        expect(rec[0].redos).toBe(2)
        expect(rec[0].left).toEqual(['repeat'])
        expect(warns[0]).toContain('after 2 redos')
    })
    it('a second redo that fails keeps the first redo draft', async () => {
        let calls = 0
        const out = await settleReply(REPEATING, [PREV], async () => (++calls === 1 ? REPEATING : null), () => {})
        expect(calls).toBe(2); expect(out).toBe(REPEATING)
    })
    it('a non-repeat rule still gets exactly one redo', async () => {
        let calls = 0; const rec: any[] = []
        const setup = 'Cô gái đó chỉ mình Kenji thấy được.'
        const out = await settleReply(setup, [], async () => { calls++; return setup }, () => {}, (r) => rec.push(r))
        expect(calls).toBe(1); expect(out).toBe(setup)
        expect(rec[0].redos).toBe(1)
    })
    it('a repeat that turns into a non-repeat hit does not get a second redo', async () => {
        let calls = 0
        const setupDraft = 'Cô gái đó chỉ mình Kenji thấy được.'
        await settleReply(REPEATING, [PREV], async () => { calls++; return setupDraft }, () => {})
        expect(calls).toBe(1)
    })
    it('strong note lists every remaining line', () => {
        const n = strongRegenerationNote([{ rule: 'repeat', text: 'một' }, { rule: 'dialogue', text: 'hai' }])
        expect(n).toContain('"một" / "hai"')
        expect(strongRegenerationNote([])).toBe('')
    })
})

describe('the NPC check in settleReply (2026-11-05, owner\'s 704 balcony)', () => {
    const HOOK = 'Cô nhìn anh. “Cánh tay tôi bị cứa. Có một phòng khám gần Kisaragi Cũ… nếu anh tìm được thuốc ở đó, tôi sẽ tin lời anh hơn.”'
    const GOOD = 'Cô nhìn anh. “Cánh tay tôi bị cứa. Tôi cần thuốc hạ sốt, hoặc thứ gì đó để rửa vết thương.”'
    const npc = (judge?: NpcCheckOpts['judge'], judgeMs?: number): NpcCheckOpts => ({ hits: (t) => npcHits(t, { player: 'Kenji Park' }), note: (h) => npcRewriteNote(h), judge, judgeMs })
    it('no npc option: unchanged (an NPC hook alone triggers nothing)', async () => {
        let calls = 0
        expect(await settleReply(HOOK, [], async () => { calls++; return GOOD })).toBe(HOOK)
        expect(calls).toBe(0)
    })
    it('an NPC hit gets ONE redo whose note names the rule and the quote; a clean redo is kept', async () => {
        const notes: string[] = []
        const rec: unknown[] = []
        expect(await settleReply(HOOK, [], async (n) => { notes.push(n); return GOOD }, () => {}, (r) => rec.push(r), npc())).toBe(GOOD)
        expect(notes).toHaveLength(1)
        expect(notes[0]).toContain('(npc-quest-hook)')
        expect(rec).toEqual([{ fired: [], left: [], redoFailed: false, redos: 1, npcFired: ['npc-quest-hook'], npcLeft: [], npcCut: [] }])
    })
    it('the redo still has the hook: the hook sentence is cut once, never a second redo', async () => {
        let calls = 0
        const out = await settleReply(HOOK, [], async () => { calls++; return HOOK }, () => {}, () => {}, npc())
        expect(calls).toBe(1)
        expect(out).toBe('Cô nhìn anh. “Cánh tay tôi bị cứa.”')
    })
    it('a clean draft makes no call; the judge (on) is fail-open and bounded', async () => {
        let calls = 0
        expect(await settleReply(GOOD, [], async () => { calls++; return GOOD }, () => {}, () => {}, npc(() => new Promise(() => {}), 20))).toBe(GOOD)
        expect(calls).toBe(0)
        const judged = await settleReply(GOOD, [], async () => { calls++; return GOOD }, () => {}, () => {}, npc(async () => [{ rule: 'npc-grammar', text: 'x', npc: '?' }]))
        expect(calls).toBe(1)
        expect(judged).toBe(GOOD)
    })
})
