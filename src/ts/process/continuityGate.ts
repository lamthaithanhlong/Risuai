// Hard continuity gate after a story draft (measured 2026-11-08, New Chat 2 / Ollama 9B):
// "Tui nhìn 3 người họ" → narrator invented Yuuichi as boyfriend lead and labeled Aki/Naru girlfriend/cousin.
// Prompt rules alone were not enough; one rewrite note is added when these fire.

export type ContinuityHit = { rule: 'kinship' | 'viewpoint' | 'lead'; text: string }

// JS \b is ASCII-only; Vietnamese labels need Unicode letter boundaries.
const KINSHIP =
    /(?<![\p{L}\p{N}])(?:bạn\s*gái|bạn\s*trai|bạn\s*đời|người\s*yêu|crush|em\s*họ|anh\s*họ|chị\s*họ|vợ|chồng|girlfriend|boyfriend|wife|husband|cousin|mẹ|bố|cha|má|con\s+gái|con\s+trai|mother|father|mom|mum|dad|daughter|son)(?![\p{L}\p{N}])/giu

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

/** Replace unsupported romance/kinship labels while preserving labels established in prior context. */
export function scrubKinship(reply: string, playerText: string, previous: string[] = []): string {
    let scrubbed = String(reply ?? '')
    const labels = kinshipHits(scrubbed, playerText, previous).map((hit) => hit.text)
    for (const label of labels) {
        const pattern = label.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+')
        scrubbed = scrubbed.replace(new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'giu'), 'người')
    }
    return scrubbed.replace(/người\s+người/giu, 'người')
}

/**
 * Player is observing / approaching people ("nhìn", "quan sát"…) but the reply recenters on a named man as the romantic hub
 * (Yuuichi + bạn gái/em họ) without the player name.
 */
export function viewpointHits(reply: string, playerText: string, playerName = ''): ContinuityHit[] {
    const act = String(playerText ?? '')
    if (!/(?<![\p{L}\p{N}])(?:nhìn|quan\s*sát|ngó|liếc|theo dõi|observe|watch|look(?:ing)?\s+at)(?![\p{L}\p{N}])/iu.test(act)) return []
    const text = String(reply ?? '')
    const low = text.toLowerCase()
    const name = String(playerName ?? '').trim()
    const first = name.split(/\s+/)[0] || ''
    const playerPresent =
        (name.length >= 2 && low.includes(name.toLowerCase())) ||
        (first.length >= 2 && new RegExp(`[^\\p{L}]${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\p{L}]`, 'iu').test(` ${low} `))
    const hub =
        /(?<![\p{L}\p{N}])(?:bạn\s*gái|bạn\s*trai|bạn\s*đời|em\s*họ)(?![\p{L}\p{N}]).{0,40}(?<![\p{L}\p{N}])(?:của|của\s+mình)(?![\p{L}\p{N}])/iu.test(text) ||
        /(?<![\p{L}\p{N}])(?:bị|được)\s+bạn\s*gái(?![\p{L}\p{N}])/iu.test(text)
    if (!hub) return []
    if (playerPresent) return []
    const snip = text.replace(/\s+/g, ' ').trim().slice(0, 120)
    return [{ rule: 'viewpoint', text: snip || 'viewpoint recentered off the player' }]
}

const LEAD_OBSERVE = /(?<![\p{L}\p{N}])(?:nhìn|quan\s*sát|ngó|liếc|theo\s*dõi|observe|watch|look(?:ing)?\s+at)(?![\p{L}\p{N}])/iu
const LEAD_FRAME = /(?<![\p{L}\p{N}])(?:bám\s+lấy|điểm\s+tựa)(?![\p{L}\p{N}])/giu

