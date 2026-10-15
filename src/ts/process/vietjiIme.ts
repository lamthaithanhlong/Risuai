// Sound typing that builds the sentence word by word (an input method, for Chinese): the learner types the Việt-ji of each
// word ("ủa uần chuỳ") and picks the characters. Asked for: writing meant searching a whole phrase and pasting it together.
//
// Every word of the pinyin list (public/dict/zh-pinyin.json, most used first) is read into Việt-ji and indexed by its
// syllables without marks. The typed sound at the end of the input (after the characters already chosen) is cut into words
// so that the most syllables match their tone mark as typed (ủa = third tone = 我, uần = fourth = 问), then the fewest
// words, then the most used ones. The bar shows that whole sentence first, then the words the first syllables could be;
// picking one turns those syllables into characters and leaves the rest of the sound to go on with.

import { hangulToVietji, pinyinToVietji } from './vietjiLang'
import { fromVietji } from './vietji'
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

/** 'tones': Chinese, the typed tone marks are compared (when there are any); 'exact': Korean, the whole syllable is. */
export type Compare = 'tones' | 'exact'
const indexMode = new WeakMap<SoundIndex, Compare>()

function ranked(idx: SoundIndex, typed: string[], folded: string[], i: number, n: number): Pick[] {
    const list = idx.get(folded.slice(i, i + n).join(' '))
    if (!list) return []
    const tones = indexMode.get(idx) === 'exact' || hasTones(typed)
    return list.map((entry) => ({ entry, tones: tones ? entry.vietji.reduce((t, v, k) => t + (exact(v) === exact(typed[i + k]) ? 1 : 0), 0) : 0 }))
        .sort((a, b) => b.tones - a.tones || a.entry.rank - b.entry.rank)
}

type Plan = { tones: number; parts: number; rank: number; words: (Entry | string)[] }
const better = (a: Plan, b: Plan) => a.tones !== b.tones ? a.tones > b.tones : a.parts !== b.parts ? a.parts < b.parts : a.rank < b.rank

