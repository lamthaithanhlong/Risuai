import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { agencyHits, agencyNote, observeOnly, scrubAgency, weakAct } from './agencyGate'
import { leadHits, scrubLead } from './continuityGate'

const PLAYER = 'Tui nhìn 3 người họ'
const BAD_FALLBACK = '“Thế thì ổn rồi.” Kenji Park đáp lại. Anh đưa tay vuốt nhẹ mái tóc đen của Aki, một cử chỉ thân mật.'
const CLEAN = 'Aki kéo tay áo Kenji Park. Naru quay sang nhìn Kenji, còn Aki im lặng quan sát. Kenji chỉ nhìn ba người họ.'
const LIVE_STYLE_AGENCY = '“Đừng đi đâu.” Kenji Park đáp lại. Kenji vuốt nhẹ mái tóc Aki. Aki cười khẽ. Aki nắm tay Kenji rồi kéo cậu vào đội hình. Naru đứng yên.'
const LIVE_STYLE_FULL = 'Tay vẫn siết chặt lấy áo của người cũ Yuuichi một cách vô thức. “Chào… mọi người.” Kenji Park đáp lại. Yuuichi đang đi cùng hai cô gái. Yuuichi kéo vạt áo của Aki và Kenji Park theo sau như thể họ là một đội hình cố định.'

