import { describe, expect, it, vi } from 'vitest'

// The lorebook pass's order, for the prompt cache (loreIndex.ts cacheOrder): asked 2026-10-20, "token tiết kiệm hơn mà vẫn tốt".
const db = { characters: [] as unknown[], loreBookDepth: 5, loreBookToken: 8000, username: 'Kenji', learningMode: false }
vi.mock('../stores.svelte', () => ({ DBState: { db }, selectedCharID: { subscribe: (run: (v: number) => void) => (run(0), () => undefined) } }))
vi.mock('../tokenizer', () => ({ tokenize: async (s: string) => Math.ceil(s.length / 4) }))
vi.mock('../parser/parser.svelte', () => ({ risuChatParser: (s: string) => s }))
vi.mock('../parser/chatVar.svelte', () => ({ getChatVar: () => '', setChatVar: () => undefined }))
vi.mock('./modules', () => ({ getModuleLorebooks: () => [] }))
vi.mock('../util', () => ({ findCharacterbyId: () => null, pickHashRand: () => 1, selectSingleFile: vi.fn() }))
vi.mock('../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../lang', () => ({ language: {} }))
vi.mock('../globalApi.svelte', () => ({ downloadFile: vi.fn(), saveAsset: vi.fn() }))
vi.mock('../storage/database.svelte', () => ({}))

const { loadLoreBookV3Prompt } = await import('./lorebook.svelte')
const { setLorePicks, clearLorePicks } = await import('./loreIndex')

const rule = (comment: string, order: number, content = `${comment} rules.`) => ({ comment, content, alwaysActive: true, insertorder: order, key: '', mode: 'normal' })
const book = (comment: string, order: number, key: string) => ({ comment, content: `${comment} canon.`, key, insertorder: order, mode: 'normal', folder: 'folder:people' })
const LORE = [
    { comment: 'People', content: '', key: 'folder:people', mode: 'folder', insertorder: 100 },
    rule('Module 01 — Random Fate Engine', 9100),
    rule('Module 07 — Status Panel', 9700, 'Name: {{getvar::st_name}}'),
    rule('Module 10 — Fate Dice', 9800, '* Event: {{random::NEW,quiet}}.'),
    rule('Lore reconciliation rule', 9900),
    book('Audrey Hall', 140, 'audrey'),
    book('Backlund', 120, 'backlund'),
]
const card = (lore: unknown[]) => ({ chaId: 'c1', name: 'LotM', globalLore: lore, chatPage: 0, loreSettings: { tokenBudget: 8000, scanDepth: 12 },
    chats: [{ message: [{ role: 'char', data: 'Fog.' }, { role: 'user', data: 'Tôi đến Backlund gặp Audrey.' }], localLore: [], fmIndex: -1 }] })

describe('the lorebook pass, in the order a cache can reuse', () => {
    it('a shelved card: the fixed rules, the books by insert order, and the rules that change every reply after the chat, before the player\'s message', async () => {
        db.characters = [card(LORE)]
        const { actives } = await loadLoreBookV3Prompt()
        const slot = actives.filter((a) => a.pos === '').map((a) => a.source)
        expect(slot).toEqual(['Module 01 — Random Fate Engine', 'Lore reconciliation rule', 'Backlund', 'Audrey Hall'])
        const after = actives.filter((a) => a.pos === 'reverse_depth' && a.depth === 1).map((a) => a.source)          // before the player's message
        // the books go in a message of their own after the system prompt (index.svelte.ts sceneLoreMessage), the rules stay in it
        expect(actives.filter((a) => a.scene).map((a) => a.source)).toEqual(['Backlund', 'Audrey Hall'])
        expect(after).toEqual(['Module 07 — Status Panel', 'Module 10 — Fate Dice'])
    })
    it('a card with no shelves keeps Risu\'s own order: insert order, the changing rules where they were', async () => {
        db.characters = [card(LORE.filter((l) => l.mode !== 'folder').map((l) => ({ ...l, folder: undefined })))]
        const { actives } = await loadLoreBookV3Prompt()
        expect(actives.some((a) => a.scene)).toBe(false)
        expect(actives.map((a) => [a.source, a.pos])).toEqual([['Backlund', ''], ['Audrey Hall', ''], ['Module 01 — Random Fate Engine', ''],
            ['Module 07 — Status Panel', ''], ['Module 10 — Fate Dice', ''], ['Lore reconciliation rule', '']])
    })
    it('a tight budget: the helper\'s pick, then the key word just said, before one said long ago, whatever the insert order', async () => {
        const big = (comment: string, order: number, key: string) => ({ ...book(comment, order, key), content: `${comment} canon. `.repeat(100) })
        const lore = [LORE[0], rule('Module 01 — Random Fate Engine', 9100), big('Old Tower', 9000, 'tower'), big('Backlund', 120, 'backlund'),
            big('Audrey Hall', 110, 'nobody-says-this'), big('Spare', 101, 'spare')]
        const c = card(lore)
        c.loreSettings.tokenBudget = 1000
        c.chats[0].message = [{ role: 'user', data: 'Tôi trèo lên tower.' }, { role: 'char', data: 'Gió.' }, { role: 'user', data: 'spare' }, { role: 'char', data: 'Mưa.' },
            { role: 'user', data: 'Tôi đến Backlund.' }]
        db.characters = [c]
        setLorePicks('c1', new Set([4]))
        const { actives } = await loadLoreBookV3Prompt()
        clearLorePicks()
        expect(actives.map((a) => a.source)).toEqual(['Module 01 — Random Fate Engine', 'Audrey Hall', 'Backlund'])                // was: Old Tower, Backlund
    })
    it('a key word said long ago no longer loads a book the librarian left behind; one said just now still does', async () => {
        const c = card(LORE)
        c.chats[0].message = [{ role: 'user', data: 'Tôi gặp Audrey.' }, { role: 'char', data: 'Gió.' }, { role: 'user', data: 'Tôi đi.' }, { role: 'char', data: 'Mưa.' },
            { role: 'user', data: 'Tôi đến Backlund.' }]
        db.characters = [c]
        setLorePicks('c1', new Set(), new Set(), new Set())                                                // the librarian named no shelf
        const { actives } = await loadLoreBookV3Prompt()
        clearLorePicks()
        expect(actives.filter((a) => a.pos === '').map((a) => a.source)).toEqual(['Module 01 — Random Fate Engine', 'Lore reconciliation rule', 'Backlund'])
        const { actives: plain } = await loadLoreBookV3Prompt()                                             // no librarian: as before
        expect(plain.map((a) => a.source)).toContain('Audrey Hall')
    })
    it('the creation shelf on a creation turn stays in the system prompt with the rules, not with the scene\'s books', async () => {
        db.characters = [card(LORE)]
        setLorePicks('c1', new Set(), new Set([5]))                                                        // Audrey Hall forced, as the creation shelf is
        const { actives } = await loadLoreBookV3Prompt()
        clearLorePicks()
        expect(actives.filter((a) => a.scene).map((a) => a.source)).toEqual(['Backlund'])
        expect(actives.find((a) => a.source === 'Audrey Hall')?.scene).toBe(false)
    })
})
