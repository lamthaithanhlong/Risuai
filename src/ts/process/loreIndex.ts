// Lore picked from an index, not only by key words (asked 2026-10-15: "cho risu hiểu lấy index trc rồi từ index mới vào từng
// lore giống như cháu làm index là complete_book_lore").
//
// Measured on the live save the same day: in chat Adv1 (Shadow Slave, 60 messages, 783 lore entries) Risu's own lorebook pass
// activated 11 entries, all of them always-on rules; not one canon entry, because every key is English ("Nightmare", "Cassie",
// "Ashen Barrow") and the story is told in Vietnamese (and Korean while learning). No key appeared in the last 12 messages.
//
// So each turn a helper model reads the index (one line a title, ~2.4k tokens for that card) with the last messages, in any
// language, and names the entries the next reply needs; those are activated like a key match, within the token budget.

export type LoreLike = { comment?: string; content?: string; alwaysActive?: boolean; mode?: string; key?: string; folder?: string }
export type IndexItem = { title: string; ids: number[]; hint?: string; tokens?: number; shelf?: string }

/** At most this many titles are named a turn (the budget then decides how many are loaded). */
export const MAX_PICK = 12
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
    const shelfOf = folderNames(lore)
    lore.forEach((l, i) => {
        if (l.alwaysActive || isFolder(l) || !(l.content ?? '').trim()) return
        const title = (l.comment ?? '').trim() || (l.content ?? '').trim().slice(0, 60)
        let item = at.get(title)
        if (!item) {
            item = { title, ids: [], hint: hintOf(l.content ?? ''), tokens: 0 }
            const shelf = l.folder ? shelfOf.get(l.folder) : undefined
            if (shelf) item.shelf = shelf
            at.set(title, item)
            out.push(item)
        }
        item.ids.push(i)
        item.tokens! += estTokens(l.content ?? '')
    })
    return out
}

/**
 * The plan for any card, from its sizes alone (asked: one rule for every story, and the fewest tokens for the best picks):
 *   all    the keyword lore fits in what the budget leaves after the always-on entries: load it all, no helper call
 *   titles else the helper picks from an index of titles
 * Measured 2026-10-15 on 16 Vietnamese scenes written from random canon entries of the Shadow Slave card (the entry is
 * the answer): key words found 1/16; titles + the story model 15/16 (94%) for 3.4k tokens; titles with a 10-word hint 88%
 * for 7.0k; a 22-word hint 81% for 10.4k; two stages 88% for 4.6k and twice the wait; the faster luna model 69-75%.
 * The one scene where titles said "none" had no canon in it: the strong model given the real next reply said none too.
 */
export type LorePlan = { mode: 'all' | 'titles' | 'shelves'; room: number; indexTokens: number }
export function planLore(lore: (LoreLike & { alwaysActive?: boolean })[], budget: number): LorePlan {
    const index = buildLoreIndex(lore)
    const always = lore.filter((l) => l.alwaysActive).reduce((n, l) => n + estTokens(l.content ?? ''), 0)
    const room = Math.max(0, budget - always)
    const keyword = index.reduce((n, it) => n + (it.tokens ?? 0), 0)
    if (keyword <= room) return { mode: 'all', room, indexTokens: 0 }
    const shelves = buildShelves(lore, index)
    if (shelves.length >= 2) return { mode: 'shelves', room, indexTokens: estTokens(shelfLines(shelves)) }
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
        if (used + t > room) {
            // a picked title bigger than what is left still goes, in part (the budget pass cuts it at a heading)
            if (room - used >= MIN_PART_TOKENS && picks.includes(k)) { out.push(k); used = room }
            continue
        }
        out.push(k)
        used += t
    }
    return out
}

