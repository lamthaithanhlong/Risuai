/**
 * Turns every closed <Thoughts>…</Thoughts> block into a collapsible <details>.
 * A block with nothing after it is the model still thinking (reasoning streams first, the reply
 * arrives at the end), so the thought text is hidden behind a "Thinking..." line; once reply text
 * follows, it becomes the folded block with the thoughts inside.
 */
export function wrapThoughts(data: string, label: string): string {
    let result = '', i = 0
    while (i < data.length) {
        if (data.slice(i, i + 10) === '<Thoughts>') {
            let j = i + 10, depth = 1
            while (j < data.length && depth > 0) {
                if (data.slice(j, j + 10) === '<Thoughts>') depth++
                if (data.slice(j, j + 11) === '</Thoughts>') depth--
                j++
            }
            if (depth === 0) {
                const thinking = data.slice(j + 10).trim() === ''
                result += thinking
                    ? `<div class="x-risu-thinking" style="opacity:.65;font-style:italic">Thinking...</div>`
                    : `<details><summary>${label}</summary>${data.substring(i + 10, j - 1)}</details>`
                i = j + 10
                continue
            }
        }
        result += data[i++]
    }
    return result
}
