import { describe, expect, it } from 'vitest'
import { replyHits } from './replyCheck.mjs'
import { settleReply, strongRegenerationNote } from './replyRegen'

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
