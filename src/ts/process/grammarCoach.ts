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
export function lessonHtml(l: Lesson): string {
    const parts = l.parts.map((p) => `<div style="margin-left:.8em">• <s style="opacity:.65">${esc(p.wrong)}</s> → <b>${esc(p.right)}</b>`
        + `${p.why ? ` <span style="opacity:.8">— ${esc(p.why)}</span>` : ''}</div>`).join('')
    return `\n\n<div style="margin-top:.4em;font-size:.85em;opacity:.92;border-left:2px solid #8fb8ff;padding-left:.5em">`
        + `<span style="color:#8fb8ff;font-weight:600">Ngữ pháp · nên nói:</span> <b>${esc(l.fix)}</b>`
        + ` <span style="opacity:.6">(bạn viết: ${esc(l.wrote)})</span>${parts}`
        + `${l.point ? `<div style="margin-left:.8em;opacity:.85"><span style="color:#8fb8ff">Nhớ:</span> ${esc(l.point)}</div>` : ''}</div>`
}
