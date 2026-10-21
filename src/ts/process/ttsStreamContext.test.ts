import { describe, expect, it, vi } from 'vitest'

// The stream played on a context of its own, made at its first reading: after the awaits that load the TTS code, so outside the tap.
// iOS starts such a context suspended and refuses to resume it outside a tap: silence, or sound only from a later tap (owner,
// 2026-10-20: "click tra một lúc mới nghe được hoặc có khi không nghe được lun"). It must play on the context the tap unlocked.
const shared = { state: 'running', currentTime: 0, destination: {}, resume: vi.fn(async () => {}), decodeAudioData: vi.fn(async () => ({ duration: 1 })),
    createBufferSource: vi.fn(() => ({ buffer: null, connect() {}, start() {}, stop() {} })) }
vi.mock('./audioUnlock', () => ({ sharedAudioContext: () => shared, unlockAudio: () => shared }))
const made = vi.fn()
;(globalThis as any).AudioContext = class { constructor() { made() } }

const { speakStream } = await import('./ttsStream')

const frame = (bytes: number[]) => new Uint8Array([65, 0, 0, 0, bytes.length, ...bytes])

describe('speakStream plays on the context the tap unlocked', () => {
    it('no context of its own; the chunks are decoded on the shared one', async () => {
        const body = new ReadableStream({ start(c) { c.enqueue(frame([1, 2, 3])); c.close() } })
        await speakStream({ fetch: async () => new Response(body, { status: 200 }), auth: async () => 'a' }, { model: 'vieneu', voice: 'v', input: 'xin chào' })
        expect(made).not.toHaveBeenCalled()
        expect(shared.decodeAudioData).toHaveBeenCalledTimes(1)
    })
    it('an interrupted shared context is resumed', async () => {
        shared.state = 'interrupted'
        const body = new ReadableStream({ start(c) { c.enqueue(frame([1])); c.close() } })
        await speakStream({ fetch: async () => new Response(body, { status: 200 }), auth: async () => 'a' }, { model: 'vieneu', voice: 'v', input: 'a' })
        expect(shared.resume).toHaveBeenCalled()
    })
})
