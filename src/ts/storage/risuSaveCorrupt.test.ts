import { describe, expect, it, vi } from 'vitest'

// the decoder only needs these two from the app; mocking them keeps the import cycle out of the test
vi.mock('../globalApi.svelte', () => ({ forageStorage: { getItem: async () => null } }))
vi.mock('./database.svelte', () => ({ getDatabase: () => ({}), presetTemplate: { name: 'preset' } }))

import { decodeRisuSave, RisuSaveCorrupt } from './risuSave'

// block: [type, compressed, nameLen, name, len (u32 le), data]
const MAGIC = Buffer.from('RISUSAVE\0')
function block(type: number, name: string, content: string | object): Buffer {
    const data = Buffer.from(typeof content === 'string' ? content : JSON.stringify(content))
    const len = Buffer.alloc(4)
    len.writeUInt32LE(data.length)
    return Buffer.concat([Buffer.from([type, 0, name.length]), Buffer.from(name), len, data])
}
const CHAR_A = { name: 'Alice', chaId: 'a', chats: [{ message: [], name: 'c', localLore: [], id: 'c1' }], chatPage: 0 }
const CHAR_B = { name: 'Bob', chaId: 'b', chats: [{ message: [], name: 'c', localLore: [], id: 'c2' }], chatPage: 0 }

function file(opts: { directory?: string[], blocks?: Buffer[] } = {}): Uint8Array {
    const root = block(1, 'root', { formatversion: 1, username: 'u', __directory: opts.directory ?? ['ca', 'cb'] })
    const blocks = opts.blocks ?? [block(2, 'ca', CHAR_A), block(2, 'cb', CHAR_B)]
    return new Uint8Array(Buffer.concat([MAGIC, root, ...blocks]))
}

describe('RisuSave decoder rejects a damaged file (specs/core/SaveLoad.tla)', () => {
    it('decodes a complete file with all its characters', async () => {
        const db: any = await decodeRisuSave(file())
        expect(db.characters.map((c: any) => c.name)).toEqual(['Alice', 'Bob'])
    })

    it('rejects a file cut in the middle of the last block instead of loading it without that character', async () => {
        const full = file()
        for (const cut of [1, 5, 40]) {
            await expect(decodeRisuSave(full.slice(0, full.length - cut))).rejects.toBeInstanceOf(RisuSaveCorrupt)
        }
    })

    it('rejects a file cut inside a block header', async () => {
        const root = block(1, 'root', { formatversion: 1, __directory: [] })
        const bytes = new Uint8Array(Buffer.concat([MAGIC, root, Buffer.from([2, 0])]))
        await expect(decodeRisuSave(bytes)).rejects.toBeInstanceOf(RisuSaveCorrupt)
    })

    it('rejects a file whose root lists a block that is not there', async () => {
        const bytes = file({ directory: ['ca', 'cb', 'cc'] })
        await expect(decodeRisuSave(bytes)).rejects.toBeInstanceOf(RisuSaveCorrupt)
    })

    it('rejects a character block that is not valid JSON, which used to be dropped silently', async () => {
        const bytes = file({ blocks: [block(2, 'ca', CHAR_A), block(2, 'cb', '{"name": "Bob", "chats": [')] })
        await expect(decodeRisuSave(bytes)).rejects.toBeInstanceOf(RisuSaveCorrupt)
    })

    it('does not guess an older format for a damaged block-format file', async () => {
        const full = file()
        const err = await decodeRisuSave(full.slice(0, full.length - 3)).catch((e) => e)
        expect(err).toBeInstanceOf(RisuSaveCorrupt)
    })

    it('accepts a file with no directory in the root (older files)', async () => {
        const root = block(1, 'root', { formatversion: 1, username: 'u' })
        const bytes = new Uint8Array(Buffer.concat([MAGIC, root, block(2, 'ca', CHAR_A)]))
        const db: any = await decodeRisuSave(bytes)
        expect(db.characters).toHaveLength(1)
    })

    // found by decoding the real database: pluginStorage is written as an empty block when it is undefined, and a first version of the
    // strict decoder refused every real save, backups included
    it('accepts an empty block for a value that is undefined (pluginStorage in a real save)', async () => {
        const bytes = file({ directory: ['ca', 'cb', 'pluginStorage'], blocks: [block(2, 'ca', CHAR_A), block(2, 'cb', CHAR_B), block(11, 'pluginStorage', '')] })
        const db: any = await decodeRisuSave(bytes)
        expect(db.characters).toHaveLength(2)
    })

    it('but an empty character block is damage', async () => {
        const bytes = file({ blocks: [block(2, 'ca', CHAR_A), block(2, 'cb', '')] })
        await expect(decodeRisuSave(bytes)).rejects.toBeInstanceOf(RisuSaveCorrupt)
    })
})
