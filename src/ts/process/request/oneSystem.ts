// One system message, at the top (measured 2026-10-16 on the Custom API through 9router to Codex): only the first system
// message reaches the model. A code word in a second system message, at the top or mid-conversation, was answered "KHÔNG
// BIẾT"; a 3,000-word system message in the middle added 12 prompt tokens, the same text as a user message 3,031. The real
// story request at 12:29 lost 2,285 of its 55,320 characters on the way to Codex: what Risu puts as system messages near the
// end (lore at @@depth 0 such as Alternate Hunters' status window rules, the portrait note, the author's note).
// So for the Custom API the leading system messages are joined into one and every later one is sent as the user's, the way
// Risu already sends them to models that take only a first system prompt ("system: …").

type Msg = { role: string; content: unknown }

export function oneSystemMessage<T extends Msg>(chat: T[], label = (s: string) => `system: ${s}`): T[] {
    const out: T[] = []
    let i = 0
    while (i < chat.length && chat[i].role === 'system') {
        const m = chat[i]
        const prev = out[0]
        if (prev && typeof prev.content === 'string' && typeof m.content === 'string') {
            out[0] = { ...prev, content: `${prev.content}\n\n${m.content}` }
        } else if (!prev) {
            out.push(m)
        } else {
            out.push({ ...m, role: 'user', content: typeof m.content === 'string' ? label(m.content) : m.content })
        }
        i++
    }
    for (; i < chat.length; i++) {
        const m = chat[i]
        if (m.role !== 'system') { out.push(m); continue }
        out.push({ ...m, role: 'user', content: typeof m.content === 'string' ? label(m.content) : m.content })
    }
    return out
}
