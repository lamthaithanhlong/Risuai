// Soft-realtime speech from the local TTS server (pdf2mp3: vieneu, kokoro) through this Risu server (/api/tts/speech).
//
// Measured 2026-10-15 before this: a 220-word message waited 12.8 s for its first sound (the whole file was rendered and
// joined first), a two-word phrase in another kokoro voice 2.5-3.3 s (the model reloaded for each voice). The TTS server now
// streams one MP3 per chunk, first sentence first (0.31 s), keeps one kokoro for every voice (0.6-0.9 s) and caches short text
// (0 s). This side decodes each chunk as it lands and schedules it right after the previous one, so they play without gaps.
// A new request stops the one playing: tapping a new word means the old one is no longer wanted.
//
// Frames: 1 byte kind ('A' = an MP3 file, 'E' = an error, UTF-8) · 4 bytes length, big endian · the data.

export type Frame = { kind: 'audio' | 'error'; data: Uint8Array }

/** Splits a byte stream into frames; the stream may cut a frame anywhere. */
export class FrameParser {
    private buf = new Uint8Array(0)

    push(piece: Uint8Array): Frame[] {
        const joined = new Uint8Array(this.buf.length + piece.length)
        joined.set(this.buf); joined.set(piece, this.buf.length)
        this.buf = joined
        const out: Frame[] = []
        while (this.buf.length >= 5) {
            const len = ((this.buf[1] << 24) >>> 0) + (this.buf[2] << 16) + (this.buf[3] << 8) + this.buf[4]
            if (this.buf.length < 5 + len) break
            const data = this.buf.slice(5, 5 + len)
            out.push({ kind: this.buf[0] === 0x45 ? 'error' : 'audio', data })
            this.buf = this.buf.slice(5 + len)
        }
        return out
    }
}

/** Korean voices a phone or Mac ships with that are women's (Yuna, Sora on Apple; Heami, SunHi on Windows; Google 한국의). */
export const FEMALE_VOICE = /yuna|sora|heami|sunhi|jimin|seoyeon|female|여성|google 한국/i

/** The voice that reads a learning language (kokoro has no Korean voice: Korean uses the device's own voice). */
export const FOREIGN_VOICE: Record<string, { model: 'kokoro'; voice: string } | { device: string }> = {
    ja: { model: 'kokoro', voice: 'jf_alpha' },
    zh: { model: 'kokoro', voice: 'zf_xiaobei' },
    es: { model: 'kokoro', voice: 'ef_dora' },
    fr: { model: 'kokoro', voice: 'ff_siwis' },
    ko: { device: 'ko-KR' },
}

export interface StreamDeps {
    fetch: typeof fetch
    auth(): Promise<string>
}

let current: { stop(): void } | null = null
let audioCtx: AudioContext | null = null

/** Stops whatever is being read. */
export function stopSpeaking() {
    current?.stop()
    current = null
    try { globalThis.speechSynthesis?.cancel() } catch { /* no device voice */ }
}

function context(): AudioContext {
    audioCtx ??= new (globalThis.AudioContext ?? (globalThis as any).webkitAudioContext)()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    return audioCtx
}

/**
 * Reads text with the local TTS, chunk by chunk as the server sends them. Resolves when the last chunk is scheduled
 * ({ first }: ms to the first sound); a new call stops this one.
 */
export async function speakStream(deps: StreamDeps, req: { model: string; voice: string; input: string }): Promise<{ first: number | null }> {
    stopSpeaking()
    const ctrl = new AbortController()
    const sources: AudioBufferSourceNode[] = []
    const me = { stop: () => { ctrl.abort(); for (const s of sources) { try { s.stop() } catch { /* not started */ } } } }
    current = me
    const ctx = context()
    const t0 = performance.now()
    let first: number | null = null
    let next = 0
    const res = await deps.fetch('/api/tts/speech', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'risu-auth': await deps.auth() },
        body: JSON.stringify(req),
    })
    if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err?.error?.message ?? `TTS failed (${res.status})`)
    }
    const parser = new FrameParser()
    const reader = res.body.getReader()
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done || current !== me) break
            for (const f of parser.push(value)) {
                if (f.kind === 'error') throw new Error(new TextDecoder().decode(f.data))
                const buffer = await ctx.decodeAudioData(f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) as ArrayBuffer)
                if (current !== me) return { first }
                const src = ctx.createBufferSource()
                src.buffer = buffer
                src.connect(ctx.destination)
                const at = Math.max(ctx.currentTime + 0.02, next)       // right after the previous chunk: no gap, no overlap
                src.start(at)
                sources.push(src)
                next = at + buffer.duration
                first ??= Math.round(performance.now() - t0)
            }
        }
    } catch (e) {
        if (ctrl.signal.aborted) return { first }
        throw e
    }
    return { first }
}

/** Reads a foreign word or phrase in its language's voice: kokoro through the stream, Korean with the device voice. */
export async function speakForeign(deps: StreamDeps, text: string, lang: string) {
    const v = FOREIGN_VOICE[lang]
    if (!v || !text.trim()) return
    if ('device' in v) {
        stopSpeaking()
        const u = new SpeechSynthesisUtterance(text)
        u.lang = v.device
        // a woman's voice when the device has one (asked: female voices wherever there is one); kokoro's are already
        const voices = globalThis.speechSynthesis?.getVoices?.() ?? []
        const own = voices.filter((x) => x.lang?.toLowerCase().startsWith(v.device.slice(0, 2).toLowerCase()))
        const female = own.find((x) => FEMALE_VOICE.test(x.name)) ?? own.find((x) => !/male|남/i.test(x.name))
        if (female) u.voice = female
        globalThis.speechSynthesis?.speak(u)
        return
    }
    return speakStream(deps, { model: v.model, voice: v.voice, input: text })
}

/** Loads the voice's model before it is needed (opening a chat in learning mode); a failure only costs the first word. */
export async function warmVoice(deps: StreamDeps, lang: string) {
    const v = FOREIGN_VOICE[lang]
    if (!v || 'device' in v) return
    try {
        await deps.fetch('/api/tts/warm', {
            method: 'POST', headers: { 'content-type': 'application/json', 'risu-auth': await deps.auth() },
            body: JSON.stringify({ model: v.model, voice: v.voice }),
        })
    } catch { /* the first word pays the load instead */ }
}
