// Hard gate for observe-only turns: looking does not authorize a new PC act.
// Measured 2026-11-08 New Chat 2: "Tui nhìn 3 người họ" → Kenji invented speech + vuốt tóc.

export type AgencyHit = { rule: 'pc-speech' | 'pc-advance'; text: string }

const OBSERVE = /(?<![\p{L}\p{N}])(?:nhìn|quan\s*sát|ngó|liếc|theo\s*dõi|observe|watch|look\s+at)(?![\p{L}\p{N}])/iu
const STRONGER_ACT = /(?<![\p{L}\p{N}])(?:nói|hỏi|gọi|đáp|trả\s*lời|đi|chạy|đánh|bắn|ôm|hôn|vuốt|kéo|nắm|say|ask|call|answer|reply|go|run|hit|shoot|hug|kiss|stroke|pull|grab|hold)(?![\p{L}\p{N}])/iu

export function observeOnly(playerText: string): boolean {
    const text = String(playerText ?? '')
    return OBSERVE.test(text) && !STRONGER_ACT.test(text)
}

const SPEECH = /(?<![\p{L}\p{N}])(?:nói|đáp(?:\s*lại)?|hỏi|trả\s*lời|thì\s*thầm|said|answered|asked|replied|whispered)(?![\p{L}\p{N}])/iu
const ADVANCE = /(?<![\p{L}\p{N}])(?:vuốt|hôn|ôm|nắm\s*tay|kéo\s*(?:vào|lại|đi)|stroke|kiss|hug|hold\s*hands?|pull\s+(?:in|close)|whisper)(?![\p{L}\p{N}])/iu

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Player name tokens only — never anh/cậu/em (too many false positives). */
function nameAlt(playerName: string): string {
    const full = String(playerName ?? '').trim()
    const first = full.split(/\s+/)[0] || ''
    const names = [full, first].filter((name, index, all) => name.length >= 2 && all.indexOf(name) === index)
    return names.map(escapeRegex).join('|')
}

function findQuotes(text: string): { start: number; end: number; body: string }[] {
    const out: { start: number; end: number; body: string }[] = []
    const pairs: [string, string][] = [
        ['"', '"'],
        ['\u201C', '\u201D'],
        ['\u2018', '\u2019'],
    ]
    for (const [open, close] of pairs) {
        let i = 0
        while (i < text.length) {
            const start = text.indexOf(open, i)
            if (start < 0) break
            const end = text.indexOf(close, start + open.length)
            if (end < 0) break
            const body = text.slice(start + open.length, end)
            if (body.length > 0 && body.length <= 240) out.push({ start, end: end + close.length, body })
            i = end + close.length
        }
    }
    return out
}

export function agencyHits(reply: string, playerText: string, playerName = ''): AgencyHit[] {
    if (!observeOnly(playerText)) return []
    const text = String(reply ?? '')
    const alt = nameAlt(playerName)
    if (!alt) return []
    const nameRe = new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, 'iu')
    const hits: AgencyHit[] = []
    const add = (rule: AgencyHit['rule'], snippet: string) => {
        const clean = snippet.replace(/\s+/g, ' ').trim().slice(0, 120)
        if (clean && !hits.some((hit) => hit.rule === rule && hit.text === clean)) hits.push({ rule, text: clean })
    }

    // PC speech: name near a speech verb, usually next to a quote.
    for (const q of findQuotes(text)) {
        const before = text.slice(Math.max(0, q.start - 140), q.start)
        const after = text.slice(q.end, q.end + 140)
        if ((nameRe.test(before) && SPEECH.test(before)) || (nameRe.test(after) && SPEECH.test(after))) {
            add('pc-speech', text.slice(Math.max(0, q.start - 80), Math.min(text.length, q.end + 80)))
        }
    }
    // Also: "Kenji Park đáp lại" even if quote pairing failed
    const speechNearName = new RegExp(`(?:${alt})[^\\n.!?]{0,40}?${SPEECH.source}|${SPEECH.source}[^\\n.!?]{0,40}?(?:${alt})`, 'giu')
    for (const m of text.matchAll(speechNearName)) {
        // Prefer when a quote is within 80 chars
        const i = m.index ?? 0
        const win = text.slice(Math.max(0, i - 80), i + m[0].length + 80)
        if (/["\u201C\u201D]/.test(win) || /đáp\s*lại/i.test(m[0])) add('pc-speech', m[0])
    }

    // PC advance: named PC then advance verb
    const namedAdvance = new RegExp(`(?:${alt})[^\\n.!?]{0,100}?${ADVANCE.source}`, 'giu')
    for (const m of text.matchAll(namedAdvance)) add('pc-advance', m[0])

    // Viewpoint "Anh đưa tay vuốt…" only after the player was already named in the reply
    if (nameRe.test(text)) {
        const anhAdvance = /(?<![\p{L}\p{N}])Anh\s+(?:đưa\s+tay\s+)?(?:vuốt|hôn|ôm|nắm\s*tay)(?![\p{L}\p{N}])/giu
        for (const m of text.matchAll(anhAdvance)) add('pc-advance', m[0])
    }

    return hits
}

export function agencyNote(hits: AgencyHit[]): string {
    if (!hits.length) return ''
    const parts = hits.map((hit) => `${hit.rule} ("${hit.text}")`)
    return (
        `\n\n[Rewrite (hidden, never named): the last draft had ${parts.join(' / ')}. ` +
        'On this observe-only turn, the player only looked; do not invent PC speech, answers, or physical/social moves. ' +
        'NPC-initiated actions toward the player may remain; describe what the player sees and stop before the PC speaks or chooses.]'
    )
}
