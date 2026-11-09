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
