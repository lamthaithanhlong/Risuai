// The offline word lists for the learning bar: the learner types in Vietnamese ("có", "tôi đói") and gets the foreign words at
// once, without asking the model. Served as /dict/vi-<lang>.json and loaded on the first Vietnamese keystroke. French comes
// from the French Wiktionary (scripts/build_vidict.py); Japanese, Chinese, Korean and Spanish are joined through English
// (scripts/build_vidict_pivot.py), which marks the words whose first pick is a guess as `unsure`: for those the bar also asks
// the model, the way it does when the list has nothing.

import type { LearningLang } from './vietji'
import { isLatinLang, phraseVietji, setLatinLanguage, stripReadings } from './vietji'
import type { Suggestion } from './vietjiSuggest'
import { ADDRESSEE_FAMILIAR, DROPS_ADDRESSEE, DROPS_ADDRESSEE_IN_ORDER, IMPERATIVE_VI, PERSON_VI, PROHIBIT_VI, imperative, isAddressee, prohibitive } from './vietjiImperative'

export type WordList = Record<string, string[]>
export type Dictionary = { words: WordList; unsure: Set<string>; order?: string[]; verbs?: Set<string> }

export const DICT_LANGS: LearningLang[] = ['fr', 'ja', 'zh', 'ko', 'es', 'en']
const MAX_SYLLABLES = 4

const loaded = new Map<string, Promise<Dictionary | null>>()

