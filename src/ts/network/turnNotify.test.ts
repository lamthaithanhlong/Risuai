// @vitest-environment node
// server/node/turnNotify.cjs: a push to the phone once per ended turn, only the card's name and the outcome.
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const { createTurnNotifier } = createRequire(import.meta.url)('../../../server/node/turnNotify.cjs')

const turn = { key: 'chat-1:abcdefgh-1', cha: 'c1', kind: 'send' }
function fake() {
    const calls: { url: string, body: any }[] = []
    return { calls, fetch: async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200 } } }
}

describe('turnNotify', () => {
    it('saved and failed each push once, as ntfy JSON to the server root with the topic in the body', async () => {
        const f = fake()
        const n = createTurnNotifier({ url: 'https://ntfy.sh/risu-abc', click: 'https://10.0.0.164:6443/', fetch: f.fetch, nameOf: () => 'Thảm Họa Zombie', log: () => {} })
        expect(await n.onState(turn, 'saved')).toBe(true)
        expect(await n.onState(turn, 'saved')).toBe(false)                // the same end again: no second push
        expect(await n.onState(turn, 'retrying')).toBe(false)             // a retry is not an end
        expect(await n.onState({ ...turn, key: 'chat-1:abcdefgh-2' }, 'failed')).toBe(true)
        expect(f.calls.map((c) => c.url)).toEqual(['https://ntfy.sh/', 'https://ntfy.sh/'])
        expect(f.calls[0].body).toMatchObject({ topic: 'risu-abc', title: 'Thảm Họa Zombie: xong lượt', click: 'https://10.0.0.164:6443/' })
        expect(f.calls[1].body.title).toBe('Thảm Họa Zombie: lượt không xong')
    })
    it('never sends the story: the message is fixed text', async () => {
        const f = fake()
        const n = createTurnNotifier({ url: 'https://ntfy.sh/t', fetch: f.fetch, nameOf: () => 'X', log: () => {} })
        await n.onState({ ...turn, input: { text: 'bí mật của truyện' } }, 'saved')
        expect(JSON.stringify(f.calls[0].body)).not.toContain('bí mật')
    })
    it('off without a URL', async () => {
        const f = fake()
        const n = createTurnNotifier({ url: '', fetch: f.fetch })
        expect(n.enabled).toBe(false)
        expect(await n.onState(turn, 'saved')).toBe(false)
        expect(f.calls).toHaveLength(0)
    })
})

describe('turnNotify settings (notify.json)', () => {
    const { saveNotifyConfig, splitNotifyConfig, notifyConfig } = createRequire(import.meta.url)('../../../server/node/turnNotify.cjs')
    const os = createRequire(import.meta.url)('node:os')
    const path = createRequire(import.meta.url)('node:path')
    const fs = createRequire(import.meta.url)('node:fs')
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tn-')), 'notify.json')
    it('saves what the settings page sends and reads it back split', () => {
        saveNotifyConfig({ server: 'https://ntfy.sh/', topic: 'risu-abcdef12', click: 'https://10.0.0.164:6443/' }, file)
        expect(notifyConfig(file)).toEqual({ url: 'https://ntfy.sh/risu-abcdef12', click: 'https://10.0.0.164:6443/' })
        expect(splitNotifyConfig(notifyConfig(file))).toEqual({ server: 'https://ntfy.sh', topic: 'risu-abcdef12', click: 'https://10.0.0.164:6443/', enabled: true })
    })
    it('refuses a bad topic or server, and an empty one turns it off', () => {
        expect(() => saveNotifyConfig({ server: 'https://ntfy.sh', topic: 'a b' }, file)).toThrow(TypeError)
        expect(() => saveNotifyConfig({ server: 'ntfy.sh', topic: 'risu-abcdef12' }, file)).toThrow(TypeError)
        saveNotifyConfig({ server: '', topic: '' }, file)
        expect(splitNotifyConfig(notifyConfig(file)).enabled).toBe(false)
    })
    it('the notifier reads the file at each push: a change in Settings needs no restart', async () => {
        const calls: string[] = []
        const n = createTurnNotifier({ file, fetch: async (u: string) => { calls.push(u); return { ok: true, status: 200 } }, log: () => {} })
        expect(await n.onState(turn, 'saved')).toBe(false)               // off
        saveNotifyConfig({ server: 'https://ntfy.sh', topic: 'risu-abcdef12' }, file)
        expect(n.enabled).toBe(true)
        expect(await n.onState({ ...turn, key: 'chat-1:abcdefgh-9' }, 'saved')).toBe(true)
        expect(calls).toEqual(['https://ntfy.sh/'])
    })
})
