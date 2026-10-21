import { beforeEach, describe, expect, it, vi } from 'vitest'

// asked 2026-10-20: the lore works like a librarian (index → shelf → book), the creation turns' rules are never dropped
const db: { loreBookToken: number; characters: unknown[]; loreForward?: boolean; loreForwardShadow?: boolean } = { loreBookToken: 4000, characters: [] }
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => db }))
const asks: string[] = []
const answers: string[] = []
vi.mock('./request/request', () => ({
    requestChatData: async (arg: { formated: { content: string }[] }) => { asks.push(arg.formated[0].content); return { type: 'success', result: answers.shift() ?? 'none' } },
}))

const { pickLoreForTurn, creationTurn, forwardAsk, prefetchBooks, trackForward, forwardStats } = await import('./loreIndexPage')
const { lorePicked, loreForced, loreLeftBehind, FORWARD_VAR } = await import('./loreIndex')

const words = (n: number) => 'Word. '.repeat(Math.round(n * 3.9 / 6))
const folder = (id: string, name: string, hint = '') => ({ mode: 'folder', key: `folder:${id}`, comment: name, content: hint })
const book = (title: string, id: string, n: number) => ({ comment: title, content: `${title}. ` + words(n), folder: `folder:${id}` })
const LORE = [
    { comment: 'Module 07 — Status Panel', content: words(1000), alwaysActive: true },                      // 0
    folder('creation', 'Rules — character creation', 'How the character is rolled.'),                         // 1
    folder('fights', 'Rules — fights and injury', 'How a fight is judged.'),                                    // 2
    folder('people', 'People', 'Canon characters.'),                                                            // 3
    book('Character generation', 'creation', 400),                                                              // 4  index 1
    book('Starting stage', 'creation', 300),                                                                    // 5  index 2
    book('Combat adjudication', 'fights', 500),                                                                 // 6  index 3
    ...Array.from({ length: 22 }, (_, i) => book(`Person ${i}`, 'people', 900)),                               // 7.. index 4..
]
const card = (extra = {}) => ({ type: 'character', chaId: 'c1', name: 'SS', desc: 'Character Creation … Được chưa?', firstMessage: '', globalLore: LORE, loreSettings: { tokenBudget: 6000 }, ...extra })
type M = { role: string; data: string }
let chats = 0
const chat = (message: M[], scriptstate: Record<string, string> = {}) => ({ id: `chat${++chats}`, message, scriptstate })     // each its own last picks
const CREATING: M[] = [{ role: 'char', data: 'prologue' }, { role: 'user', data: 'Khó, từng bước' }]
const STORY: M[] = [{ role: 'char', data: 'Tên: Mai\nĐược chưa?' }, { role: 'user', data: 'được' }, { role: 'char', data: 'Mưa rơi.' }, { role: 'user', data: 'Tôi rút dao đâm nó.' }]
const ids = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, k) => from + k)

