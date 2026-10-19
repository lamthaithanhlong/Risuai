// Settings → "Kiểm tra mạch truyện": the canon checks of the current chat (server/node/story/canon.pl over story.sqlite, served by
// GET /api/story/:chatId/check) go into the request as ONE short system line, so the model corrects itself. Off by default: a check
// that is wrong would steer the story, and gameplay must not change unless the owner turns it on. Nothing here can fail a reply:
// no server, no swipl, a slow answer (over timeoutMs) or any error gives no line.

export interface StoryCheckDeps {
    fetch: typeof fetch
    auth(): Promise<string>
    timeoutMs?: number
}

/** the line the server made for this chat's violations, or '' */
export async function fetchStoryCheckLine(chatId: string | undefined, deps: StoryCheckDeps): Promise<string> {
    if (!chatId || !/^[A-Za-z0-9-]{1,80}$/.test(chatId)) return ''
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), deps.timeoutMs ?? 2500)
    try {
        const res = await deps.fetch(`/api/story/${chatId}/check`, { headers: { 'risu-auth': await deps.auth() }, signal: ctl.signal })
        if (!res.ok) return ''
        const data = await res.json()
        const line = typeof data?.line === 'string' ? data.line.replace(/\s+/g, ' ').trim() : ''
        return line.length <= 600 ? line : line.slice(0, 600)
    } catch {
        return ''
    } finally {
        clearTimeout(timer)
    }
}

/** one system line right before the player's last message, where the model weighs it; unchanged when there is no line */
export function storyCheckRequest<T extends { role: string; content: unknown }>(formated: T[], line: string): T[] {
    if (!line) return formated
    const last = formated.map((m) => m.role).lastIndexOf('user')
    const note = { role: 'system', content: line } as T
    return last >= 0 ? [...formated.slice(0, last), note, ...formated.slice(last)] : [...formated, note]
}
