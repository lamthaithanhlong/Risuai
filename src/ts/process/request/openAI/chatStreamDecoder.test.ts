import { describe, expect, test } from 'vitest'
import { appendStreamingFragment, createChatStreamDecoder } from './chatStreamDecoder'

const enc = new TextEncoder()

// The decoder this replaced, kept here as the reference: it rebuilt the state from the whole buffer on every call.
function referenceState(buffer: string, multiGen: boolean) {
    const readed: Record<string, string> = {}
    let reasoning = ''
    let fromStructured = false
    let done = false
    for (const data of buffer.split('\n')) {
        if (!data.startsWith('data: ')) continue
        try {
            const raw = data.replace('data: ', '')
            if (raw === '[DONE]') { done = true; break }
            const choices = JSON.parse(raw).choices
            for (const choice of choices) {
                const chunk = choice.delta.content ?? choice.text
                if (chunk) {
                    const key = multiGen ? choice.index.toString() : '0'
                    if (!readed[key]) readed[key] = ''
                    readed[key] = appendStreamingFragment(readed[key], chunk)
                }
                if (choice?.delta?.tool_calls) {
                    if (!readed['__tool_calls']) readed['__tool_calls'] = JSON.stringify({})
                    const tcd = JSON.parse(readed['__tool_calls'])
                    for (const tc of choice.delta.tool_calls) {
                        const index = tc.index ?? 0
                        if (!tcd[index]) tcd[index] = { id: tc.id || null, type: 'function', function: { name: null, arguments: '' } }
                        if (tc.id) tcd[index].id = tc.id
                        if (tc.function?.name) tcd[index].function.name = tc.function.name
                        if (tc.function?.arguments) tcd[index].function.arguments = appendStreamingFragment(tcd[index].function.arguments, tc.function.arguments)
                    }
                    readed['__tool_calls'] = JSON.stringify(tcd)
                }
                const r = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning
                if (r) { fromStructured = true; reasoning = appendStreamingFragment(reasoning, r) }
            }
        } catch (e) { /* skipped, as before */ }
    }
    return { readed, reasoning, fromStructured, done }
}

function rng(seed: number) {
    let s = seed
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32
}

