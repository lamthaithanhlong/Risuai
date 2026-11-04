// Two finds that are the same thing under different English names ("Sound Rhythm" / "Stairwell Rhythm": a rhythm-listening skill twice).
// The fingerprint (sorted tokens) only catches the same words; this catches the same head noun. Deterministic, and the SAME rule lives in
// tools/assets/finds.py (similar()); findSimilar.test.ts runs both over the same names so they cannot drift.
//
//   tokens  = the fingerprint's words, minus GENERIC ones ("reading", "sense", ...), unless that leaves nothing
//   similar = |A ∩ B| / min(|A|, |B|) >= 0.5  AND  (two or more tokens shared, OR the last token of both is the same one)
// (token Jaccard was measured first: on the 12 finds of a real run the near-duplicate pairs scored 0.25 to 0.33, so a 0.5 Jaccard flags none.)
// Plain JS on purpose: the acceptance scorer (tests/acceptance/lib/finds.mjs) imports it under node without a build.

export const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with'])
export const GENERIC = new Set(['reading', 'sense', 'skill', 'technique', 'trick', 'awareness', 'detection', 'control', 'sight', 'vision'])

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/'/g, '')

/** The name's words in spoken order, no stopwords, no repeats. */
function words(nameEn) {
    const out = []
    for (const w of fold(nameEn).split(/[^a-z0-9]+/)) if (w && !STOPWORDS.has(w) && !out.includes(w)) out.push(w)
    return out
}

/** The tokens that identify the find: its words without the generic ones (all of them when nothing else is left). */
export function similarTokens(nameEn) {
    const all = words(nameEn)
    const keep = all.filter((w) => !GENERIC.has(w))
    return keep.length ? keep : all
}

export function similar(a, b) {
    const A = similarTokens(a), B = similarTokens(b)
    if (!A.length || !B.length) return false
    const shared = A.filter((w) => B.includes(w))
    if (!shared.length) return false
    if (shared.length / Math.min(A.length, B.length) < 0.5) return false
    return shared.length >= 2 || A[A.length - 1] === B[B.length - 1]
}
