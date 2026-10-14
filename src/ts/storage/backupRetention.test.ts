import { describe, expect, it } from 'vitest'
import { KEEP_DAYS, KEEP_HOURS, KEEP_RECENT, pickBackupsToKeep } from './backupRetention'

const MIN = 60 * 10 // a minute in tenths of a second
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const NOW = 100 * DAY

describe('pickBackupsToKeep', () => {
    it('keeps everything when there are few backups', () => {
        const ts = [NOW - 5 * MIN, NOW - 10 * MIN, NOW - 15 * MIN]
        expect(pickBackupsToKeep(ts, NOW).remove).toEqual([])
    })

    it('always keeps the newest 20, as before', () => {
        const ts = Array.from({ length: 200 }, (_, i) => NOW - i * 5 * MIN)
        const { keep } = pickBackupsToKeep(ts, NOW)
        expect(keep.slice(0, KEEP_RECENT)).toEqual(ts.slice(0, KEEP_RECENT))
    })

    it('reaches back a day and two weeks, one backup per hour then per day', () => {
        // a backup every 5 minutes for 20 days
        const ts = Array.from({ length: 20 * 24 * 12 }, (_, i) => NOW - i * 5 * MIN)
        const { keep } = pickBackupsToKeep(ts, NOW)
        expect(keep.length).toBeLessThanOrEqual(KEEP_RECENT + KEEP_HOURS + KEEP_DAYS + 2)
        expect(keep.length).toBeGreaterThan(KEEP_RECENT + 20)
        // something from about 12 hours ago and from about 10 days ago survives; nothing older than 14 days does
        expect(keep.some((t) => Math.abs(NOW - t - 12 * HOUR) < 2 * HOUR)).toBe(true)
        expect(keep.some((t) => Math.abs(NOW - t - 10 * DAY) < 2 * DAY)).toBe(true)
        expect(keep.every((t) => NOW - t < KEEP_DAYS * DAY || ts.indexOf(t) < KEEP_RECENT)).toBe(true)
    })

    it('property: the newest backup is always kept, keep and remove partition the input, and the size is bounded', () => {
        let state = 31337
        const rnd = (n: number) => Math.floor(((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * n)
        for (let trial = 0; trial < 300; trial++) {
            const n = rnd(400)
            const ts = Array.from(new Set(Array.from({ length: n }, () => NOW - rnd(30 * DAY))))
            const { keep, remove } = pickBackupsToKeep(ts, NOW)
            expect([...keep, ...remove].sort((a, b) => a - b)).toEqual([...ts].sort((a, b) => a - b))
            if (ts.length > 0) {
                expect(keep[0]).toBe(Math.max(...ts))
            }
            expect(keep.length).toBeLessThanOrEqual(KEEP_RECENT + KEEP_HOURS + KEEP_DAYS + 2)
            expect(new Set(keep).size).toBe(keep.length)
        }
    })

    it('ignores nothing it cannot read: future timestamps are not thrown away as old', () => {
        const ts = Array.from({ length: 30 }, (_, i) => NOW + (30 - i) * MIN) // all "in the future" (clock moved back)
        const { keep } = pickBackupsToKeep(ts, NOW)
        expect(keep.length).toBeGreaterThanOrEqual(KEEP_RECENT)
    })
})
