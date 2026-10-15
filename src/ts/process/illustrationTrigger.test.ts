// @vitest-environment node

// Runs the story's illustration-fallback trigger script (Lua, mode "output") in the real Risu scripting engine with the image
// provider replaced by a spy. The script lives in the story repository; when it is not next to this checkout the tests skip.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

// [name, path of the Lua script, how its style prompt must start]; ILLUSTRATION_LUA overrides the first path (used to mutation-test)
const SCRIPTS: [string, string, string][] = [
    ['Shadow Slave', process.env.ILLUSTRATION_LUA
        ?? resolve(process.cwd(), '../shadow-slave-the-dream-realm/fate-simulator/imagegen.lua'),
        'Anime-style illustration with a Western dark fantasy flavor'],
    ['Lord of the Mysteries', process.env.ILLUSTRATION_LUA_LOTM
        ?? resolve(process.cwd(), '../lord-of-the-mystery/fate-simulator/imagegen.lua'),
        'Anime-style gothic illustration of Victorian-era England'],
]

vi.mock('../parser/parser.svelte', () => ({ hasher: vi.fn(), risuChatParser: vi.fn() }))
vi.mock('../alert', () => ({
    alertConfirm: vi.fn(), alertError: vi.fn(), alertInput: vi.fn(), alertNormal: vi.fn(), alertSelect: vi.fn(),
}))
vi.mock('../globalApi.svelte', () => ({ fetchNative: vi.fn(), readImage: vi.fn() }))
vi.mock('../tokenizer', () => ({ tokenize: vi.fn() }))
vi.mock('../util', () => ({
    asBuffer: vi.fn(), getPersonaPrompt: vi.fn(), getUserIcon: vi.fn(), getUserName: vi.fn(),
}))
vi.mock('../storage/database.svelte', () => ({
    getCurrentCharacter: vi.fn(() => ({})),
    getCurrentChat: vi.fn(() => ({ message: [] })),
    getDatabase: vi.fn(() => ({ characters: [] })),
    setDatabase: vi.fn(),
}))
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
vi.mock('./stableDiff', () => ({ generateAIImage: vi.fn() }))

type Msg = { role: 'user' | 'char'; data: string }

let runScripted: typeof import('./scriptings').runScripted
let generateAIImage: ReturnType<typeof vi.fn>
let lua = ''
let vars: Record<string, string>
let setVar: ReturnType<typeof vi.fn>

async function reply(messages: Msg[]) {
    const chat = { message: messages.map((m) => ({ ...m })) }
    await runScripted(lua, {
        char: {} as never,
        chat: chat as never,
        setVar: setVar as never,
        getVar: ((k: string) => vars[k] ?? 'null') as never,
        mode: 'output',
        lowLevelAccess: true,
    })
    return chat.message
}

