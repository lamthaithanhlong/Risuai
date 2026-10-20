import { beforeEach, describe, expect, it, vi } from 'vitest'

const db: { gameMaster?: boolean; gmBookkeeper?: boolean; characters: unknown[] } = { characters: [] }
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => db }))
const persona = { text: '' }
vi.mock('../util', () => ({ getPersonaPrompt: () => persona.text }))
const asks: string[] = []
const answer = { text: '[[GM\nbeat: 1 | x | y\n]]' }
vi.mock('./request/request', () => ({ requestChatData: async (arg: { formated: { content: string }[] }) => { asks.push(arg.formated[0].content); return { type: 'success', result: answer.text } } }))

const { bookkeep, cardNewMark, creationRequest, gameMasterRequest, noteGameMaster, settlePanel, storyNotesRequest } = await import('./gameMasterPage')
const { statusSpec } = await import('./statusBook')

const card = { type: 'character', name: 'Shadow Slave', desc: 'Character Creation … Được chưa?', firstMessage: '', globalLore: [] }
type M = { role: string; data: string; chatId?: string }
const chatOf = (message: M[], scriptstate: Record<string, string> = {}) => ({ message, scriptstate } as never as { message: M[]; scriptstate: Record<string, string> })
const req = () => [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Tui đi xuống hầm.' }]

describe('the Game Master on the page', () => {
    beforeEach(() => { db.gameMaster = undefined; db.gmBookkeeper = undefined; db.characters = [card]; answer.text = '[[GM\nbeat: 1 | x | y\n]]' })

    it('adds nothing before the character is confirmed, nor when turned off, nor in a group', () => {
        const c = chatOf([{ role: 'user', data: 'surprise me' }, { role: 'char', data: 'Tên: Mai\nĐược chưa?' }, { role: 'user', data: 'sửa tên' }])
        expect(gameMasterRequest(req(), card as never, c as never)[1].content).toBe('Tui đi xuống hầm.')
        const ok = chatOf([{ role: 'char', data: 'story' }], { $st_name: 'Mai' })
        expect(gameMasterRequest(req(), card as never, ok as never)[1].content).toContain('[GM (hidden')
        db.gameMaster = false
        expect(gameMasterRequest(req(), card as never, ok as never)[1].content).toBe('Tui đi xuống hầm.')
        db.gameMaster = true
        expect(gameMasterRequest(req(), { ...card, type: 'group' } as never, ok as never)[1].content).toBe('Tui đi xuống hầm.')
    })

    it('names the card\'s fate die in the note when it rolled a new event, and only then', () => {
        const ok = chatOf([{ role: 'char', data: 'story', chatId: 'r1' }, { role: 'user', data: 'đi' }, { role: 'char', data: 'story 2', chatId: 'r2' }],
            { $st_name: 'Mai', $gm_arc: 'debt | Varn | pay | brother', $gm_beat: '1 | x | y' })
        const withDie = (n: number) => [{ role: 'system', content: `THIS REPLY'S DICE\n* Event: ${n}. At a natural pause (arriving, resting, travelling, a day passing), 1–20 means something new surfaces; otherwise the scene goes on.` }, { role: 'user', content: 'Tôi ngồi nghỉ.' }]
        expect(gameMasterRequest(withDie(7), card as never, ok as never)[1].content).toContain('Card fate die: NEW EVENT')
        expect(gameMasterRequest(withDie(64), card as never, ok as never)[1].content).not.toContain('Card fate die')
        expect(gameMasterRequest(req(), card as never, ok as never)[1].content).not.toContain('Card fate die')
    })

    it('stays out of the Initialization reply to "Được chưa?", seeds on the next turn', () => {
        const c = chatOf([{ role: 'char', data: 'Tên: Mai\nĐược chưa? Sửa dòng nào cứ nói' }, { role: 'user', data: 'được' }])
        expect(gameMasterRequest(req(), card as never, c as never)[1].content).toBe('Tui đi xuống hầm.')
        c.message.push({ role: 'char', data: 'Mai bước qua.' }, { role: 'user', data: 'tui đi' })
        expect(gameMasterRequest(req(), card as never, c as never)[1].content).toContain('No arc yet')
    })

    it('takes the block out of the reply into gm_* variables, and the next note carries it', () => {
        const c = chatOf([{ role: 'char', data: 'a', chatId: 'r1' }, { role: 'user', data: 'đi' },
            { role: 'char', data: 'Văn.\n[[GM\narc: debt | Varn | pay | brother\nbeat: 1 | Varn watches | collection soon\n]]', chatId: 'r2' }], { $st_name: 'Mai' })
        db.characters = [card]
        noteGameMaster(0, c as never)
        expect(c.message[2].data).toBe('Văn.')
        expect(c.scriptstate.$gm_arc).toBe('debt | Varn | pay | brother')
        expect(c.scriptstate.$gm_at).toBe('r2')
        expect(gameMasterRequest(req(), card as never, c as never)[1].content).toContain('Arc: debt | Varn')
    })

    it('a rerolled reply takes its GM change with it', () => {
        const c = chatOf([{ role: 'char', data: 'a', chatId: 'r1' }, { role: 'user', data: 'đi' },
            { role: 'char', data: 'Văn.\n[[GM\narc: debt | Varn | pay | brother\n]]', chatId: 'r2' }], { $st_name: 'Mai' })
        noteGameMaster(0, c as never)
        c.message.pop()   // reroll: the reply is gone before the new request
        const out = gameMasterRequest(req(), card as never, c as never)[1].content
        expect(out).toContain('No arc yet')
        expect(c.scriptstate.$gm_arc).toBe('')
    })

    // Module 10: "Never two new events in a row"; the note followed the die alone (Z3 specs/story/dice/card_new_z3.py)
    it('the card\'s NEW event is never told two replies in a row; a reroll looks at the reply before it', () => {
        const ok = chatOf([{ role: 'char', data: 'story', chatId: 'r1' }, { role: 'user', data: 'đi' }, { role: 'char', data: 'story 2', chatId: 'r2' }],
            { $st_name: 'Mai', $gm_arc: 'debt | Varn | pay | brother', $gm_beat: '1 | x | y' })
        const withDie = (n: number) => [{ role: 'system', content: `THIS REPLY'S DICE\n* Event: ${n}. At a natural pause (arriving, resting, travelling, a day passing), 1–20 means something new surfaces; otherwise the scene goes on.` }, { role: 'user', content: 'Tôi ngồi nghỉ.' }]
        expect(gameMasterRequest(withDie(7), card as never, ok as never)[1].content).toContain('Card fate die: NEW EVENT')
        // a reroll of that reply: asked again at the same place, still the first NEW
        expect(gameMasterRequest(withDie(3), card as never, ok as never)[1].content).toContain('Card fate die: NEW EVENT')
        ok.message.push({ role: 'user', data: 'nghỉ tiếp' }, { role: 'char', data: 'story 3', chatId: 'r3' })
        const next = gameMasterRequest(withDie(12), card as never, ok as never)[1].content
        expect(next).not.toContain('Card fate die: NEW EVENT')
        expect(next).toContain('the last reply already brought something new')
        // the pure mark: a quiet reroll of the NEW reply takes the mark back, so the reply after it may surface one
        const v: Record<string, string> = {}
        expect(cardNewMark(v, 4, true)).toBe(true)
        expect(cardNewMark(v, 4, false)).toBe(false)
        expect(cardNewMark(v, 5, true)).toBe(true)
        expect(cardNewMark(v, 6, true)).toBe(false)
        expect(cardNewMark(v, 7, true)).toBe(true)
    })

    it('fresh dice each request (the same state gives different turns)', () => {
        const c = chatOf([{ role: 'char', data: 'a', chatId: 'r1' }], { $st_name: 'Mai', $gm_arc: 'debt | Varn | pay | brother', $gm_beat_at: '0' })
        const notes = new Set(Array.from({ length: 30 }, () => gameMasterRequest(req(), card as never, c as never)[1].content))
        expect(notes.size).toBeGreaterThan(2)
    })

    it('the bookkeeper writes the side the player took, only while its reply is still the last one', async () => {
        const c = chatOf([{ role: 'char', data: 'a', chatId: 'r1' }, { role: 'user', data: 'Tui xin theo đoàn buôn nô lệ.' }, { role: 'char', data: 'Lão gật đầu.', chatId: 'r2' }], { $st_name: 'Mai' })
        let asked = ''
        const ok = await bookkeep(() => c as never, c.message[2], 2, 'x', async (p) => { asked = p; return '[[GM\npath: đoàn buôn nô lệ | tay mới | bị canh chừng\nbeat: 1 | joined | first order at dawn\n]]' })
        expect(ok).toBe(true)
        expect(asked).toContain('Tui xin theo đoàn buôn nô lệ.')
        expect(c.scriptstate.$gm_path).toBe('đoàn buôn nô lệ | tay mới | bị canh chừng')
        expect(c.scriptstate.$gm_at).toBe('r2')
        c.message.push({ role: 'user', data: 'đi' }, { role: 'char', data: 'reroll', chatId: 'r3' })
        expect(await bookkeep(() => c as never, { data: 'Lão gật đầu.', chatId: 'r2' }, 2, 'x', async () => '[[GM\npath: other | x | y\n]]')).toBe(false)
        expect(c.scriptstate.$gm_path).toBe('đoàn buôn nô lệ | tay mới | bị canh chừng')
        expect(await bookkeep(() => c as never, c.message[4], 3, 'x', async () => null)).toBe(false)
    })

    it('the bookkeeper runs after a reply unless its setting is off; off, the narrator\'s block still counts', async () => {
        const mk = () => chatOf([{ role: 'char', data: 'a', chatId: 'r1' }, { role: 'user', data: 'đi' },
            { role: 'char', data: 'Văn.\n[[GM\narc: debt | Varn | pay | brother\n]]', chatId: 'r2' }], { $st_name: 'Mai' })
        asks.length = 0
        const on = mk()
        noteGameMaster(0, on as never)
        await new Promise((r) => setTimeout(r, 20))
        expect(asks.length).toBe(1)
        expect(on.scriptstate.$gm_beat).toBe('1 | x | y')
        db.gmBookkeeper = false
        asks.length = 0
        const off = mk()
        noteGameMaster(0, off as never)
        await new Promise((r) => setTimeout(r, 20))
        expect(asks.length).toBe(0)
        expect(off.scriptstate.$gm_arc).toBe('debt | Varn | pay | brother')
        expect(off.scriptstate.$gm_beat).toBe('')
    })

    it('an advance the dice roll is marked on the chat, so the next turns rest and a stall gets pushed', () => {
        const c = chatOf([{ role: 'char', data: 'a', chatId: 'r1' }, { role: 'user', data: 'đi' }], { $st_name: 'Mai', $gm_arc: 'a | b | c | d', $gm_adv_at: '0', $gm_beat_at: '1' })
        gameMasterRequest(req(), card as never, c as never, () => 0.01)     // advance
        expect(c.scriptstate.$gm_adv_at).toBe('1')
        expect(c.scriptstate.$gm_adv_prev).toBe('0')
        const quiet = { ...c.scriptstate }
        gameMasterRequest(req(), card as never, c as never, () => 0.99)     // quiet: no mark
        expect(c.scriptstate).toEqual(quiet)
    })
})

// the card's panel, as its lorebook teaches it (condensed from Shadow Slave's Module 07)
const MODULE07 = 'MODULE 07: RUNES AND LEDGER\n[[STATUS\nrank: Aspirant\n]]\nOne key per line; "-" clears a key. date (in-world date and time of day), place, condition (wounds in words), item1.\n\nCURRENT RUNES (filled by the script)\nDate: {{getvar::st_date}}; Place: {{getvar::st_place}}\nRunes: name={{getvar::st_name}}; rank={{getvar::st_rank}}\nCondition: {{getvar::st_condition}}; Items: 1={{getvar::st_item1}}\nRefused: {{getvar::st_refused}}'
const panelCard = { ...card, globalLore: [{ content: 'Module 01' }, { content: MODULE07 }] }
const RECORD = 'Tên: Kenji\nĐược chưa? Sửa dòng nào cứ nói'
const settle = () => new Promise((r) => setTimeout(r, 20))

describe('the status panel kept by the same bookkeeper call (measured: gpt-6-luna wrote STATUS in 4 of 21 replies)', () => {
    beforeEach(() => { db.gameMaster = undefined; db.gmBookkeeper = undefined; db.characters = [panelCard]; asks.length = 0 })

    it('one helper call per turn asks for the GM notes and the panel; both are written while the reply is the last one', async () => {
        answer.text = '[[GM\nbeat: 2 | the cook watches | night\n]]\n[[STATUS\ndate: Ngày 2, đêm\nplace: Trại tù binh | lều ngủ\ncondition: cổ tay hằn đỏ\nrefused: x\nhp: 3\n]]'
        const c = chatOf([{ role: 'char', data: RECORD }, { role: 'user', data: 'được' }, { role: 'char', data: 'Kenji tỉnh dậy.', chatId: 'r2' },
            { role: 'user', data: 'Tôi tìm chỗ ngủ qua đêm.' }, { role: 'char', data: 'Đêm xuống trên trại.', chatId: 'r3' }], { $st_name: 'Kenji', $st_rank: 'Aspirant', $st_place: 'Cổng trại' })
        noteGameMaster(0, c as never)
        await settle()
        expect(asks.length).toBe(1)
        expect(asks[0]).toContain('NOTES NOW')
        expect(asks[0]).toContain('THE STATUS PANEL')
        expect(asks[0]).toContain('place: Cổng trại')
        expect(c.scriptstate.$gm_beat).toBe('2 | the cook watches | night')
        expect(c.scriptstate.$st_date).toBe('Ngày 2, đêm')
        expect(c.scriptstate.$st_place).toBe('Trại tù binh | lều ngủ')
        expect(c.scriptstate.$st_condition).toBe('cổ tay hằn đỏ')
        expect(c.scriptstate.$st_refused).toBeUndefined()
        expect(c.scriptstate.$st_hp).toBeUndefined()
    })

    it('nothing before the yes; the GM off still keeps the panel; the setting off asks nothing', async () => {
        const pre = chatOf([{ role: 'user', data: 'Hard. Surprise me.' }, { role: 'char', data: RECORD }, { role: 'user', data: 'Giữ ngoại hình của persona.' }, { role: 'char', data: RECORD + ' (ngoại hình persona)', chatId: 'r2' }])
        noteGameMaster(0, pre as never)
        await settle()
        expect(asks.length).toBe(0)
        const mk = () => chatOf([{ role: 'char', data: RECORD }, { role: 'user', data: 'được' }, { role: 'char', data: 'Kenji tỉnh dậy.', chatId: 'r2' }], { $st_name: 'Kenji' })
        answer.text = '[[STATUS\nplace: Cổng trại\n]]'
        db.gameMaster = false
        const off = mk()
        noteGameMaster(0, off as never)
        await settle()
        expect(asks.length).toBe(1)
        expect(asks[0]).not.toContain('NOTES NOW')
        expect(off.scriptstate.$st_place).toBe('Cổng trại')
        db.gmBookkeeper = false
        asks.length = 0
        noteGameMaster(0, mk() as never)
        await settle()
        expect(asks.length).toBe(0)
    })

    it('a panel answer that comes after the reply was replaced is dropped', async () => {
        const c = chatOf([{ role: 'char', data: RECORD }, { role: 'user', data: 'được' }, { role: 'char', data: 'Kenji tỉnh dậy.', chatId: 'r2' }], { $st_name: 'Kenji' })
        const spec = statusSpec(panelCard)
        const ok = await bookkeep(() => c as never, c.message[2], 1, 'x', async () => { c.message.push({ role: 'user', data: 'đi' }, { role: 'char', data: 'reroll', chatId: 'r3' }); return '[[STATUS\nplace: Bến sông\n]]' }, { gm: false, status: spec })
        expect(ok).toBe(false)
        expect(c.scriptstate.$st_place).toBeUndefined()
    })

    it('the side the player commits to is written with the reply, before any helper answer (SS t14)', () => {
        const c = chatOf([{ role: 'char', data: RECORD }, { role: 'user', data: 'được' }, { role: 'char', data: 'a', chatId: 'r2' },
            { role: 'user', data: 'Tôi quyết định rồi: tôi sẽ tìm mọi cách gia nhập nhóm của Nephis (Ngôi Sao Đổi Thay) và đi theo cô ấy, dù phải bắt đầu từ việc nhỏ nhất.' },
            { role: 'char', data: 'Kenji đã quyết. Anh hạ đoạn gậy xuống.', chatId: 'r3' }], { $st_name: 'Kenji', $gm_arc: 'a | b | c | d' })
        db.gmBookkeeper = false
        noteGameMaster(0, c as never)
        expect(c.scriptstate.$gm_path).toMatch(/^nhóm của Nephis \(Ngôi Sao Đổi Thay\) \|/)
    })

    it('the creation gate rides on the player\'s message until the yes', () => {
        const pre = chatOf([{ role: 'user', data: 'Hard. Surprise me.' }, { role: 'char', data: RECORD }, { role: 'user', data: 'Giữ ngoại hình của persona.' }])
        expect(creationRequest(req(), panelCard as never, pre as never)[1].content).toContain('[Character creation (hidden')
        const yes = chatOf([{ role: 'user', data: 'Hard. Surprise me.' }, { role: 'char', data: RECORD }, { role: 'user', data: 'Được.' }])
        expect(creationRequest(req(), panelCard as never, yes as never)[1].content).toBe('Tui đi xuống hầm.')
    })

    it('the player\'s persona is the character sheet: creation takes it, and the story keeps its abilities from the yes on', () => {
        // the owner's Mailman chat, 2026-10-19: the look answer was "Lấy như profile" and the record kept none of the ten abilities
        const RULE = " The Player's Persona: the persona is the character sheet."
        const pCard = { ...panelCard, desc: panelCard.desc + RULE }, sCard = { ...card, desc: card.desc + RULE }
        const KENJI = '[{{user}} = Kenji Park, nam, 25 tuổi ... **10 năng lực bí mật:** 1. **Thôi miên** ... **Evelyn — Linh Hồn Dẫn Lối** ...]'
        const look = chatOf([{ role: 'user', data: 'Từng bước' }, { role: 'char', data: '**Ngoại hình của Kenji Park?**\n- a\n- b\n- c\n- Để thế giới chọn.' }, { role: 'user', data: 'Lấy như profile' }])
        persona.text = ''
        expect(creationRequest(req(), pCard as never, look as never)[1].content).not.toContain('persona')
        persona.text = KENJI
        const note = creationRequest(req(), pCard as never, look as never)[1].content
        expect(note).toContain('it is the character sheet')
        expect(note).toContain('Năng lực, Đồng hành')
        // story turns, the Initialization reply (GM silent) included; none before the yes, none without a persona
        const init = chatOf([{ role: 'char', data: RECORD }, { role: 'user', data: 'Được' }])
        expect(storyNotesRequest(req(), sCard as never, init as never)[1].content).toContain('[Persona (hidden')
        const story = chatOf([{ role: 'char', data: 'story' }], { $st_name: 'Kenji Park' })
        expect(storyNotesRequest(req(), sCard as never, story as never)[1].content).toContain('[Persona (hidden')
        expect(storyNotesRequest(req(), sCard as never, look as never)[1].content).toBe('Tui đi xuống hầm.')
        expect(storyNotesRequest(req(), card as never, story as never)[1].content).not.toContain('[Persona (hidden')   // a card without the rule
        expect(creationRequest(req(), panelCard as never, look as never)[1].content).not.toContain('character sheet')
        persona.text = '   '
        expect(storyNotesRequest(req(), sCard as never, story as never)[1].content).not.toContain('[Persona (hidden')
        persona.text = ''
    })

    it('a card with a Future Plan rule gets the line asked for from the yes on; other cards and creation do not', () => {
        const planCard = { ...card, desc: card.desc + " The Player's Persona … Future Plan … [💡Kế hoạch| Nephis, Cassie ] …" }
        const story = chatOf([{ role: 'char', data: 'story' }], { $st_name: 'Kenji Park' })
        expect(storyNotesRequest(req(), planCard as never, story as never)[1].content).toContain('[💡Kế hoạch| names ]')
        const init = chatOf([{ role: 'char', data: RECORD }, { role: 'user', data: 'Được' }])
        expect(storyNotesRequest(req(), planCard as never, init as never)[1].content).toContain('[Future Plan (hidden')
        const pre = chatOf([{ role: 'user', data: 'Từng bước' }, { role: 'char', data: 'Tên?\n- a\n- b\n- c' }, { role: 'user', data: 'Kenji' }])
        expect(storyNotesRequest(req(), planCard as never, pre as never)[1].content).toBe('Tui đi xuống hầm.')
        expect(storyNotesRequest(req(), card as never, story as never)[1].content).not.toContain('Future Plan')
    })

    it('the yes turn opens the story; later turns carry the voice note; another card gets neither', () => {
        const rule = { ...card, desc: card.desc + " The Player's Persona …" }
        const init = chatOf([{ role: 'char', data: RECORD }, { role: 'user', data: 'Được' }])
        const first = storyNotesRequest(req(), rule as never, init as never)[1].content
        expect(first).toContain('[Start (hidden')
        expect(first).not.toContain('[Voice (hidden')
        const later = chatOf([{ role: 'char', data: RECORD }, { role: 'user', data: 'Được' }, { role: 'char', data: 'Mưa rơi.' }, { role: 'user', data: 'Nếu nó lao tới thì tôi né.' }])
        const next = storyNotesRequest(req(), rule as never, later as never)[1].content
        expect(next).toContain('[Voice (hidden')
        expect(next).not.toContain('[Start (hidden')
        expect(storyNotesRequest(req(), card as never, later as never)[1].content).toBe('Tui đi xuống hầm.')
    })

    it('the persona and Future Plan notes stay with the GM switched off, and come on a card with no creation step (Z3 counterexamples)', () => {
        persona.text = '[{{user}} = Kenji Park ... 1. **Thôi miên:** ...]'
        const planCard = { ...card, desc: "The Player's Persona … Future Plan … [💡Kế hoạch| a ] …" }      // no "Được chưa?": no creation step
        const story = chatOf([{ role: 'user', data: 'xin chào' }, { role: 'char', data: 'Mưa quất vào cửa kính, từng hạt nặng như sỏi. Kenji kéo cổ áo lên, nhìn con phố vắng dưới ánh đèn vàng.\n\nỞ cuối phố, một bóng người đứng yên dưới mái hiên.' }, { role: 'user', data: 'đi tiếp' }])
        db.gameMaster = false
        const out = storyNotesRequest(req(), planCard as never, story as never)[1].content
        expect(out).toContain('[Persona (hidden')
        expect(out).toContain('[Future Plan (hidden')
        expect(gameMasterRequest(req(), planCard as never, story as never)[1].content).toBe('Tui đi xuống hầm.')
        expect(storyNotesRequest(req(), planCard as never, chatOf([{ role: 'user', data: 'xin chào' }]) as never)[1].content).toBe('Tui đi xuống hầm.')
        expect(storyNotesRequest(req(), { ...planCard, type: 'group' } as never, story as never)[1].content).toBe('Tui đi xuống hầm.')
        persona.text = ''
    })

    // the Shadow Slave chat of 2026-10-20 (statusBook.test.ts): the Soul Fragments rose on every turn after the first kill
    it('pays a kill once: the narrator\'s own rise with no event goes back, the helper leaves what the narrator wrote', async () => {
        const ssCard = { ...card, globalLore: [{ content: '[[STATUS\nfrag: 12/1000\n]]\nCURRENT RUNES\nfrag={{getvar::st_frag}}; place={{getvar::st_place}}' }] }
        db.characters = [ssCard]
        const c = { ...chatOf([{ role: 'char', data: 'Tên: Mai\nĐược chưa?', chatId: 'r1' }, { role: 'user', data: 'được' }, { role: 'char', data: 'Hầm tối.', chatId: 'r2' }, { role: 'user', data: 'Tui bắn 3 viên vào mắt nó' }], { $st_frag: '0/1000' }), id: 'chat-1' }
        // the kill turn: the request leaves with 0, the card's script applies the narrator's "frag: 3/1000", the helper says 8
        storyNotesRequest(req(), ssCard as never, c as never)
        c.message.push({ role: 'char', data: 'Viên cuối xuyên qua hốc mắt.\n\n[Ngươi đã giết một Thú Ngủ Say, Kẻ Rình Khe.]', chatId: 'r3' })
        c.scriptstate.$st_frag = '3/1000'
        answer.text = '[[GM\nbeat: 3 | dead | next\n]]\n[[STATUS\nfrag: 8/1000\n]]'
        noteGameMaster(0, c as never)
        await vi.waitFor(() => expect(c.scriptstate.$gm_beat).toBe('3 | dead | next'))
        expect(c.scriptstate.$st_frag).toBe('3/1000')
        expect(asks.at(-1)).toContain('leave them out: frag: 3/1000')
        // a look through the door: the helper sees the body and says 12; no system line, nothing is paid
        c.message.push({ role: 'user', data: 'Tui dùng thấu thị nhìn ra ngoài' })
        storyNotesRequest(req(), ssCard as never, c as never)
        c.message.push({ role: 'char', data: 'Một xác xám nằm co quắp sát chân tường.', chatId: 'r4' })
        answer.text = '[[GM\nbeat: 4 | look | next\n]]\n[[STATUS\nfrag: 12/1000\nplace: hành lang\n]]'
        noteGameMaster(0, c as never)
        await vi.waitFor(() => expect(c.scriptstate.$st_place).toBe('hành lang'))
        expect(c.scriptstate.$st_frag).toBe('3/1000')
        expect(asks.at(-1)).toContain('THE REPLY BEFORE IT (everything it showed is already on the panel):\nViên cuối xuyên qua hốc mắt.')
        // "Con quái không chết": the narrator's own block says 16 with no kill; it goes back
        c.message.push({ role: 'user', data: 'Tui bắn đạn đá vào con quái kia' })
        storyNotesRequest(req(), ssCard as never, c as never)
        c.message.push({ role: 'char', data: 'Con quái không chết.', chatId: 'r5' })
        c.scriptstate.$st_frag = '16/1000'
        noteGameMaster(0, c as never)
        expect(c.scriptstate.$st_frag).toBe('3/1000')
    })

    // a reroll pops the reply and asks again, but the card's script had already written its block: Shadow Slave paid the kill
    // 0 -> 3, and the reroll, reading 3 on the panel, paid it again to 6 (Lord of the Mysteries: wages twice)
    it('a rerolled or deleted reply takes its panel writes with it, as the GM does', () => {
        const ssCard = { ...card, globalLore: [{ content: '[[STATUS\nfrag: 12/1000\n]]\nCURRENT RUNES\nfrag={{getvar::st_frag}}; place={{getvar::st_place}}' }] }
        db.characters = [ssCard]
        db.gmBookkeeper = false
        const c = { ...chatOf([{ role: 'char', data: 'Tên: Mai\nĐược chưa?', chatId: 'r1' }, { role: 'user', data: 'được' }, { role: 'char', data: 'Hầm tối.', chatId: 'r2' }, { role: 'user', data: 'Tui bắn 3 viên vào mắt nó' }], { $st_frag: '0/1000' }), id: 'chat-3' }
        // as sendChat asks: the panel settled before the prompt is built, then the notes
        const ask = () => { settlePanel(c as never); storyNotesRequest(req(), ssCard as never, c as never) }
        // the narrator's block pays three on what the panel shows (status.lua writes it), the helper notes the place
        const kill = (chatId: string) => {
            c.message.push({ role: 'char', data: 'Viên cuối xuyên qua hốc mắt.\n\n[Ngươi đã giết một Thú Ngủ Say.]', chatId })
            c.scriptstate.$st_frag = `${Number(c.scriptstate.$st_frag.split('/')[0]) + 3}/1000`
            c.scriptstate.$st_place = 'khe đá'
            // its [[LEDGER]] "event:" line, appended by status.lua
            c.scriptstate.$led_ev = [c.scriptstate.$led_ev, 'Ngày 1 | giết Kẻ Rình Khe'].filter(Boolean).join('\n')
            noteGameMaster(0, c as never)
        }
        ask()
        kill('r3')
        expect(c.scriptstate.$st_frag).toBe('3/1000')
        // reroll: the reply is gone before the new request, which finds the panel as it was before it
        c.message.pop()
        ask()
        expect(c.scriptstate.$st_frag).toBe('0/1000')
        expect(c.scriptstate.$st_place).toBe('')
        expect(c.scriptstate.$led_ev).toBe('')
        kill('r3b')
        expect(c.scriptstate.$st_frag).toBe('3/1000')
        expect(c.scriptstate.$led_ev).toBe('Ngày 1 | giết Kẻ Rình Khe')
        // a reply that stays keeps what it paid
        c.message.push({ role: 'user', data: 'Tui nhìn quanh' })
        ask()
        expect(c.scriptstate.$st_frag).toBe('3/1000')
        c.message.push({ role: 'char', data: 'Không còn gì.', chatId: 'r4' })
        noteGameMaster(0, c as never)
        // deleted, then the player writes again: the deleted reply's writes go too, the earlier payment stays
        c.scriptstate.$st_place = 'hành lang'
        c.message.splice(-1, 1, { role: 'user', data: 'Tui quay lại' })
        ask()
        expect(c.scriptstate.$st_frag).toBe('3/1000')
        expect(c.scriptstate.$st_place).toBe('khe đá')
        // a rollback over two replies at once (the kill and the one after it): back to before the kill (TLA+ PanelReroll)
        c.message.push({ role: 'char', data: 'Không còn gì.', chatId: 'r5' })
        c.scriptstate.$st_place = 'cầu thang'
        noteGameMaster(0, c as never)
        c.message.splice(4)
        ask()
        expect(c.scriptstate.$st_frag).toBe('0/1000')
        expect(c.scriptstate.$st_place).toBe('')
        expect(c.scriptstate.$led_ev).toBe('')
    })

    it('tells the narrator what the last reply already counted, the same on a reroll', () => {
        const lotm = { ...card, globalLore: [{ content: '[[STATUS\nmoney: 3 bảng\n]]\nCURRENT PANEL\nmoney={{getvar::st_money}}; place={{getvar::st_place}}' }] }
        db.characters = [lotm]
        const c = { ...chatOf([{ role: 'char', data: 'Tên: Mai\nĐược chưa?' }, { role: 'user', data: 'được' }, { role: 'char', data: 'Mưa.' }, { role: 'user', data: 'Tôi chép sổ rồi nhận tiền công.' }], { $st_money: '' }), id: 'chat-2' }
        expect(storyNotesRequest(req(), lotm as never, c as never)[1].content).not.toContain('already counted')
        c.message.push({ role: 'char', data: 'Ông đếm sáu xu vào tay Kenji.' }, { role: 'user', data: 'Tôi đi dạo.' })
        c.scriptstate.$st_money = '6 pence'
        expect(storyNotesRequest(req(), lotm as never, c as never)[1].content).toContain('the last reply already counted money — → 6 pence')
        expect(storyNotesRequest(req(), lotm as never, c as never)[1].content).toContain('the last reply already counted money — → 6 pence')
    })
})
