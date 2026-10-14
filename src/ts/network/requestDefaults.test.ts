// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const { applyReasoningDefault, readConfig, DEFAULTS } = createRequire(import.meta.url)('../../../server/node/requestDefaults.cjs')
const body = (o: unknown) => Buffer.from(JSON.stringify(o))
const chat = (extra: Record<string, unknown> = {}) => ({ model: 'main', stream: true, messages: [{ role: 'user', content: 'hi' }], temperature: 0.8, ...extra })

describe('applyReasoningDefault (measured: 4081 reasoning tokens and 86 s at the default, 1836 and 50 s at low)', () => {
    it('adds reasoning_effort medium for the main model and leaves the rest of the request alone', () => {
        const r = applyReasoningDefault(body(chat()))
        expect(r.changed).toBe(true)
        expect(JSON.parse(r.body.toString())).toEqual({ ...chat(), reasoning_effort: 'medium' })
    })

    it('does not override a request that already chose its own effort or thinking mode', () => {
        for (const extra of [{ reasoning_effort: 'high' }, { thinking: { type: 'enabled' } }, { reasoning: { effort: 'medium' } }]) {
            const b = body(chat(extra))
            const r = applyReasoningDefault(b)
            expect(r.changed).toBe(false)
            expect(r.body).toBe(b)
        }
    })

    it('leaves other models, non-chat bodies and non-JSON alone', () => {
        const other = body(chat({ model: 'story' }))
        expect(applyReasoningDefault(other).body).toBe(other)
        const embeddings = body({ model: 'main', input: 'x' })
        expect(applyReasoningDefault(embeddings).changed).toBe(false)
        const text = Buffer.from('not json')
        expect(applyReasoningDefault(text).body).toBe(text)
        expect(applyReasoningDefault(undefined).changed).toBe(false)
        expect(applyReasoningDefault(Buffer.alloc(0)).changed).toBe(false)
    })

    it('can be turned off or changed by the environment, and a bad value falls back to the default', () => {
        expect(applyReasoningDefault(body(chat()), readConfig({ RISU_REASONING_DEFAULTS: '{}' })).changed).toBe(false)
        const r = applyReasoningDefault(body(chat()), readConfig({ RISU_REASONING_DEFAULTS: '{"main":"low"}' }))
        expect(JSON.parse(r.body.toString()).reasoning_effort).toBe('low')
        expect(readConfig({ RISU_REASONING_DEFAULTS: '[1,2' })).toBe(DEFAULTS)
        expect(applyReasoningDefault(body(chat()), { main: 'extreme' }).changed).toBe(false)   // not a known effort
    })
})
