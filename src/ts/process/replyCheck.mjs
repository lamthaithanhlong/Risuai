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

/** The speech half of that rule: a spoken sentence of `text` at >= 60% of a spoken sentence of the previous reply (scene sentences are consecutiveSceneRepeat's). */
export function consecutiveSpeechRepeat(text, previous) {
    const prevSpeech = speechSentences(previous)
    return speechSentences(text).find((s) => prevSpeech.some((p) => overlap(p, s) >= 0.6)) ?? null
}

/** The scene half of that rule, the one the scorer reports for narration: any sentence of `text` (>= 6 tokens) at >= 90% of a sentence of the
 *  previous reply. 【HỆ THỐNG…】 lines are left out (the 'system' rule has its own meaning for them: they may repeat when a value changed).
 *  A short sentence whose words all occur in a longer previous one counts, as it does for the scorer. Shown form or null. */
export function consecutiveSceneRepeat(text, previous) {
    const prevScene = scoredSentences(previous).filter((x) => !SYSTEM_START.test(x))
    return scoredSentences(text).filter((x) => !SYSTEM_START.test(x)).find((s) => prevScene.some((p) => overlap(p, s) >= 0.9)) ?? null
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

// ---- malformed growth tags --------------------------------------------------------------------------------------------------------
// The narrator writes the hidden tag [[ACT|id|stat+stat|difficulty|skill]] (and rarely [[BREAK|stat]]). Real gate lines (2026-11-04) lacked the
// first pipe ("[[ACT leo-cầu-thang|the_luc+cam_nhan|normal|]]"), named a stat that does not exist ("cảm_nhận"), had a fifth field, or were
// left unclosed. Whatever the script cannot read is growth lost and, without the strip, text on the screen: one regeneration asks for the right form.

export const STAT_KEYS = ['suc_manh', 'nhanh_nhen', 'the_luc', 'tinh_than', 'cam_nhan', 'y_chi']
const STAT_NAMES = { 'sức mạnh': 'suc_manh', 'nhanh nhẹn': 'nhanh_nhen', 'thể lực': 'the_luc', 'tinh thần': 'tinh_than', 'cảm nhận': 'cam_nhan', 'ý chí': 'y_chi' }
const statOk = (tok) => { const t = tok.trim().toLowerCase(); return STAT_KEYS.includes(t.replace(/-/g, '_')) || t in STAT_NAMES }
const statsOk = (field) => { const toks = field.split(/[+,]/).map((x) => x.trim()).filter(Boolean); return toks.length > 0 && toks.every(statOk) }
const TAG_ANY = /\[\[\s*(ACT|BREAK)(?![\p{L}\p{N}_])[^\]\n]*(?:\]\]?|$|(?=\n))/giu

/** Whether one tag as written is the form the card's rule gives: [[ACT|id|stats|difficulty|skills]] with 4 fields, [[BREAK|stat]]. */
export function tagWellFormed(tag) {
    const t = String(tag).trim()
    let m = /^\[\[ACT\|([^|\]]+)\|([^|\]]+)\|([^|\]]+)\|([^|\]]*)\]\]$/.exec(t)
    if (m) return statsOk(m[2])
    m = /^\[\[BREAK\|([^|\]]+)\]\]$/.exec(t)
    return !!m && statsOk(m[1])
}

/** The growth tags of a reply that are not in the right form (text as written), a list (empty when clean or without tags). */
export function malformedTags(text) {
    return [...String(text ?? '').matchAll(TAG_ANY)].map((m) => m[0].trim()).filter((t) => !tagWellFormed(t))
}

// ---- language drift ----------------------------------------------------------------------------------------------------------------
// A gate run had the narrator answer a whole turn in French (g4.15, 2026-11-04). Only whole-narration drift is the target: a short foreign
// phrase inside Vietnamese prose must not trigger. Deterministic, no model: over the narration (tags, panel lines and quoted speech
// removed) take the share of words that show Vietnamese (a letter only Vietnamese uses, or a common Vietnamese word that has none) and
// the share of French/English/Spanish function words. Measured on 1100 distinct real replies (tests/acceptance runs): Vietnamese narration
// has viet >= 0.46 and foreign <= 0.04; the drifted ones have viet <= 0.06 and foreign >= 0.22. Thresholds sit in the middle of that gap.

