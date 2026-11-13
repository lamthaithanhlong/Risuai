// Hard gate for card emotion/sprite tags: model must not invent asset names.
// Measured 2026-11-08 New Chat 2: [🖼️|kenji_casual_nervous|👁️] while the card has zero kenji_* assets.

export type AssetTagFix = { from: string; to: string | null }

const TAG =
    /\[(?:\u{1F5BC}\u{FE0F}?|\u{1F51E})\|([^\]|\n]+)\|(?:\u{1F441}\u{FE0F}?|\u{23FA}\u{FE0F}?|\u{25B6}\u{FE0F}?|\u{23F9}\u{FE0F}?)\]/gu

function tokens(name: string): string[] {
    return name.toLowerCase().split(/[_\s.]+/).filter(Boolean)
}

function prefixOf(name: string): string {
    const i = name.indexOf('_')
    return (i > 0 ? name.slice(0, i) : name).toLowerCase()
}

function score(want: string, candidate: string): number {
    const a = new Set(tokens(want))
    const b = tokens(candidate)
    if (!a.size || !b.length) return 0
    let hit = 0
    for (const t of b) if (a.has(t)) hit++
    let s = hit / Math.max(a.size, b.length)
    if (/schooluniform/i.test(candidate) && (/school/i.test(want) || /uniform/i.test(want))) s += 0.15
    if (/casual/i.test(want) && /schooluniform/i.test(candidate)) s += 0.05
    return s
}

function bestMatch(want: string, allow: string[]): string | null {
    const exact = allow.find((n) => n === want)
    if (exact) return exact
    const lower = want.toLowerCase()
    const ci = allow.find((n) => n.toLowerCase() === lower)
    if (ci) return ci

    const pref = prefixOf(want)
    const cands = allow.filter((n) => prefixOf(n) === pref)
    if (!cands.length) return null

    // Emotion tags like yuuichi_schooluniform_* must not collapse onto a bare portrait name "Yuuichi".
    const emotionCands = cands.filter((n) => n.includes('_'))
    const pool = emotionCands.length ? emotionCands : []
    if (!pool.length) return null

    let best: string | null = null
    let bestScore = 0
    for (const c of pool) {
        const s = score(want, c)
        if (s > bestScore) {
            bestScore = s
            best = c
        }
    }
    return bestScore >= 0.25 ? best : pool[0] ?? null
}

function retag(full: string, newName: string): string {
    return full.replace(/\|([^\]|]+)\|/, `|${newName}|`)
}

function toAllowList(assetNames: Iterable<string> | string[]): string[] {
    return [...assetNames].map((n) => String(n ?? '').trim()).filter(Boolean)
}

/**
 * Keep only asset tags that exist on the card; remap near-misses within the same character prefix;
 * strip tags for characters with no assets at all (e.g. invented kenji_casual_*).
 */
export function sanitizeAssetTags(
    text: string,
    assetNames: Iterable<string> | string[],
): { text: string; fixed: AssetTagFix[] } {
    const allow = toAllowList(assetNames)
    if (!allow.length) return { text: String(text ?? ''), fixed: [] }

    const fixed: AssetTagFix[] = []
    let out = String(text ?? '')

    out = out.replace(TAG, (full, name: string) => {
        const want = String(name ?? '').trim()
        if (!want) return full
        if (allow.includes(want)) return full
        const mapped = bestMatch(want, allow)
        if (mapped && mapped !== want) {
            fixed.push({ from: want, to: mapped })
            return retag(full, mapped)
        }
        if (mapped === want) return full
        fixed.push({ from: want, to: null })
        return ''
    })

    if (fixed.length) {
        out = out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    }
    return { text: out, fixed }
}

/** Alias used by index.svelte.ts (allowlist as Set or array). */
export const gateAssetTags = sanitizeAssetTags

export function assetNamesFromCard(card: {
    additionalAssets?: string[][]
    emotionImages?: string[][]
} | null | undefined): string[] {
    const names: string[] = []
    for (const a of card?.additionalAssets ?? []) {
        const n = a?.[0]
        if (n) names.push(String(n))
    }
    for (const e of card?.emotionImages ?? []) {
        const n = e?.[0]
        if (n) names.push(String(n))
    }
    return names
}

// ── Using the card's pictures more (asked 2026-11-13) ────────────────────────────────────────────────────────────────
// Measured that day: a card with 2,313 pictures (Netoriya) had image tags in 1 of 2 live story replies, Kairos (928) in
// 1 of 12, Amorous Realm (1,054) in 1 of 4. Asked directly with the card's own image rules in the request, the models
// wrote a valid tag for every on-stage character in 34 of 34 replies (gcli/grok-4.7, grok-4.7-build-fast, web-codex), so
// the rule is understood and gets lost under the app's many end-of-message notes and rewrites. Two things follow:
// the rule is said again where the model reads last, and a tag a rewrite dropped is put back from the first draft.

