import { beforeEach, describe, expect, it, vi } from 'vitest'

const db: { gameMaster?: boolean; gmBookkeeper?: boolean; characters: unknown[] } = { characters: [] }
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => db }))
const asks: string[] = []
const answer = { text: '[[GM\nbeat: 1 | x | y\n]]' }
vi.mock('./request/request', () => ({ requestChatData: async (arg: { formated: { content: string }[] }) => { asks.push(arg.formated[0].content); return { type: 'success', result: answer.text } } }))

const { bookkeep, creationRequest, gameMasterRequest, noteGameMaster } = await import('./gameMasterPage')
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
})
