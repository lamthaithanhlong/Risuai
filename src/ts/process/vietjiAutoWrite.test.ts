import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { buildKanaIndex, buildKoreanIndex, buildSoundIndex, commitOnSpace, convert, jaConvert, jaSuggestions } from './vietjiIme'
import { fromVietji } from './vietji'
import { hangulToVietji } from './vietjiLang'

const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'))
const zh = buildSoundIndex(json('public/dict/zh-pinyin.json').words)
const ko = buildKoreanIndex(json('public/dict/ko-words.json').words, Object.values(json('public/dict/vi-ko.json').words as Record<string, string[]>).flat())
const jd = json('public/dict/ja-kanji.json')
const ja = buildKanaIndex(jd.words, jd.kana)

describe('Korean sound typing', () => {
    it.each(['안녕하세요', '감사합니다', '먹다', '마시다', '좋아하다', '사랑해요', '학교', '고양이'])('%s, typed as its Việt-ji, comes back', (w) => {
        expect(convert(ko, hangulToVietji(w)!)?.text).toBe(w)
    })
    it('the spaces the learner typed stay between the Korean words', () => {
        expect(convert(ko, `${hangulToVietji('학교')} ${hangulToVietji('고양이')}`)?.text).toBe('학교 고양이')
        expect(convert(ko, 'hac-kiô')?.text).toBe('학교')                         // a hyphen joins one word's syllables
        expect(convert(ko, 'hac kiô')?.text).toBe('학 교')                        // a space is a word boundary: never crossed
    })
})

describe('Japanese sound typing', () => {
    it.each([
        ['ta-bê-ma-sư', '食べます'],          // ます stays kana (it read as 増す)
        ['phư-ta-tsư', '二つ'], ['đai-giô-ư-bư', '大丈夫'], ['ki-rê-i', '綺麗'], ['xi-ô', '塩'],
        ['i-cư-ra', 'いくら'],                 // a word written in kana stays whole (it gave 行くら)
    ])('%s → %s', (sound, want) => expect(jaConvert(ja, fromVietji(sound)!)).toBe(want))
    it('offers the sentence, the kana, then kanji for the first kana', () => {
        const chips = jaSuggestions('a-kê-tê', ja)
        expect(chips.map((c) => c.text).slice(0, 2)).toEqual(['開けて', 'あけて'])
    })
})

describe('typed right, written at once (at the space)', () => {
    it('a hyphen-joined word becomes its characters', () => {
        expect(commitOnSpace('ủa pù trư-tào ', 'zh', { zh })).toBe('ủa pù 知道')
        expect(commitOnSpace('ta-bê-ma-sư ', 'ja', { ja })).toBe('食べます')
        expect(commitOnSpace(hangulToVietji('감사합니다') + ' ', 'ko', { ko })).toBe('감사합니다 ')
        expect(commitOnSpace('我 trư-tào ', 'zh', { zh })).toBe('我知道')            // no space between Chinese words
    })
    it('the 100 most used Vietnamese words are never eaten, in any of the three languages', () => {
        const vi = json('public/dict/vi-zh.json')
        const vietnamese = new Set(Object.keys(vi.words))
        const common = (vi.order as string[]).filter((w) => !w.includes(' ')).slice(0, 100)
        const eaten = common.flatMap((w) => (['zh', 'ko', 'ja'] as const)
            .filter((l) => commitOnSpace(w + ' ', l, { zh, ko, ja, vietnamese }) !== null).map((l) => `${w}/${l}`))
        expect(eaten).toEqual([])
    })
    it('without the Vietnamese list a one-syllable collision would be eaten: the guard is what stops it', () => {
        expect(commitOnSpace('là ', 'zh', { zh })).not.toBe(null)                 // là = 辣 (fourth tone)
        expect(commitOnSpace('là ', 'zh', { zh, vietnamese: new Set(['là']) })).toBe(null)
    })
    it('nothing happens before the space, or for a word that is not exact', () => {
        expect(commitOnSpace('trư-tào', 'zh', { zh })).toBe(null)
        expect(commitOnSpace('tru-tao ', 'zh', { zh })).toBe(null)                // no marks: not exact
    })
})
