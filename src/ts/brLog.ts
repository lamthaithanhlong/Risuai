// Diagnostics for a page that has no console (a phone). Both functions do nothing unless the server was started with
// RISU_ACCESS_LOG=1, which injects window.__brLog into the page and reports to the server log (/__client-log).

type Hooks = { __brLog?: (m: string) => void, __brPhase?: string }

export function brLog(message: string): void {
    (globalThis as Hooks).__brLog?.(message)
}

/** Names what the page is doing now; a "page frozen" report carries the last name set. */
export function brPhase(name: string): void {
    const g = globalThis as Hooks
    if (g.__brLog) {
        g.__brPhase = name
        try {
            sessionStorage.setItem('br-phase', `${name}@${Date.now()}`)
        } catch {}
    }
}

/** Runs fn, logging how long it took when it took at least minMs. */
export async function brTimed<T>(name: string, fn: () => Promise<T>, minMs = 300): Promise<T> {
    const start = performance.now()
    brPhase(name)
    try {
        return await fn()
    } finally {
        const ms = performance.now() - start
        if (ms >= minMs) {
            brLog(`${name}: ${ms.toFixed(0)}ms`)
        }
    }
}
