// @vitest-environment node

// A picture never holds a message turn (owner, 2026-10-20: "generate hình trong risu nên để 1 pipeline riêng biệt xử lý không theo pipeline
// của generate message"). The story's output trigger (Lua, mode "output") asks for a picture with generateImage(...):await(), and the turn
// awaits that trigger (index.svelte.ts sendChat). Run in the real scripting engine with the server's picture queue replaced by a fake that
// is slow, never answers, or fails: the trigger must come back at once, with the picture filed for the reply's message id.
// Before: the trigger sat in waitImageJob (a poll every 2 s, up to 10 minutes) and a failed picture raised an alert, which the server's
// turn worker takes for a failed turn (alert.ts noteTurnError -> turnWorkerPage.ts) and runs again (tests/images/repro.mjs, `fail`).

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const MAILMAN = process.env.MAILMAN_LUA ?? resolve(process.cwd(), '../nguoi-dua-thu-khung-bo/fate-simulator/imagegen.lua')

// the shape of imagegen.lua's output trigger, without its style text: the tag out of the message at once, the picture awaited, the
// result handled the same three ways (a picture, "a newer picture was asked", anything else is an error note)
const MINI_LUA = `
onOutput = async(function(triggerId)
    local last = getChat(triggerId, -1)
    if last == nil or last.role ~= "char" then return end
    local s, e, prompt = string.find(last.data, "%[%[img:%s*(.-)%]%]")
    if s == nil then return end
    setChat(triggerId, -1, string.sub(last.data, 1, s - 1) .. string.sub(last.data, e + 1))
    setChatVar(triggerId, "imagegen_off_until", tostring(os.time() + 600))
    local result = generateImage(triggerId, prompt, "ugly"):await()
    if type(result) == "string" and string.find(result, "{{inlay::", 1, true) == 1 then
        setChatVar(triggerId, "imagegen_off_until", "0")
        setChat(triggerId, -1, result .. "\\n\\n" .. getChat(triggerId, -1).data)
    else
        setChatVar(triggerId, "imagegen_last_error", tostring(result))
    end
end)
`

vi.mock('../parser/parser.svelte', () => ({ hasher: vi.fn(), risuChatParser: vi.fn() }))
vi.mock('../alert', () => ({
    alertConfirm: vi.fn(), alertError: vi.fn(), alertInput: vi.fn(), alertNormal: vi.fn(), alertSelect: vi.fn(),
}))
vi.mock('../globalApi.svelte', () => ({ fetchNative: vi.fn(), readImage: vi.fn() }))
vi.mock('../tokenizer', () => ({ tokenize: vi.fn() }))
vi.mock('../util', () => ({
    asBuffer: vi.fn(), getPersonaPrompt: vi.fn(), getUserIcon: vi.fn(), getUserName: vi.fn(),
}))
const db = { characters: [] as unknown[], sdProvider: 'openai-compat', openaiCompatImage: { url: 'http://localhost:20128/v1/images/generations', key: 'k', model: 'm' } }
vi.mock('../storage/database.svelte', () => ({
    getCurrentCharacter: vi.fn(() => ({})),
    getCurrentChat: vi.fn(() => ({ message: [] })),
    getDatabase: vi.fn(() => db),
    setDatabase: vi.fn(),
}))
vi.mock('../storage/nodeStorage', () => ({ getNodeServerProxyAuth: async () => 'tok' }))
vi.mock('../stores.svelte', () => ({
    DBState: { db: {} },
    ReloadChatPointer: { update: vi.fn() },
    ReloadGUIPointer: { update: vi.fn() },
    selectedCharID: { subscribe: (run: (value: number) => void) => (run(0), () => undefined) },
}))
vi.mock('./modules', () => ({ getModuleLorebooks: vi.fn(() => []), getModuleTriggers: vi.fn(() => []) }))
vi.mock('./files/inlays', () => ({ getInlayAsset: vi.fn(), writeInlayImage: vi.fn(async () => 'pic1.png') }))
vi.mock('./lorebook.svelte', () => ({ loadLoreBookV3Prompt: vi.fn() }))
vi.mock('./memory/hypamemory', () => ({ HypaProcesser: vi.fn() }))
vi.mock('./request/request', () => ({ requestChatData: vi.fn() }))
vi.mock('./portraitsPage', () => ({ sceneReferences: vi.fn(async (_r: unknown, prompt: string) => ({ prompt, images: [] })), currentRoom: vi.fn() }))
vi.mock('./pictureWatch.svelte', () => ({ pictureFiled: vi.fn() }))
vi.mock('./stableDiff', () => ({
    generateAIImage: vi.fn(),
    openaiCompatImageRequest: vi.fn((prompt: string) => ({ url: 'http://localhost:20128/v1/images/generations', key: 'k', body: { prompt }, models: ['m'] })),
}))

type Msg = { role: 'user' | 'char'; data: string; chatId?: string }
type Posted = { target: Record<string, unknown>; key: string; request: { body: { prompt: string } } }

let runScripted: typeof import('./scriptings').runScripted
let generateAIImage: ReturnType<typeof vi.fn>
let alertError: ReturnType<typeof vi.fn>
let jsonLua = ''
let posted: Posted[]
let polls: number
/** how the fake server answers the request: 'ok' (filed), 'down' (the queue is not there) */
let serverMode: 'ok' | 'down'
let vars: Record<string, string>

beforeAll(async () => {
    jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
    ;(globalThis as { __NODE__?: boolean }).__NODE__ = true
    vi.stubGlobal('Image', class { src = '' })
    runScripted = (await import('./scriptings')).runScripted
    generateAIImage = (await import('./stableDiff')).generateAIImage as never
    alertError = (await import('../alert')).alertError as never
})

