// The page's side of the history table of contents (historyIndex.ts): the helper writes the missing lines (kept with the
// chat, so each old message is summarised once) and picks the old messages a turn needs. Any failure, or a slow helper,
// leaves the history as it was: nothing is lost, only not saved.

import { getDatabase, type Chat } from '../storage/database.svelte'
import { indexedHistory, INDEX_MEMO, parsePicks, parseToc, pickPrompt, splitForIndex, tocPrompt, type HistMsg } from './historyIndex'

const TOC_TIMEOUT_MS = 90_000
const PICK_TIMEOUT_MS = 20_000

async function helper(prompt: string, timeoutMs: number): Promise<string | null> {
    const { requestChatData } = await import('./request/request')
    const ask = requestChatData({ formated: [{ role: 'user', content: prompt }], bias: {}, useStreaming: false, noMultiGen: true }, 'submodel')
    const res = await Promise.race([ask, new Promise<null>((r) => setTimeout(() => r(null), timeoutMs))])
    return res && res.type === 'success' && typeof res.result === 'string' ? res.result : null
}

const said = (c: HistMsg) => `${c.role === 'user' ? 'PLAYER' : 'STORY'}: ${String(c.content ?? '')}`

/** The history to send: the table and the picks in place of the old messages, or the history unchanged. */
export async function historyForTurn<T extends HistMsg>(chats: T[], chat: Chat | undefined, make: (content: string) => T): Promise<T[]> {
    if (!chat || getDatabase().historyIndex === false) return chats
    try {
        const ids = new Set((chat.message ?? []).map((m) => m.chatId).filter((x): x is string => !!x))
        const split = splitForIndex(chats, ids)
        if (!split) return chats
        chat.historyToc ??= {}
        const toc = chat.historyToc
        const missing = split.old.map((i, k) => ({ n: k + 1, i })).filter(({ i }) => !toc[chats[i].memo!])
        if (missing.length) {
            const answer = await helper(tocPrompt(missing.map(({ n, i }) => ({ n, role: chats[i].role, text: String(chats[i].content) }))), TOC_TIMEOUT_MS)
            if (!answer) return chats
            const lines = parseToc(answer)
            for (const { n, i } of missing) {
                const line = lines.get(n)
                if (line) toc[chats[i].memo!] = line
            }
            if (missing.some(({ i }) => !toc[chats[i].memo!])) return chats
        }
        const lines = split.old.map((i) => toc[chats[i].memo!])
        const recent = split.recent.map((i) => said(chats[i]).slice(-1500)).join('\n\n')
        const now = said(chats[split.recent[split.recent.length - 1]])
        const tocString = lines.map((l, k) => `#${k + 1}: ${l}`).join('\n')
        const answer = await helper(pickPrompt(tocString, recent, now), PICK_TIMEOUT_MS)
        if (answer === null) return chats
        return indexedHistory(chats, split.old, lines, parsePicks(answer, lines.length), make)
    } catch (e) {
        console.warn('[history index] skipped', e)
        return chats
    }
}

export { INDEX_MEMO }
