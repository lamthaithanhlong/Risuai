// The side the player commits to and the creation gate (gameMaster.ts), on the turns of the 2026-10-19 acceptance run with the
// narrator on gpt-6-luna (~/.backend-review/work/risu-acceptance/2026-10-19-luna).
import { describe, expect, it } from 'vitest'
import { applyBookkeep, creationNote, playerSide, sameSide, sidePaths, takeGm, type GmState } from './gameMaster'

const SS_SIDE = 'Tôi quyết định rồi: tôi sẽ tìm mọi cách gia nhập nhóm của Nephis (Ngôi Sao Đổi Thay) và đi theo cô ấy, dù phải bắt đầu từ việc nhỏ nhất.'
const LOTM_SIDE = 'Tôi quyết định rồi: tôi sẽ nộp đơn xin gia nhập Kẻ Gác Đêm (Nighthawks) của Giáo hội Nữ Thần Đêm Tối ở thành phố này.'
const MAILMAN_SIDE = 'Tôi quyết định rồi: tôi không gia nhập đoàn nào cả, tôi sẽ đi một mình và tự gây dựng tên tuổi bằng những lá thư mình giao.'
const msg = (role: 'user' | 'char', data: string, chatId?: string) => ({ role, data, chatId })

describe('the side, from the player\'s own words', () => {
    it('reads the side the player commits to, not a route, a chore or a refusal', () => {
        expect(playerSide(SS_SIDE)).toBe('nhóm của Nephis (Ngôi Sao Đổi Thay)')
        expect(playerSide(LOTM_SIDE)).toBe('Kẻ Gác Đêm (Nighthawks) của Giáo hội Nữ Thần Đêm Tối')
        // going alone is the side (the card's "Going alone" path; the acceptance gm.side check asks for it): not a refusal
        expect(playerSide(MAILMAN_SIDE)).toBe('đi một mình')
        expect(playerSide('Tôi đi theo con đường chính ra khỏi chỗ này, vừa đi vừa để ý xung quanh.')).toBe('')
        expect(playerSide('Tôi làm việc được giao trong nhóm, cố cho mọi người thấy mình có ích.')).toBe('')
        expect(playerSide('Tôi làm theo thủ tục và yêu cầu mà bên đó đặt ra cho người mới.')).toBe('')
        expect(playerSide('I swear allegiance to House Valor, whatever it costs.')).toBe('House Valor')
        expect(playerSide('Tôi xin làm thuộc hạ cho Song Seir.')).toBe('Song Seir')
        expect(playerSide('Tui xin theo đoàn buôn nô lệ.')).toBe('đoàn buôn nô lệ')
    })

    it('SS t14: the bookkeeper wrote the camp and the chore as the side; the player\'s side is recorded instead', () => {
        const state: GmState = { gm_arc: 'a | b | c | d' }
        const next = applyBookkeep(state, ['beat: 3 | chẻ củi | lính gọi\npath: trại tù binh | 1 | mới được giao việc bổ củi, chưa có sự tin cậy'], 'r14', 14, SS_SIDE)
        expect(next.gm_path).toMatch(/Nephis|Ngôi Sao Đổi Thay/)
        expect(next.gm_path).not.toMatch(/trại tù binh/)
        expect(next.gm_path_at).toBe('14')
    })

    it('LotM t14: the reply wrote no block (the character lay on a stretcher); the side is still recorded', () => {
        const taken = takeGm({ gm_arc: 'a | b | c | d' }, msg('char', 'Ý định xin vào Kẻ Gác Đêm đã rõ, nhưng Arthur vẫn nằm co giật trên cáng.', 'r14'), 14, LOTM_SIDE)
        expect(taken?.state.gm_path).toMatch(/Gác Đêm|Nighthawk/)
        expect(taken?.text).toBe('Ý định xin vào Kẻ Gác Đêm đã rõ, nhưng Arthur vẫn nằm co giật trên cáng.')
        expect(takeGm({}, msg('char', 'Trời mưa.', 'r2'), 2, 'Tôi nhìn quanh.')).toBeNull()
    })

    it('a model line naming the same side keeps its stage; once a side is held, another name needs the player to join or leave', () => {
        const kept = sidePaths(['path: Ngôi Sao Đổi Thay | người mới | được giao canh lửa'], {}, SS_SIDE)
        expect(kept[0]).toBe('path: Ngôi Sao Đổi Thay | người mới | được giao canh lửa')
        const held: GmState = { gm_path: 'nhóm của Nephis (Ngôi Sao Đổi Thay) | muốn gia nhập | chưa được nhận' }
        const life = 'Tôi làm việc được giao trong nhóm, cố cho mọi người thấy mình có ích.'
        expect(sidePaths(['beat: 4 | x | y\npath: trại tù binh | 1 | bổ củi'], held, life)).toEqual(['beat: 4 | x | y'])
        expect(sidePaths(['path: — | chưa chọn bên'], held, life)).toEqual([''])
        expect(sidePaths(['path: Nephis | đã được nhận | canh đêm'], held, life)).toEqual(['path: Nephis | đã được nhận | canh đêm'])
        expect(sidePaths(['path: -'], held, 'Tôi rời bỏ nhóm của Nephis ngay trong đêm.')).toEqual(['path: -'])
        // no side yet: a side taken through acts (a pact) still comes from the model
        expect(sidePaths(['path: the voice in the trunk | pact | owes it'], {}, 'Tôi chấp nhận giao kèo.')).toEqual(['path: the voice in the trunk | pact | owes it'])
        // a model line with no word of the player's side (another language, a place) gives way to the player's own words
        expect(sidePaths(['path: the slavers | new hand'], {}, 'Tui xin theo đoàn buôn nô lệ.')).toEqual(['path: đoàn buôn nô lệ | muốn gia nhập | chưa được nhận'])
        expect(sameSide('Kẻ Gác Đêm | x', 'Kẻ Gác Đêm (Nighthawks) của Giáo hội')).toBe(true)
        expect(sameSide('trại tù binh | 1', 'nhóm của Nephis (Ngôi Sao Đổi Thay)')).toBe(false)
    })
})

