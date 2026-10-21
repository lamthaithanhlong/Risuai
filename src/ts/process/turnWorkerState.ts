// The state of the turn the server's worker page is running (turnWorkerPage.ts), with no imports so that alert.ts and the chat
// screen can read it without pulling the app in.

export const isTurnWorker: boolean = (() => {
    try { return new URLSearchParams(globalThis.location?.search ?? '').has('turnWorker') } catch { return false }
})()

let running: { key: string, inputId: string, keyTaken: boolean } | null = null
const errors: string[] = []

export function beginTurnRun(key: string, inputId: string) {
    running = { key, inputId, keyTaken: false }
    errors.length = 0
}
export function endTurnRun() {
    running = null
}
export function turnRunErrors(): string[] {
    return [...errors]
}

/** The key of the turn's first generation: its stream job is "<key>#n", the one a run again after a crash finds and reuses. Once. */
export function takeTurnKey(): string | null {
    if (!running || running.keyTaken) return null
    running.keyTaken = true
    return running.key
}

/** The id the turn's input message gets (fixed by the key): a run again finds the input already typed. */
export function turnInputMessageId(): string | null {
    return running ? running.inputId : null
}

/** An error the app showed while a turn ran (alertError): the turn failed, and the worker says why. */
export function noteTurnError(msg: unknown) {
    if (running) errors.push(String((msg as { message?: string })?.message ?? msg).slice(0, 500))
}
