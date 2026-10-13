import { describe, expect, test } from 'vitest'
import { DEFAULT_LOCAL_TTS, resolveTTS } from './ttsLocal'

describe('resolveTTS', () => {
    test('no mode set and a local server on: speak through it', () => {
        const r = resolveTTS({}, DEFAULT_LOCAL_TTS, '')
        expect(r.mode).toBe('openai')
        expect(r.openai).toMatchObject({ baseURL: 'http://localhost:8765/v1', model: 'vieneu', voice: 'Trúc Ly', format: 'mp3', apiKey: '' })
    })

    test('no mode set and no local server: stay silent as before', () => {
        expect(resolveTTS({}, undefined, '')).toEqual({ mode: '' })
        expect(resolveTTS({}, { ...DEFAULT_LOCAL_TTS, enabled: false }, '')).toEqual({ mode: '' })
    })

    test('a character with its own mode keeps it', () => {
        expect(resolveTTS({ ttsMode: 'webspeech' }, DEFAULT_LOCAL_TTS, '')).toEqual({ mode: 'webspeech' })
        expect(resolveTTS({ ttsMode: 'elevenlab' }, DEFAULT_LOCAL_TTS, '').openai).toBeUndefined()
    })

    test("a character's own OpenAI endpoint beats the local default", () => {
        const r = resolveTTS({ ttsMode: 'openai', oaiTTSConfig: { enabled: true, baseURL: 'http://localhost:8765/v1/', model: 'kokoro', voice: 'af_heart', format: 'mp3' } }, DEFAULT_LOCAL_TTS, 'sk-x')
        expect(r.openai).toMatchObject({ baseURL: 'http://localhost:8765/v1', model: 'kokoro', voice: 'af_heart', apiKey: 'sk-x' })
    })

    test('OpenAI mode without an endpoint of its own goes local, not to api.openai.com', () => {
        const r = resolveTTS({ ttsMode: 'openai', oaiTTSConfig: { enabled: false } }, DEFAULT_LOCAL_TTS, 'sk-x')
        expect(r.openai?.baseURL).toBe('http://localhost:8765/v1')
        expect(r.openai?.apiKey).toBe('')           // the OpenAI key is never sent to the local server
    })

    test("the character's chosen voice is used with the local server", () => {
        expect(resolveTTS({ ttsMode: 'openai', oaiVoice: 'Thục Đoan' }, DEFAULT_LOCAL_TTS, '').openai?.voice).toBe('Thục Đoan')
    })

    test('local server off: OpenAI mode is the real OpenAI, as before', () => {
        const r = resolveTTS({ ttsMode: 'openai' }, undefined, 'sk-x')
        expect(r.openai).toMatchObject({ baseURL: 'https://api.openai.com/v1', apiKey: 'sk-x', model: 'tts-1', voice: 'alloy' })
    })
})
