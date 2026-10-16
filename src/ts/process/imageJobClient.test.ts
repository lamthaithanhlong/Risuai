import { describe, expect, it } from 'vitest'
import { drawOnServer, findTarget, placePicture, recoverImageJobs, waitImageJob, type ImageJob, type JobApi } from './imageJobClient'

describe('placePicture', () => {
    it('replaces the first picture, puts one on top when there is none, and leaves a placed one alone', () => {
        expect(placePicture('{{inlay::old}}\n\nText', 'new')).toBe('{{inlay::new}}\n\nText')
        expect(placePicture('Text', 'new')).toBe('{{inlay::new}}\n\nText')
        expect(placePicture('{{inlay::new}}\n\nText', 'new')).toBe('{{inlay::new}}\n\nText')
        expect(placePicture('', 'new')).toBe('{{inlay::new}}')
        expect(placePicture('{{inlay::a}} x {{inlay::b}}', 'n')).toBe('{{inlay::n}} x {{inlay::b}}')
    })
})

const db = () => ({ characters: [{ chaId: 'ss', chatPage: 0, chats: [
    { id: 'chat-a', message: [{ role: 'user', data: 'hi', chatId: 'm0' }, { role: 'char', data: 'Reply one', chatId: 'm1' }] },
    { id: 'chat-b', message: [{ role: 'char', data: 'Other', chatId: 'x1' }] },
] }] }) as any

describe('findTarget', () => {
    it('finds the message by its ids even after messages were added', () => {
        const d = db()
        d.characters[0].chats[0].message.unshift({ role: 'char', data: 'greeting', chatId: 'g' })
        const f = findTarget(d, { charId: 'ss', chatId: 'chat-a', chatIndex: 0, messageId: 'm1', messageIndex: 1 })
        expect(f?.index).toBe(2)
    })
    it('gives up when the character, chat or message is gone', () => {
        expect(findTarget(db(), { charId: 'nope', chatIndex: 0, messageIndex: 0 })).toBe(null)
        expect(findTarget(db(), { charId: 'ss', chatId: 'chat-a', chatIndex: 0, messageId: 'deleted', messageIndex: 1 })).toBe(null)
        expect(findTarget(db(), null)).toBe(null)
    })
    it('a picture for a deleted chat goes nowhere, not into the chat that moved to its position', () => {
        const d = db()
        d.characters[0].chats.unshift({ id: 'other', message: [{ role: 'char', data: 'x', chatId: 'm0' }, { role: 'char', data: 'y', chatId: 'm1' }] } as any)
        d.characters[0].chats = d.characters[0].chats.filter((c: any) => c.id !== 'chat-a')       // chat-a deleted, 'other' now at 0
        expect(findTarget(d, { charId: 'ss', chatId: 'chat-a', chatIndex: 0, messageIndex: 1 })).toBe(null)
        expect(findTarget(d, { charId: 'ss', chatIndex: 0, messageIndex: 1 })?.chat.id).toBe('other')   // an old job without ids: by position
    })
})

/** A fake server holding jobs. */
function server(jobs: ImageJob[], opts: { failPolls?: number } = {}) {
    const acked: string[] = []
    let failPolls = opts.failPolls ?? 0
    const api: JobApi = {
        auth: async () => 'tok',
        sleep: async () => {},
        fetch: (async (url: string, init?: RequestInit) => {
            const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data })
            if (url === '/api/image-jobs' && init?.method === 'POST') { const j: ImageJob = { id: 'new', status: 'running' }; jobs.push(j); return ok({ id: 'new' }) }
            if (url === '/api/image-jobs') return ok({ jobs: jobs.filter((j) => !acked.includes(j.id) && j.status !== 'running') })
            const m = /^\/api\/image-jobs\/([^/]+)(\/ack)?$/.exec(url)!
            if (m[2]) { acked.push(m[1]); return ok({ acked: true }) }
            if (failPolls-- > 0) throw new Error('network blip')
            const job = jobs.find((j) => j.id === m[1])!
            if (job.status === 'running') { job.status = 'done'; job.inlayId = 'pic-1'; job.model = 'luna' }
            return ok(job)
        }) as any,
    }
    return { api, acked }
}

