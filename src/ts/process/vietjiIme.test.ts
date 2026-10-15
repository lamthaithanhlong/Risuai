import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { buildSoundIndex, convert, imeSuggestions, isSoundTyping, soundTail } from './vietjiIme'
import { insertText } from './vietjiSuggest'

const words: Record<string, string> = JSON.parse(readFileSync('public/dict/zh-pinyin.json', 'utf8')).words
const t0 = performance.now()
const idx = buildSoundIndex(words)
const buildMs = performance.now() - t0

describe('sound typing, word by word (asked: writing meant searching a phrase and pasting it together)', () => {
    it.each([
        ['ủa pù trư-tào', '我不知道'], ['nỉ hảo', '你好'], ['khoài sàng-lấu', '快上楼'], ['ủa uần', '我问'],
        ['ni hao', '你好'],                                                  // no marks: tones are not compared, the most used wins
    ])('%s → %s', (sound, want) => expect(convert(idx, sound)?.text).toBe(want))
    it('the sound after the characters already chosen is what is converted', () => {
        expect(soundTail('我问 chuỳ')).toEqual({ head: '我问 ', sound: 'chuỳ' })
        expect(soundTail('你好')).toEqual({ head: '你好', sound: '' })
    })
    it('picking the first word turns its syllables into characters and leaves the rest to go on with', () => {
        const chips = imeSuggestions('ủa uần', idx)
        expect(chips[0]).toMatchObject({ text: '我问', source: 'ime' })              // the whole sentence first
        const one = chips.find((c) => c.text === '我')!
        expect(insertText(one, 'zh')).toBe('我 uần')
        const next = imeSuggestions(insertText(one, 'zh'), idx)
        expect(insertText(next.find((c) => c.text === '问')!, 'zh')).toBe('我问')
    })
    it('marks that all match is clearly sound typing; Vietnamese, or no marks, is not claimed', () => {
        expect(isSoundTyping('ủa pù trư-tào', idx)).toBe(true)
        expect(isSoundTyping('ni hao', idx)).toBe(false)
        expect(isSoundTyping('mau lên gác', idx)).toBe(false)
        expect(isSoundTyping('', idx)).toBe(false)
    })
    it('the index is quick to build on the page', () => {
        expect(buildMs).toBeLessThan(1500)
    })
})