const CARD = { name: 'Infinite Mailman', desc: 'Character Creation (before the story starts) … "Được chưa? Sửa dòng nào cứ nói"', firstMessage: 'HOW HARD IS THE WORLD? … Will you open the box?' }
const RECORD = '**Độ khó:** Khó\n- **Tên:** Lưu Kiến Minh.\n- **Ngoại hình:** Tóc đen cắt ngắn.\nNgoại hình: giữ ngoại hình của persona hay dùng ngoại hình vừa bốc? Được chưa? Sửa dòng nào cứ nói, hoặc bảo bốc lại dòng đó.'

describe('the creation gate', () => {
    it('Mailman t2: the look answer is not the yes, so the turn answers the creation step only', () => {
        const chat = [msg('user', 'Hard. Surprise me.'), msg('char', RECORD), msg('user', 'Giữ ngoại hình của persona.')]
        const note = creationNote(CARD, chat, {}, {})
        expect(note).toContain('not confirmed yet')
        expect(note).toContain('Được chưa?')
        expect(note).toContain('no [[STATUS]]')
        expect(note).not.toContain('Độ khó')                                               // not the first reply
    })
    it('the first reply records the difficulty; a step asks with exactly three suggestions + "để thế giới chọn"', () => {
        const note = creationNote(CARD, [msg('user', 'Hard. Từng bước.')], {}, {})
        expect(note).toContain('Độ khó: Khó')
        expect(note).toContain('exactly three suggestions')
        expect(note).toContain('đúng ba gợi ý')
        expect(note).toContain('để thế giới chọn')
    })
    it('goes away with the yes, once st_* exist, after the GM ran, and for a card with no creation step', () => {
        const yes = [msg('user', 'Hard. Surprise me.'), msg('char', RECORD), msg('user', 'Được.')]
        expect(creationNote(CARD, yes, {}, {})).toBe('')
        const later = [...yes, msg('char', 'Mưa quất vào cửa kính.'), msg('user', 'Tôi mở hộp.')]
        expect(creationNote(CARD, later, {}, {})).toBe('')
        const look = [msg('user', 'Hard. Surprise me.'), msg('char', RECORD), msg('user', 'Giữ ngoại hình của persona.')]
        expect(creationNote(CARD, look, { $st_name: 'Lưu Kiến Minh' }, {})).toBe('')
        expect(creationNote(CARD, look, {}, { gm_arc: 'a | b | c | d' })).toBe('')
        expect(creationNote({ name: 'Aiko', desc: 'A barista.', firstMessage: 'Hi?' }, look, {}, {})).toBe('')
    })
})
