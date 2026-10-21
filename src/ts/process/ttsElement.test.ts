import { beforeEach, describe, expect, it, vi } from 'vitest'
import { beginElementReading, ReadingStopped, START_TIMEOUT_MS, type ElementEnv } from './ttsElement'
import { setCurrentReading, stopSpeaking } from './ttsStream'

// Message TTS through an <audio> element: iOS keeps playing an HTTP audio stream when the screen locks, Web Audio it stops. The element
// has to be started inside the tap (play() before any await), the text sent afterwards, and Stop / a new reading must end it.

class FakeAudio extends EventTarget {
    src = ''
    error: { code: number } | null = null
    attrs = new Map<string, string>()
    play = vi.fn(() => Promise.resolve())
    pause = vi.fn()
    load = vi.fn()
    removeAttribute(n: string) { if (n === 'src') this.src = ''; this.attrs.delete(n) }
}
const audio = new FakeAudio()
let n = 0
let session: any
let time = 0
const env = (): ElementEnv => ({
    audio: () => audio as unknown as HTMLAudioElement,
    uuid: () => `id-${++n}`,
    mediaSession: session,
    makeMetadata: (init) => init as unknown as MediaMetadata,
    now: () => time,
})
const makeSession = () => ({ metadata: null as any, playbackState: 'none', handlers: {} as Record<string, any>, setActionHandler(a: string, h: any) { this.handlers[a] = h } })
const req = { model: 'vieneu', voice: 'Trúc Ly', input: 'xin chào' }
function deps(ok = true, body: any = {}) {
    const calls: { url: string; init: any }[] = []
    return { calls, fetch: vi.fn(async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status: ok ? 202 : 502 }) }), auth: async () => 'tok' }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
    stopSpeaking()
    audio.src = ''; audio.error = null
    audio.play.mockClear(); audio.pause.mockClear(); audio.load.mockClear()
    audio.play.mockImplementation(() => Promise.resolve())
    session = makeSession()
    time = 0
})

describe('beginElementReading', () => {
    it('starts the element synchronously, inside the tap: src and play() before any await, nothing sent yet', () => {
        const d = deps()
        const r = beginElementReading('Mai', d, env())
        expect(audio.src).toBe(`/api/tts/stream/${r.id}`)
        expect(audio.play).toHaveBeenCalledTimes(1)
        expect(d.fetch).not.toHaveBeenCalled()
    })

    it('send POSTs the text and voice to the same URL with risu-auth, and resolves when the element is playing', async () => {
        const d = deps()
        const r = beginElementReading('Mai', d, env())
        time = 40
        const sent = r.send(d, req)
        await tick()
        expect(d.calls[0].url).toBe(`/api/tts/stream/${r.id}`)
        expect(d.calls[0].init.method).toBe('POST')
        expect(d.calls[0].init.headers['risu-auth']).toBe('tok')
        expect(JSON.parse(d.calls[0].init.body)).toEqual(req)
        time = 1250
        audio.dispatchEvent(new Event('playing'))
        await expect(sent).resolves.toEqual({ first: 1250 })
    })

    it('a stream that failed is a rejection (the caller plays it with Web Audio): element error, refused play(), refused POST', async () => {
        const d1 = deps()
        const a = beginElementReading('Mai', d1, env())
        const p1 = a.send(d1, req)
        audio.error = { code: 4 }
        audio.dispatchEvent(new Event('error'))
        await expect(p1).rejects.toThrow(/code 4/)

        audio.play.mockImplementation(() => Promise.reject(new Error('NotAllowedError')))
        const d2 = deps()
        const b = beginElementReading('Mai', d2, env())
        await expect(b.send(d2, req)).rejects.toThrow(/NotAllowedError/)

        audio.play.mockImplementation(() => Promise.resolve())
        const d3 = deps(false, { error: { message: 'too many readings' } })
        const c = beginElementReading('Mai', d3, env())
        await expect(c.send(d3, req)).rejects.toThrow(/too many readings/)
    })

    it('gives up when the element never plays', async () => {
        vi.useFakeTimers()
        try {
            const d = deps()
            const r = beginElementReading('Mai', d, env())
            const p = r.send(d, req)
            const check = expect(p).rejects.toThrow(/did not start/)
            await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS + 10)
            await check
        } finally { vi.useRealTimers() }
    })

    it('stop pauses the element, clears its src, tells the server, and a send after it is ReadingStopped', async () => {
        const d = deps()
        const r = beginElementReading('Mai', d, env())
        const p = r.send(d, req)
        const rejected = expect(p).rejects.toBeInstanceOf(ReadingStopped)
        await tick()
        r.stop()
        await tick()
        expect(audio.pause).toHaveBeenCalled()
        expect(audio.src).toBe('')
        expect(d.calls.at(-1)!.init.method).toBe('DELETE')
        expect(d.calls.at(-1)!.url).toBe(`/api/tts/stream/${r.id}`)
        expect(d.calls.at(-1)!.init.headers['risu-auth']).toBe('tok')
        await rejected
        await expect(r.send(d, req)).rejects.toBeInstanceOf(ReadingStopped)
    })

    it('a reading that was never sent has nothing to tell the server', async () => {
        const d = deps()
        beginElementReading('Mai', d, env()).stop()
        await tick()
        expect(d.fetch).not.toHaveBeenCalled()
    })

    it('a new reading stops the old one, and the old one stopping later does not take the element from the new one', async () => {
        const d = deps()
        const old = beginElementReading('Mai', d, env())
        const p = old.send(d, req)
        const rejected = expect(p).rejects.toBeInstanceOf(ReadingStopped)
        const fresh = beginElementReading('Mai', d, env())
        await rejected
        expect(audio.src).toBe(`/api/tts/stream/${fresh.id}`)
        old.stop()
        expect(audio.src).toBe(`/api/tts/stream/${fresh.id}`)
        expect(audio.load).toHaveBeenCalledTimes(1)               // only the first stop (by the new reading) reset it
    })

    it('a reading that was replaced without being stopped does not take the element back when it stops late', () => {
        const d = deps()
        const old = beginElementReading('Mai', d, env())
        setCurrentReading(null)                                   // something else took over without stopping it
        const fresh = beginElementReading('Mai', d, env())
        old.stop()
        expect(audio.src).toBe(`/api/tts/stream/${fresh.id}`)
        expect(audio.pause).not.toHaveBeenCalled()
    })

    it('stopSpeaking (the Stop button) ends the element reading', async () => {
        const d = deps()
        const r = beginElementReading('Mai', d, env())
        const rejected = expect(r.send(d, req)).rejects.toBeInstanceOf(ReadingStopped)
        stopSpeaking()
        await rejected
        expect(audio.src).toBe('')
    })

    it('puts the character on the lock screen with play, pause and stop', () => {
        const d = deps()
        const r = beginElementReading('Mai', d, env())
        expect(session.metadata).toEqual({ title: 'Mai', artist: 'Risu' })
        audio.dispatchEvent(new Event('playing'))
        expect(session.playbackState).toBe('playing')
        session.handlers.pause()
        expect(audio.pause).toHaveBeenCalled()
        expect(session.playbackState).toBe('paused')
        session.handlers.play()
        expect(audio.play).toHaveBeenCalledTimes(2)
        session.handlers.stop()
        expect(audio.src).toBe('')
        expect(session.playbackState).toBe('none')
        r.stop()
    })

    it('works without a Media Session', () => {
        session = null
        const r = beginElementReading('Mai', deps(), env())
        expect(audio.src).toContain(r.id)
        r.stop()
    })
})