export function lorePickPrompt(index: IndexItem[], recent: string, max = MAX_PICK, hints = false): string {
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

// ---- the librarian: index → shelf → book (asked 2026-10-20) ---------------------------------------------------------------------
// Measured 2026-10-19 on the four story cards: 6.6–8.2k tokens of always-on rules every turn (o200k), most of them for one kind
// of scene (a fight, a delivery world, the creation interview), and a one-line-a-title index of 230–670 titles for the helper.
// So the cards keep only their core rules always on and put the rest on shelves: Risu's own lore folders (an entry of mode
// 'folder' is a shelf, its comment the shelf's name, its content an optional one-line hint; a book names its shelf in `folder`).
// The helper reads the shelves first, then only the titles on the shelves it named; a small shelf (a few rules) comes whole.

export type Shelf = { name: string; hint: string; items: number[]; tokens: number }
/** At most this many shelves are named a turn. */
export const MAX_SHELVES = 4
/** A shelf this small is taken whole when named (a shelf of rules), with no second question. */
export const WHOLE_SHELF_TOKENS = 1600
/** The shelf whose books the creation turns load, whatever was picked (a card's "Rules — character creation"). */
export const CREATION_SHELF = /\bcreation\b|tạo nhân vật/i

export const isFolder = (l: LoreLike) => l.mode === 'folder'
/** Folder key → shelf name (the folder's comment). */
function folderNames(lore: LoreLike[]): Map<string, string> {
    const m = new Map<string, string>()
    for (const l of lore) if (isFolder(l) && l.key && (l.comment ?? '').trim()) m.set(l.key, l.comment!.trim())
    return m
}

/**
 * The shelves, in the lorebook's order of their folders, each with its index positions (1-based, as the picks are). Titles on
 * no shelf go on a last shelf "Other". No folder at all: no shelves (the card keeps the one-level index).
 */
export function buildShelves(lore: LoreLike[], index: IndexItem[] = buildLoreIndex(lore)): Shelf[] {
    const folders = lore.filter((l) => isFolder(l) && l.key && (l.comment ?? '').trim())
    if (!folders.length) return []
    const shelves: Shelf[] = []
    const byName = new Map<string, Shelf>()
    for (const f of folders) {
        const name = f.comment!.trim()
        if (byName.has(name)) continue
        const s: Shelf = { name, hint: hintOf(f.content ?? '', 16), items: [], tokens: 0 }
        byName.set(name, s)
        shelves.push(s)
    }
    index.forEach((it, i) => {
        let s = byName.get(it.shelf ?? '')
        if (!s) {
            s = byName.get('Other')
            if (!s) { s = { name: 'Other', hint: '', items: [], tokens: 0 }; byName.set('Other', s); shelves.push(s) }
        }
        s.items.push(i + 1)
        s.tokens += it.tokens ?? 0
    })
    const out = shelves.filter((s) => s.items.length)
    // a shelf with no hint of its own shows its first titles
    for (const s of out) if (!s.hint) s.hint = s.items.slice(0, 4).map((k) => index[k - 1].title).join('; ')
    return out
}

export const shelfLines = (shelves: Shelf[]) =>
    shelves.map((s, i) => `${i + 1}. ${s.name}${s.hint ? ` — ${s.hint}` : ''} (${s.items.length})`).join('\n')

export function shelfPickPrompt(shelves: Shelf[], recent: string, max = MAX_SHELVES): string {
    return 'Below are the shelves of a story\'s lore (one line a shelf: its name, what it holds, how many entries), then the story\'s last messages, which may be in any language.'
        + ` Which shelves hold what the next reply needs to stay true to the canon and the rules: the places, creatures, people, powers and rules the scene is about or is about to meet (a fight, a journey, a trade, a power used)? Answer with only the numbers, at most ${max}, the most needed first, comma-separated; or "none".`
        + '\n\nSHELVES\n' + shelfLines(shelves)
        + '\n\nLAST MESSAGES\n' + recent
}

/**
 * What the named shelves give before any second question: `whole` the titles taken as they are (every title of the named
 * shelves when they all fit the room; else every small shelf), `ask` the titles the helper picks from next.
 */
export function shelfBooks(shelves: Shelf[], picked: number[], index: IndexItem[], room: number): { whole: number[]; ask: number[] } {
    const named = picked.map((k) => shelves[k - 1]).filter(Boolean)
    const all = [...new Set(named.flatMap((s) => s.items))]
    if (all.reduce((n, k) => n + (index[k - 1]?.tokens ?? 0), 0) <= room) return { whole: all, ask: [] }
    const whole: number[] = []
    const ask: number[] = []
    for (const s of named) for (const k of s.items) {
        if (whole.includes(k) || ask.includes(k)) continue
        ;(s.tokens <= WHOLE_SHELF_TOKENS ? whole : ask).push(k)
    }
    return { whole, ask }
}

/** The second question: the titles of the named shelves only, numbered 1..n; the answer maps back with `fromSub`. */
export function bookPickPrompt(index: IndexItem[], ask: number[], recent: string, max = MAX_PICK): string {
    return lorePickPrompt(ask.map((k) => index[k - 1]), recent, max)
}
export const fromSub = (ask: number[], picks: number[]) => picks.map((p) => ask[p - 1]).filter((k) => k !== undefined)

/** The titles on the creation shelf: loaded on every creation turn, kept within the budget before any other lore. */
export function creationItems(shelves: Shelf[]): number[] {
    return shelves.filter((s) => CREATION_SHELF.test(s.name)).flatMap((s) => s.items)
}

// ---- the Future Plan line, as the lore passes read it --------------------------------------------------------------------------
// The story cards end each reply with "[💡Kế hoạch| names ]" and their status.lua drops it from older replies, so the key pass
// wakes only the names planned last. A chat merged from two devices that both replied from one base keeps two lines until the
// next reply (Alloy, specs/story/PlanMerge.als: OnePlanAfterMerge has a counterexample); an edit or a restored backup can bring
// one back too. So the passes themselves read only the newest reply's line, whatever the stored chat holds.
const PLAN_LINE = /[ \t]*\[💡[^\]\n]*\][ \t]*/g
/** The messages with every Future Plan line but the newest reply's left out (the same array when there is nothing to leave out). */
export function onlyNewestPlan<T extends { role: string; data: string }>(messages: T[]): T[] {
    const last = messages.map((m) => m.role).lastIndexOf('char')
    if (!messages.some((m, i) => i !== last && m.role === 'char' && (m.data ?? '').includes('[💡'))) return messages
    return messages.map((m, i) => (i !== last && m.role === 'char' && (m.data ?? '').includes('[💡') ? { ...m, data: m.data.replace(PLAN_LINE, '').trimEnd() } : m))
}

