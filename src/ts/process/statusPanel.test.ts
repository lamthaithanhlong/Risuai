// @vitest-environment node

// Runs the story's status-panel script (Lua, after imagegen.lua in one script) in the real Risu scripting engine: the STATUS block the
// model writes is turned into chat variables, and the display hook draws the panel from them. The scripts live in the story
// repository; when they are not next to this checkout the tests skip.

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

const DIR = process.env.STATUS_LUA_DIR ?? resolve(process.cwd(), '../shadow-slave-the-dream-realm/fate-simulator')
const FILES = ['imagegen.lua', 'status.lua'].map((f) => resolve(DIR, f))

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

const ctx = (chat: { message: Msg[] }, mode: string, extra: object = {}) => ({
    char: {} as never,
    chat: chat as never,
    setVar: setVar as never,
    getVar: ((k: string) => vars[k] ?? 'null') as never,
    mode,
    lowLevelAccess: true,
    ...extra,
})

async function output(messages: Msg[]) {
    const chat = { message: messages.map((m) => ({ ...m })) }
    await runScripted(lua, ctx(chat, 'output'))
    return chat.message
}

async function display(messages: Msg[], index: number) {
    const chat = { message: messages.map((m) => ({ ...m })) }
    const r = await runScripted(lua, ctx(chat, 'editDisplay', { data: messages[index].data, meta: { index } }))
    return String(r.res)
}

