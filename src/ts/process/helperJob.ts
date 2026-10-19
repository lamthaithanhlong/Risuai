// A story helper's request (voice profile, glossary, history TOC) whose answer is kept even when the turn stopped waiting for it.
// The turn only waits at most its timeout; the job runs to its end and stores what it got, and a later turn that needs the same
// thing joins the job in flight instead of sending another request. Before this, the timeout sat inside the job: with the ChatGPT
// web model (minutes a turn, longer than every helper timeout) the answer always came late, was dropped, and every turn asked again,
// each ask one more ChatGPT web turn queued in front of the story's own (owner, 2026-10-19: "web bị đơ").
// specs/core/HelperCache.tla: the old way breaks OneAsk in 4 states and never caches; this way holds both (13 states).

/** Past this a helper request is given up and aborted, so a hung request cannot hold its key for ever. */
export const HELPER_HARD_MS = 15 * 60_000

const jobs = new Map<string, Promise<unknown>>()

/** The job for `key`: the one in flight, or a new one from `run`. `run` gets a signal that fires at HELPER_HARD_MS. */
export function sharedJob<T>(key: string, run: (signal: AbortSignal) => Promise<T>, hardMs = HELPER_HARD_MS): Promise<T> {
    const inFlight = jobs.get(key) as Promise<T> | undefined
    if (inFlight) return inFlight
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), hardMs)
    const job = run(ctl.signal).finally(() => { clearTimeout(timer); jobs.delete(key) })
    jobs.set(key, job)
    return job
}

/** The job's result if it ends within `ms`, else null; the job itself goes on. A failed job gives null. */
export async function waitAtMost<T>(job: Promise<T>, ms: number): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms) })
    try {
        return await Promise.race([job.catch(() => null), late])
    } finally {
        clearTimeout(timer)
    }
}

/** For tests: how many jobs are in flight. */
export function jobsInFlight(): number {
    return jobs.size
}
