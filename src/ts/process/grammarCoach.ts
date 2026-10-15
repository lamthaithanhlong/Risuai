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

// Shown as steps (asked 2026-10-15: "đưa câu tui dùng dịch từng chỗ… người ta đọc câu bạn sẽ hiểu bạn đang nói thế này nhưng
// sai rồi, chỗ sai ở đâu, sườn ngữ pháp đúng là gì, câu bạn nói chỗ nào đúng bỏ vào sườn, thiếu chỗ nào… rồi cuối cùng 1 câu
// hoàn chỉnh"): the learner's own pieces and how a native hears each, what that whole sounds like, the right frame, their right
// pieces put in it with the gaps left open, what fills each gap, and the finished sentence.

export type DetailPiece = { piece: string; heard: string; ok: boolean; why: string }
export type DetailAdd = { add: string; why: string }
export type Detail = { pieces: DetailPiece[]; heard: string; frame: string; filled: string; adds: DetailAdd[]; final: string; meaning: string }

const NAMES: Record<string, string> = { ja: 'Japanese', zh: 'Chinese (Mandarin)', ko: 'Korean', es: 'Spanish', fr: 'French' }

export function detailPrompt(fix: string, wrote: string, lang: string, meant = ''): string {
    return `A Vietnamese learner of ${NAMES[lang] ?? lang} put a sentence together word by word from Vietnamese: "${wrote}".`
        + (meant ? ` What they meant, in Vietnamese: "${meant}".` : '')
        + ` The natural sentence is "${fix}" (give a better one as final if it drops an idea of theirs, such as I think or should; Vietnamese lại after a verb is usually not again: bình tĩnh lại is calm down).`
        + ' Teach it in steps, all explanations in short simple Vietnamese. Answer with only JSON:'
        + ' {"pieces": [{"piece": "<each piece of what THEY wrote, in their order>", "heard": "<what a native hears from this piece as written>", "ok": <true if the piece can stay as it is>, "why": "<if not ok: what is wrong, in a few words>"}],'
        + ' "heard": "<what a native would understand from their whole sentence, in Vietnamese, word for word>",'
        + ' "frame": "<the right grammar frame, slots in brackets, e.g. [Chủ ngữ]는 + [tân ngữ]을 + [động từ]고 + [nơi] 위로 + [động từ]>",'
        + ' "filled": "<the frame with THEIR right pieces put in, each gap written as ___>",'
        + ' "adds": [{"add": "<what goes into a gap or must change, in the language>", "why": "<why, in Vietnamese>"}],'
        + ' "final": "<the finished natural sentence>", "meaning": "<its meaning in Vietnamese>"}'
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export function parseDetail(answer: string): Detail | null {
    const m = /\{[\s\S]*\}/.exec(answer ?? '')
    if (!m) return null
    try {
        const j = JSON.parse(m[0])
        const pieces: DetailPiece[] = (Array.isArray(j.pieces) ? j.pieces : []).filter((p: any) => p && typeof p.piece === 'string' && p.piece.trim())
            .map((p: any) => ({ piece: p.piece.trim(), heard: str(p.heard), ok: p.ok === true, why: str(p.why) }))
        const adds: DetailAdd[] = (Array.isArray(j.adds) ? j.adds : []).filter((a: any) => a && typeof a.add === 'string')
            .map((a: any) => ({ add: a.add, why: str(a.why) })).slice(0, 8)
        const final = str(j.final).trim()
        if (!pieces.length || !final) return null
        return { pieces, heard: str(j.heard), frame: str(j.frame), filled: str(j.filled), adds, final, meaning: str(j.meaning) }
    } catch {
        return null
    }
}

/** The filled frame: each word with its Việt-ji under it, each gap an empty dashed slot (a reading after a word ran into the
 *  gap next to it: "나는 그na-nưn cư ___ 의 손을 잡고ưi sô-nưl…"). */
const GAP = '<span style="display:inline-block;min-width:2.4em;border-bottom:2px dashed #e0a46b;margin:0 .2em;vertical-align:top">&nbsp;</span>'
export function filledHtml(filled: string): string {
    return (filled ?? '').split(/(_{2,}|\s+)/).filter((t) => t !== '').map((t) => {
        if (/^_{2,}$/.test(t)) return GAP
        if (/^\s+$/.test(t)) return ' '
        const v = FOREIGN_RUN.test(t) ? readAloud(t) : null
        FOREIGN_RUN.lastIndex = 0
        return v ? `<span style="display:inline-flex;flex-direction:column;align-items:center;vertical-align:top;margin:0 .1em">`
            + `<span>${esc(t)}</span><span style="font-size:.7em;color:#f2c76b;font-weight:600">${esc(v)}</span></span>` : esc(t)
    }).join('')
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