/** The word list for a language, fetched once; null when there is none or it cannot be read. */
export function loadWordList(lang: LearningLang, fetchImpl: typeof fetch = (i, o) => fetch(i, o)): Promise<Dictionary | null> {
    if (!DICT_LANGS.includes(lang)) return Promise.resolve(null)
    if (!loaded.has(lang)) {
        loaded.set(lang, fetchImpl(`/dict/vi-${lang}.json`)
            .then((r) => r.ok ? r.json() : null)
            .then((d) => (d && typeof d.words === 'object'
                ? { words: d.words as WordList, unsure: new Set<string>(Array.isArray(d.unsure) ? d.unsure : []), order: Array.isArray(d.order) ? d.order : [],
                    verbs: Array.isArray(d.verbs) ? new Set<string>(d.verbs) : undefined }
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
export function dictSuggestions(typed: string, words: WordList | null, lang: LearningLang, max = 6, verbs?: Set<string>): Suggestion[] {
    if (!words) return []
    if (isLatinLang(lang)) setLatinLanguage(lang)
    // a chip with no reading is dropped, except in a Latin-letter language: English is read from a list the bar loads, and
    // until it is here (or for a word it lacks) the word is still the right word to offer
    const chip = (text: string, meaning: string): Suggestion | null => {
        const vietji = phraseVietji(`«${text}»`) ?? (isLatinLang(lang) ? '' : null)
        return vietji !== null ? { text, vietji, meaning, source: 'dict' } : null
    }
    const parts = segment(typed, words)
    const out: (Suggestion | null)[] = []
    if (parts.length === 1) {
        for (const fr of parts[0].fr) out.push(chip(fr, parts[0].vi))
    } else if (parts.length > 1) {
        for (const o of ordered(parts, lang, ' ', verbs)) out.push(chip(o.source, o.meaning))
        const ws = withoutAddressee(parts, lang)
        out.push(chip(ws.map((p) => p.fr[0]).join(' '), `${parts.map((p) => p.vi).join(' ')} · từng chữ`))
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

// ---- building a sentence word by word from Vietnamese (asked: think in Vietnamese, look each word up, put them together) ----

const VI_MARK = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i

/**
 * The Vietnamese words at the end of the input, after what is already written in the language ("我 想 cô ấy" → "我 想 ",
 * "cô ấy"; "yo pienso cô ấy" → "yo pienso ", "cô ấy"): the longest run of words that carry Vietnamese marks or are words of
 * the list. Spanish and French are Latin too, so a word without marks counts only when the list knows it as Vietnamese.
 */
export function vietnameseTail(input: string, vietnamese: Set<string>): { head: string; tail: string } {
    const text = input ?? ''
    // words split at spaces and where the script changes: after a word written at the space, the next Vietnamese word is typed
    // right after the characters ("逆该冷静lại": reported, it was not found and the whole input was looked up)
    const parts = [...text.matchAll(/\p{Script=Latin}+|[^\s\p{Script=Latin}]+/gu)]
    let k = parts.length
    while (k > 0) {
        const word = parts[k - 1][0].toLowerCase()
        if (!/^\p{Script=Latin}+$/u.test(word) || !(VI_MARK.test(word) || vietnamese.has(word))) break
        k--
    }
    if (k === parts.length) return { head: text, tail: '' }
    const at = parts[k].index!
    return { head: text.slice(0, at), tail: text.slice(at).trim() }
}

const plainWord = (text: string) => stripReadings(text).replace(/[«»]/g, '').trim()

/** "… <verb> đi": the words before, then the verb as an order instead of verb + "go" (침착하다 가다 → 침착하세요). */
function ordered(parts: { vi: string; fr: string[] }[], lang: LearningLang, joiner: string, verbs?: Set<string>): { text: string; source: string; meaning: string }[] {
    const isVerb = (p: { vi: string }) => !PERSON_VI.has(p.vi) && (!verbs || verbs.has(p.vi))
    // the person spoken to is not said in an order (cô đừng khóc → 울지 마세요, not 당신 울지 마세요), and says which form:
    // cô/ông/bà ask for usted/vous first, bạn/em/mày for tú/tu (the forms come polite first)
    const addressee = parts.find((p) => isAddressee(p.vi))
    const drop = (ps: typeof parts) => (DROPS_ADDRESSEE_IN_ORDER.has(lang) ? ps.filter((p) => !isAddressee(p.vi)) : ps)
    // Spanish and French forms come tú/tu first: a polite addressee puts usted/vous first
    const politeFirst = !!addressee && !ADDRESSEE_FAMILIAR.has(addressee.vi) && (lang === 'es' || lang === 'fr')
    const inOrder = (forms: string[]) => (politeFirst ? [...forms].reverse() : forms)
    // "đừng <verb> …" = do not: first, because the đi of "đừng đi" is the verb go, not the order ending
    const k = parts.findIndex((p) => PROHIBIT_VI.has(p.vi))
    if (k >= 0 && k + 1 < parts.length && isVerb(parts[k + 1])) {
        const forms = inOrder(parts[k + 1].fr.map((w) => prohibitive(w, lang)).find((f) => f.length) ?? [])
        const before = drop(parts.slice(0, k)), after = parts.slice(k + 2).filter((p) => !IMPERATIVE_VI.has(p.vi))
        const meaning = `${parts.map((p) => p.vi).join(' ')} · cấm (đừng)`
        return forms.map((f) => ({
            text: [...before.map((p) => plainWord(p.fr[0])), plainWord(f), ...after.map((p) => plainWord(p.fr[0]))].join(joiner),
            source: [...before.map((p) => p.fr[0]), f, ...after.map((p) => p.fr[0])].join(' '),
            meaning,
        }))
    }
    if (parts.length < 2 || !IMPERATIVE_VI.has(parts[parts.length - 1].vi)) return []
    const verb = parts[parts.length - 2]
    // only after a verb (the lists vote which Vietnamese words are: không đi gave 不吧, có đi あってください)
    if (PERSON_VI.has(verb.vi) || (verbs && !verbs.has(verb.vi))) return []
    const forms = inOrder(verb.fr.map((w) => imperative(w, lang)).find((f) => f.length) ?? [])
    const before = drop(parts.slice(0, -2))
    const meaning = `${parts.map((p) => p.vi).join(' ')} · mệnh lệnh`
    return forms.map((f) => ({
        text: [...before.map((p) => plainWord(p.fr[0])), plainWord(f)].join(joiner),
        source: [...before.map((p) => p.fr[0]), f].join(' '),
        meaning,
    }))
}

/** Korean and Japanese do not say the person spoken to, anywhere in the sentence: "cô có sao không" → 괜찮아요?, "tôi thích
 *  cô" → 私 好き (asked for Japanese あなた in ordinary sentences, 2026-10-15). Only when more is left (cô alone is still offered). */
function withoutAddressee<P extends { vi: string }>(parts: P[], lang: LearningLang): P[] {
    // Spanish drops a subject pronoun (¿comes? not ¿tú comes?) but keeps an object one; Chinese, French and English need it
    if (lang === 'es') return parts.length > 1 && isAddressee(parts[0].vi) ? parts.slice(1) : parts
    if (!DROPS_ADDRESSEE.has(lang) || parts.length < 2) return parts
    const kept = parts.filter((p) => !isAddressee(p.vi))
    return kept.length ? kept : parts
}

/** A word already written in the language is a verb when it translates a Vietnamese verb (the list's vote); with no vote in
 *  the list, any word the language's own ending marks as one. */
const foreignVerbs = new WeakMap<object, Set<string>>()
function isForeignVerb(word: string, dict: Dictionary): boolean {
    if (!dict.verbs) return true
    let set = foreignVerbs.get(dict)
    if (!set) {
        set = new Set<string>()
        for (const vi of dict.verbs) for (const w of dict.words[vi] ?? []) set.add(plainWord(w))
        foreignVerbs.set(dict, set)
    }
    return set.has(plainWord(word))
}

/** The last word already written in the language, and what comes before it ("…, 침착하다 " → 침착하다). */
const LAST_WORD = /([^\s,.!?;:，。！？、]+)[\s,.!?;:，。！？、]*$/

/**
 * Chips that write the Vietnamese at the end of the input in the language and keep what is before it: the whole run word by
 * word, then each meaning of its first word (the rest stays Vietnamese, to go on with). Chinese and Japanese join without
 * spaces, the others with one.
 */
export function composeSuggestions(input: string, dict: Dictionary | null, lang: LearningLang, max = 6): Suggestion[] {
    if (!dict) return []
    const { head: rawHead, tail } = vietnameseTail(input, new Set(Object.keys(dict.words)))
    if (!tail) return []
    const joiner = lang === 'zh' || lang === 'ja' ? '' : ' '
    const head = joiner === '' ? rawHead.replace(/(?<=[぀-ヿ㐀-鿿])\s+$/, '') : rawHead
    const parts = segment(tail, dict.words)
    if (!parts.length) return []
    if (isLatinLang(lang)) setLatinLanguage(lang)
    const out: Suggestion[] = []
    const seen = new Set<string>()
    // the reading comes from the list's own form (我[wǒ]): the plain characters alone have none
    const chip = (text: string, source: string, meaning: string, replace: string) => {
        const vietji = phraseVietji(`«${source}»`) ?? ''
        if (seen.has(replace) || out.length >= max) return
        seen.add(replace)
        out.push({ text, vietji, meaning, source: 'dict', replace })
    }
    const syl = syllables(tail)
    // "… 침착하다 đi": đi after a verb already written is an order, not 가다
    if (parts.length === 1 && IMPERATIVE_VI.has(parts[0].vi)) {
        const m = LAST_WORD.exec(head)
        if (m && isForeignVerb(m[1], dict)) for (const f of imperative(m[1], lang)) chip(plainWord(f), f, `${m[1]} + ${parts[0].vi} · mệnh lệnh`, head.slice(0, m.index) + plainWord(f))
    }
    for (const o of ordered(parts, lang, joiner, dict.verbs)) chip(o.text, o.source, o.meaning, head + o.text)
    if (parts.length > 1) {
        const ws = withoutAddressee(parts, lang)
        const whole = ws.map((p) => plainWord(p.fr[0])).join(joiner)
        chip(whole, ws.map((p) => p.fr[0]).join(' '), `${parts.map((p) => p.vi).join(' ')} · từng chữ`, head + whole)
    }
    const first = parts[0]
    const n = first.vi.split(' ').length
    if (syl.slice(0, n).join(' ') === first.vi) {                // the run starts with a known word
        const rest = tail.split(/\s+/).slice(n).join(' ')
        for (const fr of first.fr) chip(plainWord(fr), fr, first.vi, head + plainWord(fr) + (rest ? ' ' + rest : ''))
    }
    return out
}
