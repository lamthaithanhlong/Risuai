// The page follows the pictures of the chat it shows (the server's picture queue, server/node/imageJobs.cjs): per message "drawing /
// retrying / failed" (PictureStatus.svelte), the line above the input while any is open, and the picture itself going into the page's copy
// of the message when the server has placed it. Nothing here is awaited by a message turn; if the page is closed the server goes on.

import { getCurrentChat, getDatabase } from '../storage/database.svelte'
import { applyPictureJobs, cancelImageJob, chatImageJobs, retryImageJob, type ImageJob, type JobApi } from './imageJobClient'
import { notYetApplied, openJobs, pictureStates, pollDelayMs, type PictureInfo } from './pictureStatus'
import { isTurnWorker } from './turnWorkerState'

export const pictureWatch = $state<{ byMessage: Record<string, PictureInfo>; open: number; since: number }>({ byMessage: {}, open: 0, since: 0 })

const applied = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null
let started = false
let apiPromise: Promise<JobApi> | null = null
let watching = ''

function api(): Promise<JobApi> {
    // loaded here: the node storage module touches `window` when it loads
    return apiPromise ??= import('../storage/nodeStorage').then((node) => ({ fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init), auth: node.getNodeServerProxyAuth }))
}

function show(jobs: ImageJob[]) {
    const open = openJobs(jobs)
    pictureWatch.byMessage = pictureStates(jobs)
    pictureWatch.open = open.length
    pictureWatch.since = open.length ? Math.min(...open.map((j) => j.created ?? Date.now())) : 0
}

/** Looks at the server now: updates what is shown and puts the pictures that arrived into this page's copy of the chat. */
export async function refreshPictures(): Promise<void> {
    const chat = getCurrentChat()
    const chatId = chat?.id
    if (!chatId) { show([]); return }
    if (watching !== chatId) { watching = chatId; show([]) }
    let jobs: ImageJob[]
    let skew = 0
    try {
        const got = await chatImageJobs(await api(), chatId)
        jobs = got.jobs
        skew = Date.now() - got.now                                                   // this page's clock minus the server's
    } catch { return }                                                                // the server is away: the next look tries again
    if (getCurrentChat()?.id !== chatId) return                                       // the player moved to another chat meanwhile
    const fresh = notYetApplied(jobs, applied)
    if (fresh.length) {
        const r = applyPictureJobs(getDatabase(), fresh)
        for (const id of [...r.placed, ...r.skipped]) applied.add(id)
        for (const id of r.ack) void api().then((a) => a.fetch(`/api/image-jobs/${encodeURIComponent(id)}/ack`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).catch(() => {})
    }
    // the times on the rows are the server's: put them on this page's clock
    show(jobs.map((j) => ({ ...j, created: (j.created ?? 0) + skew, nextAt: j.nextAt ? j.nextAt + skew : 0 })))
}

/** The copy of the chat was replaced (a turn's result): the pictures the server placed meanwhile go in again. */
export function forgetAppliedPictures() {
    applied.clear()
    void refreshPictures()
}

function schedule() {
    if (timer) clearTimeout(timer)
    const delay = pollDelayMs(pictureWatch.open, typeof document !== 'undefined' && document.hidden)
    timer = delay === null ? null : setTimeout(() => { void refreshPictures().finally(schedule) }, delay)
}

/** A picture was just filed: look at once, then often while it is open. */
export function pictureFiled() {
    void refreshPictures().finally(schedule)
}

/** Starts following (once). Not in the server's own turn worker page: it is short-lived and the player's page does this. */
export function startPictureWatch() {
    if (started || isTurnWorker || typeof window === 'undefined') return
    started = true
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshPictures().finally(schedule) })
    void refreshPictures().finally(schedule)
}

export async function retryPicture(jobId: string) {
    if (await retryImageJob(await api(), jobId)) pictureFiled()
}

export async function stopPicture(jobId: string) {
    await cancelImageJob(await api(), jobId).catch(() => {})
    pictureFiled()
}
