// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { appendText, CLIENT_LIMIT_MS, createDictation, formatClock, MESSAGES, pickMimeType, type DictationDeps, type DictationState } from './dictation'

const tick = () => new Promise((r) => setTimeout(r, 0))

/** A recorder that, like the real one, hands over its data and then fires stop when stop() is called. */
class FakeRecorder {
    state = 'inactive'
    ondataavailable: any = null
    onstop: any = null
    onerror: any = null
    constructor(public stream: any, public mimeType: string) {}
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: this.mimeType }) }); this.onstop?.() }
}

function setup(over: Partial<DictationDeps> & { reply?: (url: string) => Response | Promise<Response> } = {}) {
    const calls: { url: string; init: any }[] = []
    const states: DictationState[] = []
    const texts: string[] = []
    const tracksStopped: number[] = []
    let timers: (() => void)[] = []
    const deps: DictationDeps = {
        getUserMedia: async () => ({ getTracks: () => [{ stop: () => tracksStopped.push(1) }] }),
        createRecorder: (s, m) => new FakeRecorder(s, m),
        isTypeSupported: (t) => t === 'audio/webm' || t === 'audio/webm;codecs=opus',
        fetch: async (url, init) => { calls.push({ url, init }); return over.reply ? over.reply(url) : new Response(JSON.stringify(url.endsWith('/warm') ? { ok: true } : { text: 'xin chào' }), { status: 200 }) },
        auth: async () => 'token',
        setInterval: (fn) => { timers.push(fn); return timers.length },
        clearInterval: () => { timers = [] },
        ...over,
    }
    const d = createDictation(deps, (t) => texts.push(t), (s) => states.push(s))
    return { d, calls, states, texts, tracksStopped, tickSecond: () => timers.forEach((f) => f()), last: () => states[states.length - 1] }
}

describe('mic button states', () => {
    it('tap starts recording, tap again stops and delivers the text; nothing is sent anywhere but /api/stt', async () => {
        const t = setup()
        expect(t.d.state.phase).toBe('idle')
        t.d.toggle(); await tick()
        expect(t.last().phase).toBe('recording')
        t.tickSecond(); t.tickSecond()
        expect(t.last().seconds).toBe(2)
        t.d.toggle(); await tick(); await tick()
        expect(t.texts).toEqual(['xin chào'])
        expect(t.last().phase).toBe('idle')
        expect(t.tracksStopped.length).toBe(1)               // the mic is released: the iPhone's orange dot goes out
        const stt = t.calls.find((c) => c.url === '/api/stt')!
        expect(stt.init.headers['risu-auth']).toBe('token')
        expect(stt.init.headers['content-type']).toBe('audio/webm')
        expect(stt.init.headers['x-stt-language']).toBe('auto')
        expect(await new Response(stt.init.body).text()).toBe('audio-bytes')
        expect(t.calls.some((c) => c.url === '/api/stt/warm')).toBe(true)   // the model loads while the player talks
    })

    it('is "transcribing" while the server works, and a tap then does nothing', async () => {
        let release: (r: Response) => void = () => {}
        const t = setup({ reply: (u) => u.endsWith('/warm') ? new Response('{}') : new Promise<Response>((r) => { release = r }) })
        t.d.toggle(); await tick(); t.d.toggle(); await tick(); await tick()
        expect(t.last().phase).toBe('transcribing')
        t.d.toggle(); await tick()
        expect(t.last().phase).toBe('transcribing')
        release(new Response(JSON.stringify({ text: 'ok' })))
        await tick(); await tick()
        expect(t.last().phase).toBe('idle')
        expect(t.texts).toEqual(['ok'])
    })

    it('stops by itself at the 2 minute cap', async () => {
        const t = setup()
        t.d.toggle(); await tick()
        for (let i = 0; i < 120; i++) t.tickSecond()
        await tick(); await tick()
        expect(t.texts).toEqual(['xin chào'])
        expect(t.last().phase).toBe('idle')
    })

    it('prefers audio/mp4 on WebKit and audio/webm elsewhere', () => {
        expect(pickMimeType((x) => x === 'audio/mp4')).toBe('audio/mp4')
        expect(pickMimeType((x) => x.startsWith('audio/webm'))).toBe('audio/webm;codecs=opus')
        expect(pickMimeType(() => true)).toBe('audio/mp4')                  // both offered: the one every WebKit and the decoder know
        expect(pickMimeType(() => false)).toBe('')
    })

    it('says what to do when the microphone is refused, and records nothing', async () => {
        const t = setup({ getUserMedia: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }) } })
        t.d.toggle(); await tick()
        expect(t.last().error).toBe(MESSAGES.denied)
        expect(t.last().phase).toBe('idle')
        expect(t.calls.length).toBe(0)
    })

    it('says so when nothing was heard, and the box gets no text', async () => {
        const t = setup({ reply: (u) => new Response(JSON.stringify(u.endsWith('/warm') ? {} : { text: '  ' })) })
        t.d.toggle(); await tick(); t.d.toggle(); await tick(); await tick()
        expect(t.last().error).toBe(MESSAGES.noSpeech)
        expect(t.texts).toEqual([])
    })

    it('a server timeout or oversize answer says so, without switching to the browser recogniser', async () => {
        const t = setup({ reply: (u) => u.endsWith('/warm') ? new Response('{}') : new Response(JSON.stringify({ error: { code: 'timeout' } }), { status: 504 }), createRecognition: () => { throw new Error('unused') } })
        t.d.toggle(); await tick(); t.d.toggle(); await tick(); await tick()
        expect(t.last().error).toBe(MESSAGES.timeout)
    })
})

