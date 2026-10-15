// "Drawing the picture" status. A picture takes one to two minutes, and while it is drawn nothing else on the page moves, so the page shows a
// line with the seconds (GenStatusLine). It is its own small state, apart from the reply phases in genStatus (those are model-checked):
// several pictures can be in flight, the line stays until the last one ends.

export type IllustrateState = { count: number; startedAt: number }

/** One more picture started (delta +1) or ended (-1). The clock starts with the first one and resets when none is left. */
export function nextIllustrate(s: IllustrateState, delta: 1 | -1, now: number): IllustrateState {
    const count = Math.max(0, s.count + delta)
    if (count === 0) return { count: 0, startedAt: 0 }
    return { count, startedAt: s.count === 0 ? now : s.startedAt }
}

/** A finished reply that still carries a [[img: ...]] line: the output trigger is about to draw it. */
export function replyWantsPicture(messages: { role: string; data: string }[]): boolean {
    const last = messages[messages.length - 1]
    return !!last && last.role === 'char' && /\[\[img:/i.test(last.data)
}

export const illustrating = $state<IllustrateState>({ count: 0, startedAt: 0 })

export async function withIllustrating<T>(run: () => Promise<T>): Promise<T> {
    Object.assign(illustrating, nextIllustrate({ ...illustrating }, 1, Date.now()))
    try {
        return await run()
    } finally {
        Object.assign(illustrating, nextIllustrate({ ...illustrating }, -1, Date.now()))
    }
}
