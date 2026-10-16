// Lore picked from an index, not only by key words (asked 2026-10-15: "cho risu hiểu lấy index trc rồi từ index mới vào từng
// lore giống như cháu làm index là complete_book_lore").
//
// Measured on the live save the same day: in chat Adv1 (Shadow Slave, 60 messages, 783 lore entries) Risu's own lorebook pass
// activated 11 entries, all of them always-on rules; not one canon entry, because every key is English ("Nightmare", "Cassie",
// "Ashen Barrow") and the story is told in Vietnamese (and Korean while learning). No key appeared in the last 12 messages.
//
// So each turn a helper model reads the index (one line a title, ~2.4k tokens for that card) with the last messages, in any
// language, and names the entries the next reply needs; those are activated like a key match, within the token budget.

export type LoreLike = { comment?: string; content?: string; alwaysActive?: boolean }
export type IndexItem = { title: string; ids: number[]; hint?: string; tokens?: number }

/** At most this many titles are named a turn (the budget then decides how many are loaded). */
export const MAX_PICK = 12
/** An index with hints longer than this falls back to titles only. */
export const MAX_HINT_INDEX = 12_000
/** Tokens of a text, estimated (English lore: about 4 characters a token; measured o200k on the Shadow Slave card: 3.9). */
export const estTokens = (s: string) => Math.ceil((s ?? '').length / 3.9)
/** The opening of an entry, as its one-line hint: measured on the live Adv1 scene, titles alone gave "none" (the model did not
 *  know Dreamspawn are Nightmare creatures); with a hint it named the right three. */
export function hintOf(content: string, words = 22): string {
    return (content ?? '').replace(/^[#*\s>-]+/, '').split(/(?<=[.!?])\s/)[0].split(/\s+/).slice(0, words).join(' ')
}
/** A card with fewer keyword entries than this has no index pass (its keys are few enough to write in both languages). */
export const MIN_ENTRIES = 20

/** The index: the keyword entries (not always-on, not empty) grouped by title, in the lorebook's order. */
export function buildLoreIndex(lore: LoreLike[]): IndexItem[] {
    const out: IndexItem[] = []
    const at = new Map<string, IndexItem>()
    lore.forEach((l, i) => {
        if (l.alwaysActive || !(l.content ?? '').trim()) return
        const title = (l.comment ?? '').trim() || (l.content ?? '').trim().slice(0, 60)
        let item = at.get(title)
        if (!item) { item = { title, ids: [], hint: hintOf(l.content ?? ''), tokens: 0 }; at.set(title, item); out.push(item) }
        item.ids.push(i)
        item.tokens! += estTokens(l.content ?? '')
    })
    return out
}

/**
 * The plan for any card, from its sizes alone (asked: one rule for every story, not these two):
 *   all    the keyword lore fits in what the budget leaves after the always-on entries: load it all, no helper call
 *   hints  else the helper picks from an index of titles with a one-line hint (better picks, measured)
 *   titles else, when that index is itself too long, titles only
 */
export type LorePlan = { mode: 'all' | 'hints' | 'titles'; room: number; indexTokens: number }
export function planLore(lore: (LoreLike & { alwaysActive?: boolean })[], budget: number): LorePlan {
    const index = buildLoreIndex(lore)
    const always = lore.filter((l) => l.alwaysActive).reduce((n, l) => n + estTokens(l.content ?? ''), 0)
    const room = Math.max(0, budget - always)
    const keyword = index.reduce((n, it) => n + (it.tokens ?? 0), 0)
    if (keyword <= room) return { mode: 'all', room, indexTokens: 0 }
    const hints = estTokens(indexLines(index, true))
    if (hints <= MAX_HINT_INDEX) return { mode: 'hints', room, indexTokens: hints }
    return { mode: 'titles', room, indexTokens: estTokens(indexLines(index, false)) }
}
export const indexLines = (index: IndexItem[], hints: boolean) =>
    index.map((it, i) => `${i + 1}. ${it.title}${hints && it.hint ? ` — ${it.hint}` : ''}`).join('\n')

/** The picked titles in the model's order, then last turn's (for continuity), as long as they fit the room. */
export function fitPicks(index: IndexItem[], picks: number[], previous: number[], room: number): number[] {
    const out: number[] = []
    let used = 0
    for (const k of [...picks, ...previous]) {
        if (out.includes(k) || !index[k - 1]) continue
        const t = index[k - 1].tokens ?? 0
        if (used + t > room) continue
        out.push(k)
        used += t
    }
    return out
}

export function lorePickPrompt(index: IndexItem[], recent: string, max = MAX_PICK, hints = true): string {
    return 'Below is the index of a story\'s lore (one line a title), then the story\'s last messages, which may be in any language.'
        + ` Which lore does the next reply need to stay true to the canon: the places, creatures, people, powers and rules the scene is about or is about to meet? Answer with only the numbers, at most ${max}, the most needed first, comma-separated; or "none".`
        + '\n\nINDEX\n' + indexLines(index, hints)
        + '\n\nLAST MESSAGES\n' + recent
}

/** The numbers the model named, in its order: in range, once each, at most max. */
export function parseLorePick(answer: string, n: number, max = MAX_PICK): number[] {
    if (/^\s*none\b/i.test(answer ?? '')) return []
    const out: number[] = []
    for (const m of (answer ?? '').matchAll(/\d+/g)) {
        const k = parseInt(m[0], 10)
        if (k >= 1 && k <= n && !out.includes(k)) out.push(k)
        if (out.length >= max) break
    }
    return out
}

/** The lorebook positions of the picked titles. */
export function pickedIds(index: IndexItem[], picks: number[]): Set<number> {
    return new Set(picks.flatMap((k) => index[k - 1]?.ids ?? []))
}

/** The last messages as the picker reads them: the bar's and portraits' blocks left out, the newest kept whole. */
export function recentText(messages: { role: string; data: string }[], count = 6, chars = 4000): string {
    const text = messages.slice(-count).map((m) => `${m.role === 'user' ? 'PLAYER' : 'STORY'}: ${(m.data ?? '')
        .replace(/\[\[(?:REPLIES|CHECK|LOOK)\b[\s\S]*?\]\]/g, '').replace(/\{\{inlay::[^}]*\}\}/g, '').trim()}`).join('\n\n')
    return text.length > chars ? text.slice(text.length - chars) : text
}

// ---- the picks of the current turn, read by the lorebook pass -----------------------------------------------------------------

let current: { chaId: string; ids: Set<number> } | null = null
export function setLorePicks(chaId: string, ids: Set<number>) { current = { chaId, ids } }
export function clearLorePicks() { current = null }
/** True when the index pass picked this lorebook position for this character this turn. */
export function lorePicked(chaId: string, i: number): boolean {
    return !!current && current.chaId === chaId && current.ids.has(i)
}