describe.skipIf(!FILES.every(existsSync))('status panel script', () => {
    beforeAll(async () => {
        lua = (await Promise.all(FILES.map((f) => readFile(f, 'utf8')))).join('\n')
        const jsonLua = await readFile(resolve(process.cwd(), 'public/lua/json.lua'), 'utf8')
        vi.stubGlobal('fetch', vi.fn(async () => new Response(jsonLua, { status: 200 })))
        vi.stubGlobal('Image', class { src = '' })
        runScripted = (await import('./scriptings')).runScripted
        generateAIImage = (await import('./stableDiff')).generateAIImage as never
    })

    beforeEach(() => {
        vars = {}
        setVar = vi.fn((k: string, v: string) => { vars[k] = v; return true })
        generateAIImage.mockReset()
        generateAIImage.mockResolvedValue('data:image/png;base64,AAAA')
    })

    describe('output: the STATUS block becomes variables', () => {
        test('reads each key, keeps the pipe in item and skill values, and removes the block from the message', async () => {
            const out = await output([{ role: 'char', data: 'The door opens.\n\n[[STATUS\nhp: 70\nhpmax: 100\nitem3: Rusty key | opens the cellar door\nskill1: Shadow Step | slips through cover | 2\n]]' }])
            expect(vars).toMatchObject({
                st_hp: '70', st_hpmax: '100',
                st_item3: 'Rusty key | opens the cellar door',
                st_skill1: 'Shadow Step | slips through cover | 2',
            })
            expect(out[0].data).toBe('The door opens.')
        })

        test('ignores unknown keys and keys that are not on the panel', async () => {
            await output([{ role: 'char', data: 'Text.\n[[STATUS\nhp: 5\nsecret_plan: kill them\nitem11: ghost\nname: Mara\n]]' }])
            expect(Object.keys(vars).sort()).toEqual(['st_hp', 'st_name'])
        })

        test('a key set to "-" is cleared, and the key is case-insensitive', async () => {
            vars.st_item2 = 'Old ring'
            await output([{ role: 'char', data: 'Text.\n[[STATUS\nITEM2: -\n]]' }])
            expect(vars.st_item2).toBe('')
        })

        test('a long value is cut to 160 characters', async () => {
            await output([{ role: 'char', data: `Text.\n[[STATUS\nnotes: ${'x'.repeat(400)}\n]]` }])
            expect(vars.st_notes.length).toBe(160)
        })

        test('a reply without a block changes nothing', async () => {
            const out = await output([{ role: 'char', data: 'Plain reply.' }])
            expect(setVar).not.toHaveBeenCalled()
            expect(out[0].data).toBe('Plain reply.')
        })

        test('a user message is not read', async () => {
            const out = await output([{ role: 'user', data: 'x [[STATUS\nhp: 1\n]]' }])
            expect(setVar).not.toHaveBeenCalled()
            expect(out[0].data).toBe('x [[STATUS\nhp: 1\n]]')
        })

        test('two blocks in one reply are both applied and both removed', async () => {
            const out = await output([{ role: 'char', data: 'A\n[[STATUS\nhp: 60\n]]\nB\n[[STATUS\nfatigue: 30\n]]' }])
            expect(vars).toMatchObject({ st_hp: '60', st_fatigue: '30' })
            expect(out[0].data).not.toContain('STATUS')
        })

        test('the STATUS block and the [[img: ...]] line in one reply are both handled', async () => {
            const out = await output([{ role: 'char', data: 'Scene.\n\n[[img: a vaulted stone hall lit by torches]]\n\nMore.\n\n[[STATUS\nhp: 90\n]]' }])
            expect(vars.st_hp).toBe('90')
            expect(generateAIImage).toHaveBeenCalledTimes(1)
            expect(out[0].data).toBe('Scene.\n\n{{inlay::pic1.png}}\n\nMore.')
        })
    })

    describe('dashes: one em dash per reply', () => {
        const run = async (data: string) => (await output([{ role: 'char', data }]))[0].data

        test('the first em dash stays, later ones between two words become commas', async () => {
            expect(await run('It was cold — very cold — and dark — then silent.')).toBe('It was cold — very cold, and dark, then silent.')
        })

        test('works with Vietnamese letters (multi-byte) on both sides', async () => {
            expect(await run('Tôi — anh — em — họ.')).toBe('Tôi — anh, em, họ.')
        })

        test('a dash at the start of a line (dialogue) or after punctuation is never touched', async () => {
            const text = '— Hello.\n— Who is there?\nStop. — Go. — Now.'
            expect(await run(text)).toBe(text)
        })

        test('a reply with no dash, or one dash, is left alone and not rewritten', async () => {
            const msgs: Msg[] = [{ role: 'char', data: 'Plain reply — with one dash.' }]
            const out = await output(msgs)
            expect(out[0].data).toBe('Plain reply — with one dash.')
        })

        test('dashes are tidied together with a STATUS block in the same reply', async () => {
            const out = await run('A — b — c.\n[[STATUS\nhp: 50\n]]')
            expect(out).toBe('A — b, c.')
            expect(vars.st_hp).toBe('50')
        })
    })

    describe('ledger: memory, relations, timeline', () => {
        const led = (body: string): Msg[] => [{ role: 'char', data: `Scene.\n[[LEDGER\n${body}\n]]` }]

        test('a memory is stored, the block is removed, and the same memory is not stored twice', async () => {
            const out = await output(led('mem: Aiko | promised to guide me to the ruins by dawn'))
            expect(vars.led_mem).toBe('Aiko | promised to guide me to the ruins by dawn')
            expect(out[0].data).toBe('Scene.')
            await output(led('mem: AIKO | PROMISED to guide me to the ruins by dawn'))
            expect(vars.led_mem.split('\n').length).toBe(1)
        })

        test('only the newest 16 memories are kept, and each is cut to 120 characters', async () => {
            const body = Array.from({ length: 20 }, (_, i) => `mem: fact number ${i}`).join('\n') + `\nmem: ${'y'.repeat(300)}`
            await output(led(body))
            const lines = vars.led_mem.split('\n')
            expect(lines.length).toBe(16)
            expect(lines[0]).toBe('fact number 5')
            expect(lines[15].length).toBe(120)
        })

        test('forget removes the memories that contain the text', async () => {
            vars.led_mem = 'Aiko | owes me a favor\nBrann | wants the key\nAiko | left at dawn'
            await output(led('forget: AiKo'))
            expect(vars.led_mem).toBe('Brann | wants the key')
        })

        test('a relation is added, the same pair (any case, same order) replaces it, and "-" removes it', async () => {
            await output(led('rel: Aiko | Mara | trusts, owes a favor'))
            expect(vars.led_rel).toBe('Aiko | Mara | trusts, owes a favor')
            await output(led('rel: aiko | MARA | now distrusts her'))
            expect(vars.led_rel).toBe('aiko | MARA | now distrusts her')
            await output(led('rel: Aiko | Brann | rivals'))
            expect(vars.led_rel.split('\n').length).toBe(2)
            await output(led('rel: Aiko | Mara | -'))
            expect(vars.led_rel).toBe('Aiko | Brann | rivals')
        })

        test('a relation with fewer than three parts is ignored', async () => {
            await output(led('rel: Aiko | Mara'))
            expect(vars.led_rel).toBeUndefined()
        })

        test('timeline entries are appended and only the newest 12 are kept', async () => {
            const body = Array.from({ length: 15 }, (_, i) => `event: Day ${i} | something happened`).join('\n')
            await output(led(body))
            const lines = vars.led_ev.split('\n')
            expect(lines.length).toBe(12)
            expect(lines[0]).toBe('Day 3 | something happened')
            expect(lines[11]).toBe('Day 14 | something happened')
        })

        test('a STATUS block and a LEDGER block in one reply are both applied and removed', async () => {
            const out = await output([{ role: 'char', data: 'Scene.\n[[STATUS\nhp: 50\ndate: Day 4, dusk\n]]\n[[LEDGER\nmem: the east gate fell\n]]' }])
            expect(vars).toMatchObject({ st_hp: '50', st_date: 'Day 4, dusk', led_mem: 'the east gate fell' })
            expect(out[0].data).toBe('Scene.')
        })

        test('the panel shows relations, timeline (newest first) and memory, escaped, and appears even with only a ledger', async () => {
            vars = { led_mem: 'Aiko | promised <b>dawn</b>', led_rel: 'Aiko | Mara | trusts', led_ev: 'Day 1 | arrived\nDay 2 | the gate fell' }
            const html = await display([{ role: 'char', data: 'Text.' }], 0)
            expect(html).toContain('Relations')
            expect(html).toContain('Timeline')
            expect(html).toContain('Memory')
            expect(html).toContain('<b>Aiko</b> ↔ <b>Mara</b><br>trusts')
            expect(html.indexOf('the gate fell')).toBeLessThan(html.indexOf('arrived'))
            expect(html).toContain('promised &lt;b&gt;dawn&lt;/b&gt;')
        })

        test('date and place show on the identity card', async () => {
            vars = { st_name: 'Mara', st_date: 'Day 4, dusk', st_place: 'Ash Street cellar' }
            const html = await display([{ role: 'char', data: 'Text.' }], 0)
            expect(html).toContain('Day 4, dusk')
            expect(html).toContain('Ash Street cellar')
        })

        test('a LEDGER block that is still streaming is hidden', async () => {
            vars = { st_name: 'Mara' }
            const html = await display([{ role: 'char', data: 'Text.\n[[LEDGER\nmem: half a thou' }], 0)
            expect(html).not.toContain('LEDGER')
            expect(html).not.toContain('half a thou')
        })
    })

    describe('display: the panel under the latest reply', () => {
        const base: Msg[] = [{ role: 'user', data: 'I wait.' }, { role: 'char', data: 'Night falls.' }]

        test('the latest character reply gets the panel built from the variables', async () => {
            vars = { st_name: 'Mara Quill', st_rank: 'Sleeper', st_hp: '70', st_hpmax: '100', st_item3: 'Rusty key | opens the cellar door' }
            const html = await display(base, 1)
            expect(html.startsWith('Night falls.')).toBe(true)
            expect(html).toContain('<details class="sp">')
            expect(html).toContain('Mara Quill')
            expect(html).toContain('width:70%')
            expect(html).toContain('Rusty key')
            expect(html).toContain('title="opens the cellar door"')
        })

        test('there are always 10 item slots and 6 skill slots, the empty ones dimmed', async () => {
            vars = { st_name: 'Mara', st_item1: 'Torch' }
            const html = await display(base, 1)
            expect((html.match(/class="sp-it(?: sp-dim)?"/g) ?? []).length).toBe(10)
            expect((html.match(/class="sp-it sp-dim"/g) ?? []).length).toBe(9)
            expect((html.match(/class="sp-sk(?: sp-dim)?"/g) ?? []).length).toBe(6)
        })

        test('a skill shows its mastery as three diamonds', async () => {
            vars = { st_name: 'Mara', st_skill1: 'Shadow Step | slips through cover | 2' }
            const html = await display(base, 1)
            expect(html).toContain('◆◆◇')
            expect(html).toContain('slips through cover')
        })

        test('values are escaped and cannot open a tag or a macro', async () => {
            vars = { st_name: '<img src=x onerror=alert(1)>{{user}}', st_notes: '"quote" & <b>bold</b>' }
            const html = await display(base, 1)
            expect(html).not.toContain('<img src=x')
            expect(html).not.toContain('{{user}}')
            expect(html).toContain('&lt;img src=x')
            expect(html).toContain('&#123;&#123;user&#125;&#125;')
            expect(html).toContain('&quot;quote&quot; &amp; &lt;b&gt;bold&lt;/b&gt;')
        })

        test('a meter above its maximum is clamped to 100% and a non-number is empty', async () => {
            vars = { st_name: 'Mara', st_hp: '150', st_hpmax: '100', st_se: 'lots', st_semax: '10' }
            const html = await display(base, 1)
            expect(html).toContain('sp-hp" style="width:100%')
            expect(html).toContain('sp-se" style="width:0%')
        })

        test('an earlier reply, a user message, and a chat with no state get no panel', async () => {
            vars = { st_name: 'Mara' }
            const two: Msg[] = [{ role: 'char', data: 'First.' }, { role: 'user', data: 'Go.' }, { role: 'char', data: 'Second.' }]
            expect(await display(two, 0)).toBe('First.')
            expect(await display(two, 1)).toBe('Go.')
            vars = {}
            expect(await display(two, 2)).toBe('Second.')
        })

        test('when the latest message is the reader\'s own, it gets no panel', async () => {
            vars = { st_name: 'Mara' }
            const msgs: Msg[] = [{ role: 'char', data: 'Reply.' }, { role: 'user', data: 'My turn.' }]
            expect(await display(msgs, 1)).toBe('My turn.')
        })

        test('a block that is still streaming, a finished one, and an unfinished [[img: are hidden', async () => {
            vars = { st_name: 'Mara' }
            const partial = await display([{ role: 'char', data: 'Text.\n\n[[STATUS\nhp: 5' }], 0)
            expect(partial).not.toContain('STATUS')
            expect(partial.startsWith('Text.')).toBe(true)
            const done = await display([{ role: 'char', data: 'Text.\n[[STATUS\nhp: 5\n]]' }], 0)
            expect(done).not.toContain('hp: 5')
            const img = await display([{ role: 'char', data: 'Text.\n[[img: a hall at' }], 0)
            expect(img).not.toContain('[[img')
        })
    })
})
