// The page's side of the server picture queue (server/node/imageJobs.cjs): pictures are their own pipeline, apart from the message turns.
//
// generateImage (Lua) FILES a request with the server and returns at once (queuePicture): the server draws it (own concurrency limit,
// own retries with a backoff), writes the picture as inlays/<id> and puts it into the message by message id in the chat file it holds.
// A request has a key (chat + message + slot): asking twice is one picture. This page follows the rows of its chat (pictureWatch.svelte.ts)
// to show each message's picture status and to put a placed picture into the copy of the chat it holds (applyPictureJobs). A page that
// was closed (phone locked, tab swiped away) finds the rows at its next start (recoverImageJobs). The rule for where the picture goes is
// the one the story scripts use: the first picture of the message is replaced, or the new one goes on top.

import type { Database } from '../storage/database.svelte'

export type ImageTarget = { charId: string; chatId?: string; chatIndex: number; messageId?: string; messageIndex: number; slot?: string }
/**
 * superseded: a newer job exists for the same message, so this picture must not be placed (it would replace the newer one).
 * placed: the server put it into the message in the chat file it holds; retrying: the router failed, another try at `nextAt`.
 */
export type ImageJobStatus = 'queued' | 'running' | 'retrying' | 'done' | 'placed' | 'error' | 'orphan' | 'cancelled' | 'interrupted'
export type ImageJob = { id: string; status: ImageJobStatus; inlayId?: string; model?: string; error?: string; target?: ImageTarget | null; superseded?: boolean; attempt?: number; nextAt?: number; created?: number; updated?: number }
export type ImageRequest = { url: string; key?: string; models: string[]; body: Record<string, unknown> }

export interface JobApi {
    fetch: typeof fetch
    auth(): Promise<string>
    sleep?: (ms: number) => Promise<void>
}

const inlayTag = (id: string) => `{{inlay::${id}}}`

/**
 * The message text with the picture in it: already there → unchanged; else the first picture replaced; else on top. Idempotent,
 * so the page that waited and a page that recovered the job can both apply it.
 */
export function placePicture(text: string, inlayId: string): string {
    const tag = inlayTag(inlayId)
    if ((text ?? '').includes(tag)) return text
    let replaced = false
    const out = (text ?? '').replace(/\{\{inlay::[^}]*\}\}/, () => { replaced = true; return tag })
    return replaced ? out : (text?.trim() ? `${tag}\n\n${text.trim()}` : tag)
}

/** Finds the message a job was for: by its ids, falling back to its position only when the ids are missing. */
export function findTarget(db: Pick<Database, 'characters'>, target: ImageTarget | null | undefined) {
    if (!target) return null
    const char = db.characters?.find((c) => c?.chaId === target.charId)
    if (!char) return null
    // a chat with an id that is gone was deleted: its picture goes nowhere (the position would put it in whichever chat moved up)
    const chat = target.chatId ? char.chats?.find((c) => c?.id === target.chatId) : char.chats?.[target.chatIndex]
    if (!chat) return null
    const index = target.messageId ? chat.message.findIndex((m) => m.chatId === target.messageId) : target.messageIndex
    if (index < 0 || !chat.message[index]) return null
    return { char, chat, index }
}

async function call(api: JobApi, path: string, init: RequestInit = {}) {
    const res = await api.fetch(path, { ...init, headers: { 'content-type': 'application/json', 'risu-auth': await api.auth(), ...(init.headers ?? {}) } })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data?.error ?? `image job request failed (${res.status})`)
    return data
}

/** The key of a picture: chat + message + slot. The server keeps one job per key; a redraw adds its own nonce. */
export function pictureKey(target: ImageTarget, redraw?: string): string {
    const base = [target.charId, target.chatId ?? `#${target.chatIndex}`, target.messageId ?? `#${target.messageIndex}`, target.slot ?? 'main'].join('|')
    return redraw ? `${base}#${redraw}` : base
}

/** Files the request; with a key, asking again finds the job that was filed for it ({ existing: true }). */
export async function submitImageJob(api: JobApi, request: ImageRequest, target: ImageTarget | null, key?: string): Promise<{ id: string; existing: boolean }> {
    const data = await call(api, '/api/image-jobs', { method: 'POST', body: JSON.stringify({ request, target, key }) })
    return { id: data.id, existing: !!data.existing }
}

/** The pictures of a chat: open ones, failed ones, drawn ones not yet taken and ones the server placed a moment ago. */
export async function chatImageJobs(api: JobApi, chatId: string): Promise<{ jobs: ImageJob[]; now: number }> {
    const data = await call(api, `/api/image-jobs?chat=${encodeURIComponent(chatId)}`)
    return { jobs: data.jobs ?? [], now: typeof data.now === 'number' ? data.now : Date.now() }
}

export async function retryImageJob(api: JobApi, id: string): Promise<boolean> {
    try { await call(api, `/api/image-jobs/${encodeURIComponent(id)}/retry`, { method: 'POST', body: '{}' }); return true } catch { return false }
}