beforeEach(() => {
    posted = []; polls = 0; serverMode = 'ok'; vars = {}
    generateAIImage.mockReset(); generateAIImage.mockResolvedValue('data:image/png;base64,AAAA')
    alertError.mockReset()
    vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
        const u = String(input)
        const json = (data: unknown, status = 200) => ({ ok: status < 300, status, json: async () => data })
        if (/json\.lua/.test(u)) return new Response(jsonLua, { status: 200 })
        if (u === '/api/image-jobs' && init?.method === 'POST') {
            if (serverMode === 'down') return json({ error: 'image jobs unavailable' }, 503)
            posted.push(JSON.parse(String(init.body)))
            return json({ id: 'job-1', existing: false })
        }
        // any poll of a job: the picture is "being drawn" for ever (a slow router)
        if (/^\/api\/image-jobs\//.test(u)) { polls++; return json({ id: 'job-1', status: 'running' }) }
        return json({}, 404)
    }))
})

async function trigger(lua: string, messages: Msg[]) {
    const chat = { id: 'chat-1', message: messages.map((m) => ({ ...m })) }
    const setVar = (k: string, v: string) => { vars[k] = v; return true }
    const t0 = Date.now()
    // a trigger that is still waiting for the picture after this long is held by it
    const outcome = await Promise.race([
        runScripted(lua, { char: { chaId: 'cha-1', chatPage: 0 } as never, chat: chat as never, setVar: setVar as never, getVar: ((k: string) => vars[k] ?? 'null') as never, mode: 'output', lowLevelAccess: true }).then(() => 'returned'),
        new Promise<string>((r) => setTimeout(() => r('still waiting for the picture'), 3000)),
    ])
    return { outcome, ms: Date.now() - t0, messages: chat.message }
}

const reply = [
    { role: 'user' as const, data: 'I knock.', chatId: 'u-1' },
    { role: 'char' as const, data: 'The door opens. [[img: a narrow rainy corridor at night, a lone postman under a red lantern]] He steps in.', chatId: 'm-7' },
]

describe('a picture does not hold the output trigger of a message turn', () => {
    test('the trigger returns at once while the picture is still being drawn, with the picture filed for the reply by message id and key', async () => {
        const r = await trigger(MINI_LUA, reply)
        expect(r.outcome).toBe('returned')
        expect(r.ms).toBeLessThan(2500)
        expect(posted).toHaveLength(1)
        expect(posted[0].target).toMatchObject({ charId: 'cha-1', chatId: 'chat-1', messageId: 'm-7', slot: 'main' })
        expect(posted[0].key).toBe('cha-1|chat-1|m-7|main')               // chat + message + slot: asking again is the same picture
        expect(polls).toBe(0)                                               // nobody waits on the job
        expect(generateAIImage).not.toHaveBeenCalled()                      // not drawn in the page either
        // the tag is out of the message, no picture yet (it arrives later, by id), nothing was shown as an error
        expect(r.messages[1].data).toBe('The door opens.  He steps in.')
        expect(alertError).not.toHaveBeenCalled()
        expect(vars.imagegen_off_until).not.toBe('0')                       // the script's cooldown stays until the picture lands (the page lifts it)
    })

    test('a redraw (an index: the illustrate button) is a new key, so it replaces rather than finds the first picture', async () => {
        const lua = `onButtonClick = async(function(id, data) local r = generateImage(id, "a hall", "x", 1):await() end)`
        const chat = { id: 'chat-1', message: reply.map((m) => ({ ...m })) }
        await runScripted(lua, { char: { chaId: 'cha-1', chatPage: 0 } as never, chat: chat as never, setVar: (() => true) as never, getVar: (() => 'null') as never, mode: 'onButtonClick', data: 'illustrate:1', lowLevelAccess: true })
        await runScripted(lua, { char: { chaId: 'cha-1', chatPage: 0 } as never, chat: chat as never, setVar: (() => true) as never, getVar: (() => 'null') as never, mode: 'onButtonClick', data: 'illustrate:1', lowLevelAccess: true })
        expect(posted).toHaveLength(2)
        expect(posted[0].key).toMatch(/^cha-1\|chat-1\|m-7\|main#/)
        expect(posted[1].key).not.toBe(posted[0].key)
    })

    test('the queue being away is not a turn error either: the picture is drawn in the page as before, and nothing raises an alert', async () => {
        serverMode = 'down'
        const r = await trigger(MINI_LUA, reply)
        expect(r.outcome).toBe('returned')
        expect(alertError).not.toHaveBeenCalled()
        expect(generateAIImage).toHaveBeenCalledTimes(1)
        expect(r.messages[1].data).toBe('{{inlay::pic1.png}}\n\nThe door opens.  He steps in.')
    })
})

describe.skipIf(!existsSync(MAILMAN))('the Mailman card\'s own imagegen.lua', () => {
    test('its output trigger files the picture and returns while the picture is still being drawn', async () => {
        const lua = await readFile(MAILMAN, 'utf8')
        const r = await trigger(lua, reply)
        expect(r.outcome).toBe('returned')
        expect(posted).toHaveLength(1)
        expect(posted[0].key).toBe('cha-1|chat-1|m-7|main')
        expect(posted[0].request.body.prompt).toContain('a narrow rainy corridor at night')
        expect(alertError).not.toHaveBeenCalled()
        expect(r.messages[1].data).not.toContain('[[img:')
    })
})
