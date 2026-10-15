// The page's side of the server picture jobs (server/node/imageJobs.cjs).
//
// generateImage (Lua) asks the server to draw instead of drawing in the page: the server keeps going if the page is closed, and
// writes the picture as inlays/<id>. The page waits for the job and gets the id back as before. A page that was closed (phone
// locked, tab swiped away) finds the finished job at its next start and puts the picture in the message it was meant for, by the
// same rule the story scripts use: the first picture of the message is replaced, or the new one goes on top.

import type { Database } from '../storage/database.svelte'

export type ImageTarget = { charId: string; chatId?: string; chatIndex: number; messageId?: string; messageIndex: number }
/** superseded: a newer job exists for the same message, so this picture must not be placed (it would replace the newer one). */
export type ImageJob = { id: string; status: 'queued' | 'running' | 'done' | 'error' | 'interrupted'; inlayId?: string; model?: string; error?: string; target?: ImageTarget | null; superseded?: boolean }
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
    const chat = (target.chatId ? char.chats?.find((c) => c?.id === target.chatId) : undefined) ?? char.chats?.[target.chatIndex]
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

export async function submitImageJob(api: JobApi, request: ImageRequest, target: ImageTarget | null): Promise<string> {
    return (await call(api, '/api/image-jobs', { method: 'POST', body: JSON.stringify({ request, target }) })).id
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

/** Polls until the job is finished (a picture takes 30-90 s); a network blip between polls is not a failure. */
export async function waitImageJob(api: JobApi, id: string, opts: { everyMs?: number; timeoutMs?: number } = {}): Promise<ImageJob> {
    const every = opts.everyMs ?? 2000
    const until = Date.now() + (opts.timeoutMs ?? 10 * 60 * 1000)
    const sleep = api.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    while (Date.now() < until) {
        try {
            const job = await getImageJob(api, id)
            if (job.status === 'done' || job.status === 'error' || job.status === 'interrupted') return job
        } catch { /* try again at the next poll */ }
        await sleep(every)
    }
    return { id, status: 'error', error: 'the picture took too long; it will appear when it is ready' }
}

/**
 * Puts finished pictures into their messages (pages that were closed while a picture was drawn) and lets the server forget
 * them. Returns what it did. A job whose message no longer exists is just acknowledged; a failed one is logged and acknowledged.
 */
export async function recoverImageJobs(api: JobApi, db: Pick<Database, 'characters'>, log = console.warn) {
    const done: string[] = [], skipped: string[] = []
    for (const job of await unackedImageJobs(api)) {
        if (job.status === 'done' && job.inlayId && job.superseded) {
            skipped.push(job.id)                                   // a redraw of the same message came later; keep the newer one
        } else if (job.status === 'done' && job.inlayId) {
            const found = findTarget(db, job.target)
            if (found) {
                const msg = found.chat.message[found.index]
                const next = placePicture(msg.data, job.inlayId)
                if (next !== msg.data) msg.data = next
                done.push(job.id)
            } else {
                skipped.push(job.id)
            }
        } else {
            log(`[image] a picture job ended without a picture: ${job.error ?? job.status}`)
            skipped.push(job.id)
        }
        await ackImageJob(api, job.id)
    }
    return { placed: done, skipped }
}

/**
 * Draws on the server and waits: the picture id when it worked, else the reason. The caller puts the picture in its message first
 * and the job is acknowledged a little later (`ackAfterMs`): a page that dies in between leaves the job to recovery, which finds
 * the picture already placed or places it. Acknowledging before placing lost the picture when the page died in that gap, and
 * a superseded picture is never handed back (TLC, docs/specs/ImageJobs.tla).
 */
export async function drawOnServer(api: JobApi, request: ImageRequest, target: ImageTarget | null,
    opts: { everyMs?: number; timeoutMs?: number; ackAfterMs?: number; defer?: (fn: () => void, ms: number) => void } = {}): Promise<{ inlayId?: string; model?: string; error?: string }> {
    const id = await submitImageJob(api, request, target)
    const job = await waitImageJob(api, id, opts)
    const defer = opts.defer ?? ((fn, ms) => { setTimeout(fn, ms) })
    const ack = () => { ackImageJob(api, id).catch(() => { /* recovery acknowledges it at the next start */ }) }
    if (job.status === 'done' && job.inlayId && job.superseded) {
        ack()
        return { error: 'a newer picture was asked for this message' }
    }
    if (job.status !== 'done' || !job.inlayId) return { error: job.error ?? job.status }
    defer(ack, opts.ackAfterMs ?? 20_000)
    return { inlayId: job.inlayId, model: job.model }
}
