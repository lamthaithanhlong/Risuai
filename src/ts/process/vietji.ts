// Việt-ji: a language being learned, read and typed in Vietnamese letters, for a learner with none of it (Settings → Learning).
//
// Reading: every word keeps its own script large (kanji, hanzi, hangul, Spanish), Japanese and Chinese show kana or pinyin small
// above (furigana), and every word has its reading in Vietnamese letters small underneath: やめて → da-mê-tê. The model gives the
// reading of kanji and hanzi in brackets (今日[きょう], 你好[nǐhǎo]); a bare kanji run is dimmed so the learner knows it is unread.
// Korean and Spanish are read by rule (vietjiLang.ts).
// Typing (Japanese): a message written entirely in Việt-ji syllables ("da me te") is turned into kana (やめて) in the request the
// model gets; the chat keeps what the learner typed.
//
// One Việt-ji syllable per kana (vietjiTable.json, made by ~/Downloads/vietji-tutor/make_table.py), syllables joined by "-".
// ん closes the syllable before it with "n" (かん = can), っ with "t" (きって = kit-tê), ー repeats the vowel before it.

import TABLE from './vietjiTable.json'
import { frenchToVietji, hangulToVietji, pinyinToVietji, spanishToVietji } from './vietjiLang'

const VJ: Record<string, string> = TABLE.table
const ALIAS: Record<string, string> = TABLE.alias
const LONG = TABLE.long


function toHira(ch: string): string {
    const cp = ch.codePointAt(0)!
    return cp >= 0x30A1 && cp <= 0x30F6 ? String.fromCodePoint(cp - 0x60) : ch
}

function lastVowel(syl: string): string {
    for (const v of ['ư', 'ê', 'ô', 'ơ', 'a', 'i', 'u', 'e', 'o', 'y']) {
        if (syl.endsWith(v)) return v
    }
    return ''
}

/** Kana -> Việt-ji ("やめて" -> "da-mê-tê"), or null when a character has no spelling. */
export function toVietji(kana: string): string | null {
    const chars = [...kana].map(toHira)
    const out: string[] = []
    for (let i = 0; i < chars.length; i++) {
        const ch = chars[i]
        const pair = i + 1 < chars.length ? ch + chars[i + 1] : ''
        if (pair && VJ[pair]) { out.push(VJ[pair]); i++; continue }
        if (pair && ALIAS[pair] && VJ[ALIAS[pair]]) { out.push(VJ[ALIAS[pair]]); i++; continue }
        if (ch === 'ん') { if (out.length) out[out.length - 1] += 'n'; else out.push('n'); continue }
        if (ch === 'っ') { if (out.length) out[out.length - 1] += 't'; continue }
        if (ch === LONG) { if (out.length) out.push(lastVowel(out[out.length - 1])); continue }
        const v = VJ[ALIAS[ch] ?? ch]
        if (v === undefined) return null
        out.push(v)
    }
    return out.join('-')
}

// Typing is forgiving: case is ignored, ê/e, ô/o, ư/u, ơ/o, ă/â/a are one letter, "dd" is đ. Tone marks are not folded on
// purpose: Việt-ji never carries one, so a word with a tone mark (chào, bạn, muốn) matches nothing and the text stays Vietnamese.
function fold(s: string): string {
    return s.toLowerCase().replace(/dd/g, 'đ').replace(/ê/g, 'e').replace(/ô/g, 'o').replace(/ư/g, 'u')
        .replace(/ơ/g, 'o').replace(/ă/g, 'a').replace(/â/g, 'a')
}

let reverse: Map<string, string> | null = null
let reverseMax = 0
function reverseTable(): Map<string, string> {
    if (reverse) return reverse
    reverse = new Map()
    for (const [kana, viet] of Object.entries(VJ)) {
        const f = fold(viet)
        reverse.set(f, kana)
        reverseMax = Math.max(reverseMax, [...f].length)
    }
    return reverse
}

/** Việt-ji -> kana ("da me te" -> "やめて"), or null when the text is not entirely Việt-ji. */
const JA_PUNCT: Record<string, string> = { ',': '、', '.': '。', '?': '？', '!': '！' }

