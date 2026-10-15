import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { buildKanaIndex, buildKoreanIndex, buildSoundIndex, commitOnSpace, convert, imeSuggestions, jaConvert, jaSuggestions } from './vietjiIme'
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
    it('without the Vietnamese list some one-syllable collisions would be eaten: the guard is what stops them', () => {
        const vi = json('public/dict/vi-zh.json')
        const common = (vi.order as string[]).filter((w) => !w.includes(' ')).slice(0, 300)
        const wouldEat = common.filter((w) => commitOnSpace(w + ' ', 'zh', { zh }) !== null)
        expect(wouldEat.length).toBeGreaterThan(0)                                 // e.g. dùng → 用 (fourth tone, the usual word)
        expect(wouldEat.filter((w) => commitOnSpace(w + ' ', 'zh', { zh, vietnamese: new Set(Object.keys(vi.words)) }) !== null)).toEqual([])
    })
    it('nothing happens before the space, or for a word that is not exact', () => {
        expect(commitOnSpace('trư-tào', 'zh', { zh })).toBe(null)
        expect(commitOnSpace('tru-tao ', 'zh', { zh })).toBe(null)                // no marks: not exact
    })
})

describe('reported: "cô nên bình tĩnh lại đi" came out 逆该冷静lại', () => {
    it('a tone off is not written at once: "nì" (逆) is not the usual word for that sound (你 nǐ), so the chips offer both', () => {
        expect(commitOnSpace('nì ', 'zh', { zh })).toBe(null)
        expect(commitOnSpace('nỉ ', 'zh', { zh })).toBe('你')
        const chips = imeSuggestions('nì', zh).map((c) => c.text)
        expect(chips).toContain('逆')
        expect(chips).toContain('你')
    })
})

describe('reported: typing "hết sức" in Korean gave 매우 아주 지극히 and then 했 숙, 햇, 헷', () => {
    it('Vietnamese the list fully knows gets no sound chips; Korean sound typed still does', async () => {
        const { dictSuggestions, needsModel } = await import('./vietjiDict')
        const { mixChips } = await import('./vietjiSuggest')
        const vi = json('public/dict/vi-ko.json')
        const dict = { words: vi.words, unsure: new Set<string>(vi.unsure ?? []), order: vi.order ?? [] } as any
        const chipsFor = (typed: string) => {
            const rest = dictSuggestions(typed, dict.words, 'ko')
            const ime = imeSuggestions(typed, ko)
            expect(ime.length).toBeGreaterThan(0)                                // the letters do read as Korean sounds
            return mixChips(rest, ime, [], { soundTyping: false, listSure: rest.length > 0 && !needsModel(typed, dict) }).map((c) => c.text)
        }
        const words = chipsFor('hết sức')
        expect(words).toContain('매우')
        expect(words.some((w) => ['했 숙', '햇', '헷', '했'].includes(w))).toBe(false)
        expect(mixChips([], imeSuggestions('an-niơng', ko), [], { soundTyping: true, listSure: false }).length).toBeGreaterThan(0)
    })
})
