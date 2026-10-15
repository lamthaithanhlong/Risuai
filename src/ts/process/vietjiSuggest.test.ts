import { describe, expect, it } from 'vitest'
import { fromVietji } from './vietji'
import { foldTyping, insertText, looksVietnamese, starterSet, suggest, suggestionPool } from './vietjiSuggest'

const lastReply = 'Haru: 「ふたつ です。」 (Hai đồng.)\n\n[[REPLIES\nふたつ ですか | Hai đồng à?\nいいえ、 だいじょうぶ です | Không, tôi không cần.\n]]'
const vocab = JSON.stringify([{ text: 'しお です。', vietji: 'xi-ô đê-sư', meaning: 'Đây là muối.' }, { text: 'いくら ですか', vietji: 'i-cư-ra đê-sư-ca', meaning: 'Bao nhiêu tiền?' }])

describe('typing is folded the way the learner types', () => {
    it('drops tone marks, hats, hyphens and spaces; đ and dd are d', () => {
        expect(foldTyping('Đa-mê-tê')).toBe('dameté'.normalize('NFD').replace(/[̀-ͯ]/g, ''))
        expect(foldTyping('i-cư-ra đê-sư-ca')).toBe('icuradesuca')
        expect(foldTyping('i cu ra dde su ca')).toBe('icuradesuca')
        expect(foldTyping('nỉ-hảo')).toBe('nihao')
        expect(foldTyping('an-niơng')).toBe('anniong')
    })
})

describe('the suggestion pool', () => {
    const pool = suggestionPool({ lastReply, vocab, lang: 'ja' })
    it('puts the last answers first, then what was heard, then the starter set, without repeats', () => {
        expect(pool.slice(0, 4).map((s) => [s.text, s.source])).toEqual([
            ['ふたつ ですか', 'reply'], ['いいえ、 だいじょうぶ です', 'reply'], ['しお です。', 'heard'], ['いくら ですか', 'heard'],
        ])
        expect(pool.filter((s) => s.text === 'いくら ですか').length).toBe(1)   // also in the starter set, kept once
        expect(pool.every((s) => s.vietji)).toBe(true)
    })
    it('survives a broken vocabulary value', () => {
        expect(suggestionPool({ lastReply: '', vocab: 'not json', lang: 'ja' }).length).toBe(starterSet('ja').length)
    })
})

describe('suggest', () => {
    const pool = suggestionPool({ lastReply, vocab, lang: 'ja' })
    it('nothing typed: the speaker’s suggested answers', () => {
        expect(suggest('', pool).map((s) => s.text)).toEqual(['ふたつ ですか', 'いいえ、 だいじょうぶ です'])
    })
    it('nothing typed: all six answers, each keeping its kind', () => {
        const six = '[[REPLIES\nはい | Vâng | easy\nいいえ | Không | easy\nいくら ですか | Bao nhiêu? | stretch\nもう いちど | Lần nữa | stretch\nください | Cho tôi | workaround\nさようなら | Tạm biệt | workaround\n]]'
        const shown = suggest('', suggestionPool({ lastReply: six, lang: 'ja' }))
        expect(shown).toHaveLength(6)
        expect(shown.map((s) => s.kind)).toEqual(['easy', 'easy', 'stretch', 'stretch', 'workaround', 'workaround'])
    })
    it('matches the sound from the start, typed without marks', () => {
        expect(suggest('i cu', pool)[0].text).toBe('いくら ですか')
        expect(suggest('phu ta', pool)[0].text).toBe('ふたつ ですか')
    })
    it('a match from the start beats one in the middle', () => {
        const s = suggest('su', pool).map((x) => x.text)
        expect(s[0]).toBe('すみません')                       // sư-mi-ma-sên starts with "su"
        expect(s.indexOf('しお です。')).toBeGreaterThan(0)    // xi-ô đê-sư only contains it
    })
    it('finds a phrase by its Vietnamese meaning', () => {
        expect(suggest('bao nhieu', pool).map((s) => s.text)).toContain('いくら ですか')
        expect(suggest('cam on', pool).map((s) => s.text)).toContain('ありがとう')
    })
    it('two letters of meaning are not enough (too many false hits)', () => {
        expect(suggest('ca', pool).every((s) => foldTyping(s.vietji).includes('ca'))).toBe(true)
    })
    it('Korean, Chinese and Spanish starters can be found by sound', () => {
        expect(suggest('an nhong', suggestionPool({ lang: 'ko' }))).toEqual([])
        expect(suggest('an niong', suggestionPool({ lang: 'ko' }))[0].text).toBe('안녕하세요')
        expect(suggest('ni hao', suggestionPool({ lang: 'zh' }))[0].text).toBe('你好[nǐhǎo]')
        expect(suggest('gra', suggestionPool({ lang: 'es' }))[0].text).toBe('Gracias')
        expect(suggest('bong giu', suggestionPool({ lang: 'fr' }))[0].text).toBe('Bonjour')
        expect(suggest('mec', suggestionPool({ lang: 'fr' }))[0].text).toBe('Merci')
    })
})

describe('choosing a suggestion', () => {
    it('Japanese puts the sound in the input, and the request turns it back into the phrase', () => {
        const s = suggest('i cu', suggestionPool({ lastReply, vocab, lang: 'ja' }))[0]
        const typed = insertText(s, 'ja')
        expect(typed).toBe('i cư ra đê sư ca')
        expect(fromVietji(typed)).toBe('いくらですか')
    })
    it('other languages put the phrase itself, without readings', () => {
        const s = suggest('ni hao', suggestionPool({ lang: 'zh' }))[0]
        expect(insertText(s, 'zh')).toBe('你好')
    })
})

describe('typed in Vietnamese: looked up by meaning', () => {
    it('marks or đ mean Vietnamese; plain letters stay sound typing', () => {
        expect(looksVietnamese('có')).toBe(true)
        expect(looksVietnamese('đi')).toBe(true)
        expect(looksVietnamese('bao nhiêu')).toBe(true)
        expect(looksVietnamese('co')).toBe(false)
        expect(looksVietnamese('oa ca ri')).toBe(false)
    })
    const fr = suggestionPool({ lang: 'fr' })
    it('finds the phrase by what it means, not by its sound', () => {
        expect(suggest('bao nhiêu', fr).map((s) => s.text)).toEqual(['Combien ça coûte ?'])
        expect(suggest('không hiểu', fr).map((s) => s.text)).toEqual(['Je ne comprends pas'])
        expect(suggest('tạm bi', fr).map((s) => s.text)).toEqual(['Au revoir'])           // the last word may be cut short
    })
    it('"có" is not "cô": the same word with other marks does not count as exact', () => {
        // "có" folds to "co", the sound of "Combien" starts with "cô": sound typing would offer it, meaning lookup does not
        expect(suggest('có', fr)).toEqual([])
        expect(suggest('co', fr)[0].text).toBe('Combien ça coûte ?')
    })
    it('what the model was asked comes first', () => {
        const asked = [{ text: '«Oui»', vietji: 'uy', meaning: 'Có', kind: 'easy' as const }]
        const s = suggest('có', suggestionPool({ lang: 'fr', asked }))
        expect(s[0]).toMatchObject({ text: '«Oui»', source: 'asked', kind: 'easy' })
    })
})
