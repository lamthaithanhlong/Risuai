// The page's side of the index pass (loreIndex.ts): before the lorebook pass of a turn, one rule for any card (planLore):
// all the lore when it fits the budget, else the helper model picks from the titles and the picks fill the room left. A card
// whose lore is on shelves (Risu lore folders) is asked like a librarian: the shelves first, then the titles on those shelves.
import { getDatabase, type character, type Chat } from '../storage/database.svelte'
import { hasCreationStep, hasPanel, gmStateOf, yesAt } from './gameMaster'
import { bookNumbers, bookPickPrompt, buildLoreIndex, buildShelves, clearLorePicks, creationItems, fitPicks, forwardFor, forwardUsable, FORWARD_VAR, fromSub, lorePickPrompt, MAX_SHELVES, mentionedBooks, MIN_ENTRIES, MIN_PART_TOKENS, parseLorePick, pickedIds, planLore, recentText, setLorePicks, shelfBooks, shelfNumbers, shelfPickPrompt, withForward, type ForwardLore, type IndexItem, type Shelf } from './loreIndex'

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
        const got = plan.mode === 'shelves' ? await shelvedPicks(char, chat, index, recent, room) : await cachedAsk(`${char.chaId}|${index.length}|titles|${recent}`, lorePickPrompt(index, recent), index.length, 12)
        if (!got) return
        const picks = Array.isArray(got) ? got : got.picks
        const chatKey = `${char.chaId}|${chat.id ?? ''}`
        // last turn's picks stay for continuity; with shelves only those on a shelf named this turn (the scene still reads it),
        // so the room is not filled with what the scene has left behind
        const previous = (lastPicks.get(chatKey) ?? []).filter((k) => !forcedItems.includes(k) && (Array.isArray(got) || got.open.has(k)))
        const fitted = fitPicks(index, picks.filter((k) => !forcedItems.includes(k)), previous, room)
        lastPicks.set(chatKey, fitted)
        // with shelves, the books on shelves the librarian did not name are left behind (loreIndex.ts loreLeftBehind)
        setLorePicks(char.chaId, pickedIds(index, fitted), forced, Array.isArray(got) ? undefined : pickedIds(index, [...got.open]))
    } catch (e) {
        console.warn('[lore index] skipped', e)
    }
}

/**
 * Shelves first, then the titles on the named shelves that do not come whole (loreIndex.ts shelfBooks). `open`: every title on
 * the named shelves. Null when the helper failed. `fw`: the GM already named the shelves (and maybe the books) for this reply:
 * those questions are not asked again, and a title the player said outright is added (it could not be known before).
 */
async function librarian(char: character, index: IndexItem[], recent: string, room: number, fw?: ForwardLore | null, player = ''): Promise<{ picks: number[]; open: Set<number> } | null> {
    const shelves = buildShelves(char.globalLore ?? [], index)
    let named: number[]
    if (fw) named = shelfNumbers(fw, shelves)
    else {
        const got = await cachedAsk(`${char.chaId}|${index.length}|shelves|${recent}`, shelfPickPrompt(shelves, recent), shelves.length, MAX_SHELVES)
        if (!got) return null
        named = got
    }
    const said = fw ? mentionedBooks(index, player) : []
    const open = new Set([...named.flatMap((k) => shelves[k - 1]?.items ?? []), ...said])
    const { whole, ask } = shelfBooks(shelves, named, index, room)
    if (!ask.length) return { picks: [...said, ...whole], open }
    const left = Math.max(0, room - whole.reduce((n, k) => n + (index[k - 1]?.tokens ?? 0), 0))
    if (left < MIN_PART_TOKENS) return { picks: [...said, ...whole], open }
    if (fw?.books) return { picks: [...said, ...whole, ...bookNumbers(fw, index).filter((k) => ask.includes(k))], open }
    const books = await cachedAsk(`${char.chaId}|${index.length}|books|${ask.join(',')}|${recent}`, bookPickPrompt(index, ask, recent), ask.length, 12)
    return { picks: books ? [...said, ...whole, ...fromSub(ask, books)] : [...said, ...whole], open }
}

// ---- the GM asks the librarian (loreIndex.ts, 2026-10-20) ---------------------------------------------------------------------
// The bookkeeper that runs after a reply names the shelves the next reply needs (gameMasterPage.ts bookkeep), the books of those
// shelves are asked right then (prefetchBooks), and both wait in the chat's variables; this turn finds them and asks nothing
// before the narrator. Anything missing, stale or off: the live librarian above, as before.

/** What the GM's answers saved the helper this session (for the acceptance scorecard and the console). */
export const forwardStats = { hit: 0, books: 0, miss: 0 }

/** On unless the setting is off. */
const forwardOn = () => getDatabase().loreForward !== false

/** What the bookkeeper needs to ask for the shelves: the card's shelves, when this card runs the librarian; else null. */
export function forwardAsk(char: character | undefined): { shelves: Shelf[]; indexLength: number } | null {
    if (!char || char.type !== 'character' || !forwardOn() || !loreIndexOn(char)) return null
    const lore = char.globalLore ?? []
    const index = buildLoreIndex(lore)
    const plan = planLore(lore, char.loreSettings?.tokenBudget ?? getDatabase().loreBookToken)
    return plan.mode === 'shelves' ? { shelves: buildShelves(lore, index), indexLength: index.length } : null
}

