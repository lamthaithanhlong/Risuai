// Mark-then-sweep for the startup asset cleanup (specs/core/AssetSweep.tla).
//
// The cleanup deletes asset files the database does not reference. It runs right after the app opens, while another client
// sharing the same server may be importing: that client writes an asset file first and saves the database that references it
// later. A cleanup that deletes at once in that window removes a file the database is about to reference (TLC: 5 steps).
// Two strikes: the first run only remembers an unreferenced file, a later run deletes it only if it is still unreferenced and
// has been unreferenced for at least graceMs.

export const SWEEP_GRACE_MS = 10 * 60 * 1000
export const SWEEP_SEEN_KEY = 'assetSweepSeen'

export type SweepSeen = { [asset: string]: number }

export function planSweep(
    unreferenced: string[],
    seen: SweepSeen,
    now: number,
    graceMs: number = SWEEP_GRACE_MS
): { remove: string[], seen: SweepSeen } {
    const remove: string[] = []
    const next: SweepSeen = {}
    for (const name of unreferenced) {
        const first = seen[name]
        if (typeof first === 'number' && first <= now && now - first >= graceMs) {
            remove.push(name)
        } else {
            // newly unreferenced, or not unreferenced for long enough yet; a clock that went backwards restarts the wait
            next[name] = typeof first === 'number' && first <= now ? first : now
        }
    }
    return { remove, seen: next }
}

export function loadSweepSeen(): SweepSeen {
    try {
        const v = JSON.parse(localStorage.getItem(SWEEP_SEEN_KEY) ?? '{}')
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
    } catch (error) {
        return {}
    }
}

export function saveSweepSeen(seen: SweepSeen) {
    try {
        localStorage.setItem(SWEEP_SEEN_KEY, JSON.stringify(seen))
    } catch (error) {}
}