/** The last messages as the picker reads them: the bar's and portraits' blocks left out, the newest kept whole. */
export function recentText(messages: { role: string; data: string }[], count = 6, chars = 4000): string {
    const text = onlyNewestPlan(messages.slice(-count)).map((m) => `${m.role === 'user' ? 'PLAYER' : 'STORY'}: ${(m.data ?? '')
        .replace(/\[\[(?:REPLIES|CHECK|LOOK)\b[\s\S]*?\]\]/g, '').replace(/\{\{inlay::[^}]*\}\}/g, '').trim()}`).join('\n\n')
    return text.length > chars ? text.slice(text.length - chars) : text
}

// ---- the picks of the current turn, read by the lorebook pass -----------------------------------------------------------------

let current: { chaId: string; ids: Set<number>; forced: Set<number> } | null = null
/** `forced`: positions loaded this turn whatever the picks, and kept within the budget like the always-on rules (creation). */
export function setLorePicks(chaId: string, ids: Set<number>, forced: Set<number> = new Set()) {
    current = { chaId, ids: new Set([...ids, ...forced]), forced }
}
export function clearLorePicks() { current = null }
/** True when the index pass picked this lorebook position for this character this turn. */
export function lorePicked(chaId: string, i: number): boolean {
    return !!current && current.chaId === chaId && current.ids.has(i)
}
/** True when this position must be loaded and never dropped for the budget this turn (the creation shelf on a creation turn). */
export function loreForced(chaId: string, i: number): boolean {
    return !!current && current.chaId === chaId && current.forced.has(i)
}

/**
 * The index pass's part in the lorebook pass, for one entry (lorebook.svelte.ts): a decorator's @@activate / @@dont_activate
 * wins; else the creation shelf on a creation turn is loaded and kept within the budget like an always-on rule; else a pick
 * loads what the key words did not. `why` is for the count (loreStats).
 */
