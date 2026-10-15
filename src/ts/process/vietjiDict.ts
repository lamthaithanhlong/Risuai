// The offline word lists for the learning bar: the learner types in Vietnamese ("có", "tôi đói") and gets the foreign words at
// once, without asking the model. Served as /dict/vi-<lang>.json and loaded on the first Vietnamese keystroke. French comes
// from the French Wiktionary (scripts/build_vidict.py); Japanese, Chinese, Korean and Spanish are joined through English
// (scripts/build_vidict_pivot.py), which marks the words whose first pick is a guess as `unsure`: for those the bar also asks
// the model, the way it does when the list has nothing.

import type { LearningLang } from './vietji'
import { phraseVietji, setLatinLanguage } from './vietji'
import type { Suggestion } from './vietjiSuggest'

export type WordList = Record<string, string[]>
export type Dictionary = { words: WordList; unsure: Set<string>; order?: string[] }

export const DICT_LANGS: LearningLang[] = ['fr', 'ja', 'zh', 'ko', 'es']
const MAX_SYLLABLES = 4

const loaded = new Map<string, Promise<Dictionary | null>>()

/** The word list for a language, fetched once; null when there is none or it cannot be read. */
export function loadWordList(lang: LearningLang, fetchImpl: typeof fetch = (i, o) => fetch(i, o)): Promise<Dictionary | null> {
    if (!DICT_LANGS.includes(lang)) return Promise.resolve(null)
    if (!loaded.has(lang)) {
        loaded.set(lang, fetchImpl(`/dict/vi-${lang}.json`)
            .then((r) => r.ok ? r.json() : null)
            .then((d) => (d && typeof d.words === 'object'
                ? { words: d.words as WordList, unsure: new Set<string>(Array.isArray(d.unsure) ? d.unsure : []), order: Array.isArray(d.order) ? d.order : [] }
                : null))
            .catch(() => { loaded.delete(lang); return null }))
    }
    return loaded.get(lang)!
}

const syllables = (text: string) => (text ?? '').toLowerCase().normalize('NFC').split(/[^\p{L}]+/u).filter(Boolean)

/** The typed Vietnamese cut into the longest words the list knows ("tôi muốn uống nước" → tôi / muốn / uống / nước). */
export function segment(text: string, words: WordList): { vi: string; fr: string[] }[] {
    const s = syllables(text)
    const out: { vi: string; fr: string[] }[] = []
    let i = 0
    while (i < s.length) {
        let found = 0
        for (let n = Math.min(MAX_SYLLABLES, s.length - i); n >= 1; n--) {
            const w = s.slice(i, i + n).join(' ')
            if (words[w]?.length) { out.push({ vi: w, fr: words[w] }); found = n; break }
        }
        i += found || 1                                         // a syllable the list does not know is skipped
    }
    return out
}

/**
 * Suggestions from the list: one word typed → each of its meanings; several → the words in order, then each word alone. The
 * Vietnamese is the chip's top line, the foreign word under it, its reading last (same as every other chip).
 */
export function dictSuggestions(typed: string, words: WordList | null, lang: LearningLang, max = 6): Suggestion[] {
    if (!words) return []
    if (lang === 'es' || lang === 'fr') setLatinLanguage(lang)
    const chip = (text: string, meaning: string): Suggestion | null => {
        const vietji = phraseVietji(`«${text}»`)
        return vietji ? { text, vietji, meaning, source: 'dict' } : null
    }
    const parts = segment(typed, words)
    const out: (Suggestion | null)[] = []
    if (parts.length === 1) {
        for (const fr of parts[0].fr) out.push(chip(fr, parts[0].vi))
    } else if (parts.length > 1) {
        out.push(chip(parts.map((p) => p.fr[0]).join(' '), `${parts.map((p) => p.vi).join(' ')} · từng chữ`))
        for (const p of parts) out.push(chip(p.fr[0], p.vi))
    }
    const seen = new Set<string>()
    return out.filter((s): s is Suggestion => !!s && !seen.has(s.text) && !!seen.add(s.text)).slice(0, max)
}