describe('the librarian on the page', () => {
    beforeEach(() => { asks.length = 0; answers.length = 0 })

    it('a creation turn is before the yes and the yes turn itself; not once the story runs', () => {
        expect(creationTurn(card() as never, CREATING, {})).toBe(true)
        expect(creationTurn(card() as never, STORY.slice(0, 2), {})).toBe(true)                             // the yes: Initialization
        expect(creationTurn(card() as never, STORY, {})).toBe(false)
        expect(creationTurn(card() as never, CREATING, { $st_name: 'Mai' })).toBe(false)                    // the panel was written
        expect(creationTurn(card({ desc: 'a companion' }) as never, CREATING, {})).toBe(false)
    })

    it('a creation turn loads the creation shelf whatever the helper says, and marks it never dropped', async () => {
        answers.push('3')                                                                                 // the helper names People
        answers.push('5, 4')
        await pickLoreForTurn(card() as never, chat(CREATING) as never)
        expect([4, 5].map((i) => loreForced('c1', i))).toEqual([true, true])
        expect(loreForced('c1', 6)).toBe(false)
        // the helper failed: still the creation rules
        answers.push('garbage')
        await pickLoreForTurn(card({ loreIndexPick: false }) as never, chat(CREATING) as never)
        expect(asks).toHaveLength(2)                                                                        // the index pass off: no helper call
        expect(loreForced('c1', 4)).toBe(true)
    })

    it('on a creation turn the picks fill only the room the creation rules leave', async () => {
        answers.push('3')
        answers.push('1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12')
        await pickLoreForTurn(card() as never, chat([...CREATING, { role: 'char', data: 'Tên?' }, { role: 'user', data: 'Mai' }]) as never)
        // room 6000 - 1000 rules - 700 creation = 4300: four people whole and one in part (not five and one)
        expect(ids(7, 28).filter((i) => lorePicked('c1', i))).toHaveLength(5)
    })

    it('a story turn: shelves first, then the titles on the named big shelf only; the small shelf comes whole', async () => {
        answers.push('2, 3')                                                                               // fights, people
        answers.push('2')                                                                                  // of People's titles: the second
        await pickLoreForTurn(card() as never, chat(STORY) as never)
        expect(asks).toHaveLength(2)
        expect(asks[0]).toContain('SHELVES\n1. Rules — character creation — How the character is rolled. (2)\n2. Rules — fights and injury')
        expect(asks[0]).not.toContain('Person 3')
        expect(asks[1]).toContain('1. Person 0\n2. Person 1')
        expect(asks[1]).not.toContain('Combat adjudication')
        expect(lorePicked('c1', 6)).toBe(true)                                                              // Combat adjudication, whole shelf
        expect(lorePicked('c1', 8)).toBe(true)                                                              // Person 1
        expect(lorePicked('c1', 7)).toBe(false)
        expect(ids(4, 5).some((i) => lorePicked('c1', i) || loreForced('c1', i))).toBe(false)              // not a creation turn
    })

    it('last turn\'s picks stay only while their shelf is still named; the room is not padded with what the scene left', async () => {
        const c = chat([...STORY.slice(0, 3), { role: 'user', data: 'Tôi hỏi Person 0.' }])
        answers.push('3'); answers.push('1, 2')                                                         // People: Person 0, Person 1
        await pickLoreForTurn(card() as never, c as never)
        expect([7, 8].map((i) => lorePicked('c1', i))).toEqual([true, true])
        c.message.push({ role: 'char', data: 'Họ im lặng.' }, { role: 'user', data: 'Tôi rút dao đâm con quái.' })
        answers.push('2')                                                                               // fights only
        await pickLoreForTurn(card() as never, c as never)
        expect(lorePicked('c1', 6)).toBe(true)
        expect([7, 8].some((i) => lorePicked('c1', i))).toBe(false)                                     // People was not named
        c.message.push({ role: 'char', data: 'Lưỡi dao trượt.' }, { role: 'user', data: 'Tôi gọi Person 5.' })
        answers.push('3, 2'); answers.push('6')                                                         // People again: Person 5
        await pickLoreForTurn(card() as never, c as never)
        expect(lorePicked('c1', 12)).toBe(true)
    })

    it('both questions read only the newest reply\'s Future Plan line (onlyNewestPlan)', async () => {
        answers.push('3')
        answers.push('1')
        await pickLoreForTurn(card() as never, chat([...STORY.slice(0, 2), { role: 'char', data: 'Mưa.\n\n[💡Kế hoạch| Person 7 ]' }, { role: 'user', data: 'đi' },
            { role: 'char', data: 'Gió.\n\n[💡Kế hoạch| Person 2 ]' }, { role: 'user', data: 'Tôi chờ.' }]) as never)
        expect(asks.join('\n')).not.toContain('Kế hoạch| Person 7')
        expect(asks[0]).toContain('Kế hoạch| Person 2')
        expect(asks[1]).toContain('Kế hoạch| Person 2')
    })

    it('the picks fit the room the always-on rules leave; the shelf answer is cached for the same messages', async () => {
        answers.push('3')
        answers.push('1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12')
        const c = chat([...STORY.slice(0, 3), { role: 'user', data: 'Tôi hỏi Person 0.' }])
        await pickLoreForTurn(card() as never, c as never)
        const picked = ids(7, 28).filter((i) => lorePicked('c1', i))
        expect(picked.length).toBeGreaterThan(0)
        expect(picked.length * 900).toBeLessThanOrEqual(6000 - 1000 + 900)                                 // within the room (one in part)
        const n = asks.length
        await pickLoreForTurn(card() as never, c as never)
        expect(asks.length).toBe(n)
    })

    it('the librarian answered: a book on a shelf it did not name is left behind (its key word said long ago loads it no more)', async () => {
        const scene = [...STORY.slice(0, 3), { role: 'user', data: 'Tôi chém nó lần nữa.' }]                // not asked before (cache)
        answers.push('2')                                                                                  // fights only
        await pickLoreForTurn(card() as never, chat(scene) as never)
        expect(loreLeftBehind('c1', 6)).toBe(false)                                                         // on Rules — fights
        expect(loreLeftBehind('c1', 9)).toBe(true)                                                          // a person: People not named
        answers.push('nothing here')                                                                       // no number: "none", an answer
        await pickLoreForTurn(card() as never, chat([...scene, { role: 'char', data: 'Gió.' }, { role: 'user', data: 'Tôi chạy.' }]) as never)
        expect(loreLeftBehind('c1', 6)).toBe(true)
        await pickLoreForTurn(card({ loreIndexPick: false }) as never, chat(scene) as never)
        expect(loreLeftBehind('c1', 9)).toBe(false)                                                         // no librarian this turn
    })
})