describe('recovery at start', () => {
    it('places a finished picture in its message, acknowledges every job, skips a missing message, logs a failure', async () => {
        const d = db()
        const s = server([
            { id: 'j1', status: 'done', inlayId: 'pic-9', target: { charId: 'ss', chatId: 'chat-a', chatIndex: 0, messageId: 'm1', messageIndex: 1 } },
            { id: 'j2', status: 'done', inlayId: 'pic-8', target: { charId: 'ss', chatId: 'chat-a', chatIndex: 0, messageId: 'gone', messageIndex: 9 } },
            { id: 'j3', status: 'error', error: 'every model failed' },
            { id: 'j4', status: 'done', inlayId: 'old-pic', superseded: true, target: { charId: 'ss', chatId: 'chat-a', chatIndex: 0, messageId: 'm1', messageIndex: 1 } },
        ])
        const logs: string[] = []
        const r = await recoverImageJobs(s.api, d, (m: string) => logs.push(m))
        expect(d.characters[0].chats[0].message[1].data).toBe('{{inlay::pic-9}}\n\nReply one')
        expect(r).toEqual({ placed: ['j1'], skipped: ['j2', 'j3', 'j4'] })
        expect(s.acked).toEqual(['j1', 'j2', 'j3', 'j4'])           // the superseded old picture never replaced pic-9
        expect(logs[0]).toContain('every model failed')
        await recoverImageJobs(s.api, d)                                                   // nothing left the second time
        expect(d.characters[0].chats[0].message[1].data).toBe('{{inlay::pic-9}}\n\nReply one')
    })
})

describe('drawing on the server', () => {
    it('waits through a network blip and returns the picture id; the job is acknowledged only afterwards (place first)', async () => {
        const s = server([], { failPolls: 2 })
        const later: (() => void)[] = []
        const out = await drawOnServer(s.api, { url: 'http://127.0.0.1:20128/x', models: ['luna'], body: { prompt: 'p' } }, null, { defer: (fn) => { later.push(fn) } })
        expect(out).toEqual({ inlayId: 'pic-1', model: 'luna' })
        expect(s.acked).toEqual([])                       // not yet: the caller has not placed the picture
        later.forEach((fn) => fn())
        await new Promise((r) => setTimeout(r, 0))
        expect(s.acked).toEqual(['new'])
    })
    it('a superseded picture is not handed back, only acknowledged', async () => {
        const s = server([])
        const fetch0 = s.api.fetch
        s.api.fetch = (async (url: string, init?: RequestInit) => {
            const r: any = await fetch0(url, init)
            if (/^\/api\/image-jobs\/new$/.test(url)) { const j = await r.json(); return { ok: true, status: 200, json: async () => ({ ...j, superseded: true }) } }
            return r
        }) as any
        const out = await drawOnServer(s.api, { url: 'http://127.0.0.1:20128/x', models: ['luna'], body: { prompt: 'p' } }, null, { defer: () => {} })
        expect(out.inlayId).toBeUndefined()
        expect(out.error).toContain('newer picture')
        await new Promise((r) => setTimeout(r, 0))
        expect(s.acked).toEqual(['new'])
    })
    it('a job that takes too long is reported, not thrown', async () => {
        const s = server([{ id: 'slow', status: 'running' }])
        s.api.fetch = (async () => ({ ok: true, status: 200, json: async () => ({ id: 'slow', status: 'running' }) })) as any
        const job = await waitImageJob(s.api, 'slow', { everyMs: 1, timeoutMs: 5 })
        expect(job.status).toBe('error')
    })
})
