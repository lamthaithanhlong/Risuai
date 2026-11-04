import { describe, expect, it } from 'vitest'
import { replyHits, setupHits, systemLineRepeats, verbatimRepeats } from './replyCheck.mjs'
import { regenerationNote, settleReply, shouldRegenerate } from './replyRegen'
import { alreadyTold, guideDirective, guideNote, verbatimAvoid } from './guideDirective'

const prev1 = 'Tiếng cào ngoài hành lang ngừng hẳn. Hana ngồi sát cửa.\n【HỆ THỐNG: Điểm sinh tồn 12/20 | Thức ăn 3】\nHana: “Cậu muốn tớ nhìn qua bên kia không? Tớ hơi sợ đấy.”'
const clean = 'Kenji nắm chặt cán dao và đếm nhịp thở của mình.\n【HỆ THỐNG: Điểm sinh tồn 11/20 | Thức ăn 3】\nHana: “Tớ nghe thấy tiếng bước chân dưới cầu thang.”'

describe('replyCheck', () => {
    it('setup exposition', () => {
        expect(setupHits('Cô gái đó chỉ mình Kenji thấy được.')).toHaveLength(1)
        expect(setupHits('Evelyn là người bạn thân đã mất của cậu.')).toHaveLength(1)
        expect(replyHits('Evelyn là người bạn thân đã mất của cậu.', []).map((h) => h.rule)).toEqual(['setup'])
        expect(setupHits(clean)).toEqual([])
    })
    it('same scene sentence in two consecutive replies', () => {
        const cur = 'Tiếng cào ngoài hành lang ngừng hẳn! Kenji đứng yên lắng nghe.'
        expect(verbatimRepeats(cur, [prev1])).toEqual(['Tiếng cào ngoài hành lang ngừng hẳn!'])
        expect(replyHits(cur, [prev1]).map((h) => h.rule)).toEqual(['repeat'])
    })
    it('identical System line hits, a changed value does not', () => {
        const cur = 'Kenji thở ra.\n【HỆ THỐNG: Điểm sinh tồn 12/20 | Thức ăn 3】'
        expect(systemLineRepeats(cur, [prev1])).toHaveLength(1)
        expect(replyHits(cur, [prev1]).map((h) => h.rule)).toEqual(['system'])
        expect(systemLineRepeats(clean, [prev1])).toEqual([])
        expect(replyHits('【HỆ THỐNG: Điểm sinh tồn 12/20 | Thức ăn 3】', ['【HỆ THỐNG:   Điểm sinh tồn 12/20 | Thức ăn 3】'])).toHaveLength(1)
    })
    it('the guide repeating a whole sentence', () => {
        const cur = 'Hana: “Cậu muốn tớ nhìn qua bên kia không?”'
        expect(replyHits(cur, [prev1]).map((h) => h.rule)).toEqual(['repeat'])
    })
    it('a clean reply has no hits; short sentences and old replies are ignored', () => {
        expect(replyHits(clean, [prev1])).toEqual([])
        expect(verbatimRepeats('Im quá. Hana ngồi sát cửa.', ['Im quá. Hana ngồi sát cửa.'])).toEqual([])
        expect(verbatimRepeats('Tiếng cào ngoài hành lang ngừng hẳn.', [prev1, 'a', 'b', 'c'])).toEqual([])
        expect(verbatimRepeats('Tiếng cào ngoài hành lang ngừng hẳn.', [prev1, 'a', 'b', 'c'], 4)).toHaveLength(1)
    })
})

