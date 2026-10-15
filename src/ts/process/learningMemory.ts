// What the learner remembers, for learning mode: spaced review of the phrases (SM-2), the mistakes they keep making, and how
// often they get it right lately. Ideas from the fluent kit (github.com/m98/fluent): SM-2 per item, an error-pattern list, and a
// 60-70% success target; here they live in the chat's own variables and steer the foreign speaker through the format note.
//
// After each reply the speaker marks the learner's last foreign line in a hidden block:
//   [[CHECK ok]]                                       the line was right
//   [[CHECK <what was written> → <right form> | <why, in Vietnamese>]]   it needed fixing
// The block is never shown as is: a fix becomes one short "Sửa:" line under the reply.

import { lessonHtml, parseLesson, type CoachPart } from './grammarCoach'
import { foldTyping } from './vietjiSuggest'
import { fromVietji, hasForeign, phraseVietji, stripReadings, type SuggestedReply } from './vietji'

const DAY = 24 * 60 * 60 * 1000

/** A phrase with its SM-2 state: ease factor, interval (days), successful repetitions in a row, next review time, counts. */
export type VocabItem = SuggestedReply & { ef?: number; iv?: number; reps?: number; due?: number; ok?: number; bad?: number }
export type Mistake = { wrong: string; right: string; why: string; count: number; last: number }
/** grammar: every word was a right word for what the learner meant, only the order or the grammar words were off */
export type Fix = { ok: false; wrong: string; right: string; why: string; grammar?: boolean; parts?: CoachPart[] }
/** A grammar point the learner has been shown, with the example it came with. */
export type GrammarPoint = { point: string; wrong: string; right: string; count: number; last: number }
export type CheckResult = { ok: true } | Fix

/** SM-2: quality 0-5 (5 perfect, 3 recalled with effort, below 3 a failure that starts the item over). */
export function sm2(item: VocabItem, quality: number, now: number): VocabItem {
    let ef = item.ef ?? 2.5
    let reps = item.reps ?? 0
    let iv = item.iv ?? 0
    if (quality < 3) {
        reps = 0
        iv = 1
    } else {
        reps += 1
        iv = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(iv * ef)
    }
    ef = Math.max(1.3, ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)))
    return {
        ...item, ef: Math.round(ef * 100) / 100, iv, reps, due: now + iv * DAY,
        ok: (item.ok ?? 0) + (quality >= 3 ? 1 : 0), bad: (item.bad ?? 0) + (quality < 3 ? 1 : 0),
    }
}

/** Reads the speaker's check of the learner's last line; null when the reply has none. */
export function parseCheck(reply: string): CheckResult | null {
    const m = /\[\[CHECK\s+([\s\S]*?)\]\]/.exec(reply ?? '')
    if (!m) return null
    let body = m[1].trim()
    if (/^ok\b/i.test(body)) return { ok: true }
    const grammar = /^(?:grammar|ngữ pháp)\b[:\s]*/i.exec(body)
    if (grammar) {
        // the lesson form: sentence pair | parts with why | the point to remember (grammarCoach.ts)
        const lesson = parseLesson(body.slice(grammar[0].length))
        if (!lesson) return null
        const why = lesson.point || lesson.parts[0]?.why || ''
        return { ok: false, wrong: lesson.wrote, right: lesson.fix, why, grammar: true, parts: lesson.parts }
    }
    const [pair, why = ''] = body.split('|').map((s) => s.trim())
    const [wrong, right] = pair.split(/\s*(?:→|->)\s*/)
    if (!wrong || !right) return null
    return grammar ? { ok: false, wrong, right, why, grammar: true } : { ok: false, wrong, right, why }
}

