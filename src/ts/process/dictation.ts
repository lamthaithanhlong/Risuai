// The mic button in the chat input: tap to record, tap again to stop, and the words land in the input box (appended; nothing is
// sent: the player reads them and presses send). The recording goes to this Mac's own Whisper (POST /api/stt, server/node/stt.cjs),
// so no speech leaves the house.
//
//   idle --tap--> recording --tap, or the cap--> transcribing --> idle (text appended, or a message)
//
// When the server cannot transcribe (no model installed, unreachable), the browser's own recogniser (webkitSpeechRecognition) takes
// over on the next tap if there is one; without one the message says what to do instead. Everything the browser provides is passed in
// as `deps`, so the state machine is tested without a microphone.

export type DictationPhase = 'idle' | 'recording' | 'transcribing'
export interface DictationState { phase: DictationPhase; seconds: number; error: string | null; /** the browser's recogniser is in use, not the server */ browser: boolean }

export const MAX_SECONDS = 120
export const STT_PATH = '/api/stt'

/** Hint shown on the button: the iPhone keyboard has its own dictation mic too. */
export const MIC_HINT = 'Bấm để nói, bấm lần nữa để dừng; chữ sẽ vào ô soạn tin, chưa gửi. Bàn phím iPhone cũng có nút micro (đọc chính tả) dùng được.'

export const MESSAGES = {
    denied: 'Chưa được phép dùng micro. Trên iPhone: Cài đặt > Safari (hoặc Firefox) > Micro, chọn Cho phép, rồi tải lại trang.',
    unsupported: 'Trình duyệt này không ghi âm được (cần HTTPS và MediaRecorder). Dùng nút micro trên bàn phím iPhone thay thế.',
    noSpeech: 'Không nghe thấy gì. Thử nói gần micro hơn.',
    serverBrowser: 'Máy chủ chưa chép giọng được; lần bấm sau dùng nhận giọng của trình duyệt.',
    serverNone: 'Máy chủ chưa chép giọng được, và trình duyệt này không có nhận giọng. Dùng nút micro trên bàn phím iPhone thay thế.',
    timeout: 'Chép giọng quá lâu (quá 60 giây), thử ngắn hơn.',
    tooLarge: 'Đoạn ghi âm quá lớn, thử ngắn hơn.',
    micBusy: 'Không mở được micro (đang bị app khác dùng?).',
} as const

/** The first container this browser can record: audio/mp4 on WebKit, audio/webm elsewhere. '' lets the browser choose. */
export function pickMimeType(isSupported: (type: string) => boolean): string {
    for (const t of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
        try { if (isSupported(t)) return t } catch { /* an odd browser: try the next */ }
    }
    return ''
}

/** The recognised text joined onto what is already in the box, with one space between. */
export function appendText(current: string, added: string): string {
    const add = added.trim()
    if (!add) return current
    if (!current) return add
    return /\s$/.test(current) ? current + add : current + ' ' + add
}

