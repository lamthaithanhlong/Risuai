// The page's side of the index pass (loreIndex.ts): before the lorebook pass of a turn, one rule for any card (planLore):
// all the lore when it fits the budget, else the helper model picks from the titles and the picks fill the room left. A card
// whose lore is on shelves (Risu lore folders) is asked like a librarian: the shelves first, then the titles on those shelves.
import { getDatabase, type character, type Chat } from '../storage/database.svelte'
import { hasCreationStep, hasPanel, gmStateOf, yesAt } from './gameMaster'
import { bookPickPrompt, buildLoreIndex, buildShelves, clearLorePicks, creationItems, fitPicks, fromSub, lorePickPrompt, MAX_SHELVES, MIN_ENTRIES, MIN_PART_TOKENS, parseLorePick, pickedIds, planLore, recentText, setLorePicks, shelfBooks, shelfPickPrompt, type IndexItem } from './loreIndex'

const TIMEOUT_MS = 20_000
const cache = new Map<string, number[]>()
const lastPicks = new Map<string, number[]>()

/** On unless the card turned it off; only for a lorebook big enough to need it. */
export function loreIndexOn(char: character): boolean {
    return char.loreIndexPick !== false && buildLoreIndex(char.globalLore ?? []).reduce((n, it) => n + it.ids.length, 0) >= MIN_ENTRIES
}

/**
 * A turn of character creation: the card has a creation step, the story has not started (no panel, no GM yet) and the player
 * has not said yes, or this turn is the yes itself (the card's Initialization, which still reads the creation rules: the
 * starting point, the locked record).
 */
export function creationTurn(char: character, messages: { role: string; data: string }[], vars: Record<string, unknown> | undefined): boolean {
    if (!hasCreationStep(char)) return false
    const gm = gmStateOf(vars)
    if (hasPanel(vars) || gm.gm_arc || gm.gm_past) return false
    const yes = yesAt(messages)
    return yes < 0 || !messages.slice(yes + 1).some((m) => m.role === 'char')
}

async function ask(prompt: string): Promise<number[] | null> {
    const { requestChatData } = await import('./request/request')
    const req = requestChatData({ formated: [{ role: 'user', content: prompt }], bias: {}, useStreaming: false, noMultiGen: true }, 'submodel')
    const res = await Promise.race([req, new Promise<null>((r) => setTimeout(() => r(null), TIMEOUT_MS))])
    if (!res || res.type !== 'success' || typeof res.result !== 'string') return null
    return [0, ...parseLorePick(res.result, 10_000)]               // 0 marks an answer (an empty one is "none")
}

/** The model's answer to a prompt, cached by its text; null when the helper failed or was slow. */
async function cachedAsk(key: string, prompt: string, n: number, max: number): Promise<number[] | null> {
    let picks = cache.get(key)
    if (!picks) {
        const got = await ask(prompt)
        if (!got) return null
        picks = got.slice(1).filter((k) => k >= 1 && k <= n).slice(0, max)
        cache.set(key, picks)
        if (cache.size > 50) cache.delete(cache.keys().next().value!)
    }
    return picks
}

/** Sets the lore this turn loads besides key words. Never throws; a failed or slow helper leaves the key words alone. */
export async function pickLoreForTurn(char: character | undefined, chat: Chat | undefined): Promise<void> {
    clearLorePicks()
    if (!char || char.type !== 'character' || !chat) return
    try {
        const lore = char.globalLore ?? []
        const index = buildLoreIndex(lore)
        const shelves = buildShelves(lore, index)
        // the creation turns' rules, whatever the helper says or whether it runs (the index pass may be off for this card)
        const forcedItems = creationTurn(char, chat.message ?? [], chat.scriptstate) ? creationItems(shelves) : []
        const forced = pickedIds(index, forcedItems)
        if (!loreIndexOn(char)) { if (forced.size) setLorePicks(char.chaId, new Set(), forced); return }
        setLorePicks(char.chaId, new Set(), forced)
        const plan = planLore(lore, char.loreSettings?.tokenBudget ?? getDatabase().loreBookToken)
        if (plan.mode === 'all') { setLorePicks(char.chaId, pickedIds(index, index.map((_, i) => i + 1)), forced); return }
        const recent = recentText(chat.message ?? [])
        if (!recent.trim()) return
        const room = Math.max(0, plan.room - forcedItems.reduce((n, k) => n + (index[k - 1]?.tokens ?? 0), 0))
        const got = plan.mode === 'shelves' ? await librarian(char, index, recent, room) : await cachedAsk(`${char.chaId}|${index.length}|titles|${recent}`, lorePickPrompt(index, recent), index.length, 12)
        if (!got) return
        const picks = Array.isArray(got) ? got : got.picks
        const chatKey = `${char.chaId}|${chat.id ?? ''}`
        // last turn's picks stay for continuity; with shelves only those on a shelf named this turn (the scene still reads it),
        // so the room is not filled with what the scene has left behind
        const previous = (lastPicks.get(chatKey) ?? []).filter((k) => !forcedItems.includes(k) && (Array.isArray(got) || got.open.has(k)))
        const fitted = fitPicks(index, picks.filter((k) => !forcedItems.includes(k)), previous, room)
        lastPicks.set(chatKey, fitted)
        setLorePicks(char.chaId, pickedIds(index, fitted), forced)
    } catch (e) {
        console.warn('[lore index] skipped', e)
    }
}

/**
 * Shelves first, then the titles on the named shelves that do not come whole (loreIndex.ts shelfBooks). `open`: every title on
 * the named shelves. Null when the helper failed.
 */
async function librarian(char: character, index: IndexItem[], recent: string, room: number): Promise<{ picks: number[]; open: Set<number> } | null> {
    const shelves = buildShelves(char.globalLore ?? [], index)
    const named = await cachedAsk(`${char.chaId}|${index.length}|shelves|${recent}`, shelfPickPrompt(shelves, recent), shelves.length, MAX_SHELVES)
    if (!named) return null
    const open = new Set(named.flatMap((k) => shelves[k - 1]?.items ?? []))
    const { whole, ask } = shelfBooks(shelves, named, index, room)
    if (!ask.length) return { picks: whole, open }
    const left = Math.max(0, room - whole.reduce((n, k) => n + (index[k - 1]?.tokens ?? 0), 0))
    if (left < MIN_PART_TOKENS) return { picks: whole, open }
    const books = await cachedAsk(`${char.chaId}|${index.length}|books|${ask.join(',')}|${recent}`, bookPickPrompt(index, ask, recent), ask.length, 12)
    return { picks: books ? [...whole, ...fromSub(ask, books)] : whole, open }
}