export const LANG_MIN_WORDS = 12
export const LANG_MAX_VIET = 0.25
export const LANG_MIN_FOREIGN = 0.08

const VIET_ONLY = /[ăơưđảạẩậẳặẻẹểệỉịỏọổộởợủụửựỷỵẫẵẽễĩỗỡũữỹầấắằếềốồớờứừỳ]/i
const VIET_PLAIN = new Set('và là các mà cô tôi anh em cho con nhưng này đó khi rồi một những không được trong của với như thì nó ta họ ai gì sao đây kia nên bị tay chân mặt mắt cửa nhà tiếng lại ra vào lên xuống tới qua'.split(' '))
const FOREIGN_FN = new Set('le la les des du un une et est en que qui dans pour pas sur au aux se sa son ses il elle ils elles nous vous je tu ce cette ne mais ou avec sans plus comme the and of to is in that it for with was he she they his her you on as at be this had not but by from are or an which one all would there their what so if we i el los las del y es por con para pero su sus lo al más'.split(' '))

/** The narration of a reply: [[...]] and [💡...] tags, 【HỆ THỐNG】 lines and quoted speech taken out. */
export function narrationOf(text) {
    return String(text ?? '').normalize('NFC').replace(/\[\[[\s\S]*?\]\]/g, ' ').replace(/\[💡[^\]]*\]/g, ' ')
        .split('\n').filter((l) => !SYSTEM_START.test(l)).join('\n').replace(/[“"][^”"]*[”"]/g, ' ')
}

/** { n, viet, foreign, drift }: words in the narration, share showing Vietnamese, share of foreign function words, and the verdict. */
export function languageDrift(text) {
    const words = narrationOf(text).match(/\p{L}+/gu) ?? []
    const n = words.length
    if (!n) return { n, viet: 0, foreign: 0, drift: false }
    const viet = words.filter((w) => VIET_ONLY.test(w) || VIET_PLAIN.has(w.toLowerCase())).length / n
    const foreign = words.filter((w) => FOREIGN_FN.has(w.toLowerCase())).length / n
    return { n, viet, foreign, drift: n >= LANG_MIN_WORDS && viet < LANG_MAX_VIET && foreign >= LANG_MIN_FOREIGN }
}

/** The narration's opening when it is not Vietnamese, as a list (empty when it is). */
export function languageHits(text) {
    return languageDrift(text).drift ? [narrationOf(text).trim().replace(/\s+/g, ' ').slice(0, 100)] : []
}

/** Everything wrong with a reply, for the scorer and for the regenerate-once step. */
export function replyHits(text, previousReplies) {
    const prev = previousReplies ?? []
    const near = prev.length ? consecutiveSpeechRepeat(text, prev[prev.length - 1]) : null
    const exact = verbatimRepeats(text, prev)
    const said = dialogueRepeats(text, prev).filter((l) => !exact.includes(l))
    const scene = prev.length ? consecutiveSceneRepeat(text, prev[prev.length - 1]) : null
    return [
        ...setupHits(text).map((t) => ({ rule: 'setup', text: t })),
        ...exact.map((t) => ({ rule: 'repeat', text: t })),
        ...(near && !exact.some((e) => normalize(e) === normalize(near)) ? [{ rule: 'repeat', text: near }] : []),
        ...said.map((t) => ({ rule: 'dialogue', text: t })),
        ...(scene && !exact.length && !near && !said.length ? [{ rule: 'scene', text: scene }] : []),
        ...systemLineRepeats(text, prev).map((t) => ({ rule: 'system', text: t })),
        ...languageHits(text).map((t) => ({ rule: 'lang', text: t })),
        ...malformedTags(text).slice(0, 2).map((t) => ({ rule: 'tag', text: t })),
    ]
}
