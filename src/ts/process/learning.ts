// Learning mode glue: where the Việt-ji pieces (vietji.ts) meet the chat. Every function here does nothing unless the learner turned
// learning mode on in Settings → Learning.

import { getDatabase, type Chat } from '../storage/database.svelte'
import type { OpenAIChat } from './index.svelte'
import { addReadings, addSayButtons, collectVocab, fromVietji, hasForeign, mergeVocab, setLatinLanguage, splitReplies, type LearningLang } from './vietji'
import { addGrammar, addMistake, gradeUse, memoryNote, parseCheck, selfCheck, splitCheck, triedForeign, type CheckResult, type Fix } from './learningMemory'
import { migrateChat, readNotebook, writeNotebook } from './learningStore'
import { thoughtFor, thoughtNote } from './learningThought'

/** "? cái muối này bao nhiêu": the learner asks how to say something (also after a name prefix such as "Kenji: ?"). */
export function isHowDoISay(text: string): boolean {
    return /^(?:[^:\n]{1,40}:\s*)?[?？]/.test((text ?? '').trim())
}

/**
 * A short side request for the typing bar: three ways to say what the learner typed in Vietnamese, in the REPLIES format so
 * parseReplies reads the answer. Asked only after the learner stops typing and the notebook has nothing that fits.
 */
export function howToSayPrompt(viet: string, lang: LearningLang, known: string[] = []): string {
    return [
        `Translate what a Vietnamese learner of ${LANG_NAME[lang] ?? LANG_NAME.ja} wants to say: "${viet.trim()}".`,
        LANG_FORMAT[lang] ?? LANG_FORMAT.ja,
        'Give three ways, one per line, each followed by | its exact Vietnamese meaning | its kind: one "easy" (shortest, plain), one "stretch" (natural, a little richer), one "workaround" (the same idea with only very common words' + (known.length ? `, best from these: ${known.slice(0, 30).join('; ')}` : '') + ').',
        'Answer with only this block:\n[[REPLIES\n<phrase> | <meaning> | easy\n<phrase> | <meaning> | stretch\n<phrase> | <meaning> | workaround\n]]',
    ].join('\n')
}

export const VOCAB_VAR = '$vj_vocab'
export const MISTAKES_VAR = '$vj_mistakes'
export const HISTORY_VAR = '$vj_history'
/** How many replies forgot the check although the learner tried the language, and whether the last one did. */
export const CHECK_MISSED_VAR = '$vj_check_missed'
export const CHECK_MISSED_LAST_VAR = '$vj_check_missed_last'
/** The learner line already graded: a rerolled reply for the same line must not grade it again (TLC found the double grade). */
export const GRADED_FOR_VAR = '$vj_graded_for'



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
    return addSayButtons(readings ? addReadings(main) : main) + box + note
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
        `LEARNING FORMAT. The player is learning ${name} from zero. The foreign speaker in this story (Haru, if the story has one) speaks ${name}; everyone else keeps the story's own language, except that in EVERY reply the character who speaks to the player says one short line of their dialogue in ${name} (the rest of what they say stays in the story's language). If no one speaks to the player in a reply, the narration shows one short ${name} phrase that fits the scene (a sign, a word someone mutters).`,
        LANG_FORMAT[lang] ?? LANG_FORMAT.ja,
        'Every foreign line starts with who says it, named the way the story names them (Người phụ nữ: “…”, Haru: “…”), so the player knows whether it is theirs or someone else\'s; never a line with only an emoji before it. After every foreign line, its Vietnamese meaning in parentheses on the same line. Short everyday sentences; at most two new words per reply, reused soon after.',
        'When the player writes in the foreign language, the character understands it and answers that line in the foreign language too.',
        'The player may type the foreign language by sound in Vietnamese letters without tone marks (for example "an nhong ha se do" for 안녕하세요, "ni hao" for 你好); understand it as that language and answer it.',
        'EVERY reply, without exception, ends with four to six things the player could answer next, one per line, written the same way, each followed by | its Vietnamese meaning | its kind: two "easy" (short, plain), one or two "stretch" (one new word, or a longer sentence that says more), and at least one "workaround" that says the idea with only words the player already knows, the way one talks around a missing word. Answers that fit the moment, and one way to say no:\n[[REPLIES\n<answer> | <meaning> | easy\n<answer> | <meaning> | stretch\n<answer> | <meaning> | workaround\n]]',
        'When the player writes "?" followed by something in Vietnamese, they are asking how to say it: in the narration, show three ways (plain, natural, and with words they already know), put the same three in REPLIES, and let the speaker wait for them to say one.',
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
    // the notebook is per language, not per chat: a new chat brings back what was learned in the others
    const lang = (db.learningLang ?? 'ja') as LearningLang
    if (chat) migrateChat(db, lang, chat)
    const nb = readNotebook(db, lang)
    const memory = memoryNote(nb.vocab, nb.mistakes, nb.history, now, { grammarLater: db.learningGrammarLater !== false, grammar: nb.grammar })
        + (chat?.scriptstate?.[CHECK_MISSED_LAST_VAR] === '1' ? '\nYour previous reply forgot the [[CHECK]] line. Do not forget it this time.' : '')
    const note = { role: 'system', content: learningNote((db.learningLang ?? 'ja') as LearningLang) + '\n' + memory } as T
    let lastUser = -1
    formated.forEach((m, i) => { if (m.role === 'user') lastUser = i })
    const withNote = lastUser >= 0 ? [...formated.slice(0, lastUser), note, ...formated.slice(lastUser)] : [...formated, note]
    const typed = db.learningTyping === false || lang !== 'ja' ? withNote : withNote.map((m) => {
        if (m.role !== 'user' || typeof m.content !== 'string') return m
        if (isHowDoISay(m.content)) return m                       // "? ..." asks how to say something: it stays Vietnamese
        const whole = fromVietji(m.content.trim())
        if (whole) return { ...m, content: whole }
        const named = /^([^:\n]{1,40}:\s*)([\s\S]+)$/.exec(m.content.trim())
        const after = named ? fromVietji(named[2]) : null
        return after ? { ...m, content: named![1] + after } : m
    })
    // Measured on the story model (2026-10-15), a Haru-less Shadow Slave scene: with the note alone, 0 lines in the language
    // and no [[REPLIES]] in 2 of 2 replies; with this reminder at the end of the player's message, 4-5 answers and a line in
    // the language in 2 of 2. Only the request carries it; the stored message is unchanged.
    const last = typed.map((m) => m.role).lastIndexOf('user')
    if (last < 0 || typeof typed[last].content !== 'string') return typed
    const meant = thoughtFor(typed[last].content as string)
    const add = (meant ? thoughtNote(meant) : '') + learningReminder(lang, db.learningGrammarLater !== false)
    return typed.map((m, i) => (i === last ? { ...m, content: m.content + add } : m))
}

