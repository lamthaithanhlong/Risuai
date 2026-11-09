// Hard gate for observe-only turns: looking does not authorize a new PC act.
// Measured 2026-11-08 New Chat 2: "Tui nhìn 3 người họ" → Kenji invented speech + vuốt tóc.

export type AgencyHit = { rule: 'pc-speech' | 'pc-advance' | 'pc-dragged'; text: string }

const OBSERVE = /(?<![\p{L}\p{N}])(?:nhìn|quan\s*sát|ngó|liếc|theo\s*dõi|observe|watch|look\s+at)(?![\p{L}\p{N}])/iu
const STRONGER_ACT = /(?<![\p{L}\p{N}])(?:nói|hỏi|gọi|đáp|trả\s*lời|đi|chạy|đánh|bắn|ôm|hôn|vuốt|kéo|nắm|say|ask|call|answer|reply|go|run|hit|shoot|hug|kiss|stroke|pull|grab|hold)(?![\p{L}\p{N}])/iu

export function observeOnly(playerText: string): boolean {
    const text = String(playerText ?? '')
    return OBSERVE.test(text) && !STRONGER_ACT.test(text)
}

const SPEECH = /(?<![\p{L}\p{N}])(?:nói|đáp(?:\s*lại)?|hỏi|trả\s*lời|thì\s*thầm|thầm\s*nghĩ|said|answered|asked|replied|whispered)(?![\p{L}\p{N}])/iu
const ADVANCE = /(?<![\p{L}\p{N}])(?:vuốt|hôn|ôm|nắm\s*tay|kéo\s*(?:vào|lại|đi)|stroke|kiss|hug|hold\s*hands?|pull\s+(?:in|close)|whisper)(?![\p{L}\p{N}])/iu
const PC_DRAG = /(?<![\p{L}\p{N}])(?:kéo|lôi|nắm|giữ|dắt)\s+(?:(?:tay|cổ\s*tay|cánh\s*tay)\s+)?(?:(?:của\s+)?(?:cậu|bạn|em|anh|tui|tôi|you)\b|(?:đi\s+theo|theo\s+(?:tôi|anh|cậu|bạn)|vào\s+(?:đội\s*hình|hàng|formation)))(?![\p{L}\p{N}])/giu
const DRAG_CONTEXT = /(?:theo|đội\s*hình|formation|hàng)/iu
const PC_ADVANCE = /(?:vuốt|hôn|ôm|nắm\s*tay|kéo\s*(?:vào|lại|đi)|stroke|kiss|hug|hold\s*hands?|pull\s+(?:in|close))/iu
const QUOTE_THEN_REPLY = /["“][^"”\n]{1,240}["”]\s*(?:đáp(?:\s+lại)?|replied|answered)\b/giu

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
    const pairs: [string, string][] = [ ['"', '"'], ['\u201C', '\u201D'], ['\u2018', '\u2019'] ]
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
    for (const q of findQuotes(text)) {
        const before = text.slice(Math.max(0, q.start - 140), q.start)
        const after = text.slice(q.end, q.end + 140)
        if ((nameRe.test(before) && SPEECH.test(before)) || (nameRe.test(after) && SPEECH.test(after))) {
            add('pc-speech', text.slice(Math.max(0, q.start - 80), Math.min(text.length, q.end + 80)))
        }
    }
    const speechNearName = new RegExp(`(?:${alt})[^\\n.!?]{0,40}?${SPEECH.source}|${SPEECH.source}[^\\n.!?]{0,40}?(?:${alt})`, 'giu')
    for (const m of text.matchAll(speechNearName)) {
        const i = m.index ?? 0
        const win = text.slice(Math.max(0, i - 80), i + m[0].length + 80)
        if (/['"\u201C\u201D]/.test(win) && nameRe.test(m[0])) add('pc-speech', m[0])
    }
    for (const m of text.matchAll(new RegExp(QUOTE_THEN_REPLY.source, QUOTE_THEN_REPLY.flags))) {
        const i = m.index ?? 0
        const subject = text.slice(m.index! + m[0].length).match(/^\s*([\p{Lu}][\p{L}'-]*(?:\s+[\p{Lu}][\p{L}'-]*)*)/u)?.[1] ?? ''
        if (subject && nameRe.test(subject)) add('pc-speech', text.slice(i, Math.min(text.length, i + m[0].length + subject.length + 24)))
    }
    const namedAdvance = new RegExp(`(?:${alt})[^\\n.!?]{0,100}?${ADVANCE.source}`, 'giu')
    for (const m of text.matchAll(namedAdvance)) add('pc-advance', m[0])
    for (const q of findQuotes(text)) {
        const after = text.slice(q.end, q.end + 180)
        if (nameRe.test(after) && PC_ADVANCE.test(after)) add('pc-advance', text.slice(q.start, Math.min(text.length, q.end + 100)))
    }
    const dragSentence = new RegExp(`(?<![\\p{L}\\p{N}])(?:kéo|lôi|nắm|giữ|dắt)[^.!?\\n]{0,140}(?:${alt})[^.!?\\n]{0,100}(?:theo(?:\\s+sau)?|đội\\s*hình|formation|hàng)`, 'giu')
    for (const m of text.matchAll(dragSentence)) add('pc-dragged', m[0])
    for (const m of text.matchAll(new RegExp(PC_DRAG.source, PC_DRAG.flags))) {
        const i = m.index ?? 0
        const sentenceStart = Math.max(text.lastIndexOf('.', i), text.lastIndexOf('!', i), text.lastIndexOf('?', i)) + 1
        const sentenceEndCandidates = ['.', '!', '?'].map((mark) => text.indexOf(mark, i)).filter((end) => end >= 0)
        const sentenceEnd = sentenceEndCandidates.length ? Math.min(...sentenceEndCandidates) : text.length
        const sentence = text.slice(sentenceStart, sentenceEnd)
        if (nameRe.test(sentence) && DRAG_CONTEXT.test(sentence)) add('pc-dragged', sentence)
    }
    if (nameRe.test(text)) {
        const anhAdvance = /(?<![\p{L}\p{N}])Anh\s+(?:đưa\s+tay\s+)?(?:vuốt|hôn|ôm|nắm\s*tay)(?![\p{L}\p{N}])/giu
        for (const m of text.matchAll(anhAdvance)) add('pc-advance', m[0])
    }
    return hits
}

export function agencyNote(hits: AgencyHit[]): string {
    if (!hits.length) return ''
    const parts = hits.map((hit) => `${hit.rule} ("${hit.text}")`)
    return `\n\n[Rewrite (hidden, never named): the last draft had ${parts.join(' / ')}. On this observe-only turn, the player only looked; do not invent PC speech, answers, or physical/social moves, and do not have an NPC drag, pull, lead, or grab the PC into following or a formation. NPC-initiated actions toward the player may remain; describe what the player sees and stop before the PC speaks or chooses.]`
}

export function scrubAgency(reply: string, playerText: string, playerName = ''): string {
    if (!observeOnly(playerText)) return reply
    const original = String(reply ?? '')
    let scrubbed = original
    for (let pass = 0; pass < 3; pass++) {
        const hits = agencyHits(scrubbed, playerText, playerName)
        if (!hits.length) break
        const segments = scrubbed.split(/(?<=[.!?…])\s+/)
        const next = segments.filter((sentence) => !agencyHits(sentence, playerText, playerName).length).join(' ').trim()
        if (next === scrubbed) break
        scrubbed = next
    }
    if (!agencyHits(scrubbed, playerText, playerName).length) return scrubbed
    {
        const segments = scrubbed.split(/(?<=[.!?…])\s+/)
        scrubbed = segments.filter((sentence) => !agencyHits(sentence, playerText, playerName).length).join(' ').trim()
    }
    if (!agencyHits(scrubbed, playerText, playerName).length) return scrubbed

    // Remove any remaining quote attributed to the player (including thầm nghĩ).
    const alt = nameAlt(playerName)
    if (alt) {
        const quotedAttribution = new RegExp(`(?:${alt})[^\\n.!?]{0,40}?${SPEECH.source}[^\\n.!?]{0,40}?[\"\\u201C][^\"\\u201D\\n]{1,240}[\"\\u201D]|[\"\\u201C][^\"\\u201D\\n]{1,240}[\"\\u201D][^\\n.!?]{0,40}?(?:${alt})[^\\n.!?]{0,40}?${SPEECH.source}`, 'giu')
        scrubbed = scrubbed.replace(quotedAttribution, '')
    }
    // A hit snippet may omit the rest of its sentence; repeat removal until the gate is clear.
    scrubbed = scrubbed.replace(/[ \t]+([,.;!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    const remaining = agencyHits(scrubbed, playerText, playerName)
    if (remaining.length) {
        for (const hit of remaining) {
            const escaped = hit.text.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            scrubbed = scrubbed.replace(new RegExp(escaped.join('\\s+'), 'giu'), '')
        }
        scrubbed = scrubbed.replace(/[ \t]+([,.;!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    }
    return scrubbed
}

