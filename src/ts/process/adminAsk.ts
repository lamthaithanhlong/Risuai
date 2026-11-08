// An out-of-story message to Admin (owner 2026-11-06): "@admin ...", "/admin ...", "hỏi admin: ...", and "Admin hỏi ..." (any case,
// leading spaces ok). It is never a story turn: the Admin module (admin_module/guard.lua admin_parse_ask, the same rule) counts nothing
// for it, and here no find roll, no loot, no training and no story-turn count is made for it or for Admin's answer. "@admin bug: ..." is a
// report to the Game Master (the module exports it as $admin_report).
// Measured 2026-11-08: "Admin hỏi tí truyện này 3 người đó biết tui ko" was treated as a story beat → narrator invented a substitute lead.

export type AdminAsk = { kind: 'ask' | 'bug', body: string }
type Msg = { role?: string, data?: string }

const LETTER = /[\p{L}\p{N}_]/u

/** The ask a user message is, or null. "@admin" / "/admin" must be followed by a non-letter ("@administrator" is not an ask). */
export function parseAdminAsk(text: string | null | undefined): AdminAsk | null {
    if (typeof text !== 'string') return null
    const t = text.replace(/^[\s ]+/, '')
    const f = t.toLowerCase().normalize('NFC')
    let cut = -1
    for (const p of ['@admin', '/admin']) {
        if (f.startsWith(p) && !(f[p.length] !== undefined && LETTER.test(f[p.length]))) cut = p.length
    }
    if (cut < 0) {
        const m = /^h(?:ỏ|o)i\s+admin\s*:/u.exec(f) ?? /^hoi\s+admin\s*:/.exec(f)
        if (m) cut = m[0].length
    }
    // "Admin hỏi …" / "admin hỏi:" — same OOC ask, spoken Vietnamese without @ (New Chat 2, 2026-11-08).
    if (cut < 0) {
        const m = /^admin\s+h(?:ỏ|o)i\b[\s:,]*/u.exec(f)
        if (m) cut = m[0].length
    }
    if (cut < 0) return null
    let body = t.slice(cut).replace(/^[\s:,]+/, '')
    if (/^bug(?![\p{L}\p{N}_])/iu.test(body)) return { kind: 'bug', body: body.slice(3).replace(/^[\s:,-]+/, '') }
    return { kind: 'ask', body }
}

/** Is the newest user message of this chat an ask (the turn being asked, or the one whose reply just came)? */
export function lastTurnIsAsk(messages: Msg[] | undefined): boolean {
    const m = messages ?? []
    for (let i = m.length - 1; i >= 0; i--) if (m[i]?.role === 'user') return parseAdminAsk(m[i].data) !== null
    return false
}

/** Is the message at `index` the answer to an ask (a character message right after an ask)? */
export function isAskAnswer(messages: Msg[] | undefined, index: number): boolean {
    const m = messages ?? []
    return m[index]?.role === 'char' && index > 0 && m[index - 1]?.role === 'user' && parseAdminAsk(m[index - 1].data) !== null
}
