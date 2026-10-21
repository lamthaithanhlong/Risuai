// The pure part of the server-owned turn (server/node/turnQueue.cjs), for the page that sends turns and the page that runs them.
// specs/turns/TurnApply.dfy proves the two rules here on the model: a turn is written by message id, and a run that starts again
// takes away only what follows its own input.

export type TurnKind = 'send' | 'reroll' | 'continue'
export type TurnState = 'queued' | 'assembling' | 'generating' | 'tidying' | 'retrying' | 'saved' | 'failed' | 'cancelled'
export const FINAL_STATES: TurnState[] = ['saved', 'failed', 'cancelled']

export interface TurnEvent { type: 'state', state: TurnState, attempt?: number, error?: string, jobId?: string, nextAt?: number }

/** "<chat id>:<uuid>": the server maps a stream job "<key>#n" to the chat's turn by the part before ':'. */
export function newTurnKey(chatId: string, uuid: string): string | null {
    return /^[A-Za-z0-9-]{1,80}$/.test(chatId) ? `${chatId}:${uuid}` : null
}

/** The id the worker gives the turn's input message: fixed by the key, so a run again finds the input it already typed. */
export function turnInputId(key: string): string {
    return key.slice(key.indexOf(':') + 1)
}

export function finalOf(e: TurnEvent): 'done' | 'error' | null {
    return e?.state === 'saved' ? 'done' : e?.state === 'failed' || e?.state === 'cancelled' ? 'error' : null
}

interface Msg { role: string, data: string, chatId?: string }

/**
 * Where the worker starts a "send" turn: the chat as it is when the input is not there yet (the worker types it), or the chat cut
 * right after the input when an earlier run of this turn typed it (what follows is that run's partial reply; one turn at a time per
 * chat, so nothing after the input belongs to another turn). Messages before the input are never touched.
 */
export function planSend<M extends Msg>(messages: M[], inputId: string): { typed: boolean, messages: M[] } {
    const at = messages.findIndex((m) => m.chatId === inputId)
    return at < 0 ? { typed: false, messages } : { typed: true, messages: messages.slice(0, at + 1) }
}

/**
 * A reroll turn: reroll the reply `target` when it is still the last message; generate when the chat ends with the player's message
 * (an earlier run took the old reply away and died); nothing when another reply is last (an earlier run of this turn wrote it).
 */
export function planReroll(messages: Msg[], target: string | undefined): 'reroll' | 'generate' | 'done' {
    const last = messages.at(-1)
    if (!last) return 'done'
    if (last.role === 'user') return 'generate'
    if (!target || last.chatId === target) return 'reroll'
    return 'done'
}

/** The turn did what it was for: after `from` messages there is a reply with words in it. */
export function turnAnswered(messages: Msg[], from: number, visible: (data: string) => string): boolean {
    const last = messages.at(-1)
    return messages.length > from && last?.role === 'char' && visible(last.data ?? '').trim() !== ''
}

/** The words of a streamed (SSE) OpenAI-style answer, for showing a turn's reply while the server writes it. */
export function sseText(raw: string): string {
    let out = ''
    for (const line of raw.split('\n')) {
        const m = /^data:\s*(.*)$/.exec(line.trim())
        if (!m || m[1] === '[DONE]') continue
        try {
            const j = JSON.parse(m[1])
            out += j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.text ?? ''
        } catch { /* a line cut in two: the next chunk has the rest */ }
    }
    return out
}

export interface PendingTurn {
    key: string, chaId: string, chatId: string, kind: TurnKind, text: string, target?: string, at: number
    /** a chat made a moment ago may not be in the server's save yet (the phone was put away before its autosave): the turn carries it */
    chat?: unknown
}

/** The pending turns this page sent, kept in localStorage so a page that was killed follows them again; stale ones are dropped. */
export function prunePending(list: PendingTurn[], now: number, maxAgeMs = 48 * 60 * 60 * 1000): PendingTurn[] {
    return (Array.isArray(list) ? list : []).filter((p) => p && typeof p.key === 'string' && now - p.at >= 0 && now - p.at <= maxAgeMs)
}