function makeStream(seed: number, multiGen: boolean) {
    const r = rng(seed)
    const words = ['Bụi giấy ', 'bùng lên ', 'theo từng bước chân. ', 'Kenji ', 'đặt sổ ', 'xuống ', 'kệ ', '— ', '“ừ” ', 'ếch ', '日本 ']
    const lines: string[] = []
    let cumulative = ''
    const n = 5 + Math.floor(r() * 40)
    for (let i = 0; i < n; i++) {
        const k = r()
        const w = words[Math.floor(r() * words.length)]
        if (k < 0.3) lines.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { reasoning_content: w } }] })}`)
        else if (k < 0.55) lines.push(`data: ${JSON.stringify({ choices: [{ index: multiGen ? Math.floor(r() * 2) : 0, delta: { content: w } }] })}`)
        else if (k < 0.65) { cumulative += w; lines.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: cumulative } }] })}`) }
        else if (k < 0.72) lines.push(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: r() < 0.3 ? 'call_1' : undefined, function: { name: r() < 0.3 ? 'search' : undefined, arguments: '{"q":"' + Math.floor(r() * 9) } }] } }] })}`)
        else if (k < 0.8) lines.push(`data: ${JSON.stringify({ choices: [], usage: { total_tokens: 12 } })}`)
        else if (k < 0.85) lines.push('data: not json at all')
        else if (k < 0.9) lines.push(': keep-alive')
        else lines.push(`data: ${JSON.stringify({ choices: [{ index: 0, text: w }] })}`)
    }
    if (r() < 0.7) lines.push('data: [DONE]')
    return lines.join('\n\n') + '\n\n'
}

function cut(bytes: Uint8Array, seed: number) {
    const r = rng(seed)
    const out: Uint8Array[] = []
    let i = 0
    while (i < bytes.length) {
        const len = 1 + Math.floor(r() * 40)
        out.push(bytes.slice(i, i + len))
        i += len
    }
    return out
}

describe('chat stream decoder', () => {
    test('same result as the whole-buffer decoder it replaced, for any cut of the stream (1000 random streams)', () => {
        for (let seed = 1; seed <= 1000; seed++) {
            const multiGen = seed % 5 === 0
            const text = makeStream(seed, multiGen)
            const bytes = enc.encode(text)
            const dec = createChatStreamDecoder({ multiGen })
            let received = ''
            const parts = cut(bytes, seed * 7)
            const sofar: number[] = []
            for (const p of parts) {
                dec.feed(p)
                sofar.push(p.length)
            }
            // compare at the end, and at a few intermediate cuts that fall on a line boundary of what the old decoder could see
            let consumed = 0
            const dec2 = createChatStreamDecoder({ multiGen })
            for (const p of parts) {
                dec2.feed(p)
                consumed += p.length
                if (consumed % 3 === 0) {
                    // the reference sees complete text only up to the last blank line: later bytes are an unfinished event
                    const textSoFar = new TextDecoder().decode(bytes.slice(0, consumed))
                    const upTo = textSoFar.lastIndexOf('\n\n')
                    const ref = referenceState(upTo >= 0 ? textSoFar.slice(0, upTo + 2) : '', multiGen)
                    const s = dec2.state()
                    expect(s.readed).toEqual(ref.readed)
                    expect(s.reasoning).toBe(ref.reasoning)
                    expect(s.done).toBe(ref.done)
                }
            }
            const ref = referenceState(text, multiGen)
            const s = dec.state()
            expect(s.readed).toEqual(ref.readed)
            expect(s.reasoning).toBe(ref.reasoning)
            expect(s.reasoningFromStructured).toBe(ref.fromStructured)
            expect(s.done).toBe(ref.done)
            void received
        }
    }, 30000)

    test('what the old decoder dropped: CRLF line endings and "data:" without a space', () => {
        const dec = createChatStreamDecoder()
        dec.feed(enc.encode('data:{"choices":[{"index":0,"delta":{"content":"Chào"}}]}\r\n\r\ndata: {"choices":[{"index":0,"delta":{"content":" em"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'))
        expect(dec.state().readed['0']).toBe('Chào em')
        expect(dec.state().done).toBe(true)
    })

    test('a multi-byte character cut between two chunks is not damaged', () => {
        const bytes = enc.encode('data: {"choices":[{"index":0,"delta":{"content":"Đặt sổ 日本"}}]}\n\n')
        for (let i = 1; i < bytes.length; i++) {
            const dec = createChatStreamDecoder()
            dec.feed(bytes.slice(0, i))
            dec.feed(bytes.slice(i))
            expect(dec.state().readed['0']).toBe('Đặt sổ 日本')
        }
    })

    test('everything after [DONE] is ignored', () => {
        const dec = createChatStreamDecoder()
        dec.feed(enc.encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: [DONE]\n\ndata: {"choices":[{"delta":{"content":"b"}}]}\n\n'))
        expect(dec.state()).toMatchObject({ done: true, readed: { '0': 'a' } })
    })

    test('work grows linearly with the stream: 4000 chunks decode in a fraction of the 4.6 s the whole-buffer decoder needed', () => {
        const dec = createChatStreamDecoder()
        const t = performance.now()
        for (let i = 0; i < 4000; i++) {
            const delta = i < 1600 ? { reasoning_content: 'suy nghĩ từng chút một ' } : { content: 'Bụi giấy bùng lên theo từng bước chân. ' }
            dec.feed(enc.encode(`data: ${JSON.stringify({ id: 'x', choices: [{ index: 0, delta }] })}\n\n`))
        }
        expect(performance.now() - t).toBeLessThan(1500)
        expect(dec.state().readed['0'].length).toBeGreaterThan(80000)
    })
})
