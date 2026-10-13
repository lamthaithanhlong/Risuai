import { describe, expect, test } from 'vitest'
import { safeEnqueue } from './safeEnqueue'

const bytes = (s: string) => new TextEncoder().encode(s)

function openStream() {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c } })
    return { controller, reader: stream.getReader() }
}

describe('safeEnqueue', () => {
    test('an open stream gets the chunk', async () => {
        const { controller, reader } = openStream()
        expect(safeEnqueue(controller, bytes('abc'), () => false)).toBe(true)
        expect((await reader.read()).value).toEqual(bytes('abc'))
    })

    test('a stream that was already closed does not throw (the phone error)', () => {
        const { controller } = openStream()
        controller.close()
        expect(() => controller.enqueue(bytes('x'))).toThrow()
        expect(safeEnqueue(controller, bytes('x'), () => false)).toBe(false)
    })

    test('a settled stream is left alone even if it still looks open', async () => {
        const { controller, reader } = openStream()
        expect(safeEnqueue(controller, bytes('x'), () => true)).toBe(false)
        controller.close()
        expect((await reader.read()).done).toBe(true)
    })

    test('no controller yet means nothing happens', () => {
        expect(safeEnqueue(null, bytes('x'), () => false)).toBe(false)
    })
})
