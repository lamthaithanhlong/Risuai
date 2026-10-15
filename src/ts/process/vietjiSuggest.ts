// Typing suggestions for learning mode (the bar above the chat input). The learner types the sound in Vietnamese letters, without
// tone marks ("oa ca", "an nh", "ni ha"), or a few Vietnamese words of the meaning ("bao nhieu"); the bar offers the phrases that
// match, newest first: the speaker's suggested answers, then what the speaker said, then a small starter set per language.

import type { LearningLang, SuggestedReply } from './vietji'
import { parseReplies, phraseVietji, readVocab, setLatinLanguage, stripReadings } from './vietji'

/** replace: the whole new input when the chip is picked (sound typing turns its syllables into characters, vietjiIme.ts). */
export type Suggestion = SuggestedReply & { source: 'reply' | 'heard' | 'starter' | 'asked' | 'dict' | 'ime'; replace?: string }

/**
 * Typed with Vietnamese marks ("có", "bao nhiêu", "đi"): the learner is writing what they mean, not the sound, so the bar looks
 * the meaning up. Plain letters ("co", "oa ca") stay sound typing.
 */
export function looksVietnamese(s: string): boolean {
    const t = (s ?? '').normalize('NFD')
    return /[đĐ]/.test(t) || /[\u0300-\u0309\u031b\u0323]/.test(t) || /[ăâêôơư]/i.test(s ?? '')
}

/**
 * Typed the sound of a phrase on offer ("ùa lái tảng mẩn" for 我来挡门 = ủa-lái-tảng-mẩn): Việt-ji carries Vietnamese tone
 * marks, so marks alone do not mean the learner is writing Vietnamese. Reported: this was looked up as Vietnamese words
 * (流 开 板块 工作) and sent to the model.
 */
export function soundMatch(typed: string, pool: Suggestion[]): boolean {
    const q = foldTyping(typed)
    if (!q) return false
    // three letters or more of a phrase's sound, or its whole first syllable however short ("ủa" for 我撑不住了: two letters,
    // reported as showing no answer at all)
    const first = (vj: string) => foldTyping((vj ?? '').split(/[\s-]+/)[0] ?? '')
    return pool.some((s) => s.source !== 'dict' && s.source !== 'asked' && s.source !== 'ime'
        && foldTyping(s.vietji).startsWith(q) && (q.length >= 3 || first(s.vietji) === q))
}

