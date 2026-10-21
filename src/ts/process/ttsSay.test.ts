import { beforeEach, describe, expect, it, vi } from 'vitest'

// sayTTS with the local TTS server: the element starts at the tap (before the text is prepared), the text goes to it once known,
// and Web Audio (speakStream) is the fallback only when the element failed, never when the reading was stopped.

const h = vi.hoisted(() => ({
    char: { name: 'Mai', type: 'character', chaId: 'c1', ttsMode: '' } as any,
    db: { ttsLocal: { enabled: true, baseURL: 'http://localhost:8765/v1', model: 'vieneu', voice: 'Trúc Ly' }, openAIKey: '' } as any,
    order: [] as string[],
    reading: null as any,
    sendImpl: null as any,
    speakStream: null as any,
}))
vi.mock('../alert', () => ({ alertError: vi.fn(), alertToast: vi.fn() }))
vi.mock('../parser/cot', () => ({ splitCoT: (t: string) => ({ main: t }) }))
vi.mock('../storage/database.svelte', () => ({ getCurrentCharacter: () => h.char, getDatabase: () => h.db }))
vi.mock('../storage/nodeStorage', () => ({ getNodeServerProxyAuth: async () => 'tok' }))
vi.mock('../translator/translator', () => ({ runTranslator: vi.fn(), translateVox: vi.fn() }))
vi.mock('../globalApi.svelte', () => ({ globalFetch: vi.fn(async () => ({ ok: false, data: { error: { message: 'whole-file path' } } })), loadAsset: vi.fn() }))
vi.mock('src/lang', () => ({ language: { errors: { httpError: 'http ' } } }))
vi.mock('../util', () => ({ sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)) }))
vi.mock('./transformers', () => ({ runVITS: vi.fn() }))
vi.mock('../brLog', () => ({ brLog: (m: string) => { h.order.push('log:' + m) } }))
vi.mock('./audioUnlock', () => ({ playUnlocked: vi.fn(), sharedAudioContext: () => null, stopUnlocked: vi.fn(), unlockAudio: () => { h.order.push('unlock') } }))
vi.mock('./ttsElement', async () => {
    class ReadingStopped extends Error { constructor() { super('stopped') } }
    return {
        ReadingStopped,
        elementReadingSupported: () => true,
        beginElementReading: vi.fn((title: string) => {
            h.order.push('begin:' + title)
            h.reading = { id: 'r1', send: vi.fn((_d: any, req: any) => { h.order.push('send:' + req.input); return h.sendImpl(req) }), stop: vi.fn() }
            return h.reading
        }),
    }
})
vi.mock('./ttsStream', () => ({ stopSpeaking: vi.fn(), speakStream: (...a: any[]) => h.speakStream(...a) }))

;(globalThis as any).__NODE__ = true
const { sayTTS } = await import('./tts')
const { beginElementReading } = await import('./ttsElement')

beforeEach(() => {
    h.order.length = 0
    h.reading = null
    h.char = { name: 'Mai', type: 'character', chaId: 'c1', ttsMode: '' }
    h.sendImpl = async () => ({ first: 700 })
    h.speakStream = vi.fn(async () => ({ first: 900 }))
    vi.mocked(beginElementReading).mockClear()
})

describe('sayTTS with the local TTS server', () => {
    it('starts the element at the tap (right after the unlock, before the text is prepared), then sends the speakable text', async () => {
        await sayTTS(null as any, 'Xin chào **bạn**.')
        expect(h.order.slice(0, 2)).toEqual(['unlock', 'begin:Mai'])
        expect(h.reading.send).toHaveBeenCalledTimes(1)
        expect(h.reading.send.mock.calls[0][1]).toMatchObject({ model: 'vieneu', voice: 'Trúc Ly' })
        expect(h.reading.send.mock.calls[0][1].input).toContain('Xin chào')
        expect(h.speakStream).not.toHaveBeenCalled()
    })

    it('falls back to Web Audio when the element fails, and stops the dead element first', async () => {
        h.sendImpl = async () => { throw new Error('the audio element failed (code 4)') }
        await sayTTS(null as any, 'Xin chào.')
        expect(h.reading.stop).toHaveBeenCalled()
        expect(h.speakStream).toHaveBeenCalledTimes(1)
    })

    it('does not play it another way when the reading was stopped', async () => {
        const { ReadingStopped } = await import('./ttsElement')
        h.sendImpl = async () => { throw new ReadingStopped() }
        await sayTTS(null as any, 'Xin chào.')
        expect(h.speakStream).not.toHaveBeenCalled()
    })

    it('nothing to say after the text is cleaned: the element that was started is ended', async () => {
        await sayTTS(null as any, '*   *')
        expect(h.reading.send).not.toHaveBeenCalled()
        expect(h.reading.stop).toHaveBeenCalled()
    })

    it('another voice mode does not start the element', async () => {
        h.char = { name: 'Mai', type: 'character', chaId: 'c1', ttsMode: 'webspeech' }
        ;(globalThis as any).speechSynthesis = { speak: vi.fn(), getVoices: () => [], cancel: vi.fn() }
        ;(globalThis as any).SpeechSynthesisUtterance = class { constructor(public text: string) {} }
        await sayTTS(null as any, 'Xin chào.')
        expect(beginElementReading).not.toHaveBeenCalled()
    })

    it('a character with its own non-local endpoint does not start the element', async () => {
        h.char = { name: 'Mai', type: 'character', chaId: 'c1', ttsMode: 'openai', oaiTTSConfig: { enabled: true, baseURL: 'https://api.openai.com/v1', apiKey: 'k', model: 'tts-1', voice: 'nova' } }
        await sayTTS(null as any, 'Xin chào.')
        expect(beginElementReading).not.toHaveBeenCalled()
    })
})
