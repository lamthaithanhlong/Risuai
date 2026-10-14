/**
 * Splits a reply into the text the chat shows and the model's chain of thought (<Thoughts>…</Thoughts>).
 *
 * Why: the thought used to stay inside the message, so it went through every display stage (asset macros, regex scripts, markdown,
 * the sanitizer, the translator) on every streamed chunk, and the same text was saved with the chat. Now only `main` goes through
 * those stages; the thought is shown in its own panel as plain text.
 *
 * Rules (one linear pass, no backtracking):
 *  - a block is the outermost <Thoughts> up to its matching </Thoughts>; tags inside it are part of the thought
 *  - a </Thoughts> with no opening tag is ordinary text
 *  - an opening tag that is never closed starts a thought that is still being written: everything after it is the thought,
 *    `thinking` is true
 *  - while streaming, the end of the text may be half a tag ("<Thou"): from two characters on it is held back (`pending`) so it never
 *    flashes in the chat and then disappears; a lone "<" is shown
 *  - nothing is lost: the original is the pieces in `parts`, in order, joined (see cot.test.ts)
 */
const OPEN = '<Thoughts>'
const CLOSE = '</Thoughts>'

export interface CoTPart {
    /** pending: the end of the text looks like the start of a tag that has not fully arrived yet, so it is held back */
    kind: 'text' | 'thought' | 'pending'
    text: string
    /** thought only: the closing tag was never written */
    unclosed?: boolean
}

export interface CoTSplit {
    /** the reply without any thought, what the chat displays */
    main: string
    /** thought texts in order, tags removed */
    thoughts: string[]
    /** true when the last thought has no closing tag yet */
    thinking: boolean
    /** every piece of the original in order; joining the `text` of each gives back the input */
    parts: CoTPart[]
}

/** length of the longest proper prefix of `tag` (at least 2 characters) that `s` ends with, else 0 */
function partialTagAtEnd(s: string, tag: string): number {
    for (let n = Math.min(tag.length - 1, s.length); n >= 2; n--) {
        if (s.endsWith(tag.slice(0, n))) return n
    }
    return 0
}

export function splitCoT(data: string): CoTSplit {
    if (!data) {
        return { main: '', thoughts: [], thinking: false, parts: [] }
    }
    if (!data.includes(OPEN)) {
        const held = partialTagAtEnd(data, OPEN)
        if (held === 0) {
            return { main: data, thoughts: [], thinking: false, parts: [{ kind: 'text', text: data }] }
        }
        const text = data.slice(0, data.length - held)
        return {
            main: text, thoughts: [], thinking: false,
            parts: [...(text ? [{ kind: 'text' as const, text }] : []), { kind: 'pending', text: data.slice(data.length - held) }],
        }
    }
    const parts: CoTPart[] = []
    let main = ''
    const thoughts: string[] = []
    let thinking = false
    let depth = 0
    let textStart = 0
    let blockStart = -1
    const tag = /<Thoughts>|<\/Thoughts>/g
    for (let m = tag.exec(data); m; m = tag.exec(data)) {
        if (m[0] === OPEN) {
            if (depth === 0) {
                if (m.index > textStart) {
                    const t = data.slice(textStart, m.index)
                    parts.push({ kind: 'text', text: t })
                    main += t
                }
                blockStart = m.index
            }
            depth++
        } else if (depth > 0) {
            depth--
            if (depth === 0) {
                thoughts.push(data.slice(blockStart + OPEN.length, m.index))
                parts.push({ kind: 'thought', text: data.slice(blockStart, m.index + CLOSE.length) })
                textStart = m.index + CLOSE.length
                blockStart = -1
            }
        }
    }
    if (depth > 0) {
        // the model is still writing this thought; half a closing tag at the end is not thought text yet
        const body = data.slice(blockStart + OPEN.length)
        const held = partialTagAtEnd(body, CLOSE)
        thoughts.push(held ? body.slice(0, body.length - held) : body)
        parts.push({ kind: 'thought', text: data.slice(blockStart), unclosed: true })
        thinking = true
    } else if (textStart < data.length) {
        let t = data.slice(textStart)
        const held = partialTagAtEnd(t, OPEN)
        if (held) {
            t = t.slice(0, t.length - held)
            if (t) parts.push({ kind: 'text', text: t })
            parts.push({ kind: 'pending', text: data.slice(data.length - held) })
        } else {
            parts.push({ kind: 'text', text: t })
        }
        main += t
    }
    return { main, thoughts, thinking, parts }
}

/** The thought as one string for the panel: blocks separated by a blank line, each trimmed. */
export function thoughtText(split: CoTSplit): string {
    return split.thoughts.map((t) => t.trim()).filter(Boolean).join('\n\n')
}