/** The meaning's words, folded: "Bao nhiêu tiền?" → ["bao", "nhieu", "tien"]. */
const meaningWords = (s: string) => (s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
const foldWord = (w: string) => foldTyping(w)

/** How well a meaning fits what was typed in Vietnamese: every typed word is one of its words (the last one may be cut short). */
function meaningScore(typed: string, meaning: string): number {
    const want = meaningWords(typed)
    if (!want.length) return 0
    const have = meaningWords(meaning)
    const haveFolded = have.map(foldWord)
    let exact = true
    for (const [i, w] of want.entries()) {
        const last = i === want.length - 1
        if (have.includes(w)) continue                           // same word, same marks: "có" is not "cô"
        exact = false
        const f = foldWord(w)
        if (!haveFolded.some((h) => h === f || (last && h.startsWith(f)))) return 0
    }
    return exact ? 3 : 2
}

/** Lower case, no tone marks, ê/ô/ơ/ư/ă/â as plain letters, đ and "dd" as d, no spaces or hyphens: what the learner can type. */
export function foldTyping(s: string): string {
    return (s ?? '').toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')      // tone marks and the hats on ê ô â ă ư ơ (ư/ơ keep a horn: below)
        .replace(/đ/g, 'd').replace(/dd/g, 'd')
        .replace(/[^a-z0-9]/g, '')
}

const STARTER: Record<LearningLang, [string, string][]> = {
    ja: [
        ['こんにちは', 'Xin chào'], ['ありがとう', 'Cảm ơn'], ['はい', 'Vâng'], ['いいえ', 'Không'], ['すみません', 'Xin lỗi / cho hỏi'],
        ['わかりました', 'Tôi hiểu rồi'], ['わかりません', 'Tôi không hiểu'], ['いくら ですか', 'Bao nhiêu tiền?'], ['ください', 'Cho tôi'],
        ['だいじょうぶ です', 'Không sao'], ['もう いちど', 'Lần nữa'], ['おなまえ は', 'Tên bạn là gì?'], ['さようなら', 'Tạm biệt'],
    ],
    zh: [
        ['你好[nǐhǎo]', 'Xin chào'], ['谢谢[xièxie]', 'Cảm ơn'], ['是[shì]', 'Phải'], ['不是[búshì]', 'Không phải'], ['对不起[duìbuqǐ]', 'Xin lỗi'],
        ['我[wǒ] 不[bù] 懂[dǒng]', 'Tôi không hiểu'], ['多少[duōshao] 钱[qián]', 'Bao nhiêu tiền?'], ['请[qǐng]', 'Xin mời / làm ơn'],
        ['没关系[méiguānxi]', 'Không sao'], ['再见[zàijiàn]', 'Tạm biệt'],
    ],
    ko: [
        ['안녕하세요', 'Xin chào'], ['감사합니다', 'Cảm ơn'], ['네', 'Vâng'], ['아니요', 'Không'], ['죄송합니다', 'Xin lỗi'],
        ['몰라요', 'Tôi không biết'], ['얼마예요', 'Bao nhiêu tiền?'], ['주세요', 'Cho tôi'], ['괜찮아요', 'Không sao'], ['안녕히 가세요', 'Tạm biệt'],
    ],
    es: [
        ['Hola', 'Xin chào'], ['Gracias', 'Cảm ơn'], ['Sí', 'Vâng'], ['No', 'Không'], ['Perdón', 'Xin lỗi'], ['No entiendo', 'Tôi không hiểu'],
        ['¿Cuánto cuesta?', 'Bao nhiêu tiền?'], ['Por favor', 'Làm ơn'], ['No pasa nada', 'Không sao'], ['Adiós', 'Tạm biệt'],
    ],
    fr: [
        ['Bonjour', 'Xin chào'], ['Merci', 'Cảm ơn'], ['Oui', 'Vâng'], ['Non', 'Không'], ['Pardon', 'Xin lỗi'],
        ['Je ne comprends pas', 'Tôi không hiểu'], ['Combien ça coûte ?', 'Bao nhiêu tiền?'], ["S'il vous plaît", 'Làm ơn'],
        ['Ce n’est pas grave', 'Không sao'], ['Au revoir', 'Tạm biệt'],
    ],
}

export function starterSet(lang: LearningLang): Suggestion[] {
    setLatinLanguage(lang)
    return (STARTER[lang] ?? STARTER.ja).map(([text, meaning]) => ({ text, meaning, vietji: phraseVietji(lang === 'es' || lang === 'fr' ? `«${text}»` : text) ?? '', source: 'starter' as const }))
}

/** Every phrase the bar can offer, newest first, without repeats: the last reply's answers, the vocabulary list, the starter set. */
export function suggestionPool(opts: { lastReply?: string; vocab?: string; lang: LearningLang; asked?: SuggestedReply[]; dict?: Suggestion[] }): Suggestion[] {
    const pool: Suggestion[] = []
    const seen = new Set<string>()
    const add = (s: Suggestion) => {
        const key = stripReadings(s.text)
        if (!s.vietji || seen.has(key)) return
        seen.add(key)
        pool.push(s)
    }
    for (const r of opts.asked ?? []) add({ ...r, source: 'asked' })        // asked only when the list had nothing or guessed
    for (const r of opts.dict ?? []) add({ ...r, source: 'dict' })
    for (const r of parseReplies(opts.lastReply ?? '')) add({ ...r, source: 'reply' })
    for (const v of readVocab(opts.vocab)) add({ text: v.text, vietji: v.vietji, meaning: v.meaning ?? '', source: 'heard' })
    for (const s of starterSet(opts.lang)) add(s)
    return pool
}

/**
 * The best matches for what is typed: the sound from its start (strongest), the sound anywhere, then the meaning. Nothing typed:
 * the speaker's suggested answers. At most `max`.
 */
export function suggest(typed: string, pool: Suggestion[], max = 6): Suggestion[] {
    const q = foldTyping(typed)
    if (!q) {
        // the speaker's answers; a reply without them (the model forgot, or the story's opening message) still offers
        // something to say: the phrases met before, then the starter set
        const replies = pool.filter((s) => s.source === 'reply')
        return (replies.length ? replies : [...pool.filter((s) => s.source === 'heard'), ...pool.filter((s) => s.source === 'starter')]).slice(0, max)
    }
    const scored: [number, number, Suggestion][] = []
    if (looksVietnamese(typed) && !soundMatch(typed, pool)) {
        // what the learner means, in Vietnamese: by meaning only (the sound of "có" says nothing about "oui")
        pool.forEach((s, i) => {
            const score = s.source === 'asked' || s.source === 'dict' ? 4 : meaningScore(typed, s.meaning)
            if (score) scored.push([score, i, s])
        })
        return scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, max).map((x) => x[2])
    }
    pool.forEach((s, i) => {
        const sound = foldTyping(s.vietji)
        const meaning = foldTyping(s.meaning)
        // a word of the offline list read from toneless Vietnamese ("tui" → 我) comes after the sound matches ("ni hao")
        const score = sound.startsWith(q) ? 3 : sound.includes(q) ? 2 : s.source === 'dict' ? 1.5 : q.length >= 3 && meaning.includes(q) ? 1 : 0
        if (score) scored.push([score, i, s])
    })
    return scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, max).map((x) => x[2])
}

/**
 * What a chosen suggestion puts in the input. Japanese: its Việt-ji (the learner sends sound, the request turns it into kana, and
 * the learner practises the sound). Other languages: the phrase itself, without bracketed readings, since their sound typing is
 * only understood loosely.
 */
export function insertText(s: Suggestion, lang: LearningLang): string {
    if (s.replace !== undefined) return s.replace
    return lang === 'ja' ? s.vietji.replace(/-/g, ' ') : stripReadings(s.text)
}
