/**
 * Turns every closed <Thoughts>…</Thoughts> block into a collapsible <details>.
 * A block with nothing after it is the model still thinking (reasoning streams first, the reply
 * arrives at the end), so the thought text is hidden behind a "Thinking..." line; once reply text
 * follows, it becomes the folded block with the thoughts inside.
 *
 * One pass finds every tag and pairs each closing tag with the latest unmatched opening one (a stack), so the cost is
 * linear. The first version rescanned to the end of the text from every unclosed opening tag: 3,333 of them in 200 KB took
 * 4.9 s (measured), and the text shown while the model is still thinking is exactly that shape.
 */
const OPEN = '<Thoughts>'
const CLOSE = '</Thoughts>'

export function wrapThoughts(data: string, label: string): string {
    if (!data.includes(OPEN)) {
        return data
    }
    // closeOf.get(i): where the closing tag of the opening tag at i starts
    const closeOf = new Map<number, number>()
    const open: number[] = []
    const tag = /<Thoughts>|<\/Thoughts>/g
    for (let m = tag.exec(data); m; m = tag.exec(data)) {
        if (m[0] === OPEN) {
            open.push(m.index)
        } else {
            const start = open.pop()
            if (start !== undefined) {
                closeOf.set(start, m.index)
            }
        }
    }

    // where the last non-blank character ends: a block that ends at or after it has nothing visible after it
    const textEnd = data.trimEnd().length
    let result = '', i = 0
    while (i < data.length) {
        const close = data.startsWith(OPEN, i) ? closeOf.get(i) : undefined
        if (close !== undefined) {
            const end = close + CLOSE.length
            const thinking = textEnd <= end
            result += thinking
                ? `<div class="x-risu-thinking" style="opacity:.65;font-style:italic">Thinking...</div>`
                : `<details><summary>${label}</summary>${data.substring(i + OPEN.length, close)}</details>`
            i = end
            continue
        }
        // copy up to the next place a block could start
        const next = data.indexOf(OPEN, i + 1)
        const stop = next === -1 ? data.length : next
        result += data.slice(i, stop)
        i = stop
    }
    return result
}
