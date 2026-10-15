import { describe, expect, it } from 'vitest'
import { addGrammar, addMistake, dueItems, gradeUse, itemsUsed, memoryNote, parseCheck, recentAccuracy, sm2, splitCheck, type VocabItem } from './learningMemory'
import { mergeVocab } from './vietji'

const DAY = 86_400_000
const NOW = 1_800_000_000_000
const ikura: VocabItem = { text: 'いくら ですか', vietji: 'i-cư-ra đê-sư-ca', meaning: 'Bao nhiêu tiền?' }
const hai: VocabItem = { text: 'はい', vietji: 'ha-i', meaning: 'Vâng' }

describe('SM-2', () => {
    it('right answers space the reviews out: 1 day, 6 days, then times the ease', () => {
        let v = sm2(ikura, 4, NOW)
        expect([v.reps, v.iv, v.due]).toEqual([1, 1, NOW + DAY])
        v = sm2(v, 4, NOW)
        expect([v.reps, v.iv]).toEqual([2, 6])
        v = sm2(v, 5, NOW)
        expect(v.iv).toBe(Math.round(6 * 2.5))
        expect(v.ok).toBe(3)
    })
    it('a failure starts the item over and lowers its ease, never below 1.3', () => {
        let v = sm2(sm2(sm2(ikura, 5, NOW), 5, NOW), 2, NOW)
        expect([v.reps, v.iv, v.bad]).toEqual([0, 1, 1])
        for (let i = 0; i < 20; i++) v = sm2(v, 0, NOW)
        expect(v.ef).toBe(1.3)
    })
})

describe('the speaker’s check', () => {
    it('reads ok and fixes, with → or ->', () => {
        expect(parseCheck('text\n[[CHECK ok]]')).toEqual({ ok: true })
        expect(parseCheck('[[CHECK いくら です → いくら ですか | thiếu か để hỏi]]')).toEqual({ ok: false, wrong: 'いくら です', right: 'いくら ですか', why: 'thiếu か để hỏi' })
        expect(parseCheck('[[CHECK a -> b]]')).toEqual({ ok: false, wrong: 'a', right: 'b', why: '' })
        expect(parseCheck('no block')).toBe(null)
    })
    it('the block never shows; a fix becomes one Sửa line; a block still streaming is hidden', () => {
        expect(splitCheck('Haru cười.\n[[CHECK ok]]')).toEqual({ main: 'Haru cười.', note: '' })
        const fix = splitCheck('Haru cười.\n[[CHECK いくら です → いくら ですか | thiếu か]]')
        expect(fix.main).toBe('Haru cười.')
        expect(fix.note).toContain('Sửa:')
        expect(fix.note).toContain('<b>いくら ですか</b>')
        expect(splitCheck('Haru cười. [[CHECK いく').main).toBe('Haru cười. ')
    })
    it('escapes what the model wrote', () => {
        expect(splitCheck('[[CHECK <b> → x]]').note).toContain('&lt;b&gt;')
    })
})

describe('grading what the learner used', () => {
    it('finds phrases typed by sound or in their own writing, not by accident', () => {
        expect(itemsUsed('i cu ra dde su ca', [ikura, hai]).map((v) => v.text)).toEqual(['いくら ですか'])
        expect(itemsUsed('はい、いくらですか', [ikura, hai]).map((v) => v.text)).toEqual(['いくら ですか', 'はい'])
        expect(itemsUsed('Tôi đi chợ', [ikura, hai])).toEqual([])
    })
    it('a right line grades 4, a fixed line grades 2; unused phrases stay as they were', () => {
        const right = gradeUse([ikura, hai], 'i cu ra dde su ca', { ok: true }, NOW)
        expect(right[0].reps).toBe(1)
        expect(right[1].reps).toBeUndefined()
        const wrong = gradeUse([sm2(ikura, 5, NOW)], 'i cu ra dde su ca', { ok: false, wrong: 'x', right: 'y', why: '' }, NOW)
        expect(wrong[0].reps).toBe(0)
    })
    it('a phrase met again keeps its review state', () => {
        const stored = JSON.stringify([sm2(ikura, 4, NOW)])
        const merged = JSON.parse(mergeVocab(stored, [{ ...ikura }]))
        expect(merged[0].reps).toBe(1)
    })
})

