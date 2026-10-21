import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import { applyPictureJobs, drawOnServer, findTarget, liftPictureCooldown, pictureKey, placePicture, queuePicture, recoverImageJobs, waitImageJob, type ImageJob, type JobApi } from './imageJobClient'

const server_ = createRequire(import.meta.url)('../../../server/node/pictureText.cjs') as { placePicture: (t: string, id: string) => string; placeInCharacter: (c: any, t: any, id: string) => string }

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


describe('the page and the server put a picture in a message by the same rule', () => {
    const cases: [string, string][] = [['{{inlay::old}}\n\nText', 'new'], ['Text', 'new'], ['{{inlay::new}}\n\nText', 'new'], ['', 'new'], ['{{inlay::a}} x {{inlay::b}}', 'n'], ['  padded  ', 'z']]
    it.each(cases)('%j + %s', (text, id) => expect(server_.placePicture(text, id)).toBe(placePicture(text, id)))
})

describe('the server places a picture in a character object by ids', () => {
    const char = () => ({ chats: [{ id: 'k1', message: [{ chatId: 'm0', data: 'hi' }, { chatId: 'm1', data: 'Reply' }] }, { id: 'k2', message: [{ chatId: 'm1', data: 'Same id, other chat' }] }] })
    it('puts it in that message of that chat only, and says what it did', () => {
        const c = char()
        expect(server_.placeInCharacter(c, { chatId: 'k1', messageId: 'm1' }, 'p')).toBe('placed')
        expect(c.chats[0].message[1].data).toBe('{{inlay::p}}\n\nReply')
        expect(c.chats[0].message[0].data).toBe('hi')
        expect(c.chats[1].message[0].data).toBe('Same id, other chat')
        expect(server_.placeInCharacter(c, { chatId: 'k1', messageId: 'm1' }, 'p')).toBe('already')
    })
    it('waits when the chat or the message is not in the file yet, and gives up on a target without ids (never by position)', () => {
        expect(server_.placeInCharacter(char(), { chatId: 'k1', messageId: 'later' }, 'p')).toBe('wait')
        expect(server_.placeInCharacter(char(), { chatId: 'nope', messageId: 'm1' }, 'p')).toBe('wait')
        expect(server_.placeInCharacter(char(), { chatIndex: 0, messageIndex: 1 }, 'p')).toBe('unsupported')
    })
})

describe('filing a picture', () => {
    it('is one request that returns at once with the job and the key (chat + message + slot); a redraw has a key of its own', async () => {
        const sent: any[] = []
        const api: JobApi = { auth: async () => 'tok', fetch: (async (url: string, init?: RequestInit) => { sent.push([url, JSON.parse(String(init?.body))]); return { ok: true, status: 200, json: async () => ({ id: 'j1', existing: false }) } }) as any }
        const target = { charId: 'ss', chatId: 'k', chatIndex: 0, messageId: 'm1', messageIndex: 1, slot: 'main' }
        const out = await queuePicture(api, { url: 'http://127.0.0.1:1/x', models: ['m'], body: { prompt: 'p' } }, target)
        expect(out).toEqual({ id: 'j1', existing: false })
        expect(sent[0][0]).toBe('/api/image-jobs')
        expect(sent[0][1].key).toBe('ss|k|m1|main')
        await queuePicture(api, { url: 'http://127.0.0.1:1/x', models: ['m'], body: { prompt: 'p' } }, target, { redraw: 'abc' })
        expect(sent[1][1].key).toBe('ss|k|m1|main#abc')
        expect(pictureKey({ charId: 'a', chatIndex: 2, messageIndex: 5 })).toBe('a|#2|#5|main')       // a job without ids: by position, as before
    })
})

describe('applying the pictures the server drew', () => {
    const target = { charId: 'ss', chatId: 'chat-a', chatIndex: 0, messageId: 'm1', messageIndex: 1 }
    it('a placed one goes into this copy and is not acknowledged (the other page needs it too); a drawn one is acknowledged', () => {
        const d = db()
        const r = applyPictureJobs(d, [
            { id: 'p', status: 'placed', inlayId: 'pic-1', target },
            { id: 'd', status: 'done', inlayId: 'pic-2', target: { ...target, messageId: 'x1', chatId: 'chat-b' } },
        ])
        expect(d.characters[0].chats[0].message[1].data).toBe('{{inlay::pic-1}}\n\nReply one')
        expect(d.characters[0].chats[1].message[0].data).toBe('{{inlay::pic-2}}\n\nOther')
        expect(r.placed).toEqual(['p', 'd'])
        expect(r.ack).toEqual(['d'])
    })
    it('open rows are left alone; a failure is logged and acknowledged; applying twice changes nothing', () => {
        const d = db()
        const logs: string[] = []
        const jobs: ImageJob[] = [{ id: 'q', status: 'running', target }, { id: 'e', status: 'error', error: 'boom', target }, { id: 'p', status: 'placed', inlayId: 'pic-1', target }]
        const r = applyPictureJobs(d, jobs, (m) => logs.push(m))
        applyPictureJobs(d, jobs, () => {})
        expect(r.ack).toEqual(['e'])
        expect(logs[0]).toContain('boom')
        expect(d.characters[0].chats[0].message[1].data).toBe('{{inlay::pic-1}}\n\nReply one')
    })
    it('a picture lifts the script\'s cooldown of the chat (it waited for the picture, not for a clock)', () => {
        const d = db()
        d.characters[0].chats[0].scriptstate = { $imagegen_off_until: '1792600000', $other: '5' }
        applyPictureJobs(d, [{ id: 'p', status: 'placed', inlayId: 'pic-1', target }])
        expect(d.characters[0].chats[0].scriptstate).toEqual({ $imagegen_off_until: '0', $other: '5' })
        const bare = { scriptstate: undefined as any }
        liftPictureCooldown(bare)
        expect(bare.scriptstate).toBeUndefined()
    })
    it('a message that is gone, or a picture a redraw replaced, is skipped', () => {
        const d = db()
        const r = applyPictureJobs(d, [
            { id: 'g', status: 'done', inlayId: 'x', target: { ...target, messageId: 'gone' } },
            { id: 's', status: 'done', inlayId: 'old', superseded: true, target },
        ])
        expect(r.skipped).toEqual(['g', 's'])
        expect(d.characters[0].chats[0].message[1].data).toBe('Reply one')
    })
})
