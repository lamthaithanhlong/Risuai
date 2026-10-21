import { describe, expect, test } from 'vitest'
import { createAudioPlayer, type AudioContextLike } from './audioUnlock'

function fakeContext(initial: 'suspended' | 'running') {
    const log: string[] = []
    const ctx: AudioContextLike & { log: string[] } = {
        log,
        state: initial,
        destination: {},
        async resume() { log.push('resume'); ctx.state = 'running' },
        createBuffer: () => ({}),
        createBufferSource: () => {
            const s = { buffer: null as unknown, connect() { log.push('connect') }, start() { log.push('start') }, stop() { log.push('stop') } }
            return s
        },
        async decodeAudioData() { log.push('decode'); return {} },
    }
    return ctx
}

describe('audio player (iOS unlock)', () => {
    test('the tap makes and resumes ONE context before any fetch', () => {
        let made = 0
        const ctx = fakeContext('suspended')
        const p = createAudioPlayer(() => { made++; return ctx })
        p.unlock()
        expect(made).toBe(1)
        expect(ctx.log).toContain('resume')
        expect(ctx.log).toContain('start')          // the silent unlock sound
    })

    test('playing later reuses that context, it does not create another', async () => {
        let made = 0
        const ctx = fakeContext('suspended')
        const p = createAudioPlayer(() => { made++; return ctx })
        p.unlock()
        await p.play(new ArrayBuffer(8))
        await p.play(new ArrayBuffer(8))
        expect(made).toBe(1)
    })

    test('a context still suspended when the voice arrives is resumed before decoding', async () => {
        const ctx = fakeContext('suspended')
        const p = createAudioPlayer(() => ctx)
        await p.play(new ArrayBuffer(8))              // no unlock: the old behaviour
        expect(ctx.log.indexOf('resume')).toBeLessThan(ctx.log.indexOf('decode'))
    })

    test('a new voice stops the one that is still playing', async () => {
        const ctx = fakeContext('running')
        const p = createAudioPlayer(() => ctx)
        await p.play(new ArrayBuffer(8))
        await p.play(new ArrayBuffer(8))
        expect(ctx.log.filter((l) => l === 'stop').length).toBe(1)
    })
})

describe('audio player after the app was switched (iOS "interrupted")', () => {
    test('a context iOS interrupted is resumed at the next tap, not only a suspended one', () => {
        const ctx = fakeContext('running')
        ;(ctx as { state: string }).state = 'interrupted'
        const p = createAudioPlayer(() => ctx)
        p.unlock()
        expect(ctx.log).toContain('resume')
    })
    test('playing on an interrupted context resumes it first', async () => {
        const ctx = fakeContext('running')
        const p = createAudioPlayer(() => ctx)
        p.unlock()
        ;(ctx as { state: string }).state = 'interrupted'
        ctx.log.length = 0
        await p.play(new ArrayBuffer(8))
        expect(ctx.log[0]).toBe('resume')
    })
})