describe('mistakes, due items, accuracy, the note', () => {
    it('the same fix counts up, the most frequent first', () => {
        const fix = { ok: false as const, wrong: 'いくら です', right: 'いくら ですか', why: 'thiếu か' }
        let list = addMistake([], fix, NOW)
        list = addMistake(list, { ok: false, wrong: 'はい', right: 'はい、ください', why: '' }, NOW)
        list = addMistake(list, fix, NOW + 1)
        expect(list.map((m) => [m.wrong, m.count])).toEqual([['いくら です', 2], ['はい', 1]])
        expect(addMistake(list, { ok: true }, NOW)).toBe(list)
    })
    it('due items are the graded ones whose time has come, most overdue first; new ones are not due', () => {
        const a = { ...hai, due: NOW - 2 * DAY }, b = { ...ikura, due: NOW - DAY }, c = { ...ikura, text: 'x', due: NOW + DAY }
        expect(dueItems([c, b, a, { ...hai, text: 'new' }], NOW).map((v) => v.text)).toEqual(['はい', 'いくら ですか'])
    })
    it('accuracy needs three checks', () => {
        expect(recentAccuracy([true, false])).toBe(null)
        expect(recentAccuracy([true, false, true, true])).toBe(0.75)
    })
    it('the note asks for the review, the mistakes, the pace and the check', () => {
        const note = memoryNote([{ ...ikura, due: NOW - DAY }], [{ wrong: 'a', right: 'b', why: '', count: 2, last: NOW }], [true, true, true, true, true], NOW)
        expect(note).toContain('いくら ですか (Bao nhiêu tiền?)')
        expect(note).toContain('a → b')
        expect(note).toContain('up to three new words')
        expect(note).toContain('[[CHECK ok]]')
        expect(memoryNote([], [], [false, false, false, true], NOW)).toContain('no new words')
    })
    it('the note lists the words already known, for the "workaround" answers, and only those', () => {
        const known = { ...ikura, ok: 1 }
        const met = { text: 'はい', vietji: 'ha-i', meaning: 'Vâng' }
        const note = memoryNote([known, met], [], [], NOW)
        expect(note).toMatch(/already knows.*いくら ですか/)
        expect(note).not.toMatch(/already knows[^\n]*はい/)
        expect(memoryNote([met], [], [], NOW)).not.toContain('already knows')
    })
})

describe('words first, grammar a little at a time', () => {
    it('reads a grammar check: right words, only the order was off', () => {
        const c = parseCheck('…\n[[CHECK grammar 我 想 她 有点 傻 → 我觉得她有点傻 | "nghĩ là" dùng 觉得]]') as any
        expect(c).toMatchObject({ ok: false, grammar: true, wrong: '我 想 她 有点 傻', right: '我觉得她有点傻' })
        expect(parseCheck('[[CHECK 她 → 他 | sai từ]]')).not.toHaveProperty('grammar')
    })
    it('shows it as "Ngữ pháp:", not "Sửa:"', () => {
        expect(splitCheck('x\n[[CHECK grammar a → b | trật tự]]').note).toContain('Ngữ pháp:')
        expect(splitCheck('x\n[[CHECK a → b | sai]]').note).toContain('Sửa:')
    })
    it('keeps each point once, counting how often it came back', () => {
        const fix = { ok: false as const, wrong: 'a', right: 'b', why: 'trật tự', grammar: true }
        const g = addGrammar(addGrammar([], fix, 1), { ...fix, wrong: 'c' }, 2)
        expect(g).toEqual([{ point: 'trật tự', wrong: 'c', right: 'b', count: 2, last: 2 }])
    })
    it('the note asks for one grammar point at a time and lists the ones shown', () => {
        const note = memoryNote([], [], [], NOW, { grammarLater: true, grammar: [{ point: 'trật tự', wrong: 'a', right: 'b', count: 2, last: NOW }] })
        expect(note).toContain('[[CHECK grammar')
        expect(note).toContain('never more than one point')
        expect(note).toContain('trật tự (2)')
        expect(memoryNote([], [], [], NOW)).not.toContain('[[CHECK grammar')
    })
})
