import { describe, expect, it } from 'vitest'
import { hasPicture, parseImageStream, retryDelayMs } from './imageRetry'

// The router's stream for one picture, as measured on 2026-10-15 (b64 shortened).
const STREAM = [
    'event: progress', 'data: {"stage":"response.created","bytesReceived":2419}', '',
    'event: progress', 'data: {"stage":"response.image_generation_call.generating","bytesReceived":7070}', '',
    'event: done', 'data: {"created":1792074441,"data":[{"b64_json":"iVBORw0KGgo="}]}', '',
].join('\n')

describe('parseImageStream', () => {
    it('takes the picture from the done event', () => {
        const r = parseImageStream(STREAM)
        expect(r.ok).toBe(true)
        expect(hasPicture(r)).toBe(true)
        expect(r.data.data[0].b64_json).toBe('iVBORw0KGgo=')
    })
    it('reads a plain JSON answer from a router that ignores the stream header', () => {
        const r = parseImageStream('{"data":[{"b64_json":"AAAA"}]}')
        expect(hasPicture(r)).toBe(true)
    })
    it('a stream cut off before done is a temporary failure, so the next model or round is tried', () => {
        const cut = STREAM.split('event: done')[0]
        const r = parseImageStream(cut)
        expect(hasPicture(r)).toBe(false)
        expect(retryDelayMs(r)).toBe(8000)
    })
    it('an error event keeps its message (a "reset after 30s" is waited out)', () => {
        const r = parseImageStream('event: error\ndata: {"error":{"message":"[codex/gpt-5.6-luna-image] terminated (reset after 30s)"}}\n\n')
        expect(r.ok).toBe(false)
        expect(retryDelayMs(r)).toBe(33000)
    })
    it('an HTTP error body is kept as the error text', () => {
        const r = parseImageStream('{"error":{"message":"The model is not supported (reset after 30m)"}}', 400)
        expect(r.ok).toBe(false)
        expect(retryDelayMs(r)).toBe(null)
    })
    it('CRLF line endings work', () => {
        expect(hasPicture(parseImageStream(STREAM.replace(/\n/g, '\r\n')))).toBe(true)
    })
})
