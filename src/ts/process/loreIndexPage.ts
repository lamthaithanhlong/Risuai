// The page's side of the index pass (loreIndex.ts): before the lorebook pass of a turn, one rule for any card (planLore):
// all the lore when it fits the budget, else the helper model picks from the index and the picks fill the room left.
import { getDatabase, type character, type Chat } from '../storage/database.svelte'
import { buildLoreIndex, clearLorePicks, fitPicks, lorePickPrompt, MIN_ENTRIES, parseLorePick, pickedIds, planLore, recentText, setLorePicks } from './loreIndex'

const TIMEOUT_MS = 20_000
const cache = new Map<string, number[]>()
const lastPicks = new Map<string, number[]>()

/** On unless the card turned it off; only for a lorebook big enough to need it. */
export function loreIndexOn(char: character): boolean {
    return char.loreIndexPick !== false && buildLoreIndex(char.globalLore ?? []).reduce((n, it) => n + it.ids.length, 0) >= MIN_ENTRIES
}

/** Sets the lore this turn loads besides key words. Never throws; a failed or slow helper leaves the key words alone. */
export async function pickLoreForTurn(char: character | undefined, chat: Chat | undefined): Promise<void> {
    clearLorePicks()
    if (!char || char.type !== 'character' || !chat || !loreIndexOn(char)) return
    try {
        const lore = char.globalLore ?? []
        const index = buildLoreIndex(lore)
        const plan = planLore(lore, char.loreSettings?.tokenBudget ?? getDatabase().loreBookToken)
        if (plan.mode === 'all') { setLorePicks(char.chaId, pickedIds(index, index.map((_, i) => i + 1))); return }
        const recent = recentText(chat.message ?? [])
        if (!recent.trim()) return
        const key = `${char.chaId}|${index.length}|${plan.mode}|${recent}`
        let picks = cache.get(key)
        if (!picks) {
            const { requestChatData } = await import('./request/request')
            const ask = requestChatData({ formated: [{ role: 'user', content: lorePickPrompt(index, recent, undefined, plan.mode === 'hints') }], bias: {}, useStreaming: false, noMultiGen: true }, 'submodel')
            const res = await Promise.race([ask, new Promise<null>((r) => setTimeout(() => r(null), TIMEOUT_MS))])
            if (!res || res.type !== 'success' || typeof res.result !== 'string') return
            picks = parseLorePick(res.result, index.length)
            cache.set(key, picks)
            if (cache.size > 50) cache.delete(cache.keys().next().value!)
        }
        const chatKey = `${char.chaId}|${chat.id ?? ''}`
        const fitted = fitPicks(index, picks, lastPicks.get(chatKey) ?? [], plan.room)
        lastPicks.set(chatKey, fitted)
        setLorePicks(char.chaId, pickedIds(index, fitted))
    } catch (e) {
        console.warn('[lore index] skipped', e)
    }
}
