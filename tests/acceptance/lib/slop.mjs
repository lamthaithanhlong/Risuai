// Model-free, REPORT-ONLY metrics for machine-sounding Vietnamese narration (idea from slopless: stock gestures, perception verbs,
// repeated openers, filler lines). No pass/fail: slopReport returns numbers and the hits behind them; higher score = more machine-like.
// Dependency-free. JS \b does not know Vietnamese letters, so every word match uses unicode lookarounds with the u flag.

export const STOCK_PHRASES = [
    'khẽ', 'thoáng', 'một thoáng', 'khựng lại', 'nụ cười tinh quái', 'không biết từ lúc nào', 'như thể', 'nhợt nhạt', 'mùi tanh',
    'tim đập thình thịch', 'hơi thở nghẹn lại', 'ánh mắt dừng lại', 'đôi mắt', 'lặng lẽ', 'khẽ nghiêng đầu', 'giữa không trung',
    'nín thở', 'sống lưng lạnh toát', 'một cảm giác lạ', 'bất giác', 'chậm rãi', 'trầm giọng', 'khóe môi cong lên', 'nụ cười nhạt',
    'ánh mắt sắc lạnh', 'không khí đặc quánh', 'tim như ngừng đập', 'dường như', 'phảng phất', 'len lỏi', 'nặng nề', 'căng thẳng đến nghẹt thở',
    'hít một hơi sâu', 'siết chặt', 'cắn nhẹ môi', 'ánh nhìn', 'đáy mắt', 'thì thầm', 'rùng mình', 'tiếng tim đập',
]
export const PERCEPTION = ['nghe thấy', 'nhìn thấy', 'cảm thấy', 'lắng nghe', 'thấy', 'nhìn', 'ngửi'] // longest first so "nghe thấy" counts once
const QUIET = ['im', 'im lặng', 'yên', 'yên tĩnh', 'tĩnh lặng', 'lặng im', 'lặng ngắt', 'vắng lặng', 'vẫn yên', 'không động đậy', 'không nhúc nhích',
    'không (?:có )?(?:một )?(?:tiếng|âm thanh)(?: động)?(?: nào)?', 'chẳng (?:có )?(?:một )?tiếng', 'không còn tiếng']

const L = '(?<!\\p{L})', R = '(?!\\p{L})'
const alt = (list) => new RegExp(`${L}(?:${list.map((p) => p.replace(/ /g, '\\s+')).join('|')})${R}`, 'giu')
const reStock = () => alt([...STOCK_PHRASES].sort((a, b) => b.length - a.length))
const rePerc = () => alt(PERCEPTION)
const reQuiet = () => new RegExp(`${L}(?:${QUIET.map((p) => p.replace(/ /g, '\\s+')).join('|')})${R}`, 'iu')

const words = (s) => String(s).match(/[\p{L}\p{N}]+/gu) ?? []
/** A reply's prose: the trailing [💡…] choice block and bare bracket lines are not narration. */
const prose = (r) => String(r ?? '').split('\n').filter((l) => !/^\s*\[/.test(l)).join('\n')
export const splitSentences = (s) => prose(s).split(/(?<=[.!?…”"])\s+|\n+/).map((x) => x.trim()).filter((x) => words(x).length > 0)
const per100 = (n, w) => (w ? (n / w) * 100 : 0)

/** Stock gestures per 100 words, with the matches. */
export function stockGestures(replies) {
    let n = 0, w = 0; const hits = []
    replies.forEach((r, i) => {
        const t = prose(r); w += words(t).length
        for (const m of t.matchAll(reStock())) { n++; hits.push({ rule: 'stock', reply: i, text: m[0] }) }
    })
    return { count: n, per100: per100(n, w), hits }
}

/** Perception verbs (nghe thấy, thấy, nhìn, cảm thấy, ngửi, lắng nghe) per 100 words. */
export function perceptionDensity(replies) {
    let n = 0, w = 0; const hits = []
    replies.forEach((r, i) => {
        const t = prose(r); w += words(t).length
        for (const m of t.matchAll(rePerc())) { n++; hits.push({ rule: 'perception', reply: i, text: m[0] }) }
    })
    return { count: n, per100: per100(n, w), hits }
}

/** Share of sentences (across all replies) that open with the most common first two words. Needs >= 2 repeats to be a hit. */
export function openerRepetition(replies) {
    const counts = new Map(); let total = 0
    for (const r of replies) for (const s of splitSentences(r)) {
        const w = words(s.toLowerCase()); if (w.length < 3) continue
        const k = `${w[0]} ${w[1]}`; counts.set(k, (counts.get(k) ?? 0) + 1); total++
    }
    let top = '', topN = 0
    for (const [k, c] of counts) if (c > topN) { top = k; topN = c }
    const hits = topN >= 2 ? [{ rule: 'opener', reply: -1, text: `${top} (${topN}/${total})` }] : []
    return { opener: top, topShare: total ? topN / total : 0, total, hits }
}

/** Sentences of <= 6 words that only describe silence / stillness, per reply. */
export function quietFiller(replies) {
    const perReply = []; const hits = []
    replies.forEach((r, i) => {
        let n = 0
        for (const s of splitSentences(r)) if (words(s).length <= 6 && reQuiet().test(s)) { n++; hits.push({ rule: 'quiet', reply: i, text: s }) }
        perReply.push(n)
    })
    return { count: perReply.reduce((a, b) => a + b, 0), perReply, hits }
}

/** Replies that end on >= 2 consecutive short sentences (<= 7 words): the "nothing changed" tail. */
export function tailPattern(replies) {
    const hits = []
    replies.forEach((r, i) => {
        const ss = splitSentences(r); let k = 0
        while (k < ss.length && words(ss[ss.length - 1 - k]).length <= 7) k++
        if (k >= 2) hits.push({ rule: 'tail', reply: i, text: ss.slice(-k).join(' ') })
    })
    return { count: hits.length, hits }
}

const WEIGHTS = { stock: 2, perception: 1, opener: 10, quiet: 1.5, tail: 3 }
export function slopReport(replies) {
    const rs = (replies ?? []).map((r) => String(r ?? ''))
    const a = stockGestures(rs), b = perceptionDensity(rs), c = openerRepetition(rs), d = quietFiller(rs), e = tailPattern(rs)
    const n = Math.max(rs.length, 1)
    const metrics = {
        stockPer100: a.per100, perceptionPer100: b.per100, openerTopShare: c.topShare, openerTop: c.opener,
        quietPerReply: d.count / n, quietCount: d.count, tailCount: e.count, replies: rs.length,
    }
    const score = WEIGHTS.stock * a.per100 + WEIGHTS.perception * b.per100 + WEIGHTS.opener * c.topShare + WEIGHTS.quiet * metrics.quietPerReply + WEIGHTS.tail * (e.count / n)
    return { metrics, hits: [...a.hits, ...b.hits, ...c.hits, ...d.hits, ...e.hits], score }
}
