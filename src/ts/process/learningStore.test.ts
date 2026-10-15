import { describe, expect, it } from 'vitest'
import { migrateChat, readNotebook, writeNotebook } from './learningStore'
import { errorRate, flagged, soundDistance, soundOf } from './learningMemory'

const ikura = { text: 'いくら ですか', vietji: 'i-cư-ra đê-sư-ca', meaning: 'Bao nhiêu tiền?' }
const hai = { text: 'はい', vietji: 'ha-i', meaning: 'Vâng' }

describe('the language notebook', () => {
    it('a chat’s older notebook is merged once; the more practised copy of a phrase wins; mistakes add up', () => {
        const db: any = {}
        writeNotebook(db, 'ja', { vocab: [{ ...ikura, ok: 1 }], mistakes: [{ wrong: 'a', right: 'b', why: '', count: 1, last: 1 }], history: [true] })
        const chat: any = { scriptstate: {
            $vj_vocab: JSON.stringify([{ ...ikura, ok: 5, bad: 1 }, { kana: 'はい', vietji: 'ha-i', meaning: 'Vâng' }]),
            $vj_mistakes: JSON.stringify([{ wrong: 'a', right: 'b', why: '', count: 2, last: 9 }]),
            $vj_history: JSON.stringify([false]),
        } }
        expect(migrateChat(db, 'ja', chat)).toBe(true)
        const nb = readNotebook(db, 'ja')
        expect(nb.vocab.find((v) => v.text === 'いくら ですか')).toMatchObject({ ok: 5, bad: 1 })
        expect(nb.vocab.map((v) => v.text)).toContain('はい')
        expect(nb.mistakes).toEqual([{ wrong: 'a', right: 'b', why: '', count: 3, last: 9 }])
        expect(nb.history).toEqual([true, false])
        expect(migrateChat(db, 'ja', chat)).toBe(false)                    // once only
        expect(readNotebook(db, 'ja').mistakes[0].count).toBe(3)
    })
    it('languages keep separate notebooks', () => {
        const db: any = {}
        writeNotebook(db, 'ja', { vocab: [hai], mistakes: [], history: [] })
        expect(readNotebook(db, 'ko').vocab).toEqual([])
    })
})

describe('how wrong, and what is easy to confuse', () => {
    it('error rate is the share of wrong answers', () => {
        expect(errorRate({ ...hai })).toBe(0)
        expect(errorRate({ ...hai, ok: 3, bad: 1 })).toBe(0.25)
    })
    it('sound distance is an edit distance that gives up early', () => {
        expect(soundDistance('icuradesuca', 'icuradesu')).toBe(2)
        expect(soundDistance('hai', 'hai')).toBe(0)
        expect(soundDistance('a', 'abcdefghij', 3)).toBe(4)
    })
    it('a mistake written in kana is compared by its sound', () => {
        expect(soundOf('いくら です')).toBe('icuradesu')
        expect(soundOf('i cu ra')).toBe('icura')
    })
    it('flags phrases often wrong, and phrases close in sound to a mistake; heaviest first', () => {
        const kirei = { text: 'きれい', vietji: 'ki-rê-i', meaning: 'Đẹp' }
        const vocab = [{ ...ikura, ok: 1 }, { ...hai, ok: 1, bad: 2 }, kirei]
        const mistakes = [{ wrong: 'いくら です', right: 'いくら ですか', why: 'thiếu か', count: 2, last: 1 }]
        const f = flagged(vocab, mistakes)
        expect(f.map((x) => x.text)).toEqual(['はい', 'いくら ですか'])
        expect(f[1].confusedWith).toEqual(['いくら です'])
        expect(f.find((x) => x.text === 'きれい')).toBeUndefined()      // neither wrong nor close to a mistake
    })
})