// ---- the GM asks the librarian (2026-10-20): the shelves and the books wait in the chat, no helper call before the narrator ----------
describe('the librarian asked by the GM', () => {
    let seq = 0
    const player = () => ({ role: 'user', data: `Tôi đi tiếp ${++seq}.` })                                  // each turn its own text: the answers are cached by it
    const msgs = (): (M & { chatId?: string })[] => [...MSGS.slice(0, 3), player()]
    const MSGS: (M & { chatId?: string })[] = [{ role: 'char', data: 'Tên: Mai\nĐược chưa?', chatId: 'r0' }, { role: 'user', data: 'được' }, { role: 'char', data: 'Mưa rơi.\n\n[💡Kế hoạch| Person 1 ]', chatId: 'r1' }, { role: 'user', data: 'Tôi đi tiếp.' }]
    const fwVar = (over = {}) => JSON.stringify([{ at: 'r1', n: 25, shelves: ['People'], books: ['Person 1', 'Person 3'], ...over }])
    beforeEach(() => { asks.length = 0; answers.length = 0; db.loreForward = undefined; db.loreForwardShadow = false; forwardStats.hit = forwardStats.books = forwardStats.miss = 0 })

    it('a waiting answer for the last reply: the shelves and the books are loaded with no helper call at all', async () => {
        await pickLoreForTurn(card() as never, chat(msgs(), { [FORWARD_VAR]: fwVar() }) as never)
        expect(asks).toHaveLength(0)
        expect([8, 10].map((i) => lorePicked('c1', i))).toEqual([true, true])                                // Person 1, Person 3
        expect(lorePicked('c1', 7)).toBe(false)                                                             // Person 0: not named
        expect(loreLeftBehind('c1', 6)).toBe(true)                                                          // Combat adjudication: its shelf was not named
        expect(forwardStats.hit).toBe(1)
    })

    it('the shelves came but the books did not: only the book question is asked, and only over the named shelf', async () => {
        answers.push('2')
        await pickLoreForTurn(card() as never, chat(msgs(), { [FORWARD_VAR]: fwVar({ books: undefined }) }) as never)
        expect(asks).toHaveLength(1)
        expect(asks[0]).toContain('1. Person 0\n2. Person 1')
        expect(asks[0]).not.toContain('SHELVES')
        expect(lorePicked('c1', 8)).toBe(true)
    })

    it('an answer for another reply (a reroll, a newer reply) or another lorebook is not used: the live librarian asks', async () => {
        answers.push('3'); answers.push('1')
        await pickLoreForTurn(card() as never, chat(msgs(), { [FORWARD_VAR]: fwVar({ at: 'r0' }) }) as never)
        expect(asks).toHaveLength(2)
        expect(asks[0]).toContain('SHELVES')
        expect(forwardStats.miss).toBe(1)
        asks.length = 0; answers.push('3'); answers.push('2')
        await pickLoreForTurn(card() as never, chat(msgs(), { [FORWARD_VAR]: fwVar({ n: 99 }) }) as never)
        expect(asks).toHaveLength(2)
    })

    it('a title the player said outright is picked even though the GM did not name it', async () => {
        await pickLoreForTurn(card() as never, chat([...MSGS.slice(0, 3), { role: 'user', data: `Tôi gọi Person 12 lại gần ${++seq}.` }], { [FORWARD_VAR]: fwVar() }) as never)
        expect(asks).toHaveLength(0)
        expect(lorePicked('c1', 19)).toBe(true)                                                             // Person 12
    })

    it('a rerolled reply: the answer kept for the reply before it is still there, so the reroll asks nothing', async () => {
        const kept = JSON.stringify([{ at: 'r1', n: 25, shelves: ['People'], books: ['Person 1'] }, { at: 'r2', n: 25, shelves: ['Rules — fights and injury'], books: [] }])
        await pickLoreForTurn(card() as never, chat(msgs(), { [FORWARD_VAR]: kept }) as never)               // the chat ends at r1 again: r2 was rerolled away
        expect(asks).toHaveLength(0)
        expect(lorePicked('c1', 8)).toBe(true)                                                              // Person 1, from r1's answer
        expect(lorePicked('c1', 6)).toBe(false)                                                             // not r2's shelf
    })

    it('turned off, a waiting answer is left alone', async () => {
        db.loreForward = false
        answers.push('3'); answers.push('1')
        await pickLoreForTurn(card() as never, chat(msgs(), { [FORWARD_VAR]: fwVar() }) as never)
        expect(asks).toHaveLength(2)
    })

    it('the bookkeeper chain still running is waited for, not asked twice', async () => {
        const c = chat(msgs(), {})
        let done!: () => void
        trackForward(c as never, new Promise<void>((r) => { done = () => { c.scriptstate[FORWARD_VAR] = fwVar(); r() } }))
        const picking = pickLoreForTurn(card() as never, c as never)
        await Promise.resolve()
        expect(asks).toHaveLength(0)
        done()
        await picking
        expect(asks).toHaveLength(0)
        expect(lorePicked('c1', 8)).toBe(true)
    })

    it('shadow: the live librarian decides the turn, the waiting answer is only compared with it', async () => {
        db.loreForwardShadow = true
        answers.push('3'); answers.push('1')                                                                // live: People, Person 0
        const c = chat(msgs(), { [FORWARD_VAR]: fwVar() })
        await pickLoreForTurn(card() as never, c as never)
        expect(asks).toHaveLength(2)
        expect(lorePicked('c1', 7)).toBe(true)                                                              // Person 0, the live pick
        const log = JSON.parse(c.scriptstate.$lore_shadow)
        expect(log).toHaveLength(1)
        expect(log[0]).toMatchObject({ fwShelves: ['People'], liveShelves: ['People'], fwBooks: ['Person 1', 'Person 3'], liveBooks: ['Person 0'] })
    })

    it('shadow is the default while the setting was never touched (owner 10-20: live in shadow until the canon judge scores it)', async () => {
        db.loreForwardShadow = undefined
        answers.push('3'); answers.push('1')
        const c = chat(msgs(), { [FORWARD_VAR]: fwVar() })
        await pickLoreForTurn(card() as never, c as never)
        expect(asks).toHaveLength(2)                                                                        // the live librarian still asked
        expect(lorePicked('c1', 7)).toBe(true)
        expect(JSON.parse(c.scriptstate.$lore_shadow)).toHaveLength(1)
    })

    it('the GM is asked for shelves only on a shelved card the index pass runs for, and only while the setting is on', () => {
        expect(forwardAsk(card() as never)?.shelves.map((s) => s.name)).toEqual(['Rules — character creation', 'Rules — fights and injury', 'People'])
        expect(forwardAsk(card({ loreIndexPick: false }) as never)).toBeNull()
        expect(forwardAsk(card({ globalLore: LORE.slice(0, 7).filter((l) => l.mode !== 'folder') }) as never)).toBeNull()      // no shelves
        db.loreForward = false
        expect(forwardAsk(card() as never)).toBeNull()
    })

    it('prefetch: asks the books of the named shelves once, from the story after the reply, and keeps the titles with the answer', async () => {
        const c = chat(MSGS.slice(0, 3), { [FORWARD_VAR]: JSON.stringify([{ at: 'r1', n: 25, shelves: ['People'] }]) })
        answers.push('2, 4')                                                                               // Person 1, Person 3
        await prefetchBooks(card() as never, c as never)
        expect(asks).toHaveLength(1)
        expect(asks[0]).toContain('Kế hoạch| Person 1')
        expect(JSON.parse(c.scriptstate[FORWARD_VAR])[0].books).toEqual(['Person 1', 'Person 3'])
        // a small shelf comes whole: nothing to ask
        asks.length = 0
        c.scriptstate[FORWARD_VAR] = JSON.stringify([{ at: 'r1', n: 25, shelves: ['Rules — fights and injury'] }])
        await prefetchBooks(card() as never, c as never)
        expect(asks).toHaveLength(0)
        // the chat moved on while it asked: the answer is dropped
        c.scriptstate[FORWARD_VAR] = JSON.stringify([{ at: 'r1', n: 25, shelves: ['People'] }])
        c.message.push({ role: 'user', data: 'đi', }, { role: 'char', data: 'Gió.', chatId: 'r2' } as never)
        answers.push('1')
        await prefetchBooks(card() as never, c as never)
        expect(JSON.parse(c.scriptstate[FORWARD_VAR])[0].books).toBeUndefined()
    })
})
