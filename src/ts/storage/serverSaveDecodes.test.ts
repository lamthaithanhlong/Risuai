import { describe, expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

// the decoder only needs these two from the app (as in risuSaveCorrupt.test.ts)
vi.mock('../globalApi.svelte', () => ({ forageStorage: { getItem: async () => null } }))
vi.mock('./database.svelte', () => ({ getDatabase: () => ({}), presetTemplate: { name: 'preset' } }))

import { decodeRisuSave } from './risuSave'

describe('a save the server wrote decodes in the page', () => {
    const file = process.env.RISU_DECODE_FILE
    it.skipIf(!file || !existsSync(file))('RISU_DECODE_FILE decodes', async () => {
        const db: any = await decodeRisuSave(new Uint8Array(readFileSync(file!)))
        expect(Array.isArray(db.characters)).toBe(true)
    })
})
