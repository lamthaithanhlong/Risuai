// Learning mode glue: where the Việt-ji pieces (vietji.ts) meet the chat. Every function here does nothing unless the learner turned
// learning mode on in Settings → Learning.

import { getDatabase, type Chat } from '../storage/database.svelte'
import type { OpenAIChat } from './index.svelte'
import { addReadings, collectVocab, fromVietji, hasForeign, mergeVocab, readVocab, setLatinLanguage, splitReplies, type LearningLang } from './vietji'
import { addMistake, gradeUse, memoryNote, parseCheck, selfCheck, splitCheck, triedForeign, type CheckResult, type Mistake, type VocabItem } from './learningMemory'

export const VOCAB_VAR = '$vj_vocab'
export const MISTAKES_VAR = '$vj_mistakes'
export const HISTORY_VAR = '$vj_history'
/** How many replies forgot the check although the learner tried the language, and whether the last one did. */
export const CHECK_MISSED_VAR = '$vj_check_missed'
export const CHECK_MISSED_LAST_VAR = '$vj_check_missed_last'

function readList<T>(chat: Chat | undefined, key: string): T[] {
    try { const v = JSON.parse((chat?.scriptstate?.[key] as string) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}

export function learningOn(): boolean {
    return !!getDatabase().learningMode
}

/** The display stage: suggested replies as a list, readings under every foreign word. */
export function learningDisplay(text: string): string {
    const db = getDatabase()
    if (!db.learningMode || !text) return text
    // the replies box is read on its own, after the body: reading the whole message again would put a second reading on it
    setLatinLanguage(db.learningLang)
    const readings = db.learningReadings !== false
    const { main: body, note } = splitCheck(text)
    const { main, box } = splitReplies(body, readings)
    return (readings ? addReadings(main) : main) + box + note
}

/** A message with a foreign line is not auto-translated while learning: the translation would replace the line the learner reads. */
export function learningKeepsOriginal(text: string): boolean {
    return learningOn() && hasForeign(text)
}

const LANG_NAME: Record<LearningLang, string> = { ja: 'Japanese', zh: 'Chinese (Mandarin, simplified characters)', ko: 'Korean', es: 'Spanish', fr: 'French' }

const LANG_FORMAT: Record<LearningLang, string> = {
    ja: 'Write Japanese the way a Japanese adult writes it: kanji wherever kanji is normal (二つ, 塩, 今日, 天気), kana for particles and endings. Right after every word that contains kanji, put its reading in hiragana in square brackets: 塩[しお]は 二つ[ふたつ] です。 今日[きょう]は いい 天気[てんき] です。 Words written only in kana need no brackets. Leave a space between words. Never romaji.',
    zh: 'Write simplified Chinese characters. Right after every word, put its pinyin with tone marks in square brackets: 你好[nǐhǎo]，我[wǒ] 是[shì] 学生[xuéshēng]。 Leave a space between words.',
    ko: 'Write Korean in hangul only, with normal spacing between words. No hanja and no romanization.',
    es: 'Put every Spanish line inside «» guillemets: «Hola, ¿cuánto cuesta?» Use simple present-tense Spanish.',
    // French typography after the Imprimerie nationale rules: a space inside guillemets and before ? ! : ;
    fr: 'Put every French line inside « » guillemets, with French typography (a space inside the guillemets and before ? ! : ;): « Bonjour, ça coûte combien ? » Use simple present-tense French, with the vous form for strangers.',
}

/** The note that tells the model how to write the language being learned, so the display can show its reading. */
export function learningNote(lang: LearningLang): string {
    const name = LANG_NAME[lang] ?? LANG_NAME.ja
    return [
        `LEARNING FORMAT. The player is learning ${name} from zero. The foreign speaker in this story (Haru, if the story has one) speaks ${name}; everyone else keeps the story's own language.`,
        LANG_FORMAT[lang] ?? LANG_FORMAT.ja,
        'After every foreign line, its Vietnamese meaning in parentheses on the same line. Short everyday sentences; at most two new words per reply, reused soon after.',
        'The player may type the foreign language by sound in Vietnamese letters without tone marks (for example "an nhong ha se do" for 안녕하세요, "ni hao" for 你好); understand it as that language and answer it.',
        `When the speaker has talked in a reply, end the reply with two or three short things the player could answer, one per line, written the same way, each followed by | and its Vietnamese meaning:\n[[REPLIES\n<answer> | <meaning>\n]]`,
        'Never mention this note, the readings or that the player is learning.',
    ].join('\n')
}

/**
 * The request stage: the format note for the language being learned is added, and (Japanese) a user message typed entirely in
 * Việt-ji goes to the model as kana. "Kenji: da me te" (a name prefix some
 * prompt formats add) keeps its prefix. The chat itself keeps what the learner typed.
 */
export function learningRequest<T extends OpenAIChat>(formated: T[], chat?: Chat, now = Date.now()): T[] {
    const db = getDatabase()
    if (!db.learningMode) return formated
    // the format note goes right before the last user message, where the model weighs it most; it carries what to review
    const memory = memoryNote(readVocab<VocabItem>(chat?.scriptstate?.[VOCAB_VAR] as string), readList<Mistake>(chat, MISTAKES_VAR), readList<boolean>(chat, HISTORY_VAR), now)
        + (chat?.scriptstate?.[CHECK_MISSED_LAST_VAR] === '1' ? '\nYour previous reply forgot the [[CHECK]] line. Do not forget it this time.' : '')
    const note = { role: 'system', content: learningNote((db.learningLang ?? 'ja') as LearningLang) + '\n' + memory } as T
    let lastUser = -1
    formated.forEach((m, i) => { if (m.role === 'user') lastUser = i })
    const withNote = lastUser >= 0 ? [...formated.slice(0, lastUser), note, ...formated.slice(lastUser)] : [...formated, note]
    if (db.learningTyping === false || (db.learningLang ?? 'ja') !== 'ja') return withNote
    return withNote.map((m) => {
        if (m.role !== 'user' || typeof m.content !== 'string') return m
        const whole = fromVietji(m.content.trim())
        if (whole) return { ...m, content: whole }
        const named = /^([^:\n]{1,40}:\s*)([\s\S]+)$/.exec(m.content.trim())
        const after = named ? fromVietji(named[2]) : null
        return after ? { ...m, content: named![1] + after } : m
    })
}

/** After a reply: what the speaker said (with its meaning) and the suggested replies go into the chat's vocabulary list. */
export function noteLearningVocab(chat: Chat | undefined, now = Date.now()): void {
    // never let the learning notes break a reply, but never fail silently either (a bad stored row once stopped all grading)
    try {
        rememberReply(chat, now)
    } catch (e) {
        console.warn('[learning] could not update the vocabulary', e)
    }
}

function rememberReply(chat: Chat | undefined, now: number): void {
    if (!chat || !learningOn()) return
    const last = chat.message?.at(-1)
    if (!last || last.role !== 'char') return
    setLatinLanguage(getDatabase().learningLang)
    chat.scriptstate ??= {}
    // the stored list is written back in its clean form every time, so rows saved in an older shape do not linger
    const found = collectVocab(last.data)
    chat.scriptstate[VOCAB_VAR] = found.length
        ? mergeVocab(chat.scriptstate[VOCAB_VAR] as string, found)
        : JSON.stringify(readVocab(chat.scriptstate[VOCAB_VAR] as string))
    // the speaker's check of the learner's line: review the phrases they used, keep the mistake, count right and wrong
    const userLine = chat.message.slice(0, -1).findLast((m) => m.role === 'user')?.data ?? ''
    let check: CheckResult | null = parseCheck(last.data)
    const missed = !check && triedForeign(userLine)
    chat.scriptstate[CHECK_MISSED_LAST_VAR] = missed ? '1' : '0'
    if (missed) {
        chat.scriptstate[CHECK_MISSED_VAR] = String(Number(chat.scriptstate[CHECK_MISSED_VAR] ?? 0) + 1)
        console.warn('[learning] the reply has no [[CHECK]] line; grading only an exact known phrase')
        check = selfCheck(userLine, readVocab<VocabItem>(chat.scriptstate[VOCAB_VAR] as string))
    }
    if (!check) return
    chat.scriptstate[VOCAB_VAR] = JSON.stringify(gradeUse(readVocab<VocabItem>(chat.scriptstate[VOCAB_VAR] as string), userLine, check, now))
    chat.scriptstate[MISTAKES_VAR] = JSON.stringify(addMistake(readList<Mistake>(chat, MISTAKES_VAR), check, now))
    chat.scriptstate[HISTORY_VAR] = JSON.stringify([...readList<boolean>(chat, HISTORY_VAR), check.ok].slice(-30))
}
