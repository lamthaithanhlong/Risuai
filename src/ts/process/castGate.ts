export type CastHit = { rule: 'cast'; text: string }

const KO_ROMAN: [string, string][] = [
    ['아키', 'Aki'],
    ['나루', 'Naru'],
    ['유우이치', 'Yuuichi'],
]

function esc(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function namedIn(text: string, name: string): boolean {
    const full = String(name ?? '').replace(/\s+/g, ' ').trim()
    if (full.length < 2) return false
    const first = full.split(/\s+/)[0]
    const blob = ` ${String(text ?? '')} `
    const hit = (w: string) => w.length >= 2 && new RegExp(`(?<![\\p{L}\\p{N}])${esc(w)}(?![\\p{L}\\p{N}])`, 'iu').test(blob)
    return hit(full) || (first !== full && hit(first))
}

export function rosterNames(card: {
    extentions?: { vjPortraits?: Record<string, { name?: string } | undefined> }
    additionalAssets?: [string, string, string?][]
    emotionImages?: [string, string][]
} | null | undefined): string[] {
    const out: string[] = []
    const seen = new Set<string>()
    const add = (raw: string) => {
        const name = String(raw ?? '').replace(/\s+/g, ' ').trim()
        if (name.length < 2 || name === '...' || name === 'name') return
        const k = name.toLowerCase()
        if (seen.has(k)) return
        seen.add(k)
        out.push(name)
    }
    const ports = card?.extentions?.vjPortraits ?? {}
    for (const [key, val] of Object.entries(ports)) add(val?.name || key)
    for (const row of card?.additionalAssets ?? []) add(String(row?.[0] ?? '').split('_')[0] || '')
    for (const row of card?.emotionImages ?? []) add(String(row?.[0] ?? '').split('_')[0] || '')
    return out
}

export function allowedCast(
    firstMessage: string,
    previous: string[] = [],
    playerText = '',
    playerName = '',
    roster: string[] = [],
): string[] {
    const prior = [firstMessage, ...previous.slice(-4), playerText].join('\n')
    const out: string[] = []
    const seen = new Set<string>()
    const add = (n: string) => {
        const name = n.replace(/\s+/g, ' ').trim()
        if (name.length < 2) return
        const k = name.toLowerCase()
        if (seen.has(k)) return
        seen.add(k)
        out.push(name)
    }
    const pn = String(playerName ?? '').trim()
    if (pn) add(pn)
    for (const [ko, roman] of KO_ROMAN) {
        if (prior.includes(ko) || namedIn(prior, roman)) add(roman)
    }
    for (const name of roster) {
        if (namedIn(prior, name)) add(name)
    }
    return out
}

export function castHits(reply: string, allowed: string[], roster: string[]): CastHit[] {
    const allow = new Set<string>()
    for (const n of allowed) {
        allow.add(n.toLowerCase())
        const first = n.toLowerCase().split(/\s+/)[0]
        if (first.length >= 2) allow.add(first)
    }
    const hits: CastHit[] = []
    const seen = new Set<string>()
    const text = String(reply ?? '')
    for (const name of roster) {
        const first = name.toLowerCase().split(/\s+/)[0]
        if (first.length < 2) continue
        if (allow.has(name.toLowerCase()) || allow.has(first)) continue
        const inTag =
            new RegExp(`\\[🖼️\\|${esc(first)}[^\\]|]*\\|👁️\\]`, 'iu').test(text) ||
            new RegExp(`\\[\\[LOOK\\s+${esc(first)}\\b`, 'iu').test(text)
        if (!namedIn(text, name) && !inTag) continue
        if (seen.has(first)) continue
        seen.add(first)
        hits.push({ rule: 'cast', text: name })
    }
    return hits
}

export function castNote(hits: CastHit[]): string {
    if (!hits.length) return ''
    const names = hits.map((h) => h.text).join(', ')
    return (
        `\n\n[Rewrite (hidden, never named): the last draft invented off-stage character(s): ${names}. ` +
        'Keep only people already in the opening/prior scene the player looked at; do not bring in a new named character or a different beat; describe that scene from the player eyes.]'
    )
}

export function scrubCast(reply: string, hits: CastHit[]): string {
    if (!hits.length) return String(reply ?? '')
    let text = String(reply ?? '')
    for (const hit of hits) {
        const first = hit.text.replace(/\s+/g, ' ').trim().split(/\s+/)[0]
        if (first.length < 2) continue
        text = text.replace(new RegExp(`\\[🖼️\\|${esc(first)}[^\\]\\n]*\\|👁️\\]\\s*`, 'giu'), '')
        text = text.replace(new RegExp(`\\[\\[LOOK\\s+${esc(first)}\\s*\\|[^\\]]*\\]\\]\\s*`, 'giu'), '')
    }
    const parts = text.split(/\n\n+/)
    const kept = parts.filter((p) => hits.every((hit) => !namedIn(p, hit.text)))
    return kept.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + (kept.length ? '\n' : '')
}
