// The librarian's facts for this turn (server/node/storyGraph.cjs, POST /api/story/facts): the scene's last messages go in, the facts
// about who and what they name come back, each tagged FACT / RUMOR / UNKNOWN / OUTDATED with who knows it, and go with the scene's
// books (loreIndex.ts sceneLoreMessage) so the narrator never tells a rumor or a stale fact as true and an NPC knows only what it knows.
// No server, the graph off, a slow answer or any error gives '' and the turn goes on without them.

export interface FactsDeps {
    fetch: typeof fetch
    auth(): Promise<string>
    timeoutMs?: number
}

/** the block's first line, as storyGraph.cjs HEADER starts */
const BLOCK = /^\[Facts the librarian checked for this scene\./

export async function fetchSceneFacts(chatId: string | undefined, text: string, deps: FactsDeps, maxTokens = 450): Promise<string> {
    if (!chatId || !text.trim()) return ''
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? 1500)
    try {
        const res = await deps.fetch('/api/story/facts', {
            method: 'POST', signal: ctl.signal,
            headers: { 'content-type': 'application/json', 'risu-auth': await deps.auth() },
            body: JSON.stringify({ chatId, text: text.slice(-6000), maxTokens }),
        })
        if (!res.ok) return ''
        const r = await res.json()
        const lines = typeof r?.lines === 'string' ? r.lines : ''
        if (r?.status !== 'ok' || !BLOCK.test(lines) || lines.length > 12_000) return ''
        return lines
    } catch {
        return ''
    } finally {
        clearTimeout(timer)
    }
}
