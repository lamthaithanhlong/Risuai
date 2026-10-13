// iOS Safari starts an AudioContext "suspended" unless it is created or resumed inside the tap that asked for sound. Risu
// fetched the voice first (seconds with a local TTS server) and only then did `new AudioContext()`, so the tap was long over:
// the context stayed suspended and the voice played as silence, with no error. One shared context is made and resumed
// at the tap itself (a silent one-sample sound is the usual unlock), and playback reuses it.

export interface AudioContextLike {
    state: string
    destination: unknown
    resume(): Promise<void>
    createBuffer(channels: number, length: number, sampleRate: number): unknown
    createBufferSource(): { buffer: unknown, connect(node: unknown): void, start(when?: number): void, stop(): void }
    decodeAudioData(data: ArrayBuffer): Promise<unknown>
}

export function createAudioPlayer(make: () => AudioContextLike) {
    let context: AudioContextLike | null = null
    let playing: { stop(): void } | null = null

    const get = () => (context ??= make())

    return {
        /** Call synchronously from the tap, before any await. */
        unlock(): AudioContextLike {
            const c = get()
            if (c.state === 'suspended') {
                void c.resume().catch(() => {})
            }
            const silent = c.createBufferSource()
            silent.buffer = c.createBuffer(1, 1, 22050)
            silent.connect(c.destination)
            silent.start(0)
            return c
        },

        stop() {
            try {
                playing?.stop()
            } catch {}
            playing = null
        },

        async play(bytes: ArrayBuffer): Promise<{ state: string }> {
            const c = get()
            if (c.state === 'suspended') {
                await c.resume()
            }
            const buffer = await c.decodeAudioData(bytes)
            this.stop()
            const source = c.createBufferSource()
            source.buffer = buffer
            source.connect(c.destination)
            source.start()
            playing = source
            return c
        },

        context: () => context,
    }
}

const player = createAudioPlayer(() => new AudioContext() as unknown as AudioContextLike)

export const unlockAudio = () => player.unlock()
export const playUnlocked = (bytes: ArrayBuffer) => player.play(bytes)
export const stopUnlocked = () => player.stop()
export const sharedAudioContext = () => player.context() as unknown as AudioContext | null
