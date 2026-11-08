import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import { ParseMarkdown, resetAssetsCache } from '../parser.svelte'

const ASSET_URL = 'data:image/png;base64,abc'

const { CARD } = vi.hoisted(() => ({
    CARD: {
        type: 'character' as const,
        chaId: 'cha-1',
        name: 'Mailman',
        additionalAssets: [['Aki', 'assets/aki.webp', 'webp']] as [string, string, string][],
        emotionImages: [] as [string, string][],
        extentions: {
            vjPortraits: {
                aki: { name: 'Aki', look: 'black hair', status: 'done', at: 1, asset: 'assets/aki.webp' },
            },
        },
        chats: [{}],
        chatPage: 0,
        defaultVariables: '',
        customscript: [],
    },
}))

vi.mock(import('../../storage/database.svelte'), () => ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => CARD,
    getCurrentChat: () => ({ message: [] }),
    getDatabase: () => ({ characters: [CARD] }),
} as typeof import('../../storage/database.svelte')))

vi.mock(import('../../globalApi.svelte'), () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: (loc: string) => Promise.resolve(loc === 'assets/aki.webp' ? 'data:image/png;base64,abc' : ''),
}))

vi.mock(import('../../process/modules'), () => ({
    getModuleAssets: () => [],
    getModules: () => [],
    getModuleToggles: () => '',
}))

vi.mock(import('../../process/scripts'), () => ({
    processScriptFull: async (_c: unknown, data: string) => ({ data, emoChanged: false }),
    processScript: async (_c: unknown, data: string) => data,
}))

vi.mock(import('../../stores.svelte'), () => ({
    DBState: {
        db: {
            characters: [CARD],
            globalChatVariables: {},
            templateDefaultVariables: {},
            hideAllImages: false,
            assetWidth: -1,
            legacyMediaFindings: false,
            assetMaxDifference: 0,
        },
    },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
} as typeof import('../../stores.svelte')))

describe('portrait {{path::}} with simpleCharacterArgument', () => {
    beforeEach(() => {
        resetAssetsCache([], [], [])
    })

    it('resolves an Additional Asset already on the card so the cast strip is not an empty bordered circle', async () => {
        const simple = {
            type: 'simple' as const,
            chaId: 'cha-1',
            customscript: [],
            additionalAssets: CARD.additionalAssets,
            emotionImages: CARD.emotionImages,
        }
        const out = await ParseMarkdown('Aki đứng ở cửa.', simple, 'back', 0)
        expect(out).toContain(`src="${ASSET_URL}"`)
        expect(out).not.toMatch(/src=""/)
        expect(out).toContain('border-radius:50%')
    })
})
