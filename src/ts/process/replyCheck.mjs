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

// ---- repeated speech ---------------------------------------------------------------------------------------------------------------
// The acceptance scorer (narration.mjs) flags a reply whose quoted speech shares >= 60% of its tokens with the previous reply's speech (or
// any sentence at >= 90%). These helpers ARE that definition, so the app regenerates exactly what the gate would flag; and a line of
// dialogue said word for word in any of the last 8 replies is a repeat too (a companion's "Tớ không thấy dấu chân rõ hơn đâu." three
// turns later).

export const tokens = (s) => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
/** Sentences of at least 6 tokens, as the scorer cuts them. */
export const scoredSentences = (s) => String(s ?? '').split(/(?<=[.!?…”"])\s+|\n+/).map((x) => x.trim()).filter((x) => tokens(x).length >= 6)
/** Tokens in common over the shorter sentence. */
export function overlap(a, b) {
    const A = tokens(a), B = tokens(b)
    const set = new Set(B)
    return A.filter((t) => set.has(t)).length / Math.min(A.length, B.length)
}
/** The quoted speech of a reply, sentences of at least 6 tokens. */
export const speechSentences = (r) => scoredSentences([...String(r ?? '').matchAll(/“([^”]+)”/g)].map((m) => m[1]).join('\n'))

/** What the scorer calls a repeat between two consecutive replies: a spoken sentence at >= 60%, else any sentence at >= 90%. Shown form or null. */
export function consecutiveRepeat(text, previous) {
    const prevSpeech = speechSentences(previous)
    return speechSentences(text).find((s) => prevSpeech.some((p) => overlap(p, s) >= 0.6)) ?? scoredSentences(text).find((s) => scoredSentences(previous).some((p) => overlap(p, s) >= 0.9)) ?? null
}

/** The speech half of that rule: a spoken sentence of `text` at >= 60% of a spoken sentence of the previous reply (the app regenerates on this one; scene sentences and System lines stay the scorer's own report). */
export function consecutiveSpeechRepeat(text, previous) {
    const prevSpeech = speechSentences(previous)
    return speechSentences(text).find((s) => prevSpeech.some((p) => overlap(p, s) >= 0.6)) ?? null
}

/** Every sentence of the quoted speech (>= 4 words), whole quotes included, normalised for comparison. */
function speechLines(text) {
    const out = []
    for (const m of String(text ?? '').matchAll(/[“"]([^”"]+)[”"]/g)) {
        const whole = m[1].trim()
        if (normalize(whole).split(' ').filter(Boolean).length >= 4) out.push(whole)
        for (const part of whole.split(/(?<=[.!?…])\s+|\n+/).map((x) => x.trim())) if (part !== whole && normalize(part).split(' ').filter(Boolean).length >= 4) out.push(part)
    }
    return out
}

/** Lines of dialogue of `text` (shown form) that one of the last n replies already said word for word (case, quotes, punctuation and spacing folded). */
export function dialogueRepeats(text, previousReplies, n = 8) {
    const seen = new Set()
    for (const p of (previousReplies ?? []).slice(-n)) for (const l of speechLines(p)) seen.add(normalize(l))
    const out = []
    for (const l of speechLines(text)) if (seen.has(normalize(l)) && !out.includes(l)) out.push(l)
    return out
}

/** Everything wrong with a reply, for the scorer and for the regenerate-once step. */
export function replyHits(text, previousReplies) {
    const prev = previousReplies ?? []
    const near = prev.length ? consecutiveSpeechRepeat(text, prev[prev.length - 1]) : null
    const exact = verbatimRepeats(text, prev)
    const said = dialogueRepeats(text, prev).filter((l) => !exact.includes(l))
    return [
        ...setupHits(text).map((t) => ({ rule: 'setup', text: t })),
        ...exact.map((t) => ({ rule: 'repeat', text: t })),
        ...(near && !exact.some((e) => normalize(e) === normalize(near)) ? [{ rule: 'repeat', text: near }] : []),
        ...said.map((t) => ({ rule: 'dialogue', text: t })),
        ...systemLineRepeats(text, prev).map((t) => ({ rule: 'system', text: t })),
    ]
}
