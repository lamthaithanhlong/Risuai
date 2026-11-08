// Hard continuity gate after a story draft (measured 2026-11-08, New Chat 2 / Ollama 9B):
// "Tui nhìn 3 người họ" → narrator invented Yuuichi as boyfriend lead and labeled Aki/Naru girlfriend/cousin.
// Prompt rules alone were not enough; one rewrite note is added when these fire.

export type ContinuityHit = { rule: 'kinship' | 'viewpoint'; text: string }

// JS \b is ASCII-only; Vietnamese labels need Unicode letter boundaries.
const KINSHIP =
    /(?<![\p{L}\p{N}])(?:bạn\s*gái|bạn\s*trai|bạn\s*đời|người\s*yêu|crush|em\s*họ|anh\s*họ|chị\s*họ|vợ|chồng|girlfriend|boyfriend|wife|husband|cousin)(?![\p{L}\p{N}])/giu

/** Labels already present in the player's last turn or earlier story replies (allowed to repeat). */
function priorBlob(playerText: string, previous: string[]): string {
    return [playerText, ...previous.slice(-4)].join('\n').toLowerCase()
}

/** Invented romance/kinship labels not supported by the player's last act or recent story. */
export function kinshipHits(reply: string, playerText: string, previous: string[] = []): ContinuityHit[] {
    const prior = priorBlob(playerText, previous)
    const hits: ContinuityHit[] = []
    const seen = new Set<string>()
    for (const m of String(reply ?? '').matchAll(KINSHIP)) {
        const label = m[0].replace(/\s+/g, ' ').trim().toLowerCase()
        if (!label || seen.has(label)) continue
        seen.add(label)
        if (prior.includes(label)) continue
        hits.push({ rule: 'kinship', text: m[0].replace(/\s+/g, ' ').trim().slice(0, 80) })
    }
    return hits
}

/**
 * Player is observing / approaching people ("nhìn", "quan sát"…) but the reply recenters on a named man as the romantic hub
 * (Yuuichi + bạn gái/em họ) without the player name.
 */
export function viewpointHits(reply: string, playerText: string, playerName = ''): ContinuityHit[] {
    const act = String(playerText ?? '')
    if (!/\b(?:nhìn|quan\s*sát|ngó|liếc|theo dõi|observe|watch|look(?:ing)?\s+at)\b/iu.test(act)) return []
    const text = String(reply ?? '')
    const low = text.toLowerCase()
    const name = String(playerName ?? '').trim()
    const first = name.split(/\s+/)[0] || ''
    const playerPresent =
        (name.length >= 2 && low.includes(name.toLowerCase())) ||
        (first.length >= 2 && new RegExp(`[^\\p{L}]${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\p{L}]`, 'iu').test(` ${low} `))
    const hub =
        /\b(?:bạn\s*gái|bạn\s*trai|bạn\s*đời|em\s*họ)\b.{0,40}\b(?:của|của\s+mình)\b/iu.test(text) ||
        /\b(?:bị|được)\s+bạn\s*gái\b/iu.test(text)
    if (!hub) return []
    if (playerPresent) return []
    const snip = text.replace(/\s+/g, ' ').trim().slice(0, 120)
    return [{ rule: 'viewpoint', text: snip || 'viewpoint recentered off the player' }]
}

export function continuityHits(reply: string, playerText: string, previous: string[] = [], playerName = ''): ContinuityHit[] {
    return [...kinshipHits(reply, playerText, previous), ...viewpointHits(reply, playerText, playerName)]
}

/** Hidden rewrite line for settleReply / one-shot redo. */
export function continuityNote(hits: ContinuityHit[]): string {
    if (!hits.length) return ''
    const parts = hits.map((h) =>
        h.rule === 'kinship'
            ? `invented kinship/romance label "${h.text}"`
            : `viewpoint left the player ("${h.text.slice(0, 80)}")`,
    )
    return (
        `\n\n[Rewrite (hidden, never named): the last draft had: ${parts.join(' / ')}. ` +
        'Keep the player\'s character as the eyes of the scene; do not invent bạn gái/bạn trai/bạn đời/em họ or a substitute male lead; ' +
        'describe the people the player looked at from the player\'s view.]'
    )
}