const liveReply = existsSync('/tmp/risu-check/live-reply.txt')
    ? readFileSync('/tmp/risu-check/live-reply.txt', 'utf8')
    : LIVE_STYLE_FULL + ' ' + BAD_FALLBACK

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

    it('applies weak-act agency detection when the player asks a question', () => {
        expect(observeOnly('Tui hỏi Naru tên cô ấy')).toBe(false)
        expect(weakAct('Tui hỏi Naru tên cô ấy')).toBe(true)
        // Weak act: agency detection runs, catches invented PC speech/advance
        const hits = agencyHits(BAD_FALLBACK, 'Tui hỏi Naru tên cô ấy', 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).toEqual(expect.arrayContaining(['pc-speech', 'pc-advance']))
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

    it('detects and scrubs echoed player words and replayed movement', () => {
        const player = 'tui đứng dậy chạy theo họ nói này các cậu hmm cho tớ tham gia câu lạc bộ được ko'
        const replay = 'Anh hơi nghiêng người về phía trước, bắt đầu sải bước nhanh để bắt kịp nhóm ba người đang tiến về phía trước.'
        const reply = `${replay} “Cho tớ tham gia câu lạc bộ được không?” Yuuichi nói “Chào cậu, Kenji-kun.” Aki mỉm cười. Naru nhướn mày.`
        const hits = agencyHits(reply, player, 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).toEqual(expect.arrayContaining(['pc-echo', 'pc-replay']))
        expect(agencyHits(replay, player, 'Kenji Park').map((hit) => hit.rule)).toContain('pc-replay')
        const scrubbed = scrubAgency(reply, player, 'Kenji Park')
        expect(scrubbed).not.toContain('Cho tớ tham gia câu lạc bộ được không?')
        expect(scrubbed).not.toContain(replay)
        expect(scrubbed).toContain('Yuuichi nói “Chào cậu, Kenji-kun.”')
        expect(scrubbed).toContain('Aki mỉm cười.')
        expect(scrubbed).toContain('Naru nhướn mày.')
        expect(agencyHits(scrubbed, player, 'Kenji Park')).toEqual([])
        expect(agencyHits('Kenji Park khẽ nhướn mày.', 'Tui nhìn 3 người họ', 'Kenji Park').map((hit) => hit.rule)).not.toContain('pc-replay')
        expect(agencyHits('Aki chạy theo Kenji.', player, 'Kenji Park').map((hit) => hit.rule)).not.toContain('pc-replay')
        expect(agencyHits('Aki nói “Kenji Park chạy theo họ.”', player, 'Kenji Park').map((hit) => hit.rule)).not.toContain('pc-speech')
        expect(scrubAgency('Aki nghe “cho tớ tham gia câu lạc bộ được ko” rồi mỉm cười.', player, 'Kenji Park')).toBe('Aki nghe  rồi mỉm cười.')
        expect(scrubAgency(BAD_FALLBACK, 'Tui ôm Aki', 'Kenji Park')).toBe(BAD_FALLBACK)
    })

    it('scrubs replayed speech lead-ins without flagging NPCs or unrelated movement', () => {
        const player = 'tui đứng dậy chạy theo họ nói này các cậu hmm cho tớ tham gia câu lạc bộ được ko'
        const scrubbed = scrubAgency('Khi khoảng cách vừa đủ gần, anh khẽ gật đầu chào rồi cất tiếng. Yuuichi cười.', player, 'Kenji Park')
        expect(scrubbed).not.toContain('cất tiếng')
        expect(scrubbed).toContain('Yuuichi cười.')
        expect(agencyHits('Aki gật đầu chào Kenji.', player, 'Kenji Park').map((hit) => hit.rule)).not.toContain('pc-replay')
        expect(agencyHits('Đôi chân anh bước đi.', PLAYER, 'Kenji Park').map((hit) => hit.rule)).not.toContain('pc-replay')
        expect(scrubAgency('Anh vươn nhẹ đôi tay ra, linh hoạt trong từng bước chạy ngắn trên hành lang gỗ. Aki quay lại.', player, 'Kenji Park')).toBe('Aki quay lại.')
        const speech = scrubAgency('Dừng lại một nhịp, anh khẽ gật đầu với mỗi người rồi cất tiếng gọi đầy hào hứng. “Chào cậu.”', player, 'Kenji Park')
        expect(speech).not.toMatch(/cất tiếng|gật đầu/)
        expect(speech).toContain('“Chào cậu.”')
    })

    it('leaves strong player acts unchanged', () => {
        const reply = BAD_FALLBACK
        // Strong act: player explicitly initiates intimate contact
        expect(scrubAgency(reply, 'Tui ôm Aki', 'Kenji Park')).toBe(reply)
    })

    it('builds a hidden rewrite note mentioning no PC drag', () => {
        const note = agencyNote([{ rule: 'pc-advance', text: 'vuốt tóc' }])
        expect(note).toContain('hidden, never named')
        expect(note).toContain('NPC-initiated actions toward the player may remain')
        expect(note).toContain('do not have an NPC drag')
    })

    it('detects PC will/hesitation on observe-only turns (Anh không dám cử động)', () => {
        const reply = 'Kenji nhìn Aki. Anh không dám cử động. Naru im lặng.'
        const hits = agencyHits(reply, PLAYER, 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).toContain('pc-will')
        expect(hits.find((h) => h.rule === 'pc-will')?.text).toContain('Anh không dám cử động')
        const scrubbed = scrubAgency(reply, PLAYER, 'Kenji Park')
        expect(scrubbed).not.toContain('Anh không dám cử động')
        expect(scrubbed).toContain('Naru im lặng.')
    })

    it('detects PC will with other hesitation phrases', () => {
        const reply = 'Kenji Park ngồi yên. Tui không thể nói. Aki quay đi.'
        const hits = agencyHits(reply, PLAYER, 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).toContain('pc-will')
        const scrubbed = scrubAgency(reply, PLAYER, 'Kenji Park')
        expect(scrubbed).not.toContain('Tui không thể nói')
    })

    it('weakAct detects walking and asking as weak acts', () => {
        expect(weakAct('Tui đi theo Naru')).toBe(true)
        expect(weakAct('Tui hỏi Naru tên cô ấy')).toBe(true)
        expect(weakAct('Tui nhìn 3 người họ')).toBe(true)
        expect(weakAct('Tui chạy đến đó')).toBe(true)
        // Strong acts are not weak
        expect(weakAct('Tui ôm Aki')).toBe(false)
        expect(weakAct('Tui hôn Kenji')).toBe(false)
    })

    it('scrubs agency on weak player acts (walking, asking)', () => {
        const weakPlayer = 'Tui đi theo Naru'
        const reply = 'Kenji Park đáp lại, “Được thôi.” Anh vuốt tóc Aki. Naru cười.'
        const hits = agencyHits(reply, weakPlayer, 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).toEqual(expect.arrayContaining(['pc-speech', 'pc-advance']))
        const scrubbed = scrubAgency(reply, weakPlayer, 'Kenji Park')
        expect(scrubbed).not.toContain('“Được thôi.”')
        expect(scrubbed).not.toContain('vuốt tóc')
        expect(agencyHits(scrubbed, weakPlayer, 'Kenji Park')).toEqual([])
    })

    it('preserves explicit strong player act on weak turns', () => {
        const weakPlayer = 'Tui hỏi Naru tên cô ấy'
        const reply = 'Naru trả lời, “Tên tôi là Naru.” Kenji Park nhìn chằm chằm.'
        // The player explicitly asked - NPC answering is OK, PC speech is not invented
        const hits = agencyHits(reply, weakPlayer, 'Kenji Park')
        // Kenji Park didn't speak, so no pc-speech hit
        expect(hits.map((hit) => hit.rule)).not.toContain('pc-speech')
        const scrubbed = scrubAgency(reply, weakPlayer, 'Kenji Park')
        expect(scrubbed).toContain('Naru trả lời')
        expect(scrubbed).toContain('Kenji Park nhìn chằm chằm')
    })

    it('allows light sleeve tug as permissible (not an advance)', () => {
        const reply = 'Aki kéo vạt áo Kenji Park. Kenji quay lại nhìn Aki.'
        const hits = agencyHits(reply, PLAYER, 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).not.toContain('pc-advance')
        const scrubbed = scrubAgency(reply, PLAYER, 'Kenji Park')
        expect(scrubbed).toContain('kéo vạt áo')
        expect(agencyHits(scrubbed, PLAYER, 'Kenji Park')).toEqual([])
    })

    it('22:07-style snippet: observe-only with PC will and advance', () => {
        // 22:07 style: player observes, reply invents PC will + advance
        const reply = 'Kenji Park đứng yên. Anh không dám cử động. Sau đó anh đưa tay vuốt mái tóc Aki.'
        const hits = agencyHits(reply, PLAYER, 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).toEqual(expect.arrayContaining(['pc-will', 'pc-advance']))
        const scrubbed = scrubAgency(reply, PLAYER, 'Kenji Park')
        expect(scrubbed).not.toContain('Anh không dám cử động')
        expect(scrubbed).not.toContain('vuốt mái tóc')
        expect(agencyHits(scrubbed, PLAYER, 'Kenji Park')).toEqual([])
    })

    it('later-turn case (turn > 1): weak act with dragging still scrubbed', () => {
        // Simulate a later turn where player walks, reply drags PC
        const weakPlayer = 'Tui đi vào phòng'
        const reply = 'Yuuichi nắm tay Kenji Park kéo cậu vào đội hình. Naru theo sau.'
        const hits = agencyHits(reply, weakPlayer, 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).toContain('pc-dragged')
        const scrubbed = scrubAgency(reply, weakPlayer, 'Kenji Park')
        expect(scrubbed).not.toContain('kéo cậu vào đội hình')
        expect(agencyHits(scrubbed, weakPlayer, 'Kenji Park')).toEqual([])
    })

    it('later-turn case: observe-only with invented speech still scrubbed', () => {
        const reply = 'Kenji Park thầm nghĩ, “Tôi phải bảo vệ họ.” Naru nhìn ra cửa sổ.'
        const hits = agencyHits(reply, PLAYER, 'Kenji Park')
        expect(hits.map((hit) => hit.rule)).toContain('pc-speech')
        const scrubbed = scrubAgency(reply, PLAYER, 'Kenji Park')
        expect(scrubbed).not.toContain('“Tôi phải bảo vệ họ.”')
        expect(scrubbed).not.toContain('Kenji Park thầm nghĩ')
        expect(agencyHits(scrubbed, PLAYER, 'Kenji Park')).toEqual([])
    })
})