// how the line is written, in the reminder too: a Chinese line came back as 快开门！ with no pinyin, so it had no reading
const REMIND_WRITING: Partial<Record<LearningLang, string>> = {
    zh: ' (pinyin with tone marks in square brackets after every word: 快[kuài] 开门[kāimén])',
    ja: ' (hiragana reading in square brackets after every word with kanji: 開けて[あけて])',
    es: ' (inside «» guillemets)',
    fr: ' (inside «» guillemets)',
}

/** The short reminder put after the player's last message in the request (see learningRequest). */
export function learningReminder(lang: LearningLang, grammarLater = false): string {
    // the check's exact forms, here too: with them only in the note, the model wrote "[[CHECK]]" and "[[CHECK: …]]" (2026-10-15)
    const check = grammarLater
        ? 'then, if the player wrote in that language, one check line: [[CHECK ok]] when it was right, [[CHECK grammar <what they wrote> → <the natural sentence> | <part> → <right>: <why in simple Vietnamese>; <part> → <right>: <why> | <the one point to remember, in Vietnamese>]] when the words were right and only the order or grammar was off, or [[CHECK <wrong word> → <right word> | <why in Vietnamese>]] when a word was wrong'
        : 'then the [[CHECK]] line if the player wrote in that language'
    return `\n\n[Format for this reply: the character speaking to the player says one short line in ${LANG_NAME[lang] ?? LANG_NAME.ja}${REMIND_WRITING[lang] ?? ''}, starting with their name (Name: “…”), with its Vietnamese meaning in parentheses, and the reply ends with the [[REPLIES ...]] block of four to six answers, ${check}.]`
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
    const db = getDatabase()
    const lang = (db.learningLang ?? 'ja') as LearningLang
    setLatinLanguage(lang)
    chat.scriptstate ??= {}
    migrateChat(db, lang, chat)
    const nb = readNotebook(db, lang)
    // what the speaker said (with its meaning) and the suggested replies go into the notebook
    const found = collectVocab(last.data)
    if (found.length) nb.vocab = JSON.parse(mergeVocab(JSON.stringify(nb.vocab), found, 600))
    // the speaker's check of the learner's line: review the phrases they used, keep the mistake, count right and wrong
    const userIndex = chat.message.slice(0, -1).findLastIndex((m) => m.role === 'user')
    const userMsg = userIndex >= 0 ? chat.message[userIndex] : undefined
    const userLine = userMsg?.data ?? ''
    const save = () => writeNotebook(db, lang, nb)
    // only a try at the language is graded: a check on a Vietnamese line would count an answer the learner never gave, and a
    // "? ..." line is a question about how to say something, not a try
    if (isHowDoISay(userLine) || !triedForeign(userLine)) { chat.scriptstate[CHECK_MISSED_LAST_VAR] = '0'; save(); return }
    // one grade per learner line: regenerating the reply runs this again for the same line
    const lineKey = `${userIndex}:${userMsg?.chatId ?? ''}:${userLine}`
    if (chat.scriptstate[GRADED_FOR_VAR] === lineKey) { save(); return }
    let check: CheckResult | null = parseCheck(last.data)
    const missed = !check
    chat.scriptstate[CHECK_MISSED_LAST_VAR] = missed ? '1' : '0'
    if (missed) {
        chat.scriptstate[CHECK_MISSED_VAR] = String(Number(chat.scriptstate[CHECK_MISSED_VAR] ?? 0) + 1)
        console.warn('[learning] the reply has no [[CHECK]] line; grading only an exact known phrase')
        check = selfCheck(userLine, nb.vocab)
    }
    if (check && !check.ok && (check as Fix).grammar) {
        // the words were right, only the grammar was off: counted right, and the grammar point goes into the notebook
        chat.scriptstate[GRADED_FOR_VAR] = lineKey
        nb.vocab = gradeUse(nb.vocab, userLine, { ok: true }, now)
        nb.grammar = addGrammar(nb.grammar ?? [], check as Fix, now)
        nb.history = [...nb.history, true]
    } else if (check) {
        chat.scriptstate[GRADED_FOR_VAR] = lineKey
        nb.vocab = gradeUse(nb.vocab, userLine, check, now)
        nb.mistakes = addMistake(nb.mistakes, check, now)
        nb.history = [...nb.history, check.ok]
    }
    save()
}