export type ImageSystem = { kind: 'emoji' | 'img'; who: string[]; example: string }

type ImageCard = {
    additionalAssets?: string[][]
    emotionImages?: string[][]
    customscript?: { in?: string; type?: string }[]
} | null | undefined

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** The card's own picture system, read from its display scripts and picture names; null when it has none. */
export function imageSystemOf(card: ImageCard): ImageSystem | null {
    const names = assetNamesFromCard(card)
    if (names.length < 5) return null
    const scripts = (card?.customscript ?? []).filter((s) => s?.type !== 'disabled').map((s) => String(s?.in ?? '')).join('\n')
    if (/\u{1F5BC}/u.test(scripts)) {
        const count = new Map<string, number>()
        for (const n of names) if (n.split('_').length >= 3) count.set(prefixOf(n), (count.get(prefixOf(n)) ?? 0) + 1)
        // a character has a set of moods; "id_photo_1" … "status_photo_6" are the card's own panels, not people
        const who = [...count].filter(([, c]) => c >= 20).map(([p]) => p)
        if (!who.length) return null
        const mine = names.filter((n) => prefixOf(n) === who[0] && n.split('_').length >= 3)
        const first = mine.find((n) => !n.includes('.')) ?? mine[0]
        return { kind: 'emoji', who: who.map(cap), example: `[🖼️|${first}|👁️]` }
    }
    if (/<img=\\?"/.test(scripts)) {
        const set = new Set(names)
        const count = new Map<string, number>()
        for (const n of names) {
            const i = n.indexOf(' ', n.indexOf(' ') + 1)   // "First Last emotion…"
            const base = i > 0 ? n.slice(0, i) : ''
            if (base && set.has(base)) count.set(base, (count.get(base) ?? 0) + 1)
        }
        const who = [...count].filter(([, c]) => c >= 3).map(([b]) => b)
        if (!who.length) return null
        const first = names.find((n) => n.startsWith(who[0] + ' '))!
        return { kind: 'img', who, example: `<img="${first}">` }
    }
    return null
}

/** The reminder, or '' for a card without its own picture system. At most 12 names are listed. */
export function imageReminder(sys: ImageSystem | null): string {
    if (!sys) return ''
    const who = sys.who.slice(0, 12).join(', ') + (sys.who.length > 12 ? ` and ${sys.who.length - 12} more` : '')
    return `\n\n[Pictures (hidden, never named): this card shows character pictures (${who}). In this reply, each of them who speaks or acts on stage gets one image tag in the card's own format, like ${sys.example}, on its own line beside that character's first line. Names and keywords come only from the card's lists, and the card's own image rules and limits still hold. A story reply where one of them appears and no image tag is written is incomplete.]`
}

/** The reminder at the end of the player's message, on a story turn of a card that has its own picture system. */
export function imageRequest<T extends { role: string; content: unknown }>(formated: T[], card: ImageCard): T[] {
    const note = imageReminder(imageSystemOf(card))
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (!note || last < 0 || typeof formated[last].content !== 'string') return formated
    return formated.map((m, i) => (i === last ? { ...m, content: (m.content as string) + note } : m))
}

/** How many of the card's image tags a text carries (both formats). */
export function countImageTags(text: string): number {
    const t = String(text ?? '')
    return (t.match(TAG) ?? []).length + (t.match(/<img="[^"<>\n]+">/g) ?? []).length
}

/**
 * A rewrite must not cost the reply its pictures: a tag the first draft had for a character the final text still names,
 * and no longer tags, goes back in front of the first paragraph that names that character.
 */
export function keepAssetTags(first: string, final: string): { text: string; kept: string[] } {
    const kept: string[] = []
    let out = String(final ?? '')
    const have = new Set([...out.matchAll(TAG)].map((m) => prefixOf(m[1].trim())))
    for (const m of String(first ?? '').matchAll(TAG)) {
        const p = prefixOf(m[1].trim())
        if (!p || have.has(p)) continue
        const named = new RegExp(`(^|[^\\p{L}\\p{N}_])${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'iu')
        const paras = out.split(/\n\n+/)
        const at = paras.findIndex((para) => named.test(para) && !/^\s*[\[<【]/.test(para))
        if (at < 0) continue
        paras.splice(at, 0, m[0])
        out = paras.join('\n\n')
        have.add(p)
        kept.push(m[1].trim())
    }
    return { text: out, kept }
}
