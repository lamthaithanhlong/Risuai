// @vitest-environment node

// The "illustrate this reply" button: the chat calls the story script's onButtonClick(id, "illustrate:<index>"). The main model is
// replaced by a spy that writes the scene description, the image provider by a spy that returns a picture. The scripts live in the
// story repositories; a script that is not next to this checkout is skipped.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const SCRIPTS: [string, string][] = [
    ['Shadow Slave', process.env.ILLUSTRATE_SS ?? resolve(process.cwd(), '../shadow-slave-the-dream-realm/fate-simulator/imagegen.lua')],
    ['Lord of the Mysteries', process.env.ILLUSTRATE_LOTM ?? resolve(process.cwd(), '../lord-of-the-mystery/fate-simulator/imagegen.lua')],
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
let requestChatData: ReturnType<typeof vi.fn>
let alertError: ReturnType<typeof vi.fn>
let lua = ''

const PASSAGE = 'Rain ran down the cellar steps. A tall woman in a grey cloak stood at the iron door, one hand on the lock, her torch low and smoking.'

async function press(messages: Msg[], data: string) {
    const chat = { message: messages.map((m) => ({ ...m })) }
    await runScripted(lua, {
        char: {} as never, chat: chat as never, setVar: (() => true) as never, getVar: (() => 'null') as never,
        mode: 'onButtonClick', data, lowLevelAccess: true,
    })
    return chat.message
}

