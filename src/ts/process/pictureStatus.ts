// What the page shows about the pictures of a chat, worked out from the server's rows (imageJobClient.ts ImageJob). Pure: the reactive
// state and the polling are in pictureWatch.svelte.ts.

import type { ImageJob } from './imageJobClient'

/** One line under a message: its picture is waiting, being drawn, tried again, or failed. A picture that arrived shows nothing (it is in the message). */
export type PictureInfo = {
    jobId: string
    messageId: string
    state: 'drawing' | 'retrying' | 'failed'
    /** the tries started so far */
    attempt: number
    /** ms epoch: when the next try starts (retrying) */
    nextAt: number
    /** ms epoch: when the picture was asked for */
    since: number
    error?: string
}

/** The picture state of every message that has one worth showing, by message id: the newest job of the message wins. */
export function pictureStates(jobs: ImageJob[]): Record<string, PictureInfo> {
    const out: Record<string, PictureInfo> = {}
    // oldest first, so a newer job (a redraw) of the same message replaces an older one
    for (const job of [...jobs].sort((a, b) => (a.created ?? 0) - (b.created ?? 0))) {
        const messageId = job.target?.messageId
        if (!messageId) continue
        const state = job.status === 'queued' || job.status === 'running' ? 'drawing'
            : job.status === 'retrying' ? 'retrying'
            : job.status === 'error' ? 'failed' : null
        if (!state) { delete out[messageId]; continue }          // drawn, placed, cancelled: nothing to show
        out[messageId] = { jobId: job.id, messageId, state, attempt: job.attempt ?? 0, nextAt: job.nextAt ?? 0, since: job.created ?? 0, error: job.error }
    }
    return out
}

/** Pictures that still have work to do (waiting, being drawn, waiting to be tried again). */
export function openJobs(jobs: ImageJob[]): ImageJob[] {
    return jobs.filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'retrying')
}

/** Seconds between two looks at the server: quick while a picture is on its way, slow otherwise, never while the page is hidden. */
export function pollDelayMs(open: number, hidden: boolean): number | null {
    if (hidden) return null
    return open > 0 ? 3000 : 20000
}

/** The jobs a page has not put into its copy yet, so that a picture is applied once per page and a deleted one does not come back. */
export function notYetApplied(jobs: ImageJob[], applied: Set<string>): ImageJob[] {
    return jobs.filter((j) => (j.status === 'done' || j.status === 'placed' || j.status === 'orphan') && j.inlayId && !applied.has(j.id))
}
