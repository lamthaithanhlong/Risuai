// Sound typing that builds the sentence word by word (an input method, for Chinese): the learner types the Việt-ji of each
// word ("ủa uần chuỳ") and picks the characters. Asked for: writing meant searching a whole phrase and pasting it together.
//
// Every word of the pinyin list (public/dict/zh-pinyin.json, most used first) is read into Việt-ji and indexed by its
// syllables without marks. The typed sound at the end of the input (after the characters already chosen) is cut into words
// so that the most syllables match their tone mark as typed (ủa = third tone = 我, uần = fourth = 问), then the fewest
// words, then the most used ones. The bar shows that whole sentence first, then the words the first syllables could be;
// picking one turns those syllables into characters and leaves the rest of the sound to go on with.

import { pinyinToVietji } from './vietjiLang'
import type { Suggestion } from './vietjiSuggest'

type Entry = { word: string; pinyin: string; vietji: string[]; rank: number }
export type SoundIndex = Map<string, Entry[]>

const MAX_SYLLABLES = 4

/** A syllable without its marks: "chuỳ" → "chuy", "đổi" → "doi". */
export function foldSyllable(s: string): string {
    return (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/[^a-z]/g, '')
}
const exact = (s: string) => (s ?? '').normalize('NFC').toLowerCase()
// a tone mark (huyền sắc ngã hỏi nặng), not a vowel's hat or horn: typed without any, the tones are not compared at all
// ("ni hao" gave 妮蒿, because no mark read as the level tone of 妮 nī)
const TONE = /[\u0300\u0301\u0303\u0309\u0323]/
const hasTones = (typed: string[]) => typed.some((t) => TONE.test(t.normalize('NFD')))

/** Indexes a word → pinyin list (in its order, most used first) by the folded Việt-ji of each word. */
export function buildSoundIndex(words: Record<string, string>): SoundIndex {
    const idx: SoundIndex = new Map()
    let rank = 0
    for (const [word, pinyin] of Object.entries(words)) {
        rank++
        const vj = pinyinToVietji(pinyin)
        if (!vj) continue
        const vietji = vj.split(/[-\s]+/).filter(Boolean)
        if (vietji.length === 0 || vietji.length > MAX_SYLLABLES) continue
        const key = vietji.map(foldSyllable).join(' ')
        if (!idx.has(key)) idx.set(key, [])
        idx.get(key)!.push({ word, pinyin, vietji, rank })
    }
    return idx
}

/** The input split into what is already written and the sound being typed at its end ("我问 chuỳ" → "我问 ", "chuỳ"). */
export function soundTail(input: string): { head: string; sound: string } {
    const m = /[\p{Script=Latin}\s-]*$/u.exec(input ?? '')
    const tail = m ? m[0] : ''
    const lead = /^[\s-]*/.exec(tail)![0]
    return { head: (input ?? '').slice(0, (input ?? '').length - tail.length) + lead, sound: tail.slice(lead.length) }
}

type Pick = { entry: Entry; tones: number }

function ranked(idx: SoundIndex, typed: string[], folded: string[], i: number, n: number): Pick[] {
    const list = idx.get(folded.slice(i, i + n).join(' '))
    if (!list) return []
    const tones = hasTones(typed)
    return list.map((entry) => ({ entry, tones: tones ? entry.vietji.reduce((t, v, k) => t + (exact(v) === exact(typed[i + k]) ? 1 : 0), 0) : 0 }))
        .sort((a, b) => b.tones - a.tones || a.entry.rank - b.entry.rank)
}

type Plan = { tones: number; parts: number; rank: number; words: (Entry | string)[] }
const better = (a: Plan, b: Plan) => a.tones !== b.tones ? a.tones > b.tones : a.parts !== b.parts ? a.parts < b.parts : a.rank < b.rank

/** The whole typed sound as words: most tones matched, then fewest words, then the most used; unknown syllables stay sound. */
export function convert(idx: SoundIndex, sound: string): { text: string; tones: number; syllables: number; known: boolean } | null {
    const typed = sound.split(/[\s-]+/).filter(Boolean)
    if (!typed.length) return null
    const folded = typed.map(foldSyllable)
    const best: (Plan | null)[] = Array(typed.length + 1).fill(null)
    best[0] = { tones: 0, parts: 0, rank: 0, words: [] }
    for (let i = 0; i < typed.length; i++) {
        const from = best[i]
        if (!from) continue
        let any = false
        for (let n = 1; n <= Math.min(MAX_SYLLABLES, typed.length - i); n++) {
            const top = ranked(idx, typed, folded, i, n)[0]
            if (!top) continue
            any = true
            const cand: Plan = { tones: from.tones + top.tones, parts: from.parts + 1, rank: from.rank + top.entry.rank, words: [...from.words, top.entry] }
            if (!best[i + n] || better(cand, best[i + n]!)) best[i + n] = cand
        }
        if (!any) {                                              // a syllable no word sounds like: kept as typed
            const cand: Plan = { tones: from.tones, parts: from.parts + 1, rank: from.rank + 1e6, words: [...from.words, typed[i]] }
            if (!best[i + 1] || better(cand, best[i + 1]!)) best[i + 1] = cand
        }
    }
    const end = best[typed.length]!
    const known = end.words.every((w) => typeof w !== 'string')
    return { text: end.words.map((w) => (typeof w === 'string' ? w : w.word)).join(''), tones: end.tones, syllables: typed.length, known }
}

/**
 * The bar's chips for the sound at the end of the input: the whole sentence, then the words its first syllables could be.
 * Each chip's `replace` is the new input. meaningOf gives a word's Vietnamese meaning when the word lists know it.
 */
export function imeSuggestions(input: string, idx: SoundIndex | null, meaningOf: (word: string) => string = () => '', max = 6): Suggestion[] {
    if (!idx) return []
    const tail = soundTail(input)
    const sound = tail.sound
    // Chinese has no spaces between words: the space before the sound goes when what comes before it is a character
    const head = /[\u3400-\u9fff]\s+$/.test(tail.head) ? tail.head.trimEnd() : tail.head
    const typed = sound.split(/[\s-]+/).filter(Boolean)
    if (!typed.length) return []
    const folded = typed.map(foldSyllable)
    const out: Suggestion[] = []
    const seen = new Set<string>()
    const chip = (word: string, vietji: string, replace: string, meaning: string) => {
        if (seen.has(replace)) return
        seen.add(replace)
        out.push({ text: word, vietji, meaning, source: 'ime', replace })
    }
    const whole = convert(idx, sound)
    if (whole && typed.length > 1 && whole.known) chip(whole.text, typed.join(' '), head + whole.text, `${typed.join(' ')} · cả câu`)
    for (let n = Math.min(MAX_SYLLABLES, typed.length); n >= 1 && out.length < max; n--) {
        for (const p of ranked(idx, typed, folded, 0, n).slice(0, 3)) {
            const rest = typed.slice(n).join(' ')
            chip(p.entry.word, p.entry.vietji.join('-'), head + p.entry.word + (rest ? ' ' + rest : ''), meaningOf(p.entry.word))
            if (out.length >= max) break
        }
    }
    return out.slice(0, max)
}

/** True when the sound at the end of the input reads fully as words with every tone as typed: sound typing, not Vietnamese. */
export function isSoundTyping(input: string, idx: SoundIndex | null): boolean {
    if (!idx) return false
    const { sound } = soundTail(input)
    const c = convert(idx, sound)
    return !!c && c.known && c.tones === c.syllables && c.syllables > 0
}
