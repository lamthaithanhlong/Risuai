import { describe, expect, it } from 'vitest'
import { dictSuggestions, loadWordList, segment, type WordList } from './vietjiDict'
import { suggest, suggestionPool } from './vietjiSuggest'

const words: WordList = {
    'có': ['avoir', 'il y a', 'oui'], 'tôi': ['je', 'moi'], 'đói': ['avoir faim'], 'muốn': ['vouloir'], 'uống': ['boire'],
    'nước': ['eau'], 'bao nhiêu': ['combien'], 'bao': ['sac'], 'nhiêu': ['beaucoup'],
}

describe('the offline word list', () => {
    it('cuts the typed Vietnamese into the longest known words', () => {
        expect(segment('bao nhiêu', words).map((p) => p.vi)).toEqual(['bao nhiêu'])
        expect(segment('Tôi muốn uống nước!', words).map((p) => p.vi)).toEqual(['tôi', 'muốn', 'uống', 'nước'])
        expect(segment('tôi xyz đói', words).map((p) => p.vi)).toEqual(['tôi', 'đói'])   // an unknown syllable is skipped
    })
    it('one word: each meaning, Vietnamese on top and a reading', () => {
        const s = dictSuggestions('có', words, 'fr')
        expect(s.map((x) => x.text)).toEqual(['avoir', 'il y a', 'oui'])
        expect(s.every((x) => x.meaning === 'có' && x.source === 'dict' && x.vietji)).toBe(true)
        expect(s[2].vietji).toBe('uy')
    })
    it('several words: the words in order, then each alone', () => {
        const s = dictSuggestions('tôi đói', words, 'fr')
        expect(s[0]).toMatchObject({ text: 'je avoir faim', meaning: 'tôi đói · từng chữ' })
        expect(s.slice(1).map((x) => x.text)).toEqual(['je', 'avoir faim'])
    })
    it('no list (another language, or not loaded): nothing', () => {
        expect(dictSuggestions('có', null, 'ja')).toEqual([])
    })
    it('the bar shows the list first when Vietnamese is typed', () => {
        const pool = suggestionPool({ lang: 'fr', dict: dictSuggestions('có', words, 'fr') })
        expect(suggest('có', pool).map((x) => x.text)).toEqual(['avoir', 'il y a', 'oui'])
    })
    it('a word the list does not know does not hide what it does know', () => {
        const pool = suggestionPool({ lang: 'fr', dict: dictSuggestions('tôi rất đói', words, 'fr') })
        expect(suggest('tôi rất đói', pool)[0].text).toBe('je avoir faim')
    })
    it('is fetched once, only for a language that has one, and a failed fetch is tried again', async () => {
        const calls: string[] = []
        let ok = false
        const f = (async (url: string) => { calls.push(url); return ok ? { ok: true, json: async () => ({ words }) } : Promise.reject(new Error('offline')) }) as any
        expect(await loadWordList('ja', f)).toBe(null)
        expect(await loadWordList('fr', f)).toBe(null)
        ok = true
        expect((await loadWordList('fr', f))?.['có']).toEqual(['avoir', 'il y a', 'oui'])
        await loadWordList('fr', f)
        expect(calls).toEqual(['/dict/vi-fr.json', '/dict/vi-fr.json'])
    })
})

describe('the built French list (public/dict/vi-fr.json)', async () => {
    const { readFileSync } = await import('fs')
    const real: WordList = JSON.parse(readFileSync('public/dict/vi-fr.json', 'utf8')).words
    it.each([
        ['có', 'avoir'], ['tôi', 'je'], ['không', 'non'], ['bao nhiêu', 'combien'], ['cảm ơn', 'merci'], ['đói', 'avoir faim'],
        ['uống', 'boire'], ['nước', 'eau'], ['ở đâu', 'où'], ['xin chào', 'bonjour'],
    ])('%s → %s first', (vi, fr) => expect(real[vi]?.[0]).toBe(fr))
    it('stays small enough to load on a phone', () => {
        expect(readFileSync('public/dict/vi-fr.json').length).toBeLessThan(800_000)
    })
})