export function indexActivation(chaId: string, i: number, cardLore: boolean, activated: boolean, forceState: string, alwaysActive: boolean): { activated: boolean; always: boolean; why: string } {
    const plain = { activated, always: alwaysActive, why: alwaysActive ? 'always' : 'key' }
    if (forceState !== 'none' || !cardLore) return plain
    if (loreForced(chaId, i)) return { activated: true, always: true, why: alwaysActive ? 'always' : 'forced' }
    if (!activated && lorePicked(chaId, i)) return { activated: true, always: alwaysActive, why: 'picked' }
    return plain
}

/** What the lorebook pass sent last turn, by why each entry was sent (o200k tokens, the app's own count). */
export type LoreStats = { at: number; budget: number; sent: number; always: number; forced: number; picked: number; keyed: number; entries: number; dropped: number }
export function loreStats<T extends { tokens: number; why?: string }>(actives: T[], kept: T[], budget: number): LoreStats {
    const sum = (w: string) => kept.filter((a) => a.why === w).reduce((n, a) => n + a.tokens, 0)
    return { at: Date.now(), budget, sent: kept.reduce((n, a) => n + a.tokens, 0), always: sum('always'), forced: sum('forced'), picked: sum('picked'),
        keyed: sum('key'), entries: kept.length, dropped: actives.length - kept.length }
}

/**
 * Lore that belongs to learning mode: the foreign speaker module ("MODULE 08: THE FOREIGN SPEAKER", loaded as an always-on
 * entry) or any entry marked @@learning_only. Reported 2026-10-15: with learning mode off the story still said Elise did not
 * understand Vietnamese and offered Korean lines, because that always-on entry went on being sent. Such lore is left out
 * while learning mode is off.
 */
export function isLearningOnlyLore(l: LoreLike): boolean {
    return /@@learning_only\b/.test(l.content ?? '') || /^\s*MODULE\s+\d+:\s*THE\s+FOREIGN\s+SPEAKER\b/i.test(l.content ?? '')
        || /\b(?:foreign|japanese)\s+speaker\b/i.test(l.comment ?? '')
}

// ---- the budget, for every card (asked 2026-10-15: "cho này toàn risu được ko") -----------------------------------------------

/** The least of a cut entry worth sending; below this the rest of the room stays empty. */
export const MIN_PART_TOKENS = 300

/**
 * The opening of an entry that fits the room, cut at a heading or a paragraph, never mid-sentence when it can help it: an
 * entry bigger than what is left is sent in part instead of dropped (23 of the Shadow Slave card's 237 titles pass 1,500
 * tokens; the Lore Codex is 4,785).
 */
export function headOf(content: string, maxTokens: number, tokensOf: (s: string) => number = estTokens): string {
    if (tokensOf(content) <= maxTokens) return content
    const parts = content.split(/(?=\n#{1,6} )|\n{2,}/)
    let out = ''
    for (const p of parts) {
        const next = out ? `${out}\n\n${p.replace(/^\n+/, '')}` : p
        if (tokensOf(next) > maxTokens) break
        out = next
    }
    if (out) return out
    // one paragraph bigger than the room: whole sentences of it
    for (const sentence of content.split(/(?<=[.!?。])\s+/)) {
        const next = out ? `${out} ${sentence}` : sentence
        if (tokensOf(next) > maxTokens) break
        out = next
    }
    return out
}

export type Active = { tokens: number; priority: number; always?: boolean; prompt: string }
/**
 * The entries kept within the budget: the always-on ones first (the rules a card is built on: with a tight budget Risu used
 * to keep whichever had the higher insert order and could drop a rule for a lore entry), then by priority; an entry that
 * does not fit whole is sent in part when at least MIN_PART_TOKENS are left.
 */
export async function fitBudget<T extends Active>(actives: T[], budget: number, tokensOf: (s: string) => Promise<number> | number): Promise<T[]> {
    const sorted = [...actives].sort((a, b) => (Number(!!b.always) - Number(!!a.always)) || (b.priority - a.priority))
    const kept: T[] = []
    let used = 0
    for (const act of sorted) {
        if (used + act.tokens <= budget) { kept.push(act); used += act.tokens; continue }
        const left = budget - used
        if (left < MIN_PART_TOKENS) continue
        const prompt = headOf(act.prompt, left, estTokens)
        if (!prompt) continue
        const tokens = await tokensOf(prompt)
        if (tokens > left) continue
        kept.push({ ...act, prompt, tokens })
        used += tokens
    }
    return kept
}
