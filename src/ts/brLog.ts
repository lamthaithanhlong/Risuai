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

const acc = new Map<string, { calls: number, ms: number, max: number }>()

function note(name: string, ms: number) {
    const a = acc.get(name) ?? { calls: 0, ms: 0, max: 0 }
    a.calls++
    a.ms += ms
    a.max = Math.max(a.max, ms)
    acc.set(name, a)
}

/** Like brTimed, but adds to a running total reported by brReportAcc (for a step that runs once per message). */
export async function brTimedAcc<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now()
    brPhase(name)
    try {
        return await fn()
    } finally {
        note(name, performance.now() - start)
    }
}

export function brSync<T>(name: string, fn: () => T): T {
    const start = performance.now()
    brPhase(name)
    try {
        return fn()
    } finally {
        note(name, performance.now() - start)
    }
}

/** One log line per accumulated step (calls, total ms, slowest call), then the totals start again. */
export function brReportAcc(): void {
    for (const [name, a] of acc) {
        brLog(`${name}: ${a.calls} calls, ${a.ms.toFixed(0)}ms total, slowest ${a.max.toFixed(0)}ms`)
    }
    acc.clear()
}
