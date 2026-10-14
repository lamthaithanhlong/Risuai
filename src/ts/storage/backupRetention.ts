// Which database backups to keep (specs/core/SaveLoad.tla).
//
// A backup is written every 5 minutes and only the newest 20 were kept: 100 minutes of history. A bad save (a half-empty database
// from a failed load, a bug, a bad import) stays unnoticed for longer than that all the time, and then every backup is a copy of
// the bad one. Keep the newest 20 as before, plus the newest backup of each of the last 24 hours and of each of the last 14 days.
// At about 2.6 MB a file that is at most 58 files, 150 MB.
//
// Timestamps are the ones in the file names: Date.now() / 100, that is tenths of a second.

export const KEEP_RECENT = 20
export const KEEP_HOURS = 24
export const KEEP_DAYS = 14

const HOUR = 60 * 60 * 10
const DAY = 24 * HOUR

export function pickBackupsToKeep(timestamps: number[], nowTenths: number): { keep: number[], remove: number[] } {
    const sorted = [...timestamps].sort((a, b) => b - a) // newest first
    const keep = new Set<number>(sorted.slice(0, KEEP_RECENT))
    const hours = new Set<number>()
    const days = new Set<number>()
    for (const ts of sorted.slice(KEEP_RECENT)) {
        const age = nowTenths - ts
        const hour = Math.floor(ts / HOUR)
        const day = Math.floor(ts / DAY)
        if (age >= 0 && age < KEEP_HOURS * HOUR && !hours.has(hour)) {
            hours.add(hour)
            keep.add(ts)
        }
        else if (age >= 0 && age < KEEP_DAYS * DAY && !days.has(day)) {
            days.add(day)
            keep.add(ts)
        }
    }
    return {
        keep: sorted.filter((t) => keep.has(t)),
        remove: sorted.filter((t) => !keep.has(t)),
    }
}