describe('regenerate once', () => {
    const hits = replyHits('Tiếng cào ngoài hành lang ngừng hẳn. Chỉ mình Kenji thấy.\n【HỆ THỐNG: Điểm sinh tồn 12/20 | Thức ăn 3】', [prev1])
    it('shouldRegenerate: only first attempt with hits', () => {
        expect(shouldRegenerate(hits, 0)).toBe(true)
        expect(shouldRegenerate(hits, 1)).toBe(false)
        expect(shouldRegenerate([], 0)).toBe(false)
    })
    it('note names each hit', () => {
        const n = regenerationNote(hits)
        expect(n).toContain('setup exposition "Chỉ mình Kenji thấy"')
        expect(n).toContain('repeated sentence "Tiếng cào ngoài hành lang ngừng hẳn."')
        expect(n).toContain('unchanged System line "【HỆ THỐNG')
        expect(regenerationNote([])).toBe('')
    })
    it('redoes once, uses the second, never loops, keeps first when redo fails', async () => {
        const dirty = 'Tiếng cào ngoài hành lang ngừng hẳn.'
        let calls = 0
        const warns: string[] = []
        expect(await settleReply(dirty, [prev1], async (note) => { calls++; expect(note).toContain('repeated sentence'); return clean }, (m) => warns.push(m))).toBe(clean)
        expect(calls).toBe(1); expect(warns).toEqual([])
        calls = 0
        expect(await settleReply(dirty, [prev1], async () => { calls++; return dirty }, (m) => warns.push(m))).toBe(dirty)
        expect(calls).toBe(1); expect(warns[0]).toContain('still has')
        expect(await settleReply(dirty, [prev1], async () => null)).toBe(dirty)
        expect(await settleReply(clean, [prev1], async () => { throw new Error('no') })).toBe(clean)
    })
})

describe('directive avoids verbatim sentences', () => {
    const ms = [{ role: 'char', data: prev1 }]
    it('guide sentences and scene sentences', () => {
        const v = verbatimAvoid(ms, 'Hana')
        expect(v.guide).toContain('Cậu muốn tớ nhìn qua bên kia không?')
        expect(v.scene).toContain('Tiếng cào ngoài hành lang ngừng hẳn.')
        expect(verbatimAvoid(ms, '').guide).toEqual([])
        expect(verbatimAvoid(Array.from({ length: 3 }, (_, i) => ({ role: 'char', data: Array.from({ length: 5 }, (_, j) => `Câu cảnh số ${i} thứ ${j} dài đủ chữ.`).join(' ') })), 'Hana').scene).toHaveLength(8)
    })
    it('directive and guideNote carry the rules', () => {
        const d = guideNote({ globalLore: [{ comment: 'Story guide: Hana' }] }, ms, 'x', 0)
        expect(d).toContain('do not reuse these sentences verbatim:')
        expect(d).toContain('"Cậu muốn tớ nhìn qua bên kia không?"')
        expect(d).toContain('may repeat only when a value changed')
        expect(guideDirective({ present: true, name: 'Hana', playerText: '', turnsWithoutProgress: 0, recentLines: [], asked: false })).not.toContain('verbatim')
        expect(alreadyTold(ms, 'Hana').length).toBeGreaterThan(0)
    })
})


describe('settleReply records what fired', () => {
    it('records the rules that fired and what is left after the one redo', async () => {
        const { settleReply } = await import('./replyRegen')
        const prev = ['Tiếng cào ngoài hành lang ngừng hẳn rồi.']
        const rec: any[] = []
        const out = await settleReply('Tiếng cào ngoài hành lang ngừng hẳn rồi.', prev, async () => 'Kenji áp tai vào cửa lạnh ngắt.', () => {}, (r) => rec.push(r))
        expect(out).toBe('Kenji áp tai vào cửa lạnh ngắt.')
        expect(rec).toEqual([{ fired: ['repeat'], left: [], redoFailed: false }])
    })
    it('records nothing for a clean reply and a failed redo as such', async () => {
        const { settleReply } = await import('./replyRegen')
        const rec: any[] = []
        await settleReply('Kenji áp tai vào cửa lạnh ngắt.', ['Gió thổi qua khe cửa sổ mở hé.'], async () => 'x', () => {}, (r) => rec.push(r))
        expect(rec).toEqual([])
        await settleReply('Tiếng cào ngoài hành lang ngừng hẳn rồi.', ['Tiếng cào ngoài hành lang ngừng hẳn rồi.'], async () => null, () => {}, (r) => rec.push(r))
        expect(rec[0].redoFailed).toBe(true)
    })
})
