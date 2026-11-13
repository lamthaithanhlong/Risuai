// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { questNote, questRequest, questState, QUEST_STALE_REPLIES } from './adminQuest'
import { turnFacts } from './adminSections'

const m = (...p: [string, string][]) => p.map(([role, data]) => ({ role, data }))
const req = (t: string) => [{ role: 'system', content: 's' }, { role: 'user', content: t }]

describe('Admin missions in a story with no quest script', () => {
    it('reads the open mission back from Admin\'s own lines', () => {
        expect(questState(m(['char', 'mở đầu'])).open).toBe('')
        const a = m(['char', 'x\n【ADMIN: Nhiệm vụ: Tìm Mai ở tầng ba — cô ấy giữ chìa khoá.】'], ['user', 'đi'], ['char', 'y'])
        expect(questState(a)).toEqual({ open: 'Tìm Mai ở tầng ba — cô ấy giữ chìa khoá.', age: 1, replies: 2 })
        expect(questState([...a, ...m(['char', '【ADMIN: Nhiệm vụ hoàn thành: đã gặp Mai.】'])]).open).toBe('')
        expect(questState([...a, ...m(['char', '【ADMIN: Nhiệm vụ hoàn thành: đã gặp Mai.】\n…\n【ADMIN: Nhiệm vụ: Mở cửa kho — lối ra ở đó.】'])]).open).toBe('Mở cửa kho — lối ra ở đó.')
    })
    it('no note on the opening, on an ask, or for Zombie and the Post Office', () => {
        expect(questNote(m(['user', 'bắt đầu']))).toBe('')
        const chat = m(['char', 'a'], ['user', 'đi tiếp'])
        expect(questRequest(req('đi tiếp'), 'zombie', chat, false)[1].content).toBe('đi tiếp')
        expect(questRequest(req('đi tiếp'), 'mailman', chat, false)[1].content).toBe('đi tiếp')
        expect(questRequest(req('@admin gì'), 'cha-12345678', chat, true)[1].content).toBe('@admin gì')
    })
    it('none open: Admin is told to hand one out, and the turn fires the quest sections', () => {
        const chat = m(['char', 'a'], ['user', 'admin nhiệm vụ của tui làm gì'])
        const out = questRequest(req('admin nhiệm vụ của tui làm gì'), 'cha-12345678', chat, false)
        expect(out[1].content).toContain('[Nhiệm vụ (ẩn): no mission is open')
        expect(out[1].content).toContain('never silence')
        expect(turnFacts({ opening: false, formated: out, messages: chat }).has('questEvent')).toBe(true)
    })
    it('one open: named in the note; asked = restate; stale = settle', () => {
        const base = m(['char', '【ADMIN: Nhiệm vụ: Tìm Mai — cô ấy giữ chìa khoá.】'])
        expect(questNote([...base, ...m(['user', 'đi lên'])])).toContain('open mission: "Tìm Mai — cô ấy giữ chìa khoá."')
        expect(questNote([...base, ...m(['user', 'đi lên'])])).toContain('does not repeat it')
        expect(questNote([...base, ...m(['user', 'nhiem vu la gi'])])).toContain('Nhiệm vụ đang mở')
        const old = [...base]
        for (let i = 0; i < QUEST_STALE_REPLIES; i++) old.push(...m(['user', 'đi'], ['char', 'ừ']))
        expect(questNote([...old, ...m(['user', 'đi'])])).toContain(`gone ${QUEST_STALE_REPLIES} replies`)
    })
})
