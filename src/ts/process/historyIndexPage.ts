// The page's side of the history table of contents (historyIndex.ts): the helper writes the missing lines (kept with the
// chat, so each old message is summarised once) and picks the old messages a turn needs. Any failure, or a slow helper,
// leaves the history as it was: nothing is lost, only not saved. A slow TOC answer is still kept for the next turn.

import { getDatabase, type Chat } from '../storage/database.svelte'
import { sharedJob, waitAtMost } from './helperJob'
import { indexedHistory, INDEX_MEMO, parsePicks, parseToc, pickPrompt, splitForIndex, tocPrompt, type HistMsg } from './historyIndex'

const TOC_TIMEOUT_MS = 90_000
const PICK_TIMEOUT_MS = 20_000

async function helper(prompt: string, signal?: AbortSignal): Promise<string | null> {
    const { requestChatData } = await import('./request/request')
    const res = await requestChatData({ formated: [{ role: 'user', content: prompt }], bias: {}, useStreaming: false, noMultiGen: true }, 'submodel', signal)
    return res && res.type === 'success' && typeof res.result === 'string' ? res.result : null
}

/** The pick is for this turn only: past its timeout it is aborted, so it does not keep a (ChatGPT web) turn busy for nothing. */
async function pickHelper(prompt: string): Promise<string | null> {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), PICK_TIMEOUT_MS)
    try {
        return await waitAtMost(helper(prompt, ctl.signal), PICK_TIMEOUT_MS)
    } finally {
        clearTimeout(timer)
        ctl.abort()
    }
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
            // The missing lines are written by a job of the chat that outlives this turn's wait: a slow answer is kept for the next
            // turn, and a turn that comes while it runs joins it (helperJob.ts, specs/core/HelperCache.tla).
            const job = sharedJob(`toc:${chat.id ?? chats[split.old[0]].memo}`, async (signal) => {
                const answer = await helper(tocPrompt(missing.map(({ n, i }) => ({ n, role: chats[i].role, text: String(chats[i].content) }))), signal)
                if (!answer) return
                const lines = parseToc(answer)
                for (const { n, i } of missing) {
                    const line = lines.get(n)
                    if (line) toc[chats[i].memo!] = line
                }
            })
            await waitAtMost(job, TOC_TIMEOUT_MS)
            if (missing.some(({ i }) => !toc[chats[i].memo!])) return chats
        }
        const lines = split.old.map((i) => toc[chats[i].memo!])
        const recent = split.recent.map((i) => said(chats[i]).slice(-1500)).join('\n\n')
        const now = said(chats[split.recent[split.recent.length - 1]])
        const tocString = lines.map((l, k) => `#${k + 1}: ${l}`).join('\n')
        const answer = await pickHelper(pickPrompt(tocString, recent, now))
        if (answer === null) return chats
        return indexedHistory(chats, split.old, lines, parsePicks(answer, lines.length), make)
    } catch (e) {
        console.warn('[history index] skipped', e)
        return chats
    }
}

export { INDEX_MEMO }
