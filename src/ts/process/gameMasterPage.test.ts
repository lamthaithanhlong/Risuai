import { beforeEach, describe, expect, it, vi } from 'vitest'

const db: { gameMaster?: boolean; gmBookkeeper?: boolean; characters: unknown[] } = { characters: [] }
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => db }))
const asks: string[] = []
vi.mock('./request/request', () => ({ requestChatData: async (arg: { formated: { content: string }[] }) => { asks.push(arg.formated[0].content); return { type: 'success', result: '[[GM\nbeat: 1 | x | y\n]]' } } }))

const { bookkeep, gameMasterRequest, noteGameMaster } = await import('./gameMasterPage')

const card = { type: 'character', name: 'Shadow Slave', desc: 'Character Creation … Được chưa?', firstMessage: '', globalLore: [] }
type M = { role: string; data: string; chatId?: string }
const chatOf = (message: M[], scriptstate: Record<string, string> = {}) => ({ message, scriptstate } as never as { message: M[]; scriptstate: Record<string, string> })
const req = () => [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Tui đi xuống hầm.' }]

describe('the Game Master on the page', () => {
    beforeEach(() => { db.gameMaster = undefined; db.gmBookkeeper = undefined; db.characters = [card] })

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
        const ok = await bookkeep(() => c as never, c.message[2], 2, 'x', async (p) => { asked = p; return '[[GM\npath: the slavers | new hand | watched\nbeat: 1 | joined | first order at dawn\n]]' })
        expect(ok).toBe(true)
        expect(asked).toContain('Tui xin theo đoàn buôn nô lệ.')
        expect(c.scriptstate.$gm_path).toBe('the slavers | new hand | watched')
        expect(c.scriptstate.$gm_at).toBe('r2')
        c.message.push({ role: 'user', data: 'đi' }, { role: 'char', data: 'reroll', chatId: 'r3' })
        expect(await bookkeep(() => c as never, { data: 'Lão gật đầu.', chatId: 'r2' }, 2, 'x', async () => '[[GM\npath: other | x | y\n]]')).toBe(false)
        expect(c.scriptstate.$gm_path).toBe('the slavers | new hand | watched')
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
})
