// The bookkeeper chains still running in this page, by chat id (gameMasterPage.ts noteGameMaster: one helper call per reply, not
// awaited by the chat). The next turn's lore waits for its chain (loreIndexPage.ts); the server's turn worker waits for it before it
// saves and hands the chat back (turnWorkerPage.ts). Measured 2026-10-21 (acceptance ss, cb0dd7bc): the worker saved the turn as soon
// as the reply landed, the bookkeeper's writes came ~5 s later in a page the next turn reloads, and the client put the turn's chat in
// place of its own: 9 social lines from 6 of 17 calls and $led_soc stayed empty.

const pending = new Map<string, Promise<unknown>>()

export function trackForward(chat: { id?: string }, p: Promise<unknown>): void {
    const key = chat.id ?? ''
    const q: Promise<unknown> = p.catch(() => undefined).finally(() => { if (pending.get(key) === q) pending.delete(key) })
    pending.set(key, q)
}

/** the chain still running for this chat, or undefined */
export const pendingFor = (chatId: string | undefined) => pending.get(chatId ?? '')

/** waits for this chat's chain, at most `ms`; true when there was none or it ended in time */
export async function bookkeepSettled(chatId: string | undefined, ms: number): Promise<boolean> {
    const run = pendingFor(chatId)
    if (!run) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = await Promise.race([run.then(() => true), new Promise<boolean>((r) => { timer = setTimeout(() => r(false), ms) })])
    clearTimeout(timer)
    return done
}
