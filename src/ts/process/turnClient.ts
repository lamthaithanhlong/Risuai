// The player's page when the server runs the turns (server/node/turnQueue.cjs): it sends the turn and follows it, nothing more.
// It never writes the chat while a turn runs; it shows the input and the reply as the server writes them, and takes the server's
// chat when the turn is saved. A page that was frozen, offline or killed follows its turns again from where it was (by sequence
// number) when it comes back.
import { get, writable } from 'svelte/store'
import { v4 } from 'uuid'
import { readJobEvents } from '../network/proxyJobHttp'
import { decodeProxyJobWsChunk, type ProxyJobWsEvent } from '../network/proxyJobWs'
import { getNodeServerProxyAuth } from '../storage/nodeStorage'
import { DBState } from '../stores.svelte'
import { FINAL_STATES, finalOf, newTurnKey, prunePending, sseText, type PendingTurn, type TurnEvent, type TurnKind, type TurnState } from './turnCore'

const STORE_KEY = 'risu-pending-turns'

export interface TurnView extends PendingTurn {
    state: TurnState
    attempt: number
    error?: string
    partial: string
}

/** chat id -> its turns that are not finished (or failed and not yet dismissed), oldest first */
export const turnViews = writable<Record<string, TurnView[]>>({})

let config: Promise<{ enabled: boolean, asyncDefault: boolean }> | null = null
const following = new Set<string>()

/** GET /api/turns/config, asked once per page load: whether the server runs turns, and the Async turn default it sets. */
function turnConfig(): Promise<{ enabled: boolean, asyncDefault: boolean }> {
    if (!config) {
        config = (async () => {
            try {
                const res = await fetch('/api/turns/config', { headers: { 'risu-auth': await getNodeServerProxyAuth() } })
                const body = res.ok ? await res.json() : null
                return { enabled: body?.enabled === true, asyncDefault: body?.asyncDefault === true }
            } catch {
                return { enabled: false, asyncDefault: false }
            }
        })()
    }
    return config
}

/** True when this page talks to a Node server that runs turns. */
export async function serverTurnsEnabled(): Promise<boolean> {
    return (await turnConfig()).enabled
}

/** Async turn is on for this page: the player's setting, or the server's default when the player never set it. */
export async function asyncTurnsOn(setting: boolean | undefined): Promise<boolean> {
    const c = await turnConfig()
    return c.enabled && (setting ?? c.asyncDefault)
}

function readStored(): PendingTurn[] {
    try { return prunePending(JSON.parse(localStorage.getItem(STORE_KEY) || '[]'), Date.now()) } catch { return [] }
}
function writeStored(list: PendingTurn[]) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list)) } catch { /* private mode: the server still has the turn */ }
}
function forget(key: string) {
    writeStored(readStored().filter((p) => p.key !== key))
}

function update(chatId: string, key: string, fn: (v: TurnView) => TurnView | null) {
    turnViews.update((all) => {
        const list = (all[chatId] ?? []).map((v) => (v.key === key ? fn(v) : v)).filter(Boolean) as TurnView[]
        return { ...all, [chatId]: list }
    })
}
function addView(p: PendingTurn, state: TurnState = 'queued') {
    turnViews.update((all) => {
        const list = all[p.chatId] ?? []
        if (list.some((v) => v.key === p.key)) return all
        return { ...all, [p.chatId]: [...list, { ...p, state, attempt: 0, partial: '' }] }
    })
}

async function authHeaders(): Promise<Record<string, string>> {
    return { 'risu-auth': await getNodeServerProxyAuth() }
}

/**
 * Sends a turn: POST /api/turns, asked again with the same key when the answer is lost (the server finds the turn it made).
 * Returns the key, or throws when the server could not be reached at all.
 */
export async function submitTurn(arg: { chaId: string, chatId: string, kind: TurnKind, text?: string, target?: string, chat?: unknown }): Promise<string> {
    const key = newTurnKey(arg.chatId, v4())
    if (!key) throw new Error('This chat has no id the server can use')
    const pending: PendingTurn = { key, chaId: arg.chaId, chatId: arg.chatId, kind: arg.kind, text: arg.text ?? '', target: arg.target, chat: arg.chat, at: Date.now() }
    writeStored([...readStored(), pending])
    addView(pending)
    try {
        await postTurn(pending, 5)
    } catch (error) {
        // the answer may be what was lost: when the server has the turn, it is sent
        const known = await fetch(`/api/turns/${encodeURIComponent(key)}`, { headers: await authHeaders() }).then((r) => r.ok).catch(() => false)
        if (known) {
            void followTurn(pending)
            return key
        }
        forget(key)
        update(arg.chatId, key, () => null)
        throw error
    }
    void followTurn(pending)
    return key
}

/** POST /api/turns for a pending turn; the same key again finds the turn the server already has. */
async function postTurn(p: PendingTurn, attempts: number): Promise<void> {
    const body = JSON.stringify({ key: p.key, chat: p.chatId, cha: p.chaId, kind: p.kind, input: { text: p.text, target: p.target, chat: p.chat } })
    let lastError: unknown = null
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const res = await fetch('/api/turns', { method: 'POST', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' }, body })
            if (res.ok) return
            if (res.status >= 400 && res.status < 500) throw new Error(`The server refused the turn: ${res.status} ${await res.text()}`)
            lastError = new Error(`The server answered ${res.status}`)
        } catch (error) {
            lastError = error
            if (String(error).includes('refused the turn')) break
        }
        await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)))
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