/** The reply without its check block (a block still streaming is cut off), and the "Sửa:" line for a fix. */
export function splitCheck(reply: string): { main: string; note: string } {
    const check = parseCheck(reply)
    const main = (reply ?? '').replace(/\n*\[\[CHECK[\s\S]*?\]\]/, '').replace(/\[\[CHECK[\s\S]*$/, '')
    if (!check || check.ok) return { main, note: '' }
    const fix = check as Fix                                    // the project does not narrow unions (strict is off)
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
    if (fix.grammar) return { main, note: lessonHtml({ wrote: fix.wrong, fix: fix.right, parts: fix.parts ?? [], point: fix.why }) }
    const label = '<span style="color:#e0a46b;font-weight:600">Sửa:</span>'
    const note = `\n\n<div style="margin-top:.4em;font-size:.9em;opacity:.9">${label} `
        + `<s style="opacity:.7">${esc(fix.wrong)}</s> → <b>${esc(fix.right)}</b>${fix.why ? ` <span style="opacity:.75">(${esc(fix.why)})</span>` : ''}</div>`
    return { main, note }
}

/** Counts a grammar point the learner was shown (the same point again: one more time, newest example kept). */
export function addGrammar(points: GrammarPoint[], fix: Fix, now: number): GrammarPoint[] {
    const key = fix.why.trim().toLowerCase()
    if (!key) return points
    const out = points.map((p) => ({ ...p }))
    const same = out.find((p) => p.point.trim().toLowerCase() === key)
    if (same) { same.count += 1; same.last = now; same.wrong = fix.wrong; same.right = fix.right }
    else out.push({ point: fix.why.trim(), wrong: fix.wrong, right: fix.right, count: 1, last: now })
    return out.sort((a, b) => b.last - a.last).slice(0, 40)
}

/** The phrases the learner used in a message: typed by sound (Việt-ji) or in the language's own writing. */
export function itemsUsed(message: string, vocab: VocabItem[]): VocabItem[] {
    const typed = foldTyping(message)
    const plain = (message ?? '').toLowerCase()
    if (!typed && !plain) return []
    return vocab.filter((v) => {
        const sound = foldTyping(v.vietji)
        const text = stripReadings(v.text).replace(/[。、！？!?.,«»¿¡\s]/g, '').toLowerCase()
        return (sound.length >= 3 && typed.includes(sound)) || (text.length >= 2 && plain.replace(/[。、！？!?.,«»¿¡\s]/g, '').includes(text))
    })
}

/** Grades what the learner used after the speaker's check: right → 4, fixed → 2. Returns the updated list. */
export function gradeUse(vocab: VocabItem[], userMessage: string, check: CheckResult, now: number): VocabItem[] {
    const used = new Set(itemsUsed(userMessage, vocab).map((v) => v.text))
    if (used.size === 0) return vocab
    return vocab.map((v) => (used.has(v.text) ? sm2(v, check.ok ? 4 : 2, now) : v))
}

/** Adds a fix to the mistake list (the same wrong → right pair counts up), most frequent first, at most `max`. */
export function addMistake(list: Mistake[], check: CheckResult, now: number, max = 30): Mistake[] {
    if (check.ok) return list
    const fix = check as Fix
    const key = (m: { wrong: string; right: string }) => `${m.wrong.toLowerCase()}→${m.right.toLowerCase()}`
    const found = list.find((m) => key(m) === key(fix))
    const next = found
        ? list.map((m) => (m === found ? { ...m, count: m.count + 1, last: now, why: fix.why || m.why } : m))
        : [...list, { wrong: fix.wrong, right: fix.right, why: fix.why, count: 1, last: now }]
    return next.sort((a, b) => b.count - a.count || b.last - a.last).slice(0, max)
}

/** Phrases due for review now, the most overdue first. New phrases (never graded) are not "due": they are still being met. */
export function dueItems(vocab: VocabItem[], now: number, max = 5): VocabItem[] {
    return vocab.filter((v) => v.due !== undefined && v.due <= now).sort((a, b) => (a.due ?? 0) - (b.due ?? 0)).slice(0, max)
}

/** Share of the last `window` checks that were right, or null with fewer than 3 checks. */
export function recentAccuracy(history: boolean[], window = 10): number | null {
    const last = history.slice(-window)
    return last.length >= 3 ? last.filter(Boolean).length / last.length : null
}

/** One paragraph for the format note: what to bring back, what to practise, and how fast to go (aiming at 60-70% right). */
export function memoryNote(vocab: VocabItem[], mistakes: Mistake[], history: boolean[], now: number,
    opts: { grammarLater?: boolean; grammar?: GrammarPoint[] } = {}): string {
    // the check comes first and is required: placed last, the model skipped it (measured 2026-10-15)
    const lines: string[] = [
        'REQUIRED whenever the player\'s last message has words in the foreign language: the very last line of your reply is a check of that line, after the REPLIES block: [[CHECK ok]] when it was right, or [[CHECK <what they wrote> → <the right form> | <the reason in a few Vietnamese words>]] when it needed fixing. The story text can still show the speaker repeating it correctly.',
    ]
    if (opts.grammarLater) {
        // words first, grammar a little at a time (asked: think in Vietnamese, put the words together, be corrected slowly)
        lines.push('The player learns words first: they think in Vietnamese and put the foreign words together in Vietnamese word order (我 想 她 有点 傻 for "tôi nghĩ cô ấy hơi ngốc"). Answer what they meant. When every word is a right word for what they meant and only the order, a particle or a grammar word is off, the check teaches like a kind teacher: [[CHECK grammar <what they wrote> → <the natural sentence> | <part they wrote> → <what to write>: <why, in a few simple Vietnamese words>; <next part> → <what to write>: <why> | <the ONE grammar point to remember, in Vietnamese>]], at most three parts, the most useful first, and one point a reply; nothing else is marked wrong. Use the plain [[CHECK <wrong> → <right> | why]] only when a word itself is wrong.')
        const seen = (opts.grammar ?? []).slice(0, 12)
        if (seen.length) lines.push(`Grammar points the player has already been shown (newest first, how many times): ${seen.map((g) => `${g.point} (${g.count})`).join('; ')}. When one of these comes up again, remind it in a few words; otherwise teach a new point, simplest first.`)
    }
    const known = vocab.filter((v) => (v.ok ?? 0) > 0 || (v.reps ?? 0) > 0).slice(0, 40)
    if (known.length) lines.push(`Words and phrases the player already knows (build the "workaround" answers from these): ${known.map((v) => stripReadings(v.text)).join('; ')}.`)
    const due = dueItems(vocab, now)
    if (due.length) lines.push(`Bring back these phrases naturally in the scene, the player is due to review them: ${due.map((v) => `${stripReadings(v.text)} (${v.meaning})`).join('; ')}.`)
    const hard = flagged(vocab, mistakes).slice(0, 4)
    if (hard.length) lines.push(`The player often gets these wrong or mixes them up with similar sounds; use them more and make the difference clear in the scene: ${hard.map((v) => `${stripReadings(v.text)} (${v.meaning})`).join('; ')}.`)
    const often = mistakes.filter((m) => m.count >= 2).slice(0, 3)
    if (often.length) lines.push(`The player keeps getting these wrong; give them a chance to say them right: ${often.map((m) => `${m.wrong} → ${m.right}`).join('; ')}.`)
    const acc = recentAccuracy(history)
    if (acc !== null && acc > 0.8) lines.push('The player is getting almost everything right: you may add up to three new words this reply.')
    else if (acc !== null && acc < 0.5) lines.push('The player is struggling: no new words this reply, shorter and simpler sentences, reuse what they know.')
    return lines.join('\n')
}

const PUNCT = /[\s。、！？!?.,«»¿¡「」]/g

/** True when the learner's line holds a try at the foreign language (its own writing, or Japanese typed in Việt-ji). */
export function triedForeign(userLine: string): boolean {
    return hasForeign(userLine ?? '') || fromVietji((userLine ?? '').trim()) !== null
}

/**
 * Risu's own check when the speaker forgot one: a line that is, word for word, a phrase the learner already met (typed in its
 * own writing, in Việt-ji, or as kana after conversion) was right. Anything else is not judged here: only the speaker can tell
 * a wrong sentence from a new one.
 */
export function selfCheck(userLine: string, known: VocabItem[]): CheckResult | null {
    const line = (userLine ?? '').trim()
    if (!line) return null
    const asKana = fromVietji(line)
    const plain = (asKana ?? line).replace(PUNCT, '').toLowerCase()
    const sound = foldTyping(line)
    const hit = known.some((v) => stripReadings(v.text).replace(PUNCT, '').toLowerCase() === plain || (sound.length >= 3 && foldTyping(v.vietji) === sound))
    return hit ? { ok: true } : null
}

// ---- how wrong, and what is easy to confuse ----------------------------------------------------------------------------------

/** Share of the answers with this phrase that were wrong (0 when never graded). */
export function errorRate(v: VocabItem): number {
    const n = (v.ok ?? 0) + (v.bad ?? 0)
    return n === 0 ? 0 : (v.bad ?? 0) / n
}

/** Edit distance between two typed sounds (folded Việt-ji), stopping early above `max`. */
export function soundDistance(a: string, b: string, max = 4): number {
    if (Math.abs(a.length - b.length) > max) return max + 1
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
    for (let i = 1; i <= a.length; i++) {
        const cur = [i]
        let rowMin = i
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
            rowMin = Math.min(rowMin, cur[j])
        }
        if (rowMin > max) return max + 1
        prev = cur
    }
    return prev[b.length]
}

export type Flagged = VocabItem & { rate: number; confusedWith: string[]; weight: number }

/**
 * Every phrase with how often it was wrong and which mistakes sound close to it. A phrase is flagged when it was wrong at least
 * a third of the time, or when it sounds close (small edit distance of the folded sound) to something the learner wrote wrong:
 * the learner is likely to mix them up. Heaviest first.
 */
/** The typed sound of a phrase: its Việt-ji when it is written in the language (kana, hangul, «...»), else the letters typed. */
export function soundOf(text: string): string {
    return foldTyping(hasForeign(text) ? (phraseVietji(text) ?? '') : text)
}

export function flagged(vocab: VocabItem[], mistakes: Mistake[]): Flagged[] {
    const wrongSounds = mistakes.map((m) => ({ m, sound: soundOf(m.wrong), right: soundOf(m.right) }))
    return vocab.map((v) => {
        const sound = foldTyping(v.vietji)
        const confusedWith: string[] = []
        for (const w of wrongSounds) {
            if (!w.sound || sound.length < 2) continue
            const limit = Math.max(1, Math.floor(Math.min(sound.length, w.sound.length) * 0.3))
            // close in sound to what was written wrong, or the very form that was missed: both need the practice
            const d = soundDistance(sound, w.sound, limit)
            if (d <= limit || w.right === sound) confusedWith.push(w.m.wrong)
        }
        const rate = errorRate(v)
        const weight = rate * 2 + confusedWith.length * 0.5 + (v.bad ?? 0) * 0.1
        return { ...v, rate, confusedWith, weight }
    }).filter((f) => f.rate >= 1 / 3 || f.confusedWith.length > 0).sort((a, b) => b.weight - a.weight)
}
