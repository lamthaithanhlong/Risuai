import { describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

// Measured 2026-10-20 on the owner's phone (LAN page): "Error while parsing chat message: … undefined is not an object
// (evaluating 'e.type')" in processScriptFull's editdisplay branch: getCurrentCharacter() is undefined while the page reloads the
// save after another client's write (selectedCharID points at nothing for a moment), and .type was read outside the try.
const state = { current: undefined as unknown, runs: 0 }
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => ({ presetRegex: [] }), getCurrentCharacter: () => state.current, getCurrentChat: () => undefined }))
vi.mock('./scriptings', () => ({ runLuaEditTrigger: async (_c: unknown, _m: unknown, d: string) => d }))
vi.mock('./triggers', () => ({ runTrigger: async (_c: unknown, _t: unknown, a: { displayData: string }) => { state.runs++; return { displayData: a.displayData + ' [panel]' } } }))
vi.mock('../plugins/plugins.svelte', () => ({ pluginV2: { editdisplay: new Set(), editinput: new Set(), editoutput: new Set(), editprocess: new Set() } }))
vi.mock('./modules', () => ({ getModuleRegexScripts: () => [], getModuleAssets: () => [] }))
vi.mock('../parser/parser.svelte', () => ({ risuChatParser: (d: string) => d, assetRegex: /\{\{asset::([^}]*)\}\}/g }))
vi.mock('../stores.svelte', () => ({ selectedCharID: writable(-1), CharEmotion: writable({}) }))
vi.mock('../alert', () => ({ alertError: () => {}, alertNormal: () => {} }))
vi.mock('../globalApi.svelte', () => ({ downloadFile: async () => {} }))
vi.mock('../util', () => ({ selectSingleFile: async () => null }))
vi.mock('src/lang', () => ({ language: {} }))
vi.mock('./memory/hypamemory', () => ({ HypaProcesser: class {} }))

describe('processScriptFull editdisplay', async () => {
    const { processScriptFull } = await import('./scripts')
    const char = { type: 'character', chaId: 'x', customscript: [] }
    it('does not throw when no character is selected (the page is reloading the save)', async () => {
        state.current = undefined; state.runs = 0
        const out = await processScriptFull(char as never, 'Mưa rơi.', 'editdisplay', 3)
        expect(out.data).toBe('Mưa rơi.')
        expect(state.runs).toBe(0)
    })
    it('still runs the display trigger for the selected character', async () => {
        state.current = char; state.runs = 0
        const out = await processScriptFull(char as never, 'Mưa rơi.', 'editdisplay', 4)
        expect(out.data).toBe('Mưa rơi. [panel]')
        expect(state.runs).toBe(1)
    })
})
