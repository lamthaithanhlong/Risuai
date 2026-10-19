import { beforeEach, describe, expect, it, vi } from 'vitest'

const db: { gameMaster?: boolean; characters: unknown[] } = { characters: [] }
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => db }))

const { gameMasterRequest, noteGameMaster } = await import('./gameMasterPage')

const card = { type: 'character', name: 'Shadow Slave', desc: 'Character Creation … Được chưa?', firstMessage: '', globalLore: [] }
type M = { role: string; data: string; chatId?: string }
const chatOf = (message: M[], scriptstate: Record<string, string> = {}) => ({ message, scriptstate } as never as { message: M[]; scriptstate: Record<string, string> })
const req = () => [{ role: 'system', content: 'sys' }, { role: 'user', content: 'Tui đi xuống hầm.' }]

describe('the Game Master on the page', () => {
    beforeEach(() => { db.gameMaster = undefined; db.characters = [card] })

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
})
