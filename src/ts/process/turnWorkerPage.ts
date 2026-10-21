// The page the server's turn worker drives (server/node/turnWorker.cjs opens the app at /?turnWorker=1): it runs the server's turns
// with the same code a player's page uses (DefaultChatScreen.svelte sendMain / reroll / sendChatMain), then reports the chat.
//   globalThis.__risuTurnWorker = { ready, run(spec), abort() }
//   globalThis.__risuTurnPhase(key, phase)   (exposed by the worker) moves the turn on: tidying once the reply is in
import { get } from 'svelte/store'
import { selectedCharID } from '../stores.svelte'
import { getDatabase } from '../storage/database.svelte'
import { planReroll, planSend, turnAnswered, turnInputId, type TurnKind } from './turnCore'
import { visibleReply } from './emptyReply'

/** how long a turn waits for the reply's bookkeeper before it saves (the helper answers in ~3-7 s, measured 2026-10-21) */
const BOOKKEEP_WAIT_MS = 20_000
import { beginTurnRun, endTurnRun, isTurnWorker, turnRunErrors } from './turnWorkerState'

export { isTurnWorker }

export interface TurnSpec { key: string, chaId: string, chatId: string, kind: TurnKind, input: { text?: string, target?: string, chat?: { id?: string } }, attempt: number }
export interface TurnRunner {
    chaId: () => string | undefined
    /** types the input the way the player does: input trigger, editinput scripts, then the reply */
    send: (text: string) => Promise<void>
    /** answers the message already at the end of the chat (no new input) */
    generate: () => Promise<void>
    reroll: () => Promise<void>
    continue: () => Promise<void>
    abort: () => void
}

let runner: TurnRunner | null = null

/** DefaultChatScreen registers itself; the returned function unregisters it. */
export function registerTurnRunner(r: TurnRunner): () => void {
    runner = r
    return () => { if (runner === r) runner = null }
}

function phase(key: string, p: 'tidying') {
    try { void (globalThis as unknown as { __risuTurnPhase?: (k: string, p: string) => unknown }).__risuTurnPhase?.(key, p) } catch { /* only in the worker */ }
}

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
        if (cond()) return true
        await new Promise((r) => setTimeout(r, 100))
    }
    return cond()
}

