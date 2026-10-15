// The grammar lesson under a reply (asked: after sending, the reply shows how it should be said and explains each part, like
// a teacher, in a small line, for every language; the points are kept so mistakes are reminded later).
//
// The story model already writes a check line after each reply; for grammar it now carries the parts:
//   [[CHECK grammar <what was written> → <the natural sentence> | <part> → <right>: <why>; <part> → <right>: <why> | <point>]]
// The older two-field form ([[CHECK grammar a → b | point]]) still reads.

export type CoachPart = { wrong: string; right: string; why: string }
export type Lesson = { wrote: string; fix: string; parts: CoachPart[]; point: string }

/** The parts field: "冷静又起 → 冷静下来: 'bình tĩnh lại' nói là 冷静下来; 该 → 应该: …". */
export function parseParts(field: string): CoachPart[] {
    const out: CoachPart[] = []
    for (const raw of (field ?? '').split(/\s*;\s*/)) {
        const m = /^(.+?)\s*(?:→|->)\s*(.+?)\s*(?::\s*(.*))?$/.exec(raw.trim())
        if (m && m[1] && m[2]) out.push({ wrong: m[1].trim(), right: m[2].trim(), why: (m[3] ?? '').trim() })
    }
    return out.slice(0, 3)
}

/** A grammar check's fields after "grammar": the sentence pair, then parts and point, or the point alone (older form). */
export function parseLesson(body: string): Lesson | null {
    const fields = (body ?? '').split('|').map((s) => s.trim())
    const [wrote, fix] = (fields[0] ?? '').split(/\s*(?:→|->)\s*/)
    if (!wrote || !fix) return null
    if (fields.length >= 3) return { wrote, fix, parts: parseParts(fields[1]), point: fields.slice(2).join(' | ') }
    const parts = parseParts(fields[1] ?? '')
    // two fields: either parts ("a → b: why") or just the point
    return parts.length ? { wrote, fix, parts, point: '' } : { wrote, fix, parts: [], point: fields[1] ?? '' }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/** The small lesson shown under the reply: what to say, each part and why, the point to remember. */
const VJ = 'font-size:.85em;color:#f2c76b;font-weight:600;margin-left:.35em'
/** The Việt-ji of a sentence, set by learningMemory so this file stays free of the readers (phraseVietji). */
let readAloud: (s: string) => string | null = () => null
export function setReader(r: (s: string) => string | null) { readAloud = r }
const reading = (s: string) => { const v = readAloud(s); return v ? `<span style="${VJ}">${esc(v)}</span>` : '' }

/** Text of an explanation with the Việt-ji after each run of Korean, Chinese or Japanese in it (reported: "Dạng lịch sự của
 *  아프다" and "bạn viết: 병" had none). Escaped: the text is the model's. */
const FOREIGN_RUN = /[\uAC00-\uD7A3\u3040-\u30ff\u3400-\u9fff々ー]+(?:\s+[\uAC00-\uD7A3]+)*/g
export function readInline(text: string): string {
    let out = '', at = 0
    for (const m of (text ?? '').matchAll(FOREIGN_RUN)) {
        out += esc(text.slice(at, m.index)) + esc(m[0]) + reading(m[0])
        at = m.index! + m[0].length
    }
    return out + esc((text ?? '').slice(at))
}

export function lessonHtml(l: Lesson): string {
    const parts = l.parts.map((p) => `<div style="margin-left:.8em">• <s style="opacity:.65">${esc(p.wrong)}</s> → <b>${esc(p.right)}</b>${reading(p.right)}`
        + `${p.why ? ` <span style="opacity:.8">— ${readInline(p.why)}</span>` : ''}</div>`).join('')
    // the sentence first (<b>) and what was written (<s>): the "Chi tiết" button reads them from here
    return `\n\n<div style="margin-top:.4em;font-size:.85em;opacity:.92;border-left:2px solid #8fb8ff;padding-left:.5em">`
        + `<span style="color:#8fb8ff;font-weight:600">Ngữ pháp · nên nói:</span> <b>${esc(l.fix)}</b>${reading(l.fix)}${DETAIL_BUTTON}`
        + ` <span style="opacity:.6">(bạn viết: <s>${esc(l.wrote)}</s>${reading(l.wrote)})</span>${parts}`
        + `${l.point ? `<div style="margin-left:.8em;opacity:.85"><span style="color:#8fb8ff">Nhớ:</span> ${readInline(l.point)}</div>` : ''}</div>`
}

// ---- the "Chi tiết" button: the sentence word by word, asked of the model when pressed ---------------------------------------
// Measured on the story model (2026-10-15): 5.8-6.8 s, well-formed JSON for Korean and Chinese (다시 침착하게 생각하자: 침착하게
// "trạng từ chỉ cách thức", 자 "đuôi câu rủ rê", and each change from what was written, with why).

export type DetailWord = { word: string; role: string; meaning: string; note: string }
export type Detail = { pattern: string; words: DetailWord[]; changes: string[] }

const NAMES: Record<string, string> = { ja: 'Japanese', zh: 'Chinese (Mandarin)', ko: 'Korean', es: 'Spanish', fr: 'French' }

export function detailPrompt(fix: string, wrote: string, lang: string): string {
    return `Explain the grammar of this ${NAMES[lang] ?? lang} sentence to a Vietnamese learner, word by word: "${fix}". They had written "${wrote}", word by word from Vietnamese; if the sentence drops an idea of theirs (I think, should) or reads Vietnamese lại after a verb as again (bình tĩnh lại is calm down), say so in changes and give the better sentence. `
        + 'Answer with only JSON: {"pattern": "<the sentence pattern, e.g. Chủ ngữ + 很 + tính từ>", '
        + '"words": [{"word": "<word or ending as written in the sentence>", "role": "<its role, in Vietnamese: chủ ngữ, động từ, đuôi câu…>", '
        + '"meaning": "<its meaning, in Vietnamese>", "note": "<a short note in Vietnamese, or empty>"}], '
        + '"changes": ["<each change from what they wrote, and why, in simple Vietnamese>"]}. Every word of the sentence, in order.'
}

export function parseDetail(answer: string): Detail | null {
    const m = /\{[\s\S]*\}/.exec(answer ?? '')
    if (!m) return null
    try {
        const j = JSON.parse(m[0])
        const words: DetailWord[] = (Array.isArray(j.words) ? j.words : []).filter((w: any) => w && typeof w.word === 'string')
            .map((w: any) => ({ word: w.word, role: String(w.role ?? ''), meaning: String(w.meaning ?? ''), note: String(w.note ?? '') }))
        if (!words.length) return null
        return { pattern: String(j.pattern ?? ''), words, changes: (Array.isArray(j.changes) ? j.changes : []).map(String).slice(0, 8) }
    } catch {
        return null
    }
}

export const DETAIL_BUTTON = '<span title="Chi tiết ngữ pháp" style="cursor:pointer;margin-left:.5em;padding:0 .4em;border:1px solid #8fb8ff66;border-radius:.6em;font-size:.9em;user-select:none">🔍 Chi tiết</span>'

/** Presses on a "Chi tiết" button in a message: the sentence (first <b>) and what was written (first <s>) of its note. */
export function installDetailButton(open: (fix: string, wrote: string) => void) {
    const handler = (e: MouseEvent) => {
        const t = e.target as Element | null
        if (t?.getAttribute?.('title') !== 'Chi tiết ngữ pháp') return
        const note = t.closest('div[data-vj-note], div') as Element | null
        const fix = note?.querySelector('b')?.textContent?.trim() ?? ''
        const wrote = note?.querySelector('s')?.textContent?.trim() ?? ''
        if (fix) open(fix, wrote)
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
}

/** At most 6 detail requests a minute and one every 2 s: each is a model call (about 6 s), a cached sentence costs nothing. */
const asked: number[] = []
export function allowCoach(now = Date.now()): boolean {
    while (asked.length && now - asked[0] > 60_000) asked.shift()
    if (asked.length >= 6 || (asked.length && now - asked[asked.length - 1] < 2_000)) return false
    asked.push(now)
    return true
}
