// What the learner remembers, for learning mode: spaced review of the phrases (SM-2), the mistakes they keep making, and how
// often they get it right lately. Ideas from the fluent kit (github.com/m98/fluent): SM-2 per item, an error-pattern list, and a
// 60-70% success target; here they live in the chat's own variables and steer the foreign speaker through the format note.
//
// After each reply the speaker marks the learner's last foreign line in a hidden block:
//   [[CHECK ok]]                                       the line was right
//   [[CHECK <what was written> → <right form> | <why, in Vietnamese>]]   it needed fixing
// The block is never shown as is: a fix becomes one short "Sửa:" line under the reply.

import { foldTyping } from './vietjiSuggest'
import { stripReadings, type SuggestedReply } from './vietji'

const DAY = 24 * 60 * 60 * 1000

/** A phrase with its SM-2 state: ease factor, interval (days), successful repetitions in a row, next review time, counts. */
export type VocabItem = SuggestedReply & { ef?: number; iv?: number; reps?: number; due?: number; ok?: number; bad?: number }
export type Mistake = { wrong: string; right: string; why: string; count: number; last: number }
export type Fix = { ok: false; wrong: string; right: string; why: string }
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
    const body = m[1].trim()
    if (/^ok\b/i.test(body)) return { ok: true }
    const [pair, why = ''] = body.split('|').map((s) => s.trim())
    const [wrong, right] = pair.split(/\s*(?:→|->)\s*/)
    if (!wrong || !right) return null
    return { ok: false, wrong, right, why }
}

/** The reply without its check block (a block still streaming is cut off), and the "Sửa:" line for a fix. */
export function splitCheck(reply: string): { main: string; note: string } {
    const check = parseCheck(reply)
    const main = (reply ?? '').replace(/\n*\[\[CHECK[\s\S]*?\]\]/, '').replace(/\[\[CHECK[\s\S]*$/, '')
    if (!check || check.ok) return { main, note: '' }
    const fix = check as Fix                                    // the project does not narrow unions (strict is off)
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
    const note = `\n\n<div style="margin-top:.4em;font-size:.9em;opacity:.9"><span style="color:#e0a46b;font-weight:600">Sửa:</span> `
        + `<s style="opacity:.7">${esc(fix.wrong)}</s> → <b>${esc(fix.right)}</b>${fix.why ? ` <span style="opacity:.75">(${esc(fix.why)})</span>` : ''}</div>`
    return { main, note }
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
export function memoryNote(vocab: VocabItem[], mistakes: Mistake[], history: boolean[], now: number): string {
    // the check comes first and is required: placed last, the model skipped it (measured 2026-10-15)
    const lines: string[] = [
        'REQUIRED whenever the player\'s last message has words in the foreign language: the very last line of your reply is a check of that line, after the REPLIES block: [[CHECK ok]] when it was right, or [[CHECK <what they wrote> → <the right form> | <the reason in a few Vietnamese words>]] when it needed fixing. The story text can still show the speaker repeating it correctly.',
    ]
    const due = dueItems(vocab, now)
    if (due.length) lines.push(`Bring back these phrases naturally in the scene, the player is due to review them: ${due.map((v) => `${stripReadings(v.text)} (${v.meaning})`).join('; ')}.`)
    const often = mistakes.filter((m) => m.count >= 2).slice(0, 3)
    if (often.length) lines.push(`The player keeps getting these wrong; give them a chance to say them right: ${often.map((m) => `${m.wrong} → ${m.right}`).join('; ')}.`)
    const acc = recentAccuracy(history)
    if (acc !== null && acc > 0.8) lines.push('The player is getting almost everything right: you may add up to three new words this reply.')
    else if (acc !== null && acc < 0.5) lines.push('The player is struggling: no new words this reply, shorter and simpler sentences, reuse what they know.')
    return lines.join('\n')
}