/** The chat as the server saved it, put in place of this page's copy (by chat id; the character found by its id). */
function applyResult(p: PendingTurn, chat: unknown) {
    if (!chat || typeof chat !== 'object' || (chat as { id?: string }).id !== p.chatId) return false
    const char = DBState.db.characters.find((c) => c.chaId === p.chaId)
    const i = char?.chats?.findIndex((c) => c.id === p.chatId) ?? -1
    if (!char || i < 0) return false
    char.chats[i] = chat as typeof char.chats[number]
    return true
}

/** The reply's words while the server writes them (the turn's stream job), shown under the input. */
async function followText(p: PendingTurn, jobId: string, stillCurrent: () => boolean) {
    let raw = ''
    const decoder = new TextDecoder()
    await readJobEvents<ProxyJobWsEvent>({
        openEvents: async (from) => fetch(`/proxy-stream-jobs/${encodeURIComponent(jobId)}/events?from=${from}`, { headers: await authHeaders() }),
        onEvent: (event) => {
            if (event.type === 'chunk') {
                raw += decoder.decode(decodeProxyJobWsChunk(event.dataBase64), { stream: true })
                const text = sseText(raw)
                update(p.chatId, p.key, (v) => ({ ...v, partial: text }))
            }
        },
        isAborted: () => !stillCurrent(),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        maxAttempts: 60,
    }).catch(() => 'error')
}

/**
 * Follows a turn to its end from its event log (GET /api/turns/:key/events?from=N), reconnecting from the next sequence number
 * after every drop; when it is saved, takes the chat. Safe to call again for a turn already followed (one reader per key).
 */
export async function followTurn(p: PendingTurn): Promise<void> {
    if (following.has(p.key)) return
    following.add(p.key)
    addView(p)
    let jobId = ''
    let end: TurnState | null = null
    try {
        const known = await fetch(`/api/turns/${encodeURIComponent(p.key)}`, { headers: await authHeaders() }).then((r) => r.status).catch(() => 0)
        if (known === 404) await postTurn(p, 3)
        await readJobEvents<TurnEvent>({
            openEvents: async (from) => fetch(`/api/turns/${encodeURIComponent(p.key)}/events?from=${from}`, { headers: await authHeaders() }),
            onEvent: (event) => {
                if ((event as unknown as { type: string }).type === 'error') { end = 'failed'; return }   // 404: the server forgot it
                if (event.type !== 'state') return
                update(p.chatId, p.key, (v) => ({ ...v, state: event.state, attempt: event.attempt ?? v.attempt, error: event.error }))
                if (event.state === 'generating' && event.jobId && event.jobId !== jobId) {
                    jobId = event.jobId
                    const mine = jobId
                    void followText(p, mine, () => jobId === mine && !end)
                }
                if (FINAL_STATES.includes(event.state)) end = event.state
            },
            finalOf,
            isAborted: () => false,
            sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
            maxAttempts: 1_000_000,          // a turn is followed for as long as the page lives; each failure waits up to 5 s
        })
        if (end === 'saved') {
            const res = await fetch(`/api/turns/${encodeURIComponent(p.key)}/result`, { headers: await authHeaders() })
            const body = res.ok ? await res.json() : null
            if (!applyResult(p, body?.chat)) console.warn('[turns] saved, but the page could not take the chat; it is in the save on the server')
            update(p.chatId, p.key, () => null)
            forget(p.key)
        } else if (end === 'cancelled') {
            update(p.chatId, p.key, () => null)
            forget(p.key)
        } else {
            forget(p.key)                    // failed: stays on screen with its error until dismissed or sent again
        }
    } finally {
        following.delete(p.key)
    }
}

export async function cancelTurn(key: string): Promise<void> {
    await fetch(`/api/turns/${encodeURIComponent(key)}`, { method: 'DELETE', headers: await authHeaders() }).catch(() => {})
}

export function dismissTurn(chatId: string, key: string) {
    update(chatId, key, () => null)
    forget(key)
}

/** The page loaded or came back: follow every turn it sent that may not be finished, and the chat's turns sent from elsewhere. */
export async function resumeTurns(chatId?: string, chaId?: string): Promise<void> {
    if (!(await serverTurnsEnabled())) return
    for (const p of readStored()) void followTurn(p)
    if (!chatId || !chaId) return
    try {
        const res = await fetch(`/api/turns?chat=${encodeURIComponent(chatId)}`, { headers: await authHeaders() })
        const turns = res.ok ? (await res.json())?.turns ?? [] : []
        for (const t of turns) {
            if (FINAL_STATES.includes(t.state)) continue
            void followTurn({ key: t.key, chaId: t.cha, chatId: t.chat, kind: t.kind, text: t.input?.text ?? '', at: t.created })
        }
    } catch { /* offline: the stored ones are followed already */ }
}

/** The chat has a turn that is not finished: the page must not run one of its own on it. */
export function chatBusy(chatId: string): boolean {
    return (get(turnViews)[chatId] ?? []).some((v) => !FINAL_STATES.includes(v.state))
}