/**
 * True when the list cannot answer alone: it has nothing, it only guessed a word, or a typed word is not in it at all (the
 * word-by-word chip would drop that word silently; Alloy, docs/specs/VietjiAsk.als, SkippedWordAsks). The model is asked too.
 */
export function needsModel(typed: string, dict: Dictionary | null): boolean {
    if (!dict) return true
    const parts = segment(typed, dict.words)
    const covered = parts.reduce((n, p) => n + p.vi.split(' ').length, 0)
    return parts.length === 0 || covered < syllables(typed).length || parts.some((p) => dict.unsure.has(p.vi))
}

/**
 * Asks the model at most once per text: a finished answer is kept, and a request still out is shared, so typing away and
 * back while it is out does not ask again (TLC, docs/specs/VietjiBar.tla, NoDoubleRequest). A failed request is forgotten.
 */
export function makeAsker<T>(send: (key: string) => Promise<T>) {
    const done = new Map<string, T>()
    const out = new Map<string, Promise<T>>()
    return {
        cached: (key: string) => done.get(key),
        pending: (key: string) => out.has(key),
        ask(key: string): Promise<T> {
            if (done.has(key)) return Promise.resolve(done.get(key)!)
            let p = out.get(key)
            if (!p) {
                p = send(key).then((v) => { done.set(key, v); return v }).finally(() => out.delete(key))
                out.set(key, p)
            }
            return p
        },
    }
}

/** Vietnamese without its marks, spaces kept: "Túi đỏ" → "tui do" (how the learner types without a Vietnamese keyboard). */
export function foldVietnamese(s: string): string {
    return (s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
        .split(/[^a-z]+/).filter(Boolean).join(' ')
}

const foldedIndexes = new WeakMap<WordList, Map<string, string[]>>()

/** toneless spelling → the list's words written that way, most used first ("tui" → tui, túi, tụi, tủi) */
function foldedIndex(dict: Dictionary): Map<string, string[]> {
    let idx = foldedIndexes.get(dict.words)
    if (!idx) {
        const rank = new Map((dict.order ?? []).map((w, i) => [w, i]))
        idx = new Map()
        for (const w of Object.keys(dict.words)) {
            const f = foldVietnamese(w)
            if (!idx.has(f)) idx.set(f, [])
            idx.get(f)!.push(w)
        }
        for (const ws of idx.values()) ws.sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9))
        foldedIndexes.set(dict.words, idx)
    }
    return idx
}

/**
 * Typed without marks ("tui", "an com"): the Vietnamese words it could be, each with its foreign word. One word typed → up
 * to `perWord` readings of it (tui, túi, tụi …), most used first; a sentence → the most used reading of each word in order,
 * then each word alone. The Vietnamese word, with its marks, is the chip's top line, so the learner sees which one it is.
 */
export function toneless(typed: string, dict: Dictionary | null, lang: LearningLang, max = 6, perWord = 4): Suggestion[] {
    if (!dict) return []
    const idx = foldedIndex(dict)
    const syl = foldVietnamese(typed).split(' ').filter(Boolean)
    const parts: string[][] = []
    for (let i = 0; i < syl.length;) {
        let n = Math.min(MAX_SYLLABLES, syl.length - i)
        for (; n >= 1; n--) if (idx.has(syl.slice(i, i + n).join(' '))) break
        if (n === 0) { i++; continue }
        parts.push(idx.get(syl.slice(i, i + n).join(' '))!)
        i += n
    }
    if (!parts.length) return []
    if (parts.length === 1) {
        return parts[0].slice(0, perWord).flatMap((vi) => dictSuggestions(vi, dict.words, lang, 1)).slice(0, max)
    }
    const sentence = parts.map((p) => p[0]).join(' ')
    return dictSuggestions(sentence, dict.words, lang, max)
}
