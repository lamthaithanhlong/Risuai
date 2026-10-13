// Streaming display (Streaming Display Optimization, balanced/strong) repaints the growing reply at most once per
// `base` ms. On a phone one repaint (regex scripts over the whole message + render) can take longer than that, and a
// fixed delay then leaves the main thread busy almost all the time. Wait 3x the last repaint's cost instead
// (so repainting uses at most ~25% of the thread), never less than `base` and never more than `max`.

export function nextFlushDelay(base: number, lastCostMs: number, max = 800): number {
    if (!Number.isFinite(lastCostMs) || lastCostMs < 0) {
        return base
    }
    return Math.min(max, Math.max(base, Math.round(lastCostMs * 3)))
}
