import { describe, expect, it, vi } from 'vitest'

// The lorebook pass reads the chat of the reply being written, not whatever is selected when it runs. Owner, iPhone, 2026-10-20: the
// turn died in the lorebook pass (database.svelte dP: "t.chatPage" of undefined) after the selection changed while it ran (the player
// left the chat, switched apps, the page reloaded: selectedCharID -1).
const db = { characters: [] as unknown[], loreBookDepth: 5, loreBookToken: 8000, username: 'Kenji', learningMode: false }
vi.mock('../stores.svelte', () => ({ DBState: { db }, selectedCharID: { subscribe: (run: (v: number) => void) => (run(-1), () => undefined) } }))
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

const card = (key: string, page: number) => ({ chaId: 'c1', name: 'Mailman', chatPage: page, loreSettings: { tokenBudget: 8000, scanDepth: 12 },
    globalLore: [{ comment: 'Post office', content: 'The post office rules.', key, insertorder: 100, mode: 'normal' }],
    chats: [{ message: [{ role: 'user', data: 'Tôi đến bưu điện.' }], localLore: [] }, { message: [{ role: 'user', data: 'Không có gì.' }], localLore: [] }] })

describe('the lorebook pass follows the reply\'s chat', () => {
    it('reads the chat it was given while nothing is selected (the player left the chat)', async () => {
        db.characters = [card('bưu điện', 0)]
        const { actives } = await loadLoreBookV3Prompt({ char: 0, page: 0 })
        expect(actives.map((a) => a.source)).toEqual(['Post office'])
    })
    it('reads the reply\'s chat, not the one the player opened since', async () => {
        db.characters = [card('bưu điện', 1)]                // the player switched to chat 1 while the reply for chat 0 is written
        const { actives } = await loadLoreBookV3Prompt({ char: 0, page: 0 })
        expect(actives.map((a) => a.source)).toEqual(['Post office'])
    })
    it('without a target and nothing selected it says so, instead of a TypeError deep in the pass', async () => {
        db.characters = [card('bưu điện', 0)]
        await expect(loadLoreBookV3Prompt()).rejects.toThrow('no longer loaded')
    })
})