async function run(spec: TurnSpec): Promise<{ ok: boolean, error?: string, retryable?: boolean, chat?: unknown }> {
    const db = getDatabase()
    const index = db.characters.findIndex((c) => c.chaId === spec.chaId)
    if (index < 0) return { ok: false, error: 'the character is gone', retryable: false }
    const char = db.characters[index]
    let chatPage = char.chats.findIndex((c) => c.id === spec.chatId)
    if (chatPage < 0 && spec.input?.chat?.id === spec.chatId) {
        // a chat made just before the turn and not yet in the save: the turn carried it (first, as New Chat puts it)
        char.chats.unshift(JSON.parse(JSON.stringify(spec.input.chat)))
        chatPage = 0
    }
    if (chatPage < 0) return { ok: false, error: 'the chat is not in the save', retryable: true }
    char.chatPage = chatPage
    const { changeChar } = await import('../characters')
    if (get(selectedCharID) !== index) await changeChar(index)
    if (!(await waitFor(() => runner?.chaId() === spec.chaId, 30000))) return { ok: false, error: 'the chat screen did not open', retryable: true }
    const inputId = turnInputId(spec.key)
    beginTurnRun(spec.key, inputId)
    const chat = () => char.chats.find((c) => c.id === spec.chatId)
    let from = chat()!.message.length
    // what the page loaded for this turn (the worker logs it: a stale load is visible in the server log)
    const loaded = { found: chatPage, ids: chat()!.message.map((m) => String(m.chatId ?? '?').slice(0, 4)) }
    let lastBefore: string | null = null
    // a run that does not save leaves nothing after the turn's input: what it wrote (a reply cut mid-stream, a half continuation)
    // is taken away before the save, so a turn that is tried again or fails for good never leaves those words as an answer
    // (specs/turns TurnQueue CutOnFail, TurnApply.dfy E)
    const undo = () => {
        const c = chat()
        if (!c) return
        if (spec.kind === 'continue') {
            const last = c.message.at(-1)
            if (last && lastBefore !== null) last.data = lastBefore
            return
        }
        const at = c.message.findIndex((m) => m.chatId === inputId)
        c.message = c.message.slice(0, spec.kind === 'send' && at >= 0 ? at + 1 : Math.min(from, c.message.length))
    }
    try {
        if (spec.kind === 'send') {
            const plan = planSend(chat()!.message, inputId)
            if (plan.typed) {
                chat()!.message = plan.messages
                from = plan.messages.length
                await runner!.generate()
            } else {
                await runner!.send(spec.input?.text ?? '')
            }
        } else if (spec.kind === 'reroll') {
            const what = planReroll(chat()!.message, spec.input?.target)
            if (what === 'done') return { ok: true, chat: JSON.parse(JSON.stringify(chat())) }
            from = what === 'generate' ? from : from - 1
            if (what === 'generate') await runner!.generate()
            else await runner!.reroll()
        } else {
            lastBefore = chat()!.message.at(-1)?.data ?? null
            from = Math.max(0, from - 1)
            await runner!.continue()
        }
        const errors = turnRunErrors()
        const jobOk = await ((globalThis as unknown as { __risuTurnJobOk?: (k: string) => Promise<boolean> }).__risuTurnJobOk?.(spec.key) ?? true)
        if (!jobOk) errors.push('the model stream broke off before the reply was whole')
        const c = chat()
        if (!c) return { ok: false, error: 'the chat is gone', retryable: false }
        const { flushSave } = await import('../globalApi.svelte')
        if (errors.length || !turnAnswered(c.message, from, visibleReply)) {
            undo()
            await flushSave(30000)
            return { ok: false, error: errors[0] ?? 'no reply came back', retryable: true }
        }
        phase(spec.key, 'tidying')
        // the bookkeeper's notes for this reply (social acts, the panel, the next shelves) are part of the turn: wait for them before the
        // save the client takes (bookkeepPending.ts), at most BOOKKEEP_WAIT_MS; one that is slower writes after, as before
        const { bookkeepSettled } = await import('./bookkeepPending')
        await bookkeepSettled(spec.chatId, BOOKKEEP_WAIT_MS)
        // saved means in the server's save: flush until the server sees the turn's messages there (flushSave alone gives up after its
        // timeout, and the next turn reloads the page: what was not written yet is lost)
        const ids = c.message.slice(Math.max(0, from - 1)).map((m) => m.chatId).filter((x): x is string => typeof x === 'string')
        const inSave = (globalThis as unknown as { __risuTurnInSave?: (a: string, b: string, ids: string[]) => Promise<boolean> }).__risuTurnInSave
        let landed = !inSave
        for (let i = 0; !landed && i < 20; i++) {
            await flushSave(10000)
            landed = await inSave!(spec.chaId, spec.chatId, ids)
            if (!landed) await new Promise((r) => setTimeout(r, 1000))
        }
        if (!landed) return { ok: false, error: 'the reply did not reach the save on the server', retryable: true, loaded }
        return { ok: true, chat: JSON.parse(JSON.stringify(c)), loaded }
    } catch (error) {
        undo()
        try { const { flushSave } = await import('../globalApi.svelte'); await flushSave(30000) } catch { /* the next run cuts it */ }
        return { ok: false, error: String((error as Error)?.message ?? error).slice(0, 500), retryable: true }
    } finally {
        endTurnRun()
    }
}

/** Called once the save is loaded: the worker waits for `ready`. */
export function installTurnWorker() {
    if (!isTurnWorker) return
    ;(globalThis as unknown as { __risuTurnWorker: unknown }).__risuTurnWorker = {
        ready: true,
        run,
        abort: () => runner?.abort(),
    }
}