/** The bookkeeper chains of this session, by chat: the next turn waits for the one still running instead of asking itself. */
const pending = new Map<string, Promise<unknown>>()
const FORWARD_WAIT_MS = 8_000
export function trackForward(chat: Chat, p: Promise<unknown>): void {
    const key = chat.id ?? ''
    const q = p.catch(() => undefined).finally(() => { if (pending.get(key) === q) pending.delete(key) })
    pending.set(key, q)
}

const lastReplyId = (chat: Chat) => [...(chat.message ?? [])].reverse().find((m) => m.role === 'char')?.chatId
const lastPlayer = (chat: Chat) => [...(chat.message ?? [])].reverse().find((m) => m.role === 'user')?.data ?? ''

/**
 * The books of the shelves the GM named, asked now (nobody is waiting on it) from the story as it stands after the reply, and
 * kept with the shelves in the chat's variable. Dropped when the chat has moved on meanwhile (a reroll, a newer reply).
 */
export async function prefetchBooks(char: character, chat: Chat): Promise<void> {
    try {
        const fw = forwardFor(chat.scriptstate, lastReplyId(chat))
        const lore = char.globalLore ?? []
        const index = buildLoreIndex(lore)
        if (!forwardUsable(fw, lastReplyId(chat), index.length)) return
        const plan = planLore(lore, char.loreSettings?.tokenBudget ?? getDatabase().loreBookToken)
        const shelves = buildShelves(lore, index)
        const { whole, ask } = shelfBooks(shelves, shelfNumbers(fw, shelves), index, plan.room)
        const left = Math.max(0, plan.room - whole.reduce((n, k) => n + (index[k - 1]?.tokens ?? 0), 0))
        if (!ask.length || left < MIN_PART_TOKENS) return
        const recent = recentText(chat.message ?? [])
        const books = await cachedAsk(`${char.chaId}|${index.length}|books|${ask.join(',')}|${recent}`, bookPickPrompt(index, ask, recent), ask.length, 12)
        const now = forwardFor(chat.scriptstate, lastReplyId(chat))
        if (!books || !forwardUsable(now, lastReplyId(chat), index.length) || now.at !== fw.at) return
        chat.scriptstate ??= {}
        chat.scriptstate[FORWARD_VAR] = withForward(chat.scriptstate, { ...now, books: fromSub(ask, books).map((k) => index[k - 1].title) })
    } catch (e) {
        console.warn('[lore index] prefetch skipped', e)
    }
}

/** The picks of a shelved card: from the GM's waiting answer when there is one for this reply, else the live librarian. */
async function shelvedPicks(char: character, chat: Chat, index: IndexItem[], recent: string, room: number): Promise<{ picks: number[]; open: Set<number> } | null> {
    const shadow = getDatabase().loreForwardShadow === true
    let fw: ForwardLore | null = null
    if (forwardOn() || shadow) {
        const run = pending.get(chat.id ?? '')
        if (run) await Promise.race([run, new Promise((r) => setTimeout(r, FORWARD_WAIT_MS))])
        const v = forwardFor(chat.scriptstate, lastReplyId(chat))
        fw = forwardUsable(v, lastReplyId(chat), index.length) ? v : null
    }
    if (shadow) return shadowPicks(char, chat, index, recent, room, fw)
    if (!fw) { if (forwardOn()) forwardStats.miss++; return librarian(char, index, recent, room) }
    forwardStats.hit++
    if (fw.books) forwardStats.books++
    return librarian(char, index, recent, room, fw, lastPlayer(chat))
}

/**
 * Measuring: the live librarian decides the turn; what the GM's waiting answer would have loaded is kept on the chat
 * ("$lore_shadow") beside it, as titles, to read back after a run.
 */
async function shadowPicks(char: character, chat: Chat, index: IndexItem[], recent: string, room: number, fw: ForwardLore | null) {
    const live = await librarian(char, index, recent, room)
    const shelves = buildShelves(char.globalLore ?? [], index)
    const title = (ks: number[]) => ks.map((k) => index[k - 1]?.title).filter(Boolean)
    const sh = (ids: Set<number>) => shelves.filter((s) => s.items.some((k) => ids.has(k))).map((s) => s.name)
    const fwd = fw ? await librarianNoAsk(char, index, recent, room, fw, lastPlayer(chat)) : null
    const entry = { at: lastReplyId(chat) ?? '', hit: !!fw, books: !!fw?.books, fwShelves: fw?.shelves ?? [], liveShelves: live ? sh(live.open) : [], fwBooks: fwd ? title(fwd.picks) : [], liveBooks: live ? title(live.picks) : [] }
    let log: unknown[] = []
    try { log = JSON.parse(String(chat.scriptstate?.$lore_shadow || '[]')) } catch { log = [] }
    chat.scriptstate ??= {}
    chat.scriptstate.$lore_shadow = JSON.stringify([...log, entry].slice(-60))
    return live
}
/** What the waiting answer alone would load: its books, none asked for. */
async function librarianNoAsk(char: character, index: IndexItem[], recent: string, room: number, fw: ForwardLore, player: string) {
    return librarian(char, index, recent, room, { ...fw, books: fw.books ?? [] }, player)
}
