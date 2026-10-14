import { describe, expect, it } from 'vitest'
import { ChatSlot, ChatSlotGone } from './chatSlot'

type Chat = { id?: string, name: string }
type Room = { chaId?: string, chats: Chat[] }
const room = (chaId: string | undefined, ...names: string[]): Room => ({ chaId, chats: names.map((n) => ({ id: chaId === undefined ? undefined : n, name: n })) })

describe('ChatSlot (specs/core/ChatSlot.tla)', () => {
    it('is -1 until init, like the plain variables it replaces', () => {
        const slot = new ChatSlot(() => ({ characters: [] }))
        expect(slot.char).toBe(-1)
        expect(slot.chat).toBe(-1)
    })

    it('keeps pointing at the same chat when New Chat unshifts a chat in front (the 3-step TLC trace)', () => {
        const db = { characters: [room('A', 'one', 'two')] }
        const slot = new ChatSlot(() => db)
        slot.init(0, 0) // generating for "one"
        db.characters[0].chats.unshift({ id: 'new', name: 'New Chat 3' })
        expect(slot.chat).toBe(1)
        expect(db.characters[0].chats[slot.chat].name).toBe('one')
    })

    it('follows the chat when an earlier chat is deleted', () => {
        const db = { characters: [room('A', 'one', 'two', 'three')] }
        const slot = new ChatSlot(() => db)
        slot.init(0, 2)
        db.characters[0].chats.splice(0, 1)
        expect(slot.chat).toBe(1)
        expect(db.characters[0].chats[slot.chat].name).toBe('three')
    })

    it('follows the character when characters are added or removed in front', () => {
        const db = { characters: [room('A', 'a1'), room('B', 'b1', 'b2')] }
        const slot = new ChatSlot(() => db)
        slot.init(1, 1)
        db.characters.shift()
        expect(slot.char).toBe(0)
        expect(db.characters[slot.char].chats[slot.chat].name).toBe('b2')
        db.characters.unshift(room('C', 'c1'))
        expect(slot.char).toBe(1)
    })

    it('throws instead of redirecting when the chat or the character was removed', () => {
        const db = { characters: [room('A', 'one', 'two')] }
        const slot = new ChatSlot(() => db)
        slot.init(0, 1)
        db.characters[0].chats.pop()
        expect(() => slot.chat).toThrow(ChatSlotGone)
        const db2 = { characters: [room('A', 'one'), room('B', 'two')] }
        const slot2 = new ChatSlot(() => db2)
        slot2.init(1, 0)
        db2.characters.pop()
        expect(() => slot2.char).toThrow(ChatSlotGone)
    })

    it('falls back to the captured index for rooms without ids, as before', () => {
        const db = { characters: [room(undefined, 'one', 'two')] }
        const slot = new ChatSlot(() => db)
        slot.init(0, 1)
        db.characters[0].chats.unshift({ name: 'x' })
        expect(slot.chat).toBe(1)
    })

    it('property: after any sequence of list changes the slot is the original chat or it throws', () => {
        let state = 777
        const rnd = (n: number) => Math.floor(((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * n)
        for (let trial = 0; trial < 300; trial++) {
            const db = { characters: [room('A', 'c0', 'c1', 'c2'), room('B', 'd0', 'd1')] }
            const targetChat = db.characters[1].chats[rnd(2)]
            const slot = new ChatSlot(() => db)
            slot.init(1, db.characters[1].chats.indexOf(targetChat))
            let n = 0
            for (let step = 0; step < 12; step++) {
                const r = db.characters[rnd(db.characters.length)]
                switch (rnd(4)) {
                    case 0: r.chats.unshift({ id: 'n' + n, name: 'n' + n++ }); break
                    case 1: if (r.chats.length) r.chats.splice(rnd(r.chats.length), 1); break
                    case 2: db.characters.unshift(room('X' + n, 'x' + n++)); break
                    default: if (db.characters.length > 1) db.characters.splice(rnd(db.characters.length), 1)
                }
                let got: Chat | undefined
                try {
                    got = db.characters[slot.char].chats[slot.chat]
                } catch (e) {
                    expect(e).toBeInstanceOf(ChatSlotGone)
                    expect(db.characters.some((c) => c.chats.includes(targetChat))).toBe(false)
                    break
                }
                expect(got).toBe(targetChat)
            }
        }
    })
})
