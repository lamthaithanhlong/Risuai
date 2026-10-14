/**
 * Splits a reply into the text the chat shows and the model's chain of thought (<Thoughts>…</Thoughts>).
 *
 * Why: the thought used to stay inside the message, so it went through every display stage (asset macros, regex scripts, markdown,
 * the sanitizer, the translator) on every streamed chunk, and the same text was saved with the chat. Now only `main` goes through
 * those stages; the thought is shown in its own panel as plain text.
 *
 * Rules (one linear pass, no backtracking):
 *  - a block is the outermost <Thoughts> up to its matching </Thoughts>; tags inside it are part of the thought
 *  - a closing tag with no opening tag is ordinary text, except a </think> before any thought in the reply: some models leave the
 *    opening tag out and write "reasoning</think>reply", so the text before it is the thought
 *  - an opening tag that is never closed starts a thought that is still being written: everything after it is the thought,
 *    `thinking` is true
 *  - while streaming, the end of the text may be half a tag ("<Thou"): from two characters on it is held back (`pending`) so it never
 *    flashes in the chat and then disappears; a lone "<" is shown
 *  - nothing is lost: the original is the pieces in `parts`, in order, joined (see cot.test.ts)
 */
// Risu writes <Thoughts>; models reached through a custom API often write <think> (or <thinking>) themselves, in the reply text
const OPEN_TAGS = ['<Thoughts>', '<think>', '<thinking>']
const CLOSE_TAGS = ['</Thoughts>', '</think>', '</thinking>']
const TAG = /<\/?(?:Thoughts|think|thinking)>/g
const isOpen = (t: string) => !t.startsWith('</')

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

/** length of the longest proper prefix (at least 2 characters) of any of `tags` that `s` ends with, else 0 */
function partialTagAtEnd(s: string, tags: string[]): number {
    let best = 0
    for (const tag of tags) {
        for (let n = Math.min(tag.length - 1, s.length); n > best && n >= 2; n--) {
            if (s.endsWith(tag.slice(0, n))) { best = n; break }
        }
    }
    return best
}

export function splitCoT(data: string): CoTSplit {
    if (!data) {
        return { main: '', thoughts: [], thinking: false, parts: [] }
    }
    if (!/<(?:Thoughts|think|thinking)>|<\/think(?:ing)?>/.test(data)) {
        const held = partialTagAtEnd(data, OPEN_TAGS)
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
    const tag = new RegExp(TAG.source, 'g')
    for (let m = tag.exec(data); m; m = tag.exec(data)) {
        if (isOpen(m[0])) {
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
                const open = data.slice(blockStart).match(/^<[A-Za-z]+>/)![0]
                thoughts.push(data.slice(blockStart + open.length, m.index))
                parts.push({ kind: 'thought', text: data.slice(blockStart, m.index + m[0].length) })
                textStart = m.index + m[0].length
                blockStart = -1
            }
        } else if (m[0] !== '</Thoughts>' && thoughts.length === 0 && textStart === 0 && m.index > 0) {
            // "reasoning</think>reply": the opening tag was left out, the thought starts at the beginning
            thoughts.push(data.slice(0, m.index))
            parts.push({ kind: 'thought', text: data.slice(0, m.index + m[0].length) })
            textStart = m.index + m[0].length
        }
    }
    if (depth > 0) {
        // the model is still writing this thought; half a closing tag at the end is not thought text yet
        const open = data.slice(blockStart).match(/^<[A-Za-z]+>/)![0]
        const body = data.slice(blockStart + open.length)
        const held = partialTagAtEnd(body, CLOSE_TAGS)
        thoughts.push(held ? body.slice(0, body.length - held) : body)
        parts.push({ kind: 'thought', text: data.slice(blockStart), unclosed: true })
        thinking = true
    } else if (textStart < data.length) {
        let t = data.slice(textStart)
        const held = partialTagAtEnd(t, OPEN_TAGS)
        if (held) {
            t = t.slice(0, t.length - held)
            if (t) parts.push({ kind: 'text', text: t })
            parts.push({ kind: 'pending', text: data.slice(data.length - held) })
        } else {
            parts.push({ kind: 'text', text: t })
        }
        main += t
    }
    // a closing tag that closes nothing is markup, not text: dropping it also keeps a second split of `main` from reading it as the
    // end of an implicit thought
    main = main.replace(/<\/think(?:ing)?>/g, '')
    return { main, thoughts, thinking, parts }
}

/** The thought as one string for the panel: blocks separated by a blank line, each trimmed. */
export function thoughtText(split: CoTSplit): string {
    return split.thoughts.map((t) => t.trim()).filter(Boolean).join('\n\n')
}