describe('server cannot transcribe', () => {
    class FakeRecognition {
        lang = ''; continuous = false; interimResults = false
        onresult: any = null; onerror: any = null; onend: any = null
        started = false
        start() { this.started = true }
        stop() { this.onresult?.({ results: [Object.assign([{ transcript: 'tôi đi vào rừng' }], { isFinal: true })] }); this.onend?.() }
    }
    const down = (u: string) => u.endsWith('/warm') ? new Response('{}') : new Response(JSON.stringify({ error: { code: 'unavailable' } }), { status: 503 })

    it('falls back to the browser recogniser on the next tap when there is one', async () => {
        const made: FakeRecognition[] = []
        const t = setup({ reply: down, createRecognition: () => { const r = new FakeRecognition(); made.push(r); return r } })
        t.d.toggle(); await tick(); t.d.toggle(); await tick(); await tick()
        expect(t.last().error).toBe(MESSAGES.serverBrowser)
        t.d.toggle(); await tick()                           // now listens through the browser
        expect(t.last()).toMatchObject({ phase: 'recording', browser: true })
        expect(made[0].lang).toBe('vi-VN')
        t.d.toggle(); await tick()
        expect(t.texts).toEqual(['tôi đi vào rừng'])
        expect(t.last().phase).toBe('idle')
    })

    it('without a browser recogniser the message says what to use instead', async () => {
        const t = setup({ reply: down })
        t.d.toggle(); await tick(); t.d.toggle(); await tick(); await tick()
        expect(t.last().error).toBe(MESSAGES.serverNone)
        t.d.toggle(); await tick()
        expect(t.last().phase).toBe('recording')              // it still records and tries the server again
    })

    it('with no mic API at all (an insecure page) it uses the recogniser, or says the browser cannot', async () => {
        const a = setup({ getUserMedia: undefined, createRecorder: undefined })
        a.d.toggle(); await tick()
        expect(a.last().error).toBe(MESSAGES.unsupported)
        const b = setup({ getUserMedia: undefined, createRecorder: undefined, createRecognition: () => new FakeRecognition() })
        b.d.toggle(); await tick()
        expect(b.last()).toMatchObject({ phase: 'recording', browser: true })
    })
})

describe('the recorder cannot start', () => {
    it('releases the mic and says so, instead of an alert with the mic still open', async () => {
        const t = setup({ createRecorder: (s, m) => { const r = new FakeRecorder(s, m); r.start = () => { throw new Error('NotSupportedError') }; return r } })
        t.d.toggle(); await tick()
        expect(t.tracksStopped.length).toBe(1)
        expect(t.last().phase).toBe('idle')
        expect(t.last().error).toBe(MESSAGES.micBusy)
    })
})

describe('the tag of a dictation', () => {
    it('is read when recording starts and comes back with the text, whatever it is by then', async () => {
        let open = 'chat A'
        const got: [string, unknown][] = []
        let release: (r: Response) => void = () => {}
        const deps: DictationDeps = {
            getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
            createRecorder: (s, m) => new FakeRecorder(s, m),
            fetch: async (url) => url.endsWith('/warm') ? new Response('{}') : new Promise<Response>((r) => { release = r }),
            auth: async () => 'token', setInterval: () => 1, clearInterval: () => {},
        }
        const d = createDictation(deps, (t, tag) => got.push([t, tag]), () => {}, 120, () => open)
        d.toggle(); await tick(); d.toggle(); await tick()
        open = 'chat B'
        release(new Response(JSON.stringify({ text: 'xin chào' })))
        await new Promise((r) => setTimeout(r, 5))
        expect(got).toEqual([['xin chào', 'chat A']])
    })
})

describe('a request that never comes back', () => {
    it('gives up after the page\'s limit: the button is usable again and says so, with the request aborted', async () => {
        let giveUp: (() => void) | null = null
        let limitMs = 0
        let signal: AbortSignal | undefined
        const t = setup({
            reply: () => new Promise<Response>(() => { /* lost on the way */ }),
            fetch: async (url, init) => { if (url.endsWith('/warm')) return new Response('{}'); signal = (init as any).signal; return new Promise<Response>(() => {}) },
            setTimeout: (fn, ms) => { giveUp = fn; limitMs = ms; return 7 },
            clearTimeout: () => {},
        })
        t.d.toggle(); await tick(); t.d.toggle(); await tick()
        expect(t.last().phase).toBe('transcribing')
        expect(limitMs).toBe(CLIENT_LIMIT_MS)
        expect(CLIENT_LIMIT_MS).toBeGreaterThan((180 + 60) * 1000)
        giveUp!(); await tick()
        expect(t.last().phase).toBe('idle')
        expect(t.last().error).toBe(MESSAGES.noAnswer)
        expect(signal?.aborted).toBe(true)
        expect(t.texts).toEqual([])
    })
})

describe('text helpers', () => {
    it('appends with one space and leaves the box alone for empty text', () => {
        expect(appendText('', ' xin chào ')).toBe('xin chào')
        expect(appendText('Tôi nói', 'xin chào')).toBe('Tôi nói xin chào')
        expect(appendText('Tôi nói ', 'xin chào')).toBe('Tôi nói xin chào')
        expect(appendText('Tôi nói\n', 'xin chào')).toBe('Tôi nói\nxin chào')
        expect(appendText('giữ nguyên', '   ')).toBe('giữ nguyên')
    })
    it('formats the clock', () => { expect(formatClock(7)).toBe('0:07'); expect(formatClock(75)).toBe('1:15') })
})
