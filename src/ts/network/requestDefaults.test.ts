// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const { applyReasoningDefault, readConfig, DEFAULTS } = createRequire(import.meta.url)('../../../server/node/requestDefaults.cjs')
const MAIN_LOW = { main: 'low' }
const body = (o: unknown) => Buffer.from(JSON.stringify(o))
const chat = (extra: Record<string, unknown> = {}) => ({ model: 'main', stream: true, messages: [{ role: 'user', content: 'hi' }], temperature: 0.8, ...extra })

describe('applyReasoningDefault (measured: 4081 reasoning tokens and 86 s at the default, 1836 and 50 s at low)', () => {
    it('does nothing by default: the provider default is kept', () => {
        const b = body(chat())
        expect(applyReasoningDefault(b).changed).toBe(false)
        expect(applyReasoningDefault(b).body).toBe(b)
        expect(readConfig({})).toBe(DEFAULTS)
    })

    it('adds the configured reasoning_effort for a configured model and leaves the rest of the request alone', () => {
        const r = applyReasoningDefault(body(chat()), MAIN_LOW)
        expect(r.changed).toBe(true)
        expect(JSON.parse(r.body.toString())).toEqual({ ...chat(), reasoning_effort: 'low' })
    })

    it('does not override a request that already chose its own effort or thinking mode', () => {
        for (const extra of [{ reasoning_effort: 'high' }, { thinking: { type: 'enabled' } }, { reasoning: { effort: 'medium' } }]) {
            const b = body(chat(extra))
            const r = applyReasoningDefault(b, MAIN_LOW)
            expect(r.changed).toBe(false)
            expect(r.body).toBe(b)
        }
    })

    it('leaves other models, non-chat bodies and non-JSON alone', () => {
        const other = body(chat({ model: 'story' }))
        expect(applyReasoningDefault(other, MAIN_LOW).body).toBe(other)
        const embeddings = body({ model: 'main', input: 'x' })
        expect(applyReasoningDefault(embeddings, MAIN_LOW).changed).toBe(false)
        const text = Buffer.from('not json')
        expect(applyReasoningDefault(text, MAIN_LOW).body).toBe(text)
        expect(applyReasoningDefault(undefined, MAIN_LOW).changed).toBe(false)
        expect(applyReasoningDefault(Buffer.alloc(0), MAIN_LOW).changed).toBe(false)
    })

    it('is switched on by the environment, and a bad value falls back to the default (off)', () => {
        expect(applyReasoningDefault(body(chat()), readConfig({ RISU_REASONING_DEFAULTS: '{}' })).changed).toBe(false)
        const r = applyReasoningDefault(body(chat()), readConfig({ RISU_REASONING_DEFAULTS: '{"main":"medium"}' }))
        expect(JSON.parse(r.body.toString()).reasoning_effort).toBe('medium')
        expect(readConfig({ RISU_REASONING_DEFAULTS: '[1,2' })).toBe(DEFAULTS)
        expect(applyReasoningDefault(body(chat()), { main: 'extreme' }).changed).toBe(false)   // not a known effort
    })
})
