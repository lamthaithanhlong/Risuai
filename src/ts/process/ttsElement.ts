// Message TTS through an <audio> element, so the reading goes on when the iPhone screen locks or the app is switched.
//
// Web Audio (ttsStream.ts) is silenced by iOS when the page goes to the background; an HTMLAudioElement playing a real HTTP audio
// stream is not, and it gets the lock-screen player through the Media Session API (title, play/pause/stop).
//
// Order of things, all so that iOS sees play() inside the tap:
//   1. at the tap, synchronously: beginElementReading() sets <audio src="/api/tts/stream/<uuid>"> and calls play(). The GET waits on
//      the server (up to 20 s) for the registration, so the text does not have to be known yet;
//   2. when the text and the voice are known: send() POSTs them to the same URL with the usual risu-auth header (a media GET cannot
//      carry one: the single-use uuid is the capability; server/node/ttsStreams.cjs);
//   3. send() resolves when the element is playing; it rejects if the stream failed, and the caller falls back to Web Audio.
// One element is reused for every reading: after the first tap iOS lets it start the next one.

import { currentReading, setCurrentReading, stopSpeaking, type StreamDeps } from './ttsStream'

export interface ElementEnv {
    /** The <audio> element (made once, reused). */
    audio(): HTMLAudioElement
    uuid(): string
    mediaSession: MediaSession | null
    makeMetadata(init: { title: string; artist: string }): MediaMetadata | null
    now(): number
}

function uuid4(): string {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID()
    const b = crypto.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80
    const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

const realEnv = (): ElementEnv => ({
    audio: () => { const a = new Audio(); a.preload = 'auto'; a.setAttribute('playsinline', ''); return a },
    uuid: uuid4,
    mediaSession: typeof navigator !== 'undefined' && 'mediaSession' in navigator ? navigator.mediaSession : null,
    makeMetadata: (init) => (typeof MediaMetadata !== 'undefined' ? new MediaMetadata(init) : null),
    now: () => performance.now(),
})

/** Whether this browser can read a message through an element at all. */
export const elementReadingSupported = () => typeof Audio !== 'undefined' && typeof crypto?.getRandomValues === 'function'

export const STREAM_PATH = '/api/tts/stream/'
/** How long send() waits for the element to start playing before it gives up (the server waits 20 s for the registration). */
export const START_TIMEOUT_MS = 45_000

/** send() rejects with this when the reading was stopped meanwhile: the caller must not play it another way. */
export class ReadingStopped extends Error { constructor() { super('stopped') } }

let shared: HTMLAudioElement | null = null
/** The stream the element is on now: an older reading being stopped must not touch the element a newer one is using. */
let activeId = ''

export interface ElementReading {
    readonly id: string
    /** POSTs the text; resolves with ms from the tap to the first sound, rejects when the stream failed (play it another way). */
    send(deps: StreamDeps, req: { model: string; voice: string; input: string }): Promise<{ first: number }>
    /** Ends the reading: pauses the element and tells the server to drop the stream. */
    stop(): void
}

/**
 * Call synchronously from the tap, before any await. Stops whatever was being read, points the element at a new stream and starts it.
 */
export function beginElementReading(title: string, deps: StreamDeps, env: ElementEnv = realEnv()): ElementReading {
    stopSpeaking()
    const el = (shared ??= env.audio())
    const id = env.uuid()
    activeId = id
    const t0 = env.now()
    let stopped = false, sent = false
    let outcome: { first: number } | Error | null = null
    let waiter: { ok(v: { first: number }): void; fail(e: Error): void } | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (v: { first: number } | Error) => {
        if (outcome) return
        outcome = v
        if (timer) clearTimeout(timer)
        if (waiter) { if (v instanceof Error) waiter.fail(v); else waiter.ok(v) }
    }
    const setSession = (state: 'playing' | 'paused' | 'none') => {
        try { if (env.mediaSession) env.mediaSession.playbackState = state } catch { /* unsupported */ }
    }

    const onPlaying = () => { finish({ first: Math.round(env.now() - t0) }); setSession('playing') }
    const onError = () => { if (!stopped) finish(new Error(`the audio element failed (code ${el.error?.code ?? '?'})`)) }
    const onEnded = () => { detach(); if (currentReading() === me) setCurrentReading(null); setSession('none') }
    const listeners: [string, () => void][] = [['playing', onPlaying], ['error', onError], ['ended', onEnded]]
    const detach = () => { for (const [n, f] of listeners) el.removeEventListener(n, f) }
    for (const [n, f] of listeners) el.addEventListener(n, f)

    const me: ElementReading = {
        id,
        send(d, req) {
            if (stopped) return Promise.reject(new ReadingStopped())
            sent = true
            const done = new Promise<{ first: number }>((ok, fail) => {
                if (outcome) { if (outcome instanceof Error) fail(outcome); else ok(outcome); return }
                waiter = { ok, fail }
                timer = setTimeout(() => finish(new Error('the stream did not start')), START_TIMEOUT_MS)
            })
            void (async () => {
                try {
                    const res = await d.fetch(STREAM_PATH + id, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', 'risu-auth': await d.auth() },
                        body: JSON.stringify(req),
                    })
                    if (!res.ok) {
                        const err = await res.json().catch(() => ({}))
                        finish(new Error(err?.error?.message ?? `TTS failed (${res.status})`))
                    }
                } catch (e) { finish(e instanceof Error ? e : new Error(String(e))) }
            })()
            return done
        },
        stop() {
            if (stopped) return
            stopped = true
            detach()
            if (activeId === id) {
                if (currentReading() === me) setCurrentReading(null)
                try { el.pause(); el.removeAttribute('src'); el.load() } catch { /* nothing loaded */ }
                setSession('none')
            }
            if (sent) {
                void (async () => {
                    try { await deps.fetch(STREAM_PATH + id, { method: 'DELETE', headers: { 'risu-auth': await deps.auth() } }) } catch { /* the server drops it after its idle time anyway */ }
                })()
            }
            finish(new ReadingStopped())
        },
    }
    setCurrentReading(me)

    el.src = STREAM_PATH + id
    el.play()?.catch((e: unknown) => { if (!stopped) finish(e instanceof Error ? e : new Error(String(e))) })

    // lock-screen player
    try {
        const ms = env.mediaSession
        if (ms) {
            const meta = env.makeMetadata({ title, artist: 'Risu' })
            if (meta) ms.metadata = meta
            const set = (action: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(action, h) } catch { /* action not supported here */ } }
            set('play', () => { void el.play().catch(() => {}); setSession('playing') })
            set('pause', () => { el.pause(); setSession('paused') })
            set('stop', () => stopSpeaking())
            for (const a of ['seekbackward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack'] as MediaSessionAction[]) set(a, null)
        }
    } catch { /* no Media Session */ }
    return me
}
