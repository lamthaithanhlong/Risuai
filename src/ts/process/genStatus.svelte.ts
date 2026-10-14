// What the user sees between pressing send and the end of the reply. Without it a request that takes 10-18 s to answer (a router
// retrying a provider channel, or a model reasoning for two minutes) looks like nothing happened.
//
// Phases, in the order a request goes through them (specs/genstatus/GenStatus.tla checks the transitions):
//   sent      the request left this page, no answer yet
//   retrying  the provider failed before any byte and the request is being sent again (attempt n of m)
//   accepted  the provider answered with a stream, nothing readable yet
//   thinking  the model is writing its chain of thought
//   writing   the reply text is arriving
//   idle      nothing in flight (also the end state after done, failure or abort)
import { splitCoT } from '../parser/cot'

export type GenPhase = 'idle' | 'sent' | 'retrying' | 'accepted' | 'thinking' | 'writing'

export interface GenStatusState {
    phase: GenPhase
    /** when the request was first sent (ms since epoch); 0 when idle */
    startedAt: number
    /** when the current phase began */
    phaseAt: number
    attempt: number
    attempts: number
    /** why the last attempt failed, short */
    reason: string
}

export const IDLE: GenStatusState = { phase: 'idle', startedAt: 0, phaseAt: 0, attempt: 0, attempts: 0, reason: '' }

export type GenEvent =
    | { type: 'send'; now: number }
    | { type: 'retry'; now: number; attempt: number; attempts: number; reason: string }
    | { type: 'accept'; now: number }
    | { type: 'text'; now: number; text: string }
    | { type: 'end' }

/** What a piece of streamed text says about the phase: only a thought so far, or reply text. */
export function phaseOfText(text: string): 'accepted' | 'thinking' | 'writing' {
    if (!text) {
        return 'accepted'
    }
    const split = splitCoT(text)
    if (split.main.trim() !== '') {
        return 'writing'
    }
    if (split.thinking || split.thoughts.length > 0) {
        return 'thinking'
    }
    return 'accepted'
}

const ORDER: Record<GenPhase, number> = { idle: 0, sent: 1, retrying: 1, accepted: 2, thinking: 3, writing: 4 }

/** The one place that decides what follows what. Phases only move forward, except that a failed attempt goes back to retrying. */
export function nextStatus(s: GenStatusState, e: GenEvent): GenStatusState {
    switch (e.type) {
        case 'send':
            return { phase: 'sent', startedAt: e.now, phaseAt: e.now, attempt: 1, attempts: 1, reason: '' }
        case 'retry':
            if (s.phase === 'idle') return s
            // e.attempt is the number of the attempt that is about to start (2 for the first retry)
            return { ...s, phase: 'retrying', phaseAt: e.now, attempt: e.attempt, attempts: e.attempts, reason: e.reason }
        case 'accept':
            if (s.phase !== 'sent' && s.phase !== 'retrying') return s
            return { ...s, phase: 'accepted', phaseAt: e.now, reason: '' }
        case 'text': {
            if (s.phase === 'idle') return s   // a straggling chunk after the end must not bring the status back
            if (s.phase === 'sent' || s.phase === 'retrying') {
                // text can only come after the provider accepted; treat it as accepting too
                const p = phaseOfText(e.text)
                return { ...s, phase: p, phaseAt: e.now, reason: '' }
            }
            const p = phaseOfText(e.text)
            if (ORDER[p] <= ORDER[s.phase]) return s
            return { ...s, phase: p, phaseAt: e.now }
        }
        case 'end':
            return IDLE
    }
}

// Shared by the app: one status for the page.
export const genStatus = $state<GenStatusState>({ ...IDLE })

function apply(e: GenEvent) {
    Object.assign(genStatus, nextStatus({ ...genStatus }, e))
}

export const genStatusEvents = {
    send: () => apply({ type: 'send', now: Date.now() }),
    retry: (attempt: number, attempts: number, reason: string) => apply({ type: 'retry', now: Date.now(), attempt, attempts, reason }),
    accept: () => apply({ type: 'accept', now: Date.now() }),
    text: (text: string) => apply({ type: 'text', now: Date.now(), text }),
    end: () => apply({ type: 'end' }),
}
