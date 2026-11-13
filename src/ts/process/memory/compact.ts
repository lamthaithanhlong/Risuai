// /compact and autocompact (owner 2026-11-13: "Tạo tính năng compact và autocompact memory đi").
//
// Measured that day on the live save: HypaV3 was on globally, yet 12 of 16 cards had their own memory switch off and no chat had
// a single summary. A card with the switch off loses its oldest messages once the chat outgrows the context: they are cut, not
// summarised. Two things fix that without a per-card setting:
//   autocompact  the memory phase runs for EVERY card once the request is over a limit (the model context, or a lower number the
//                owner types with /autocompact N), and keeps running for a chat that already has summaries;
//   /compact     summarise now everything but the last few messages, whatever the size.
// This file is the arithmetic only, so it can be tested without the app; compactCommand.ts does the work.

export interface CompactMsg { chatId?: string; role: string; data: string }

/** Below this a limit would summarise on nearly every turn: the system prompt and lore alone are several thousand tokens. */
export const AUTOCOMPACT_MIN = 4000

/** The token count HypaV3 starts summarising at: the context, or the owner's lower number. Never above the context. */
export function compactLimit(maxContextTokens: number, autoCompact: boolean, autoCompactTokens: number): number {
    if (!autoCompact) return maxContextTokens
    if (typeof autoCompactTokens !== 'number' || !Number.isFinite(autoCompactTokens) || autoCompactTokens <= 0) return maxContextTokens
    return Math.min(maxContextTokens, Math.max(AUTOCOMPACT_MIN, Math.floor(autoCompactTokens)))
}

/** Whether this request goes through the memory phase. A card with its switch off is left alone until it needs compacting. */
export function memoryPhaseOn(a: { cardSwitch: boolean, autoCompact: boolean, hasSummaries: boolean, currentTokens: number, limit: number }): boolean {
    if (a.cardSwitch) return true
    return a.autoCompact && (a.hasSummaries || a.currentTokens > a.limit)
}

/**
 * The messages /compact summarises, in chunks of `per`: everything after the last message a summary already covers, except the
 * last `keep`. Empty messages are left out. `covered` holds the chatIds in existing summaries.
 */
export function pickCompactChunks<T extends CompactMsg>(messages: T[], covered: Set<string>, keep: number, per: number): T[][] {
    const size = Number.isFinite(per) && per >= 1 ? Math.floor(per) : 6
    const tail = Number.isFinite(keep) && keep >= 0 ? Math.floor(keep) : 3
    let start = 0
    for (let i = 0; i < messages.length; i++) if (messages[i].chatId && covered.has(messages[i].chatId)) start = i + 1
    const todo = messages.slice(start, Math.max(start, messages.length - tail)).filter((m) => (m.data ?? '').trim() !== '')
    const chunks: T[][] = []
    for (let i = 0; i < todo.length; i += size) chunks.push(todo.slice(i, i + size))
    return chunks
}

export type AutocompactArg = { kind: 'show' } | { kind: 'off' } | { kind: 'on' } | { kind: 'set', tokens: number } | { kind: 'bad' }

/** "/autocompact", "/autocompact off|on", "/autocompact 20000", "/autocompact 20k". */
export function parseAutocompactArg(arg: string): AutocompactArg {
    const s = (arg ?? '').trim().toLowerCase()
    if (s === '') return { kind: 'show' }
    if (['off', 'tắt', 'tat'].includes(s)) return { kind: 'off' }
    if (['on', 'bật', 'bat'].includes(s)) return { kind: 'on' }
    const m = /^(\d+(?:,\d{3})*|\d+\.\d+|\d+)(k?)$/.exec(s)
    if (!m) return { kind: 'bad' }
    const n = Number(m[1].replace(/,/g, '')) * (m[2] ? 1000 : 1)
    return Number.isFinite(n) && n >= 1 ? { kind: 'set', tokens: Math.round(n) } : { kind: 'bad' }
}
