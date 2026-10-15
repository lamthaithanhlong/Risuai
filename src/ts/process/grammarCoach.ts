import { makeAsker } from './vietjiDict'

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

// Shown as steps, in the order the owner asked (2026-10-15): start from the WHOLE sentence they sent (the check line may fix only
// one word: 개 → 게 for 그렇게 개 거기 이다 개 이상하다뭐 그렇다), say it is not grammatical and give the right frame, then their
// words one by one, right in green and wrong in red, then their right nouns and verbs put into the frame ("ok, these are
// right"), then what is wrong or missing (in Korean the verb goes last, so reorder; add the particles), then the finished sentence.

/**
 * The panel's asker: one request per sentence, a good answer kept. A bad one (no JSON, or JSON that does not parse) is not
 * kept, so the next press asks again: it was kept as null, and every later press showed "Chưa phân tích được" without
 * asking (TLC, docs/specs/VietjiDetail.tla, PressAlwaysTries). `request` sends the prompt and gives the model's text.
 */
export function detailAsker(request: (prompt: string) => Promise<string | null>) {
    return makeAsker<Detail>(async (key) => {
        const [lang, sent, hint, meant] = JSON.parse(key) as [string, string, string, string]
        const d = parseDetail((await request(detailPrompt(sent, lang, meant ?? '', hint))) ?? '')
        if (!d) throw new Error('bad answer')
        return d
    })
}

export type DetailPiece = { piece: string; kind: string; heard: string; ok: boolean; why: string }
export type DetailAdd = { add: string; why: string }
export type Detail = { pieces: DetailPiece[]; heard: string; frame: string; filled: string; order: string; adds: DetailAdd[]; final: string; meaning: string }

const NAMES: Record<string, string> = { ja: 'Japanese', zh: 'Chinese (Mandarin)', ko: 'Korean', es: 'Spanish', fr: 'French' }

