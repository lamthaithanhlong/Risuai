import { beforeEach, describe, expect, it, vi } from 'vitest'

// asked 2026-10-20: the lore works like a librarian (index → shelf → book), the creation turns' rules are never dropped
const db = { loreBookToken: 4000, characters: [] as unknown[] }
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => db }))
const asks: string[] = []
const answers: string[] = []
vi.mock('./request/request', () => ({
    requestChatData: async (arg: { formated: { content: string }[] }) => { asks.push(arg.formated[0].content); return { type: 'success', result: answers.shift() ?? 'none' } },
}))

const { pickLoreForTurn, creationTurn } = await import('./loreIndexPage')
const { lorePicked, loreForced } = await import('./loreIndex')

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
})