/** Detect an invented named romantic/emotional hub on an observe-only turn. */
export function leadHits(reply: string, playerText: string, playerName = '', previous: string[] = []): ContinuityHit[] {
    if (!LEAD_OBSERVE.test(String(playerText ?? ''))) return []
    const text = String(reply ?? '')
    const prior = priorBlob(playerText, previous)
    const player = String(playerName ?? '').trim().toLowerCase()
    const playerFirst = player.split(/\s+/)[0] || ''
    const properName = String.raw`\p{Lu}[\p{L}'-]{1,30}`
    const hits: ContinuityHit[] = []
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:bám\\s+lấy|níu\\s+lấy|ôm\\s+lấy|dựa\\s+vào|bám\\s+vào)\\s+(${properName})(?![\\p{L}\\p{N}])`, 'giu')
    for (const match of text.matchAll(pattern)) {
        const name = match[1]
        const lowerName = name.toLowerCase()
        if (lowerName === player || lowerName === playerFirst) continue
        const exact = match[0].replace(/\\s+/g, ' ').toLowerCase()
        if (prior.includes(exact) || prior.includes(`bám lấy ${lowerName}`)) continue
        hits.push({ rule: 'lead', text: match[0] })
    }
    const support = /(?<![\p{L}\p{N}])điểm\s+tựa(?![\p{L}\p{N}])/giu
    for (const match of text.matchAll(support)) {
        const start = Math.max(0, match.index! - 40), end = Math.min(text.length, match.index! + match[0].length + 40)
        const nameMatch = [...text.slice(start, end).matchAll(new RegExp(`(?<![\\p{L}\\p{N}])(${properName})(?![\\p{L}\\p{N}])`, 'gu'))]
            .find((candidate) => candidate[1].toLowerCase() !== player && candidate[1].toLowerCase() !== playerFirst)
        if (nameMatch && !prior.includes(match[0].toLowerCase())) hits.push({ rule: 'lead', text: `${nameMatch[1]}: ${match[0]}` })
    }
    return hits
}

/** Replace unsupported cling framing while retaining the named person. */
export function scrubLead(reply: string, playerText: string, previous: string[] = [], playerName = ''): string {
    if (!leadHits(reply, playerText, playerName, previous).length) return String(reply ?? '')
    let scrubbed = String(reply ?? '')
    const properName = String.raw`\p{Lu}[\p{L}'-]{1,30}`
    scrubbed = scrubbed.replace(
        new RegExp(String.raw`(?<![\p{L}\p{N}])(?:bám\s+lấy|níu\s+lấy|ôm\s+lấy|dựa\s+vào|bám\s+vào)\s+(${properName})(?![\p{L}\p{N}])`, 'giu'),
        (full, name) => {
            const lower = name.toLowerCase()
            const player = String(playerName ?? '').trim().toLowerCase()
            const first = player.split(/\s+/)[0] || ''
            if (lower === player || lower === first) return full
            const exact = full.replace(/\s+/g, ' ').toLowerCase()
            const prior = [playerText, ...previous.slice(-4)].join('\n').toLowerCase()
            if (prior.includes(exact) || prior.includes(`bám lấy ${lower}`)) return full
            return `đứng cạnh ${name}`
        },
    )
    if (leadHits(scrubbed, playerText, playerName, previous).some((h) => h.text.includes('điểm'))) {
        scrubbed = scrubbed.replace(/(?<![\p{L}\p{N}])điểm\s+tựa(?![\p{L}\p{N}])/giu, 'người cạnh bên')
    }
    return scrubbed
}

export function continuityHits(reply: string, playerText: string, previous: string[] = [], playerName = ''): ContinuityHit[] {
    return [...kinshipHits(reply, playerText, previous), ...viewpointHits(reply, playerText, playerName), ...leadHits(reply, playerText, playerName, previous)]
}

/** Hidden rewrite line for settleReply / one-shot redo. */
export function continuityNote(hits: ContinuityHit[]): string {
    if (!hits.length) return ''
    const parts = hits.map((h) =>
        h.rule === 'kinship'
            ? `invented kinship/romance label "${h.text}"`
            : h.rule === 'lead'
              ? `invented romantic/emotional hub framing "${h.text}"`
              : `viewpoint left the player ("${h.text.slice(0, 80)}")`,
    )
    return (
        `\n\n[Rewrite (hidden, never named): the last draft had: ${parts.join(' / ')}. ` +
        'Keep the player\'s character as the eyes of the scene; do not invent bạn gái/bạn trai/bạn đời/em họ, parent or child labels, or a substitute male lead; ' +
        'describe the people the player looked at from the player\'s view.]'
    )
}