/** The whole typed sound as words: most tones matched, then fewest words, then the most used; unknown syllables stay sound. */
export function convert(idx: SoundIndex, sound: string): { text: string; tones: number; syllables: number; known: boolean } | null {
    const typed = sound.split(/[\s-]+/).filter(Boolean)
    if (!typed.length) return null
    // which syllables start a new typed word (a space before them): Korean keeps that space between its words
    const spaced: boolean[] = []
    { let k = 0; for (const m of sound.trim().matchAll(/([\s-]*)([^\s-]+)/g)) { spaced[k++] = /\s/.test(m[1]) } }
    const keepSpaces = indexMode.get(idx) === 'exact'
    const folded = typed.map(foldSyllable)
    const best: (Plan | null)[] = Array(typed.length + 1).fill(null)
    const starts: number[][] = Array(typed.length + 1).fill(null).map(() => [])
    best[0] = { tones: 0, parts: 0, rank: 0, words: [] }
    for (let i = 0; i < typed.length; i++) {
        const from = best[i]
        if (!from) continue
        let any = false
        for (let n = 1; n <= Math.min(MAX_SYLLABLES, typed.length - i); n++) {
            const top = ranked(idx, typed, folded, i, n)[0]
            if (!top) continue
            any = true
            // a Korean word never runs across a space the learner typed
            if (keepSpaces && spaced.slice(i + 1, i + n).some(Boolean)) continue
            const cand: Plan = { tones: from.tones + top.tones, parts: from.parts + 1, rank: from.rank + top.entry.rank, words: [...from.words, top.entry] }
            if (!best[i + n] || better(cand, best[i + n]!)) { best[i + n] = cand; starts[i + n] = [...starts[i], i] }
        }
        if (!any) {                                              // a syllable no word sounds like: kept as typed
            const cand: Plan = { tones: from.tones, parts: from.parts + 1, rank: from.rank + 1e6, words: [...from.words, typed[i]] }
            if (!best[i + 1] || better(cand, best[i + 1]!)) { best[i + 1] = cand; starts[i + 1] = [...starts[i], i] }
        }
    }
    const end = best[typed.length]!
    const at = starts[typed.length]
    const known = end.words.every((w) => typeof w !== 'string')
    const text = end.words.map((w, k) => (keepSpaces && k > 0 && spaced[at[k]] ? ' ' : '') + (typeof w === 'string' ? w : w.word)).join('')
    return { text, tones: end.tones, syllables: typed.length, known }
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
    const head = /[\u3400-\u9fff]\s+$/.test(tail.head) && indexMode.get(idx) !== 'exact' ? tail.head.trimEnd() : tail.head
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

// ---- Korean -------------------------------------------------------------------------------------------------------------------

/**
 * Korean words (most used first, public/dict/ko-words.json) read with the chat's own reader (hangulToVietji, the spoken form),
 * then every syllable of them alone, so a word missing from the list can still be put together syllable by syllable.
 */
export function buildKoreanIndex(words: string[], more: string[] = []): SoundIndex {
    const idx: SoundIndex = new Map()
    indexMode.set(idx, 'exact')
    let rank = 0
    const add = (word: string) => {
        rank++
        const vj = hangulToVietji(word)
        if (!vj) return
        const vietji = vj.split(/[-\s]+/).filter(Boolean)
        if (!vietji.length || vietji.length > MAX_SYLLABLES) return
        const key = vietji.map(foldSyllable).join(' ')
        if (!idx.has(key)) idx.set(key, [])
        const list = idx.get(key)!
        if (!list.some((e) => e.word === word)) list.push({ word, pinyin: '', vietji, rank })
    }
    for (const w of [...words, ...more]) add(w)
    const syllables = new Set<string>()
    for (const w of [...words, ...more]) for (const c of w) if (/[가-힣]/.test(c)) syllables.add(c)
    for (const c of syllables) add(c)
    return idx
}

// ---- Japanese -----------------------------------------------------------------------------------------------------------------

type KanaEntry = { word: string; rank: number }
export type KanaIndex = Map<string, KanaEntry[]>

/** reading (hiragana) → the kanji spellings with it, most used first (public/dict/ja-kanji.json, in its order). */
export function buildKanaIndex(words: Record<string, string>, kanaWords: string[] = []): KanaIndex {
    const idx: KanaIndex = new Map()
    let rank = 0
    for (const [word, reading] of Object.entries(words)) {
        rank++
        if (!idx.has(reading)) idx.set(reading, [])
        idx.get(reading)!.push({ word, rank })
    }
    // words written in kana (いくら, こと): known words too, kept whole and in kana
    for (const w of kanaWords) {
        rank++
        if (!idx.has(w)) idx.set(w, [])
        idx.get(w)!.unshift({ word: w, rank })
    }
    return idx
}

const MIN_KANJI_READING = 2       // は, を, で stay kana: a one-kana reading (葉, 出) is offered as a chip, never chosen alone
// endings and particles that stay kana however a kanji word reads (食べます gave 食べ増す: ます read as 増す)
const STAY_KANA = new Set(['ます', 'です', 'ました', 'でした', 'ません', 'ない', 'たい', 'ください', 'から', 'まで', 'ので', 'のに',
    'だけ', 'など', 'より', 'ながら', 'けど', 'でも', 'たら', 'れる', 'られる', 'ている', 'てる'])

/** The kana as words: as much of it written in kanji as the list allows, then the fewest words, then the most used. */
export function jaConvert(idx: KanaIndex, kana: string): string {
    type P = { covered: number; parts: number; rank: number; out: string }
    const best: (P | null)[] = Array(kana.length + 1).fill(null)
    best[0] = { covered: 0, parts: 0, rank: 0, out: '' }
    const take = (to: number, p: P) => { const b = best[to]; if (!b || p.covered > b.covered || (p.covered === b.covered && (p.parts < b.parts || (p.parts === b.parts && p.rank < b.rank)))) best[to] = p }
    for (let i = 0; i < kana.length; i++) {
        const from = best[i]
        if (!from) continue
        take(i + 1, { covered: from.covered, parts: from.parts + 1, rank: from.rank + 1e6, out: from.out + kana[i] })
        for (let n = MIN_KANJI_READING; n <= Math.min(12, kana.length - i); n++) {
            const top = STAY_KANA.has(kana.slice(i, i + n)) ? undefined : idx.get(kana.slice(i, i + n))?.[0]
            if (top) take(i + n, { covered: from.covered + n, parts: from.parts + 1, rank: from.rank + top.rank, out: from.out + top.word })
        }
    }
    return best[kana.length]!.out
}

/** The bar's chips for Japanese sound typing: the kanji sentence, the kana, then what the first kana could be in kanji. */
export function jaSuggestions(input: string, idx: KanaIndex | null, max = 6): Suggestion[] {
    if (!idx) return []
    const tail = soundTail(input)
    const kana = tail.sound ? fromVietji(tail.sound) : null
    if (!kana) return []
    const head = /[\u3040-\u30ff\u3400-\u9fff]\s+$/.test(tail.head) ? tail.head.trimEnd() : tail.head
    const out: Suggestion[] = []
    const seen = new Set<string>()
    const chip = (text: string, replace: string, meaning: string) => {
        if (seen.has(replace) || out.length >= max) return
        seen.add(replace)
        out.push({ text, vietji: tail.sound, meaning, source: 'ime', replace })
    }
    const whole = jaConvert(idx, kana)
    if (whole !== kana) chip(whole, head + whole, `${tail.sound} · cả câu`)
    chip(kana, head + kana, 'kana')
    // what the first kana could be (two kana or more: a one-kana reading gave 朱て, 当けて for あけて)
    for (let n = Math.min(12, kana.length); n >= MIN_KANJI_READING && out.length < max; n--) {
        for (const e of (idx.get(kana.slice(0, n)) ?? []).slice(0, 3)) chip(e.word + kana.slice(n), head + e.word + kana.slice(n), '')
    }
    return out
}

// ---- typed right: the word becomes characters at the space -------------------------------------------------------------------

/**
 * When the learner ends a word with a space and its sound reads exactly as one word, the word is written in the language's
 * script at once (asked: "typed the right Việt-ji, show the characters"). Only for a word joined with hyphens (trư-tào: a
 * Vietnamese word never has one) or one that is not a Vietnamese word: measured, 23 of the 275 most used one-syllable
 * Vietnamese words read as a Chinese word with their tone (là → 辣, của → 果) and 21 as a Korean one (không, em), so those are
 * left to the chips. Returns the new input, or null to leave it.
 */
export function commitOnSpace(value: string, lang: string, ctx: { zh?: SoundIndex | null; ko?: SoundIndex | null; ja?: KanaIndex | null; vietnamese?: Set<string> }): string | null {
    const m = /(^|\s)([\p{Script=Latin}-]+) $/u.exec(value ?? '')
    if (!m) return null
    const word = m[2]
    if (/^-|-$/.test(word)) return null
    if (!word.includes('-') && ctx.vietnamese?.has(word.toLowerCase())) return null
    const before = value.slice(0, value.length - word.length - 1)
    const glue = (text: string) => (/[\u3040-\u30ff\u3400-\u9fff]\s$/.test(before) && lang !== 'ko' ? before.trimEnd() : before) + text
    if (lang === 'zh' && ctx.zh) {
        return isSoundTyping(word, ctx.zh) ? glue(convert(ctx.zh, word)!.text) : null
    }
    if (lang === 'ko' && ctx.ko) {
        const c = convert(ctx.ko, word)
        return c && c.known && c.tones === c.syllables ? glue(c.text) + ' ' : null
    }
    if (lang === 'ja' && ctx.ja) {
        const kana = fromVietji(word)
        if (!kana) return null
        return glue(jaConvert(ctx.ja, kana))                     // 開けて for a-kê-tê; kana where no kanji fits
    }
    return null
}
