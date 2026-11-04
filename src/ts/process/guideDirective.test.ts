import { describe, expect, it } from 'vitest'
import { guideDirective, guideNameOf, guideNote, guideRecentLines, playerAsks } from './guideDirective'

const m = (role: 'user' | 'char', data: string) => ({ role, data })

describe('playerAsks', () => {
    it.each(['Gợi ý cho tớ đi', 'Nhìn thử ngoài cửa xem', 'xem giúp tớ phòng bên', 'kiểm tra ngoài hành lang', 'Ngoài đó có gì không?', 'đi xem cầu thang', 'Hana, xem phòng bên cạnh', 'Hana ơi nhìn xuống tầng hầm'])('yes: %s', (t) => expect(playerAsks(t, 'Hana')).toBe(true))
    it.each(['Tớ mở cửa tủ lạnh', 'Tớ chạy lên cầu thang', 'Hana đang khóc', 'Tớ cầm cây gậy và đợi', ''])('no: %s', (t) => expect(playerAsks(t, 'Hana')).toBe(false))
})

describe('guideRecentLines', () => {
    const ms = [m('char', 'Hana nói: “Im quá. Tớ sợ.”'), m('user', 'ừ'), m('char', 'Gió thổi.'), m('char', 'Hana thì thầm “Hình như có tiếng nước!” rồi lùi lại.')]
    it('takes her quoted sentences from replies that name her', () => {
        expect(guideRecentLines(ms, 'Hana')).toEqual(['Im quá.', 'Tớ sợ.', 'Hình như có tiếng nước!'])
    })
    it('only the last n replies', () => { expect(guideRecentLines(ms, 'Hana', 1)).toEqual(['Hình như có tiếng nước!']) })
    it('nothing for a missing name', () => { expect(guideRecentLines(ms, '')).toEqual([]); expect(guideRecentLines(ms, 'Mai')).toEqual([]) })
})

describe('guideDirective', () => {
    const base = { present: true, name: 'Hana', playerText: '', turnsWithoutProgress: 0, recentLines: [], asked: false }
    it('empty when she is absent', () => expect(guideDirective({ ...base, present: false })).toBe(''))
    it('no hint by default', () => expect(guideDirective(base)).toContain('no hint'))
    it('hints after two turns without progress', () => expect(guideDirective({ ...base, turnsWithoutProgress: 2 })).toContain('never the answer'))
    it('one turn is not enough', () => expect(guideDirective({ ...base, turnsWithoutProgress: 1 })).toContain('no hint'))
    it('hints and scouts limit when asked', () => {
        const d = guideDirective({ ...base, asked: true })
        expect(d).toContain('never the answer'); expect(d).toContain('~10 m')
    })
    it('no scouting reminder unless asked', () => expect(guideDirective({ ...base, turnsWithoutProgress: 5 })).not.toContain('10 m'))
    it('lists lines not to restate', () => expect(guideDirective({ ...base, recentLines: ['Im quá.'] })).toContain('Do not restate: "Im quá."'))
    it('no restate line when none', () => expect(guideDirective(base)).not.toContain('restate'))
})

describe('guideNote wiring', () => {
    const card = { globalLore: [{ comment: 'Rules' }, { comment: 'Story guide: Hana' }] }
    it('named in the lore', () => expect(guideNameOf(card)).toBe('Hana'))
    it('no guide, no note', () => expect(guideNote({ globalLore: [{ comment: 'Rules' }] }, [], 'x', 9)).toBe(''))
    it('builds the note', () => expect(guideNote(card, [m('char', 'Hana: “Im quá.”')], 'gợi ý đi', 0)).toContain('Do not restate: "Im quá."'))
})