export function fromVietji(text: string): string | null {
    const rev = reverseTable()
    // punctuation typed between words ("i i ê, i ri ma sên") is kept as Japanese punctuation, not a reason to give up
    const tokens = text.split(/([,.?!]+)|[\s\-]+/).filter((t) => t !== undefined && t !== '')
    const words = tokens.filter((t) => !/^[,.?!]+$/.test(t))
    if (words.length === 0) return null
    const out: string[] = []
    for (const word of tokens) {
        if (/^[,.?!]+$/.test(word)) { out.push([...word].map((c) => JA_PUNCT[c]).join('')); continue }
        const f = [...fold(word)]
        let i = 0
        while (i < f.length) {
            let hit = ''
            for (let len = Math.min(reverseMax, f.length - i); len >= 1; len--) {
                const piece = f.slice(i, i + len).join('')
                if (rev.has(piece)) { hit = piece; break }
            }
            if (hit) {
                out.push(rev.get(hit)!)
                i += [...hit].length
            } else if (f[i] === 'n' && out.length) {
                out.push('ん'); i++
            } else if (f[i] === 't' && out.length && i === f.length - 1) {
                out.push('っ'); i++   // a "t" coda is the っ before the next word's consonant
            } else {
                return null
            }
        }
    }
    return out.join('')
}


export type LearningLang = 'ja' | 'zh' | 'ko' | 'es' | 'fr'

// Spanish and French lines both sit inside «»; which reader they get follows the language being learned.
let latinReader: (word: string) => string | null = spanishToVietji
export function setLatinLanguage(lang: string | undefined): void {
    latinReader = lang === 'fr' ? frenchToVietji : spanishToVietji
}
const LATIN_WORD = /[A-Za-zÀ-ÖØ-öø-ÿœŒ]+/g

const KANA = /[ぁ-ゖァ-ヺ]/
const HAN = '一-鿿㐀-䶿々〆'
const HANGUL = /[가-힣]/

/** True when the text has any kana (a Japanese line the learner reads). */
export function hasKana(text: string): boolean {
    return KANA.test(text ?? '')
}

/** True when the text holds a line in a language being learned: kana, hanzi/kanji, hangul, or a «Spanish» line. */
export function hasForeign(text: string): boolean {
    return KANA.test(text ?? '') || new RegExp(`[${HAN}]`).test(text ?? '') || HANGUL.test(text ?? '') || /«[^»]+»/.test(text ?? '')
}

const SUB_STYLE = 'font-size:.55em;color:#c8cbe6;font-weight:500;letter-spacing:.02em'     // kana / pinyin, small, above
const VJ_STYLE = 'font-size:.68em;color:#f2c76b;font-weight:600;letter-spacing:.03em;white-space:nowrap'   // Việt-ji, below
const WORD_STYLE = 'display:inline-flex;flex-direction:column;align-items:center;vertical-align:bottom;margin:0 .14em;line-height:1.3'
const UNREAD_STYLE = 'border-bottom:1px dotted #8e97cf;opacity:.6'

function esc(s: string): string {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
}

/** One word: the original script large, its reading in Việt-ji small underneath. */
function wordUnit(baseHtml: string, vietji: string | null): string {
    if (!vietji) return baseHtml
    return `<span style="${WORD_STYLE}"><span style="font-size:1.12em">${baseHtml}</span><span style="${VJ_STYLE}">${esc(vietji)}</span></span>`
}

// A Japanese or Chinese word: kanji/hanzi with their reading in brackets (今日[きょう], 你好[nǐhǎo]), kana, or both (今日[きょう]は).
const CJK_WORD = new RegExp(`(?:[${HAN}]+\\[[^\\]\\n]{1,40}\\]|[\\u3041-\\u3096\\u30A1-\\u30FA\\u30FC]+|[${HAN}]+)+`, 'g')
const BRACKETED = new RegExp(`([${HAN}]+)\\[([^\\]\\n]{1,40})\\]`, 'g')

