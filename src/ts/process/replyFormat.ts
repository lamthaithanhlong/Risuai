// A story's reply format, kept for every story (asked 2026-10-16: "cháu đang nói mọi truyện cơ", on the low reasoning effort
// after the opening). On Alternate Hunters, whose replies end with "[💡Request Profile| …]" then the status line
// ("☆ [Date: … | EXP …]", 8 of its last 10 replies), the model kept that ending in 1 of 6 replies at the default effort and
// 4 of 6 at low; with this reminder, read from the replies themselves, 6 of 6 at low (lore 2, state 0 faults, against 1 / 0
// at the default). The model forgets the shape of its own replies; the reminder gives it back, for any card.
//
// Only panel lines count: a line in brackets with fields ("[Date: … | Time: … ]", "☆ [ … | … ]"). In-story system text
// ("[Ngươi đã bước vào Cơn Ác Mộng Đầu Tiên.]") and the script blocks a card writes only when something changed
// ([[STATUS …]], [[img: …]]) are not part of the shape.

const THOUGHTS = /<(Thoughts|think|thinking)>[\s\S]*?<\/\1>/gi
/** A panel line: optional mark, a bracket, a label, and at least one "|" field separator inside. */
const PANEL = /^\s*([☆★◆◇■□●○▶►※]\s*)?[[【]([^\]\]【】\n]*\|[^\]】\n]*)[\]】]\s*$/

export type ReplyShape = { head: string[]; tail: string[] }

/** The label a panel line starts with: "☆ [Date:", "[💡Request Profile|". */
function labelOf(line: string): string {
    const t = line.trim()
    const m = /^([☆★◆◇■□●○▶►※]\s*)?([[【])\s*([^:|\]】]{1,40})([:|])/.exec(t)
    return m ? `${m[1] ?? ''}${m[2]}${m[3].trim()}${m[4]}` : t.slice(0, 24)
}

/** The panel lines that open and close the last reply, in their order (AH ends with the status line, then the profile). */
export function replyShape(reply: string): ReplyShape {
    const lines = (reply ?? '').replace(THOUGHTS, '').replace(/\[\[[\s\S]*?\]\]/g, '').split('\n').map((l) => l.trim()).filter(Boolean)
    const head: string[] = []
    const tail: string[] = []
    for (const l of lines) { if (!PANEL.test(l)) break; head.push(labelOf(l)) }
    for (let i = lines.length - 1; i >= head.length; i--) { if (!PANEL.test(lines[i])) break; tail.unshift(labelOf(lines[i])) }
    // a reply that is nothing but panels has no shape worth keeping
    if (head.length + tail.length >= lines.length) return { head: [], tail: [] }
    return { head, tail }
}

/**
 * The story's shape: the one most of its last replies share (at least two of them). One reply is not a rule: measured on
 * Alternate Hunters, the last reply had lost its status line, and a reminder copied from it made 6 of 6 new replies drop
 * it too; 8 of its last 10 replies end with the profile line, then the status line.
 */
export function storyShape(replies: string[], look = 5): ReplyShape {
    const counts = new Map<string, { n: number; shape: ReplyShape }>()
    for (const r of replies.slice(-look)) {
        const sh = replyShape(r)
        if (!sh.head.length && !sh.tail.length) continue
        const key = JSON.stringify(sh)
        counts.set(key, { n: (counts.get(key)?.n ?? 0) + 1, shape: sh })
    }
    const best = [...counts.values()].sort((a, b) => b.n - a.n)[0]
    return best && best.n >= 2 ? best.shape : { head: [], tail: [] }
}

const quoteAll = (labels: string[]) => labels.map((l) => `"${l} …]"`).join(', then ')

/** The reminder, or '' for a story whose replies have no panel at either end. */
export function shapeReminder(shape: ReplyShape): string {
    if (!shape.head.length && !shape.tail.length) return ''
    const parts: string[] = []
    if (shape.head.length) parts.push(`open with ${quoteAll(shape.head)}`)
    if (shape.tail.length) parts.push(`after the story, end with ${quoteAll(shape.tail)}, in this order, nothing after`)
    return `\n\n[Format, as in your recent replies: ${parts.join('; ')}. In those lines every value stays as it was unless this reply changes it.]`
}

/** The reminder at the end of the player's message, on every story turn after the opening, for a story whose replies have
 *  an established shape. */
export function shapeRequest<T extends { role: string; content: unknown }>(formated: T[], messages: { role: string; data: string }[] | undefined): T[] {
    const replies = (messages ?? []).filter((m) => m.role === 'char').map((m) => m.data ?? '')
    const note = shapeReminder(storyShape(replies))
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (!note || last < 0 || typeof formated[last].content !== 'string') return formated
    return formated.map((m, i) => (i === last ? { ...m, content: (m.content as string) + note } : m))
}