export async function cancelImageJob(api: JobApi, id: string): Promise<void> {
    await call(api, `/api/image-jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' })
}

export async function getImageJob(api: JobApi, id: string): Promise<ImageJob> {
    return call(api, `/api/image-jobs/${encodeURIComponent(id)}`)
}

export async function ackImageJob(api: JobApi, id: string): Promise<void> {
    await call(api, `/api/image-jobs/${encodeURIComponent(id)}/ack`, { method: 'POST', body: '{}' })
}

export async function unackedImageJobs(api: JobApi): Promise<ImageJob[]> {
    return (await call(api, '/api/image-jobs')).jobs ?? []
}

const ENDED: ImageJobStatus[] = ['done', 'placed', 'orphan', 'error', 'interrupted', 'cancelled']
/** The job ended with a picture (drawn: on the server and in its message, or not yet). */
const hasPicture = (j: ImageJob) => (j.status === 'done' || j.status === 'placed' || j.status === 'orphan') && !!j.inlayId

/**
 * Polls until the job is finished (a picture takes 30-90 s); a network blip between polls is not a failure. Only a caller that needs
 * the picture's id (a portrait, the in-page fallback) waits; a chat picture never does (queuePicture, pictureWatch.svelte.ts).
 */
export async function waitImageJob(api: JobApi, id: string, opts: { everyMs?: number; timeoutMs?: number } = {}): Promise<ImageJob> {
    const every = opts.everyMs ?? 2000
    const until = Date.now() + (opts.timeoutMs ?? 10 * 60 * 1000)
    const sleep = api.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    while (Date.now() < until) {
        try {
            const job = await getImageJob(api, id)
            if (ENDED.includes(job.status)) return job
        } catch { /* try again at the next poll */ }
        await sleep(every)
    }
    return { id, status: 'error', error: 'the picture took too long; it will appear when it is ready' }
}

/** The chat's variable that keeps a story script from asking for another picture soon after a failure (imagegen.lua, scenePictures.ts). */
const COOLDOWN_VARS = ['$imagegen_off_until', 'vj_scene_off_until']
/** A picture arrived: the cooldown that was waiting for it ends. */
export function liftPictureCooldown(chat: { scriptstate?: Record<string, string> } | undefined) {
    const st = chat?.scriptstate
    if (!st) return
    for (const k of COOLDOWN_VARS) if (k in st && String(st[k]) !== '0') st[k] = '0'
}

/**
 * Puts the pictures the server drew into the messages they are for, in this page's copy of the chats (by ids, never by position when
 * the ids are known). Idempotent. Returns what it did and which jobs the server may forget:
 *  - drawn (done/orphan): placed in the message, then acknowledged; a message that is gone, or a picture a newer redraw replaced, is skipped;
 *  - placed (the server did it): put into this copy too; not acknowledged (another page of the same chat needs it as well);
 *  - failed (error/interrupted): logged and acknowledged; open or cancelled rows are left alone.
 */
export function applyPictureJobs(db: Pick<Database, 'characters'>, jobs: ImageJob[], log: (m: string) => void = console.warn) {
    const placed: string[] = [], skipped: string[] = [], ack: string[] = []
    for (const job of jobs) {
        if (job.status === 'queued' || job.status === 'running' || job.status === 'retrying' || job.status === 'cancelled') continue
        if (!hasPicture(job)) {
            log(`[image] a picture job ended without a picture: ${job.error ?? job.status}`)
            skipped.push(job.id); ack.push(job.id)
            continue
        }
        if (job.superseded) { skipped.push(job.id); if (job.status !== 'placed') ack.push(job.id); continue }   // a redraw of the same message came later
        const found = findTarget(db, job.target)
        if (found) {
            const msg = found.chat.message[found.index]
            const next = placePicture(msg.data, job.inlayId!)
            if (next !== msg.data) msg.data = next
            liftPictureCooldown(found.chat as { scriptstate?: Record<string, string> })
            placed.push(job.id)
        } else {
            skipped.push(job.id)
        }
        if (job.status !== 'placed') ack.push(job.id)
    }
    return { placed, skipped, ack }
}

/**
 * At a page's start: puts the pictures that were drawn while it was closed into their messages and lets the server forget them.
 * A job whose message no longer exists is just acknowledged; a failed one is logged and acknowledged.
 */
export async function recoverImageJobs(api: JobApi, db: Pick<Database, 'characters'>, log = console.warn) {
    const r = applyPictureJobs(db, await unackedImageJobs(api), log)
    for (const id of r.ack) await ackImageJob(api, id)
    return { placed: r.placed, skipped: r.skipped }
}

/**
 * Files a picture with the server and returns at once: the message turn that asked never waits for it. With the same key (chat + message
 * + slot) the server finds the job that was filed before instead of making another. A redraw passes `redraw` (any text, new each time).
 */
export async function queuePicture(api: JobApi, request: ImageRequest, target: ImageTarget, opts: { redraw?: string } = {}): Promise<{ id: string; existing: boolean }> {
    return submitImageJob(api, request, target, pictureKey(target, opts.redraw))
}

/**
 * Draws on the server and waits: the picture id when it worked, else the reason. Only for a picture nobody's message is waiting on
 * (a portrait). The caller puts the picture in its message first and the job is acknowledged a little later (`ackAfterMs`): a page that
 * dies in between leaves the job to recovery, which finds the picture already placed or places it. Acknowledging before placing lost the
 * picture when the page died in that gap, and a superseded picture is never handed back (TLC, docs/specs/ImageJobs.tla).
 */
export async function drawOnServer(api: JobApi, request: ImageRequest, target: ImageTarget | null,
    opts: { everyMs?: number; timeoutMs?: number; ackAfterMs?: number; defer?: (fn: () => void, ms: number) => void } = {}): Promise<{ inlayId?: string; model?: string; error?: string }> {
    const { id } = await submitImageJob(api, request, target)
    const job = await waitImageJob(api, id, opts)
    const defer = opts.defer ?? ((fn, ms) => { setTimeout(fn, ms) })
    const ack = () => { ackImageJob(api, id).catch(() => { /* recovery acknowledges it at the next start */ }) }
    if (hasPicture(job) && job.superseded) {
        ack()
        return { error: 'a newer picture was asked for this message' }
    }
    if (!hasPicture(job)) return { error: job.error ?? job.status }
    defer(ack, opts.ackAfterMs ?? 20_000)
    return { inlayId: job.inlayId, model: job.model }
}