function cjkWord(word: string): string {
    let reading = ''          // the word's sound: kana for Japanese, pinyin for Chinese
    let pinyin = false
    let unread = false
    let html = ''
    let last = 0
    const parts = [...word.matchAll(BRACKETED)]
    const plain = (t: string) => {
        // kana between bracketed words, or a bare kanji run without a reading
        for (const m of t.matchAll(new RegExp(`([${HAN}]+)|([^${HAN}]+)`, 'g'))) {
            if (m[1]) { html += `<span style="${UNREAD_STYLE}" title="chưa có cách đọc">${m[1]}</span>`; unread = true }
            else { html += m[2]; reading += m[2] }
        }
    }
    for (const m of parts) {
        plain(word.slice(last, m.index))
        const [, han, read] = m
        if (KANA.test(read)) reading += read
        else { pinyin = true; reading += (reading && !KANA.test(reading) ? ' ' : '') + read }
        html += `<ruby>${han}<rt style="${SUB_STYLE}">${esc(read)}</rt></ruby>`
        last = m.index! + m[0].length
    }
    plain(word.slice(last))
    const vietji = unread && !reading ? null : pinyin ? pinyinToVietji(reading) : toVietji(reading.replace(/[^ぁ-ゖァ-ヺー]/g, ''))
    return wordUnit(html, vietji)
}

function readText(text: string): string {
    return text
        // «Spanish or French line»: every word gets its reading underneath
        .replace(/«([^»]{1,400})»/g, (_, line: string) =>
            '«' + line.replace(LATIN_WORD, (w) => wordUnit(w, latinReader(w))) + '»')
        .replace(/[가-힣]+/g, (w) => wordUnit(w, hangulToVietji(w)))
        .replace(CJK_WORD, (w) => cjkWord(w))
}

/**
 * Puts the reading under every word of a language being learned (markdown with inline HTML): Japanese and Chinese keep their
 * characters large with kana/pinyin small above (furigana), and every word has its Việt-ji small underneath. Only text is
 * touched: tags and their attributes, <style>/<script> bodies and anything already inside a <ruby> are left as they are.
 */
export function addReadings(message: string): string {
    if (!hasForeign(message)) return message
    const parts = message.split(/(<[^>]*>)/)
    let skip = 0
    return parts.map((part) => {
        if (part.startsWith('<')) {
            const m = /^<(\/?)(ruby|style|script|rt)\b/i.exec(part)
            if (m) skip += m[1] ? -1 : 1
            if (skip < 0) skip = 0
            return part
        }
        return skip > 0 ? part : readText(part)
    }).join('')
}

