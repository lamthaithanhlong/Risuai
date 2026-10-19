// Jev referee of the player's turn (server/node/jevReferee.cjs, POST /api/story/referee), for every story on the Node server.
// Jev scores the turn against the chat's panel and the last narration; when the action is beyond the character or the player
// wrote someone else's outcome, a short note goes after the player's message (where playerAgency.ts puts its reminder, because a
// system note alone is not read on this route). A fair turn, no key, a slow answer or any error adds nothing.

export interface RefereeDeps {
    fetch: typeof fetch
    auth(): Promise<string>
    timeoutMs?: number
}

/** the note for this turn, or '' */
export async function fetchRefereeNote(chatId: string | undefined, turn: string, scene: string, deps: RefereeDeps): Promise<string> {
    if (!turn || !turn.trim()) return ''
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? 3000)
    try {
        const res = await deps.fetch('/api/story/referee', {
            method: 'POST', signal: ctl.signal,
            headers: { 'content-type': 'application/json', 'risu-auth': await deps.auth() },
            body: JSON.stringify({ chatId: chatId ?? '', turn, scene }),
        })
        if (!res.ok) return ''
        const data = await res.json()
        const note = typeof data?.note === 'string' ? data.note : ''
        return note.startsWith('\n\n[Referee:') && note.length <= 900 ? note : ''
    } catch {
        return ''
    } finally {
        clearTimeout(timer)
    }
}

/** the note at the end of the player's last message; unchanged without a note or a text message */
export function refereeRequest<T extends { role: string; content: unknown }>(formated: T[], note: string): T[] {
    if (!note) return formated
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (last < 0 || typeof formated[last].content !== 'string') return formated
    return formated.map((m, i) => (i === last ? { ...m, content: (m.content as string) + note } : m))
}

/** the player's last message and the narration before it, from the chat */
export function turnAndScene(messages: { role: string; data: string }[] | undefined): { turn: string; scene: string } {
    const list = messages ?? []
    const u = list.map((m) => m.role).lastIndexOf('user')
    if (u < 0) return { turn: '', scene: '' }
    const before = list.slice(0, u).reverse().find((m) => m.role === 'char')
    return { turn: list[u].data ?? '', scene: before?.data ?? '' }
}