export function formatClock(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds) % 60).padStart(2, '0')}`
}

export interface RecorderLike {
    state: string
    mimeType: string
    ondataavailable: ((e: { data: Blob }) => void) | null
    onstop: (() => void) | null
    onerror: ((e: unknown) => void) | null
    start(timeslice?: number): void
    stop(): void
}
export interface RecognitionLike {
    lang: string
    continuous: boolean
    interimResults: boolean
    onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => void) | null
    onerror: ((e: { error?: string }) => void) | null
    onend: (() => void) | null
    start(): void
    stop(): void
}
export interface DictationDeps {
    /** undefined where the browser has no mic API (an insecure page) */
    getUserMedia?: (c: { audio: boolean }) => Promise<{ getTracks(): { stop(): void }[] }>
    createRecorder?: (stream: any, mimeType: string) => RecorderLike
    isTypeSupported?: (type: string) => boolean
    createRecognition?: () => RecognitionLike
    fetch: (input: string, init: RequestInit) => Promise<Response>
    auth: () => Promise<string>
    setInterval: (fn: () => void, ms: number) => unknown
    clearInterval: (id: unknown) => void
}

export function createDictation(deps: DictationDeps, onText: (text: string) => void, onState: (s: DictationState) => void, maxSeconds = MAX_SECONDS) {
    let state: DictationState = { phase: 'idle', seconds: 0, error: null, browser: false }
    let recorder: RecorderLike | null = null
    let recognition: RecognitionLike | null = null
    let stream: { getTracks(): { stop(): void }[] } | null = null
    let ticker: unknown = null
    let chunks: Blob[] = []
    let useBrowser = false          // set once the server failed: the next tap uses the browser's recogniser
    let busy = false                // a tap arrived while getUserMedia was still asking for permission

    const set = (patch: Partial<DictationState>) => { state = { ...state, ...patch }; onState(state) }
    const stopTicker = () => { if (ticker !== null) deps.clearInterval(ticker); ticker = null }
    const releaseMic = () => { try { stream?.getTracks().forEach((t) => t.stop()) } catch { /* already stopped */ } stream = null }
    const startTicker = () => {
        set({ seconds: 0 })
        ticker = deps.setInterval(() => {
            set({ seconds: state.seconds + 1 })
            if (state.seconds >= maxSeconds) stop()
        }, 1000)
    }

    async function startRecording() {
        busy = true
        try {
            if (!deps.getUserMedia || !deps.createRecorder) {
                if (deps.createRecognition) return startBrowser()
                set({ error: MESSAGES.unsupported }); return
            }
            try { stream = await deps.getUserMedia({ audio: true }) } catch (e: any) {
                set({ error: e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? MESSAGES.denied : MESSAGES.micBusy }); return
            }
            const mime = pickMimeType(deps.isTypeSupported ?? (() => false))
            chunks = []
            try { recorder = deps.createRecorder(stream, mime) } catch { releaseMic(); set({ error: MESSAGES.unsupported }); return }
            recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data) }
            recorder.onerror = () => { stopTicker(); releaseMic(); recorder = null; set({ phase: 'idle', error: MESSAGES.micBusy }) }
            recorder.onstop = () => { void finish(recorder?.mimeType || mime || 'audio/webm') }
            recorder.start()
            set({ phase: 'recording', error: null, browser: false })
            startTicker()
            // the model loads while the player is still talking (it takes ~3 s warm, ~20 s the first time after a restart)
            void deps.auth().then((a) => deps.fetch(STT_PATH + '/warm', { method: 'POST', headers: { 'risu-auth': a } })).catch(() => { /* the clip itself will say */ })
        } finally { busy = false }
    }

    function startBrowser() {
        const r = deps.createRecognition!()
        recognition = r
        r.lang = 'vi-VN'
        r.continuous = true
        r.interimResults = false
        const heard: string[] = []
        r.onresult = (e) => {
            for (let i = 0; i < e.results.length; i++) {
                const res = e.results[i]
                if (res.isFinal !== false && res[0]?.transcript) heard[i] = res[0].transcript
            }
        }
        r.onerror = (e) => {
            stopTicker(); recognition = null
            set({ phase: 'idle', browser: false, error: e?.error === 'not-allowed' || e?.error === 'service-not-allowed' ? MESSAGES.denied : MESSAGES.serverNone })
        }
        r.onend = () => {
            if (!recognition) return
            recognition = null
            stopTicker()
            const text = heard.filter(Boolean).join(' ').trim()
            set({ phase: 'idle', browser: false, error: text ? null : MESSAGES.noSpeech })
            if (text) onText(text)
        }
        r.start()
        set({ phase: 'recording', error: null, browser: true })
        startTicker()
    }

    async function finish(mime: string) {
        stopTicker()
        releaseMic()
        const parts = chunks
        chunks = []
        recorder = null
        if (parts.length === 0) { set({ phase: 'idle', error: MESSAGES.noSpeech }); return }
        set({ phase: 'transcribing', error: null })
        try {
            const body = new Blob(parts, { type: mime })
            const res = await deps.fetch(STT_PATH, {
                method: 'POST',
                headers: { 'content-type': mime.split(';')[0] || 'audio/webm', 'risu-auth': await deps.auth(), 'x-stt-language': 'auto' },
                body,
            })
            if (!res.ok) {
                let code = ''
                try { code = (await res.json())?.error?.code ?? '' } catch { /* not json */ }
                if (code === 'timeout') { set({ phase: 'idle', error: MESSAGES.timeout }); return }
                if (code === 'too_large') { set({ phase: 'idle', error: MESSAGES.tooLarge }); return }
                throw new Error(`stt ${res.status}`)
            }
            const text = String((await res.json())?.text ?? '').trim()
            if (!text) { set({ phase: 'idle', error: MESSAGES.noSpeech }); return }
            set({ phase: 'idle', error: null })
            onText(text)
        } catch {
            // the server cannot transcribe: the browser's own recogniser, if there is one, on the next tap
            useBrowser = !!deps.createRecognition
            set({ phase: 'idle', error: useBrowser ? MESSAGES.serverBrowser : MESSAGES.serverNone })
        }
    }

    function stop() {
        if (state.phase !== 'recording') return
        if (recognition) { try { recognition.stop() } catch { /* ended already */ } return }   // onend delivers the text
        stopTicker()
        try { if (recorder && recorder.state !== 'inactive') recorder.stop() } catch { void finish('audio/webm') }
    }

    /** The button's tap. */
    function toggle() {
        if (state.phase === 'transcribing' || busy) return
        if (state.phase === 'recording') { stop(); return }
        if (useBrowser && deps.createRecognition) { set({ error: null }); startBrowser(); return }
        set({ error: null })
        void startRecording()
    }

    /** Drops everything (the page goes away): no text is delivered. */
    function dispose() {
        stopTicker()
        recognition = null
        if (recorder) { recorder.onstop = null; try { recorder.stop() } catch { /* inactive */ } recorder = null }
        releaseMic()
    }

    return { toggle, dispose, get state() { return state } }
}