/** The Việt-ji of a whole phrase in any of the languages (for the vocabulary list and the suggestions). */
export function phraseVietji(text: string): string | null {
    const out: string[] = []
    const t = text.replace(/[«»「」『』“”"()（）]/g, ' ')
    for (const m of t.matchAll(new RegExp(`${CJK_WORD.source}|[\\uAC00-\\uD7A3]+|${LATIN_WORD.source}`, 'g'))) {
        const w = m[0]
        if (HANGUL.test(w)) { const v = hangulToVietji(w); if (v) out.push(v); continue }
        if (/^[A-Za-zÀ-ÖØ-öø-ÿœŒ]+$/.test(w)) { const v = latinReader(w); if (v) out.push(v); continue }
        const html = cjkWord(w)
        const v = /<span style="[^"]*white-space:nowrap">([^<]*)<\/span><\/span>$/.exec(html)?.[1]
        if (v) out.push(v.replace(/&amp;/g, '&'))
    }
    return out.length ? out.join(' ') : null
}

/** The phrase without its bracketed readings: 今日[きょう]は → 今日は (what the learner sees and types). */
export function stripReadings(text: string): string {
    return text.replace(BRACKETED, '$1').replace(/[«»]/g, '').trim()
}

/**
 * The speaker's suggested answers. The learning note asks for one block at the end of a reply:
 *   [[REPLIES
 *   はい | Vâng
 *   お金[かね] ですか | Tiền à?
 *   ]]
 * It is shown as a short list with readings, and the parsed list feeds the typing suggestions. A block still streaming is hidden.
 */
export type SuggestedReply = { text: string; vietji: string; meaning: string }

export function parseReplies(message: string): SuggestedReply[] {
    const m = /\[\[REPLIES\s*\n([\s\S]*?)\]\]/.exec(message ?? '')
    if (!m) return []
    const out: SuggestedReply[] = []
    for (const line of m[1].split('\n')) {
        const [text, meaning = ''] = line.split('|').map((s) => s.trim())
        if (!text) continue
        const vietji = phraseVietji(text)
        if (vietji) out.push({ text, vietji, meaning })
    }
    return out.slice(0, 4)
}

/** The message without its replies block (a block still streaming is cut off too), and the box that shows the replies. */
export function splitReplies(message: string, withReadings = true): { main: string; box: string } {
    const replies = parseReplies(message)
    const main = (message ?? '').replace(/\n*\[\[REPLIES[\s\S]*?\]\]/, '').replace(/\[\[REPLIES[\s\S]*$/, '')
    if (!replies.length) return { main, box: '' }
    const line = (r: SuggestedReply) => {
        const shown = /[«\uAC00-\uD7A3\u3041-\u30FA\u4E00-\u9FFF]/.test(r.text) ? r.text : `«${r.text}»`
        return `<div>${withReadings ? readText(shown) : esc(stripReadings(shown))} <span style="opacity:.75">— ${esc(r.meaning)}</span></div>`
    }
    const box = '\n\n<div style="margin-top:.6em;padding:.4em .7em;border-left:3px solid #f2c76b;opacity:.92"><div style="font-size:.8em;opacity:.7">Bạn có thể đáp</div>'
        + replies.map(line).join('') + '</div>'
    return { main, box }
}

/** The message with its replies block shown as a list (kept for callers that render the whole message at once). */
export function renderReplies(message: string): string {
    const { main, box } = splitReplies(message)
    return main + box
}

/** Each foreign phrase the speaker said with its meaning ("「…」 (nghĩa)", "«…» (nghĩa)", a hangul phrase), and the replies. */
export function collectVocab(message: string): SuggestedReply[] {
    const out: SuggestedReply[] = []
    const re = new RegExp(`(?:「([^」\\n]{1,120})」|«([^»\\n]{1,160})»|([\\uAC00-\\uD7A3][\\uAC00-\\uD7A3\\s?.!,]{0,80}))\\s*[”"]?\\s*\\(([^)]{1,80})\\)`, 'g')
    for (const m of (message ?? '').matchAll(re)) {
        const text = (m[1] ?? m[2] ?? m[3]).trim()
        if (!hasForeign(text) && !m[2]) continue
        const vietji = phraseVietji(text)
        if (vietji) out.push({ text, vietji, meaning: m[4].trim() })
    }
    return [...out, ...parseReplies(message)]
}

/**
 * A stored vocabulary list as a clean array. Rows saved before the four-language version have `kana` instead of `text`; rows
 * without a phrase or a reading are dropped. A bad value gives an empty list.
 */
export function readVocab<T extends SuggestedReply>(stored: string | null | undefined): T[] {
    let raw: any[] = []
    try { const p = JSON.parse(stored || '[]'); if (Array.isArray(p)) raw = p } catch { /* a bad value starts a new list */ }
    return raw
        .map((v) => (v && typeof v === 'object' ? { ...v, text: v.text ?? v.kana } : null))
        .filter((v) => v && typeof v.text === 'string' && typeof v.vietji === 'string')
        .map(({ kana, ...v }) => v as T)
}

/** Adds new phrases to a stored list (JSON), newest first, no repeats, at most `max`. */
export function mergeVocab(stored: string | null | undefined, found: SuggestedReply[], max = 300): string {
    let list: SuggestedReply[] = readVocab(stored)
    for (const item of found) {
        // a phrase met again keeps its review state (learningMemory.ts) and moves to the front
        const old = list.find((x) => x.text === item.text)
        list = [{ ...old, ...item }, ...list.filter((x) => x.text !== item.text)]
    }
    return JSON.stringify(list.slice(0, max))
}