describe.each(SCRIPTS.filter(([, path]) => existsSync(path)))('illustrate button: %s', (_name, path) => {
    beforeAll(async () => {
        lua = await readFile(path, 'utf8')
        const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
        vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
        vi.stubGlobal('Image', class { src = '' })
        runScripted = (await import('./scriptings')).runScripted
        generateAIImage = (await import('./stableDiff')).generateAIImage as never
        requestChatData = (await import('./request/request')).requestChatData as never
        alertError = (await import('../alert')).alertError as never
    })

    beforeEach(() => {
        generateAIImage.mockReset()
        generateAIImage.mockResolvedValue('data:image/png;base64,AAAA')
        requestChatData.mockReset()
        requestChatData.mockResolvedValue({ type: 'success', result: 'A rain-soaked cellar stair at night, a tall woman in a grey cloak at an iron door, low smoky torchlight, tense mood.' })
        alertError.mockReset()
    })

    test('the main model describes the scene, the picture is drawn with the story style, and it goes to the top of the reply', async () => {
        const out = await press([{ role: 'user', data: 'I go down.' }, { role: 'char', data: PASSAGE }], 'illustrate:1')
        expect(requestChatData).toHaveBeenCalledTimes(1)
        const asked = requestChatData.mock.calls[0][0].formated[0].content as string
        expect(asked).toContain('ONE visual description')
        expect(asked).toContain(PASSAGE)
        expect(generateAIImage).toHaveBeenCalledTimes(1)
        const [prompt, , neg, mode] = generateAIImage.mock.calls[0]
        expect(prompt).toContain('A rain-soaked cellar stair at night')
        expect(prompt.startsWith('Anime-style')).toBe(true)
        expect(neg).toContain('kimono')
        expect(mode).toBe('inlay')
        expect(out[1].data).toBe(`{{inlay::pic1.png}}\n\n${PASSAGE}`)
        expect(out[0].data).toBe('I go down.')
        expect(alertError).not.toHaveBeenCalled()
    })

    test('pressing it again replaces the picture at the top instead of stacking', async () => {
        const out = await press([{ role: 'char', data: `{{inlay::old.png}}\n\n${PASSAGE}` }], 'illustrate:0')
        expect(out[0].data).toBe(`{{inlay::pic1.png}}\n\n${PASSAGE}`)
    })

    test('a picture in the middle of the message (placed by an [[img: ...]] line) is replaced in place, with no second picture', async () => {
        const out = await press([{ role: 'char', data: `${PASSAGE}\n\n{{inlay::old.png}}\n\nThe door groans.` }], 'illustrate:0')
        expect(out[0].data).toBe(`${PASSAGE}\n\n{{inlay::pic1.png}}\n\nThe door groans.`)
        expect((out[0].data.match(/\{\{inlay::/g) ?? []).length).toBe(1)
    })

    test('with two pictures only the first is replaced', async () => {
        const out = await press([{ role: 'char', data: `{{inlay::a.png}}\n\n${PASSAGE}\n\n{{inlay::b.png}}` }], 'illustrate:0')
        expect(out[0].data).toBe(`{{inlay::pic1.png}}\n\n${PASSAGE}\n\n{{inlay::b.png}}`)
    })

    test('tags, hidden blocks, library images and html are not sent to the main model', async () => {
        const dirty = `{{inlay::x.png}}{{image::lib.jpg}}<b>${PASSAGE}</b>\n[[img: a hall]]\n[[STATUS\nhp: 5\n]]\n[[LEDGER\nmem: secret\n]]`
        await press([{ role: 'char', data: dirty }], 'illustrate:0')
        const asked = requestChatData.mock.calls[0][0].formated[0].content as string
        expect(asked).toContain(PASSAGE)
        for (const bad of ['{{inlay', '{{image', '<b>', '[[img', 'STATUS', 'LEDGER', 'secret']) expect(asked).not.toContain(bad)
    })

    test('a long reply is cut to the last 3000 characters', async () => {
        await press([{ role: 'char', data: `START ${'word '.repeat(1500)}END` }], 'illustrate:0')
        const asked = requestChatData.mock.calls[0][0].formated[0].content as string
        expect(asked).not.toContain('START')
        expect(asked).toContain('END')
        expect(asked.length).toBeLessThan(3500)   // 3000 of the reply plus the instruction
    })

    test('a user message, an unknown index, and another button name do nothing', async () => {
        const msgs: Msg[] = [{ role: 'user', data: PASSAGE }, { role: 'char', data: PASSAGE }]
        expect(await press(msgs, 'illustrate:0')).toEqual(msgs)
        expect(await press(msgs, 'illustrate:9')).toEqual(msgs)
        expect(await press(msgs, 'something-else')).toEqual(msgs)
        expect(requestChatData).not.toHaveBeenCalled()
        expect(generateAIImage).not.toHaveBeenCalled()
    })

    test('a reply that is too short says so and spends nothing', async () => {
        const out = await press([{ role: 'char', data: 'Short.' }], 'illustrate:0')
        expect(out[0].data).toBe('Short.')
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(requestChatData).not.toHaveBeenCalled()
    })

    test('when the main model fails the reader is told and the reply is untouched', async () => {
        requestChatData.mockResolvedValue({ type: 'fail', result: 'rate limited' })
        const out = await press([{ role: 'char', data: PASSAGE }], 'illustrate:0')
        expect(out[0].data).toBe(PASSAGE)
        expect(alertError.mock.calls[0][0]).toContain('Could not describe the scene')
        expect(alertError.mock.calls[0][0]).toContain('rate limited')
        expect(generateAIImage).not.toHaveBeenCalled()
    })

    test('an empty description is refused', async () => {
        requestChatData.mockResolvedValue({ type: 'success', result: '  "" ' })
        const out = await press([{ role: 'char', data: PASSAGE }], 'illustrate:0')
        expect(out[0].data).toBe(PASSAGE)
        expect(alertError).toHaveBeenCalledTimes(1)
        expect(generateAIImage).not.toHaveBeenCalled()
    })

    test('when the image provider fails the reply is untouched', async () => {
        generateAIImage.mockResolvedValue(false)
        const out = await press([{ role: 'char', data: PASSAGE }], 'illustrate:0')
        expect(out[0].data).toBe(PASSAGE)
    })

    test('East Asian costume is blocked unless the description names it', async () => {
        await press([{ role: 'char', data: PASSAGE }], 'illustrate:0')
        expect(generateAIImage.mock.calls[0][2]).toContain('kimono')
        generateAIImage.mockClear()
        requestChatData.mockResolvedValue({ type: 'success', result: 'A young woman in a plain kimono beside a small shrine at dusk, lantern light.' })
        await press([{ role: 'char', data: PASSAGE }], 'illustrate:0')
        expect(generateAIImage.mock.calls[0][2]).not.toContain('kimono')
    })

    test('the description is cleaned: one line, no quotes, cut to 700 characters', async () => {
        requestChatData.mockResolvedValue({ type: 'success', result: `"${'a hall of stone. '.repeat(80)}\nsecond line"` })
        await press([{ role: 'char', data: PASSAGE }], 'illustrate:0')
        const prompt = generateAIImage.mock.calls[0][0] as string
        expect(prompt).not.toContain('\n')
        expect(prompt).not.toMatch(/"a hall/)
        expect((prompt.match(/a hall of stone\./g) ?? []).length).toBeLessThanOrEqual(41)   // 700 characters of 17-character sentences
    })
})
