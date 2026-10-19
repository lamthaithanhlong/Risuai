import { describe, expect, test } from 'vitest'
import { fetchStoryCheckLine, storyCheckRequest } from './storyCheck'

const msgs = () => [{ role: 'system', content: 'rules' }, { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }]
const LINE = '[Story consistency check: mara died (day 1) but acts later (day 4). Correct this in the story without mentioning the check.]'
const deps = (impl: (url: string, init?: any) => Promise<any>) => ({ fetch: impl as any, auth: async () => 'tok', timeoutMs: 50 })
const ok = (body: any, status = 200) => Promise.resolve({ ok: status < 300, status, json: async () => body })

describe('story check line in the request (setting, off by default)', () => {
    test('one system line goes right before the last user message; nothing else changes', () => {
        const out = storyCheckRequest(msgs(), LINE)
        expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'system', 'user'])
        expect(out[3].content).toBe(LINE)
        expect(storyCheckRequest(msgs(), '')).toEqual(msgs())
    })

    test('fetches the line for the chat with the auth header', async () => {
        let seen: any
        const line = await fetchStoryCheckLine('4c9bb225-3ef3', deps((url, init) => { seen = { url, init }; return ok({ status: 'ok', violations: [{}], line: LINE }) }))
        expect(line).toBe(LINE)
        expect(seen.url).toBe('/api/story/4c9bb225-3ef3/check')
        expect(seen.init.headers['risu-auth']).toBe('tok')
    })

    test('no line on any failure: unavailable, archived, error, network, slow server, bad id', async () => {
        expect(await fetchStoryCheckLine('k1', deps(() => ok({ status: 'unavailable', reason: 'no swipl', line: '' })))).toBe('')
        expect(await fetchStoryCheckLine('k1', deps(() => ok({ status: 'archived' }, 410)))).toBe('')
        expect(await fetchStoryCheckLine('k1', deps(() => Promise.reject(new Error('down'))))).toBe('')
        expect(await fetchStoryCheckLine('k1', deps((_u, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))))))).toBe('')
        expect(await fetchStoryCheckLine('../etc', deps(() => ok({ line: LINE })))).toBe('')
        expect(await fetchStoryCheckLine(undefined, deps(() => ok({ line: LINE })))).toBe('')
    })
})