/** sent: the player's whole message; meant: the Vietnamese they typed for it (bar); hint: the reply's own check, maybe one word. */
export function detailPrompt(sent: string, lang: string, meant = '', hint = ''): string {
    return `A Vietnamese learner of ${NAMES[lang] ?? lang} put this sentence together word by word from Vietnamese and sent it: "${sent}".`
        + (meant ? ` What they meant, in Vietnamese: "${meant}".` : '')
        + (hint ? ` The story's check corrected: ${hint} (it may cover only one word; teach the whole sentence).` : '')
        + ' Keep every idea of theirs; Vietnamese lại after a verb is usually not again (bình tĩnh lại is calm down), and cái is a classifier, not a dog.'
        + ' Teach it in steps, all explanations in short simple Vietnamese. Answer with only JSON:'
        + ' {"frame": "<the right grammar frame for what they meant, slots in brackets, e.g. [Chủ ngữ]는 + [tân ngữ]을 + [động từ]>",'
        + ' "heard": "<what a native understands from their sentence as written, in Vietnamese>",'
        + ' "pieces": [{"piece": "<each word of THEIR sentence, in their order, exactly as they wrote it>", "kind": "<danh từ, động từ, đại từ, trạng từ…>", "heard": "<its meaning as written>", "ok": <true if this word is the right word for what they meant (form may change)>, "why": "<if not ok: what is wrong>"}],'
        + ' "filled": "<the sentence in the right order with only THEIR right words in it and ___ for each missing part, written as a sentence: no brackets, no + signs>",'
        + ' "order": "<how this language orders the sentence unlike Vietnamese, and what to move, one sentence>",'
        + ' "adds": [{"add": "<what to add or change, in the language: a particle, an ending, a word>", "why": "<why, in Vietnamese>"}],'
        + ' "final": "<the finished natural sentence>", "meaning": "<its meaning in Vietnamese>"}'
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export function parseDetail(answer: string): Detail | null {
    const m = /\{[\s\S]*\}/.exec(answer ?? '')
    if (!m) return null
    try {
        const j = JSON.parse(m[0])
        const pieces: DetailPiece[] = (Array.isArray(j.pieces) ? j.pieces : []).filter((p: any) => p && typeof p.piece === 'string' && p.piece.trim())
            .map((p: any) => ({ piece: p.piece.trim(), kind: str(p.kind), heard: str(p.heard), ok: p.ok === true, why: str(p.why) }))
        const adds: DetailAdd[] = (Array.isArray(j.adds) ? j.adds : []).filter((a: any) => a && typeof a.add === 'string')
            .map((a: any) => ({ add: a.add, why: str(a.why) })).slice(0, 8)
        const final = str(j.final).trim()
        if (!pieces.length || !final) return null
        return { pieces, heard: str(j.heard), frame: str(j.frame), filled: str(j.filled), order: str(j.order), adds, final, meaning: str(j.meaning) }
    } catch {
        return null
    }
}

/** The player's message the reply answers: the newest user message before the reply at `at` (data-chat-index). */
export function sentBefore(messages: { role: string; data: string }[] | undefined, at: number | null): string {
    if (!messages?.length) return ''
    for (let k = Math.min(at ?? messages.length, messages.length) - 1; k >= 0; k--) {
        if (messages[k]?.role === 'user') return (messages[k].data ?? '').trim()
    }
    return ''
}

/** A sentence as words with the Việt-ji under each; gaps (___) as empty dashed slots; words from `right` in green
 *  (Risu's text-green-500), from `wrong` in red (text-red-500). */
const GAP = '<span style="display:inline-block;min-width:2.4em;border-bottom:2px dashed #e0a46b;margin:0 .2em;vertical-align:top">&nbsp;</span>'
const GREEN = '#22c55e', RED = '#ef4444'
export function filledHtml(filled: string, right: string[] = [], wrong: string[] = []): string {
    const has = (list: string[], t: string) => list.some((w) => w && (t === w || t.startsWith(w) || w.startsWith(t.replace(/[.?!。？！,，]+$/, ''))))
    return (filled ?? '').split(/(_{2,}|\s+)/).filter((t) => t !== '').map((t) => {
        if (/^_{2,}$/.test(t)) return GAP
        if (/^\s+$/.test(t)) return ' '
        const v = FOREIGN_RUN.test(t) ? readAloud(t) : null
        FOREIGN_RUN.lastIndex = 0
        const color = has(right, t) ? `color:${GREEN}` : has(wrong, t) ? `color:${RED}` : ''
        return v ? `<span style="display:inline-flex;flex-direction:column;align-items:center;vertical-align:top;margin:0 .1em">`
            + `${color ? `<span style="${color}">` : '<span>'}${esc(t)}</span><span style="font-size:.7em;color:#f2c76b;font-weight:600">${esc(v)}</span></span>`
            : color ? `<span style="${color}">${esc(t)}</span>` : esc(t)
    }).join('')
}

export const DETAIL_BUTTON = '<span title="Chi tiết ngữ pháp" style="cursor:pointer;margin-left:.5em;padding:0 .4em;border:1px solid #8fb8ff66;border-radius:.6em;font-size:.9em;user-select:none">🔍 Chi tiết</span>'

/** Presses on a "Chi tiết" button in a message: the note's sentence (first <b>), what it struck (first <s>), and the index
 *  of the message it sits in, so the player's whole sentence before it can be found. */
export function installDetailButton(open: (fix: string, wrote: string, at: number | null) => void) {
    const handler = (e: MouseEvent) => {
        const t = e.target as Element | null
        if (t?.getAttribute?.('title') !== 'Chi tiết ngữ pháp') return
        const note = t.closest('div[data-vj-note], div') as Element | null
        const fix = note?.querySelector('b')?.textContent?.trim() ?? ''
        const wrote = note?.querySelector('s')?.textContent?.trim() ?? ''
        const at = Number((t.closest('[data-chat-index]') as HTMLElement | null)?.dataset.chatIndex)
        if (fix) open(fix, wrote, Number.isFinite(at) ? at : null)
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