describe.each(SCRIPTS.filter(([, path]) => existsSync(path)))('illustration trigger: %s', (_name, scriptPath, styleStart) => {
    beforeAll(async () => {
        lua = await readFile(scriptPath, 'utf8')
        const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
        vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
        vi.stubGlobal('Image', class { src = '' })
        const scriptings = await import('./scriptings')
        runScripted = scriptings.runScripted
        generateAIImage = (await import('./stableDiff')).generateAIImage as never
    })

    beforeEach(() => {
        vars = {}
        setVar = vi.fn((k: string, v: string) => { vars[k] = v; return true })
        generateAIImage.mockReset()
        generateAIImage.mockResolvedValue('data:image/png;base64,AAAA')
    })

    test('turns the tag into a generated picture, with the world style and negative prompt added', async () => {
        const out = await reply([
            { role: 'user', data: 'I go in.' },
            { role: 'char', data: 'You step into the hall.\n\n[[img: a vaulted stone hall lit by torches, dust in the air]]\n\nA door groans.' },
        ])
        expect(vars.imagegen_last_error).toBeUndefined()
        expect(generateAIImage).toHaveBeenCalledTimes(1)
        const [prompt, , neg, mode] = generateAIImage.mock.calls[0]
        expect(prompt.startsWith(styleStart)).toBe(true)
        expect(prompt).toContain('a vaulted stone hall lit by torches, dust in the air')
        expect(neg).toContain('kimono')
        expect(neg).not.toMatch(/anime/i)
        expect(mode).toBe('inlay')
        expect(out[1].data).toBe('You step into the hall.\n\n{{inlay::pic1.png}}\n\nA door groans.')
    })

    test('blocks East Asian costume by default and allows it only when the description names it', async () => {
        await reply([{ role: 'char', data: 'A [[img: a quiet village street at dusk with lanterns and wooden houses]] b' }])
        expect(generateAIImage.mock.calls[0][2]).toContain('kimono')
        generateAIImage.mockClear()
        await reply([{ role: 'char', data: 'A [[img: Aiko in a plain kimono beside a small shrine at dusk]] b' }])
        const neg = generateAIImage.mock.calls[0][2] as string
        expect(neg).not.toContain('kimono')
        expect(neg).not.toContain('East Asian')
        expect(neg).toContain('photorealistic')
    })

    test('does nothing when there is no tag', async () => {
        const out = await reply([{ role: 'char', data: 'Plain reply.' }])
        expect(generateAIImage).not.toHaveBeenCalled()
        expect(out[0].data).toBe('Plain reply.')
    })

    test('ignores a user message', async () => {
        const out = await reply([{ role: 'user', data: '[[img: a long enough description of a hall]]' }])
        expect(generateAIImage).not.toHaveBeenCalled()
        expect(out[0].data).toBe('[[img: a long enough description of a hall]]')
    })

    test('does not generate when the reply already shows a library image, and removes the tag', async () => {
        const out = await reply([
            { role: 'char', data: '{{image::library.jpg}}\n\nText one.\n\n[[img: a long enough description of a hall]]\n\nText two.' },
        ])
        expect(generateAIImage).not.toHaveBeenCalled()
        expect(out[0].data).toBe('{{image::library.jpg}}\n\nText one.\n\nText two.')
    })

    test('uses only the first tag and removes the others', async () => {
        const out = await reply([
            { role: 'char', data: 'A [[img: first long enough description here]] B [[img: second long enough description]] C' },
        ])
        expect(generateAIImage).toHaveBeenCalledTimes(1)
        expect(generateAIImage.mock.calls[0][0]).toContain('first long enough description here')
        expect(out[0].data).toBe('A\n\n{{inlay::pic1.png}}\n\nB  C')
        expect(out[0].data).not.toContain('second')
    })

    test('at most one generated picture in every three replies', async () => {
        const out = await reply([
            { role: 'char', data: 'Earlier.\n\n{{inlay::old.png}}' },
            { role: 'char', data: 'Middle.' },
            { role: 'char', data: 'Now [[img: a long enough description of a hall]] here.' },
        ])
        expect(generateAIImage).not.toHaveBeenCalled()
        expect(out[2].data).toBe('Now\n\nhere.')
    })

    test('a picture three replies back no longer blocks', async () => {
        await reply([
            { role: 'char', data: '{{inlay::old.png}}' },
            { role: 'char', data: 'Two.' },
            { role: 'char', data: 'Three.' },
            { role: 'char', data: 'Now [[img: a long enough description of a hall]] here.' },
        ])
        expect(generateAIImage).toHaveBeenCalledTimes(1)
    })

    test('skips a description too short to draw', async () => {
        const out = await reply([{ role: 'char', data: 'Text [[img: hall]] more' }])
        expect(generateAIImage).not.toHaveBeenCalled()
        expect(out[0].data).toBe('Text\n\nmore')
    })

    test('a failed generation leaves the text, starts a cooldown, and the next reply does not call the provider', async () => {
        generateAIImage.mockResolvedValue(false)
        const first = await reply([{ role: 'char', data: 'Before [[img: a long enough description of a hall]] after' }])
        expect(generateAIImage).toHaveBeenCalledTimes(1)
        expect(first[0].data).toBe('Before\n\nafter')
        expect(Number(vars.imagegen_off_until)).toBeGreaterThan(Date.now() / 1000)

        generateAIImage.mockClear()
        const second = await reply([{ role: 'char', data: 'Again [[img: another long enough description of a road]] done' }])
        expect(generateAIImage).not.toHaveBeenCalled()
        expect(second[0].data).toBe('Again\n\ndone')
    })

    test('a provider that throws leaves the reply clean and keeps the cooldown', async () => {
        generateAIImage.mockRejectedValue(new Error('network down'))
        const messages: Msg[] = [{ role: 'char', data: 'Before [[img: a long enough description of a hall]] after' }]
        const chat = { message: messages.map((m) => ({ ...m })) }
        await runScripted(lua, {
            char: {} as never, chat: chat as never, setVar: setVar as never,
            getVar: ((k: string) => vars[k] ?? 'null') as never, mode: 'output', lowLevelAccess: true,
        }).catch(() => undefined)
        expect(chat.message[0].data).toBe('Before\n\nafter')
        expect(Number(vars.imagegen_off_until)).toBeGreaterThan(Date.now() / 1000)
    })

    test('a successful picture lifts the cooldown', async () => {
        vars.imagegen_off_until = String(Math.floor(Date.now() / 1000) - 5)
        await reply([{ role: 'char', data: 'Text [[img: a long enough description of a hall]] more' }])
        expect(vars.imagegen_off_until).toBe('0')
    })

    test('a cooldown that has passed allows generation again', async () => {
        vars.imagegen_off_until = String(Math.floor(Date.now() / 1000) - 5)
        await reply([{ role: 'char', data: 'Text [[img: a long enough description of a hall]] more' }])
        expect(generateAIImage).toHaveBeenCalledTimes(1)
    })

    test('caps a very long description', async () => {
        await reply([{ role: 'char', data: `X [[img: ${'word '.repeat(400)}]] Y` }])
        const prompt = generateAIImage.mock.calls[0][0] as string
        expect((prompt.match(/word/g) ?? []).length).toBeLessThanOrEqual(140)   // 700 characters of description at most
    })
})
