// The offline word list for the learning bar: the learner types in Vietnamese ("có", "tôi đói") and gets the foreign words at
// once, without asking the model. Built by scripts/build_vidict.py from the French Wiktionary (CC BY-SA), served as
// /dict/vi-<lang>.json and loaded on the first Vietnamese keystroke. Only French has a list for now; the other languages fall
// back to asking the model.

import type { LearningLang } from './vietji'
import { phraseVietji, setLatinLanguage } from './vietji'
import type { Suggestion } from './vietjiSuggest'

export type WordList = Record<string, string[]>

export const DICT_LANGS: LearningLang[] = ['fr']
const MAX_SYLLABLES = 4

const loaded = new Map<string, Promise<WordList | null>>()

/** The word list for a language, fetched once; null when there is none or it cannot be read. */
export function loadWordList(lang: LearningLang, fetchImpl: typeof fetch = (i, o) => fetch(i, o)): Promise<WordList | null> {
    if (!DICT_LANGS.includes(lang)) return Promise.resolve(null)
    if (!loaded.has(lang)) {
        loaded.set(lang, fetchImpl(`/dict/vi-${lang}.json`)
            .then((r) => r.ok ? r.json() : null)
            .then((d) => (d && typeof d.words === 'object' ? d.words as WordList : null))
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
    setLatinLanguage(lang)
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
