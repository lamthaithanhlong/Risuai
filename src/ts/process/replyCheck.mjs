// One checker for the narrator's replies, used by the app (regenerate once) and by the acceptance scorer (tests/acceptance/lib/narration.mjs),
// so what the gate flags and what the app fixes can never drift apart. Plain JS on purpose: the scorer runs under node without a build.

/** Setup exposition the narrator must not say to the player (the owner's Evelyn / Zombie chats). */
export const SETUP = [/chỉ mình (anh|cậu|Kenji) (mới )?(thấy|nghe)/i, /(là )?người bạn thân đã (mất|qua đời) của/i, /chỉ (anh|cậu|Kenji) (mới )?(thấy|nghe) (và nghe )?được (cô|Evelyn)/i]

const SYSTEM_START = /^[\s*_>]*【\s*HỆ THỐNG/u

/** Case, punctuation and whitespace folded away: two sentences that read the same compare equal. */
export const normalize = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()

/** The reply's sentences (quotes opened up so a spoken sentence stands alone), shown form, with at least minWords words. */
export function sentencesOf(text, minWords = 5) {
    return String(text ?? '').replace(/[“”"]/g, '\n').split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim())
        .filter((x) => !SYSTEM_START.test(x) && normalize(x).split(' ').filter(Boolean).length >= minWords)
}

const systemLines = (text) => String(text ?? '').split(/\n+/).map((l) => l.trim()).filter((l) => SYSTEM_START.test(l))

/** The first setup-exposition match, as a list of matched texts (empty when clean). */
export function setupHits(text) {
    const out = []
    for (const re of SETUP) { const m = re.exec(String(text ?? '')); if (m) out.push(m[0]) }
    return out
}

/** Sentences (>= 5 words) of `text` that a recent previous reply already had word for word (after normalization). Shown form returned. */
export function verbatimRepeats(text, previousReplies, n = 3) {
    const seen = new Set()
    for (const p of (previousReplies ?? []).slice(-n)) for (const s of sentencesOf(p)) seen.add(normalize(s))
    const out = []
    for (const s of sentencesOf(text)) if (seen.has(normalize(s)) && !out.includes(s)) out.push(s)
    return out
}

/** 【HỆ THỐNG…】 lines identical (after trim and whitespace folding) to one in a recent previous reply: it may repeat only when a value changed. */
export function systemLineRepeats(text, previousReplies, n = 3) {
    const prev = new Set()
    for (const p of (previousReplies ?? []).slice(-n)) for (const l of systemLines(p)) prev.add(l.replace(/\s+/g, ' '))
    return systemLines(text).filter((l) => prev.has(l.replace(/\s+/g, ' ')))
}

/** Everything wrong with a reply, for the scorer and for the regenerate-once step. */
export function replyHits(text, previousReplies) {
    return [
        ...setupHits(text).map((t) => ({ rule: 'setup', text: t })),
        ...verbatimRepeats(text, previousReplies).map((t) => ({ rule: 'repeat', text: t })),
        ...systemLineRepeats(text, previousReplies).map((t) => ({ rule: 'system', text: t })),
    ]
}
