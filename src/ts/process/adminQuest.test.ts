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
        expect(questState(a)).toMatchObject({ open: 'Tìm Mai ở tầng ba — cô ấy giữ chìa khoá.', age: 1, replies: 2 })
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

import { POINTS_START, questEvents, questReward, stampPoints } from './adminQuest'

describe('mission points (owner 2026-11-13; tools/stats/formal/quest_z3.py + quest.als in the Zombie repo)', () => {
    const c = (data: string) => ({ role: 'char', data })
    const u = (data = 'tiếp') => ({ role: 'user', data })
    const offer = c('Truyện. 【ADMIN: Nhiệm vụ: tìm chìa khóa kho — cửa kho đang khóa.】')
    const done = c('Truyện. 【ADMIN: Nhiệm vụ hoàn thành: đã có chìa khóa.】')
    const fail = c('Truyện. 【ADMIN: Nhiệm vụ thất bại: kho đã cháy.】')

    it('starts at 3, +1 for a mission done (ceiling 5), -1 for one failed', () => {
        expect(questState([offer]).points).toBe(POINTS_START)
        expect(questState([offer, u(), done]).points).toBe(4)
        expect(questState([offer, u(), fail]).points).toBe(2)
        const many = Array.from({ length: 4 }, () => [offer, u(), done, u()]).flat()
        expect(questState(many).points).toBe(5)
    })

    it('the third failure in a row is the game over and the points start again', () => {
        const two = [offer, u(), fail, u(), offer, u(), fail, u(), offer, u()]
        expect(questState(two)).toMatchObject({ points: 1, over: false })
        expect(questState([...two, fail])).toMatchObject({ points: 3, over: true, last: 'fail' })
        expect(questState([...two, fail, u(), offer])).toMatchObject({ points: 3, over: false })
    })

    it('a close counts only for a mission open before the reply, once per reply', () => {
        expect(questState([done]).points).toBe(3)                                   // nothing was open
        expect(questState([c(offer.data + ' ' + fail.data)])).toMatchObject({ points: 3, open: 'tìm chìa khóa kho — cửa kho đang khóa.' })
        expect(questState([offer, u(), c(done.data + done.data + done.data)]).points).toBe(4)
        expect(questState([offer, u(), c('【ADMIN: Nhiệm vụ đã hủy: không còn ai ở đó.】')])).toMatchObject({ points: 3, open: '' })
    })

    it('the events of the newest reply: EXP for a mission done, one penalty for the game over, nothing else', () => {
        expect(questEvents([offer, u(), done], 1)).toEqual([{ kind: 'mission', idx: 'aq', level: 10, stats: {} }])
        expect(questReward(4)).toBe(80)
        expect(questEvents([offer, u(), fail], 1)).toEqual([])
        const over = [offer, u(), fail, u(), offer, u(), fail, u(), offer, u(), fail]
        expect(questEvents(over, 9)).toEqual([{ kind: 'penalty', idx: 'go', level: 30, stats: {} }])
        expect(questEvents([...over, u()], 9)).toEqual([])                         // the player's turn: no reply to pay for
        expect(questEvents([offer, u(), done, u(), c('Truyện.')], 1)).toEqual([])  // an older reply's close is not paid again
    })

    it('the grade on the mission line sets the reward; a restated mission keeps its grade', () => {
        const hard = c('Truyện. 【ADMIN: Nhiệm vụ (khó): qua cầu trước khi trời tối — cầu đang bị canh.】')
        expect([questReward(1, 'dễ'), questReward(1, 'vừa'), questReward(1, 'khó'), questReward(1, 'rất khó'), questReward(1, 'bịa')]).toEqual([5, 10, 20, 35, 10])
        expect([questReward(4, 'dễ'), questReward(4, 'khó'), questReward(4, 'rất khó')]).toEqual([40, 160, 280])
        expect(questState([hard])).toMatchObject({ open: 'qua cầu trước khi trời tối — cầu đang bị canh.', tier: 'khó' })
        expect(questEvents([hard, u(), done], 4)).toEqual([{ kind: 'mission', idx: 'aq', level: 160, stats: {} }])
        expect(stampPoints([hard, u(), done], 4)).toContain('Thưởng (khó): +160 EXP.')
        expect(questState([c('【ADMIN: Nhiệm vụ: (dễ) Mở phòng 307 cùng Mika — kiểm tra phòng tối.】')])).toMatchObject({ open: 'Mở phòng 307 cùng Mika — kiểm tra phòng tối.', tier: 'dễ' })
        // Admin restating an open mission cannot raise its pay; a NEW mission after it is graded afresh
        const again = c('【ADMIN: Nhiệm vụ đang mở (rất khó): qua cầu — còn một giờ.】')
        expect(questEvents([offer, u(), again, u(), done], 4)[0].level).toBe(80)
        expect(questEvents([hard, u(), done, u(), offer, u(), done], 4)[0].level).toBe(80)
    })

    it("the app's own points line goes after the counted close, once, and a number the model wrote goes", () => {
        const out = stampPoints([offer, u(), done], 1)!
        expect(out).toBe('Truyện. 【ADMIN: Nhiệm vụ hoàn thành: đã có chìa khóa.】\n【ADMIN: Điểm nhiệm vụ: 4/5 (+1). Thưởng (vừa): +10 EXP.】')
        expect(stampPoints([offer, u(), c(out)], 1)).toBeNull()                     // already there: unchanged
        expect(questState([offer, u(), c(out)]).points).toBe(4)                     // the line itself is not read as a mission
        expect(stampPoints([offer, u(), c(fail.data + ' 【ADMIN: Điểm nhiệm vụ: 9/5.】')], 1)).toBe(fail.data + '\n【ADMIN: Điểm nhiệm vụ: 2/5 (−1). Hết điểm là GAME OVER, mất 30% tổng EXP.】')
        const over = [offer, u(), fail, u(), offer, u(), fail, u(), offer, u(), fail]
        expect(stampPoints(over, 1)).toContain('【ADMIN: GAME OVER — hết điểm nhiệm vụ. Phạt: −30% tổng EXP, cấp có thể tụt. Điểm nhiệm vụ đặt lại 3/5.】')
        expect(stampPoints([offer, u(), c('Truyện.')], 1)).toBeNull()
        expect(stampPoints([c('Truyện. 【ADMIN: GAME OVER.】')], 1)).toBe('Truyện.')  // invented: taken out
    })

    it('the note states the points and the stakes', () => {
        const n = questNote([offer, u(), fail, u()])
        expect(n).toContain('Mission points: 2/5')
        expect(n).toContain('GAME OVER')
    })
})
