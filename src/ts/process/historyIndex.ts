// The chat history through a table of contents (asked 2026-10-16: "chỉ cần 1 mục lục và AI tra mục lục đó rất tốn ít token
// và lại chính xác"). Until the context is full Risu sent every message of the chat, every turn. Now a long chat keeps its
// last messages whole, and the older ones become one line each (written once by the helper model and kept with the chat);
// each turn the helper reads that table with the latest messages and names the older messages the reply needs in full.
//
// Measured on the Alternate Hunters chat (50 messages) with six questions only an old message answers (the age given at
// registration, the fee, the MP a skill cost …), two replies each:
//   every message      recall 12/12   28,707 prompt tokens
//   last 6 only        recall  0/12   14,462
//   table + picks      recall 12/12   16,213 + 2,904 for the helper's pick (-33%)

export type HistMsg = { role: string; content: unknown; memo?: string }

/** The last messages kept whole. */
export const KEEP_RECENT = 6
/** Fewer older messages than this: nothing to gain, the history is sent as it is. */
export const MIN_OLD = 8
/** At most this many older messages are put back in full a turn. */
export const MAX_PICKS = 3
export const INDEX_MEMO = 'historyIndex'

/** Where the chat's messages are in the history (by their memo, the message's chatId), and which of them are old. */
export function splitForIndex(chats: HistMsg[], messageIds: Set<string>): { old: number[]; recent: number[] } | null {
    const at = chats.map((c, i) => (c.memo && messageIds.has(c.memo) && typeof c.content === 'string' ? i : -1)).filter((i) => i >= 0)
    if (at.length - KEEP_RECENT < MIN_OLD) return null
    return { old: at.slice(0, at.length - KEEP_RECENT), recent: at.slice(at.length - KEEP_RECENT) }
}

const who = (role: string) => (role === 'user' ? 'PLAYER' : 'STORY')

/** The ask that writes the table's missing lines. */
export function tocPrompt(items: { n: number; role: string; text: string }[]): string {
    return 'Below are numbered messages of a story chat. Write a table of contents: one line per message, "#N: " then at most 18'
        + ' words saying what happens or what is said there, naming people, places, items and numbers that matter. Only the lines.\n\n'
        + items.map((m) => `#${m.n} ${who(m.role)}: ${m.text.slice(0, 2500)}`).join('\n\n')
}

/** The lines of the answer, by number. */
export function parseToc(answer: string): Map<number, string> {
    const out = new Map<number, string>()
    for (const m of (answer ?? '').matchAll(/^\s*#(\d+)\s*[:.)-]\s*(.+?)\s*$/gm)) out.set(parseInt(m[1], 10), m[2])
    return out
}

export function pickPrompt(toc: string, recent: string, now: string): string {
    return 'Below is the table of contents of a story chat (one line per old message), then its latest messages and the player\'s new'
        + ` message. Which old messages does the next reply need to read in full to stay true to what happened? Answer with only the numbers, at most ${MAX_PICKS}, or "none".`
        + `\n\nTABLE OF CONTENTS\n${toc}\n\nLATEST\n${recent}\n\nPLAYER NOW\n${now}`
}

export function parsePicks(answer: string, n: number): number[] {
    if (/^\s*none\b/i.test(answer ?? '')) return []
    const out: number[] = []
    for (const m of (answer ?? '').matchAll(/\d+/g)) {
        const k = parseInt(m[0], 10)
        if (k >= 1 && k <= n && !out.includes(k)) out.push(k)
        if (out.length >= MAX_PICKS) break
    }
    return out
}

/** The table as sent: "#N: line" for every old message. */
export function tocText(lines: string[]): string {
    return lines.map((l, i) => `#${i + 1}: ${l}`).join('\n')
}

/** The history with its old messages replaced by the table and the picked ones, at the place of the first old message. */
export function indexedHistory<T extends HistMsg>(chats: T[], old: number[], lines: string[], picks: number[], make: (content: string) => T): T[] {
    const oldSet = new Set(old)
    let block = '[Story so far: table of contents of the earlier messages]\n' + tocText(lines)
    if (picks.length) {
        block += '\n\n[Earlier messages in full, as the story needs them now]\n' + picks
            .sort((a, b) => a - b)
            .map((k) => `#${k} ${who(chats[old[k - 1]].role)}: ${chats[old[k - 1]].content as string}`)
            .join('\n\n')
    }
    const out: T[] = []
    chats.forEach((c, i) => {
        if (i === old[0]) out.push(make(block))
        if (!oldSet.has(i)) out.push(c)
    })
    return out
}
