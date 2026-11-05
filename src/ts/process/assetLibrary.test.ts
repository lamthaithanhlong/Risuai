// @vitest-environment node
// The asset picker's helpers (assetLibrary.ts): what the library lists, how it filters, and the entry it hands the card.
import { describe, expect, it } from 'vitest'
import { collectLibrary, entryFromLibrary, extOf, filterLibrary } from './assetLibrary'

const chars = [
    { name: 'Zombie', image: 'assets/aaa11111.webp', additionalAssets: [['kenji.png', 'assets/bbb22222.png', 'png'], ['theme.mp3', 'assets/ccc33333.mp3', 'mp3']] },
    { name: 'Mailman', image: 'assets/aaa11111.webp', additionalAssets: [['Kenji portrait', 'assets/bbb22222.png', 'png']], emotionImages: [['happy', 'assets/ddd44444.jpg']] },
]

describe('collectLibrary', () => {
    it('lists each image path once, with every card that holds it, and skips audio and non-asset paths', () => {
        const lib = collectLibrary([...chars, { name: 'X', image: 'https://x/y.png', additionalAssets: [['f.ttf', 'assets/eee55555.ttf', 'ttf']] }])
        expect(lib.map((i) => i.path)).toEqual(['assets/aaa11111.webp', 'assets/bbb22222.png', 'assets/ddd44444.jpg'])
        expect(lib[0].cards).toEqual(['Zombie', 'Mailman'])
        expect(lib[1].name).toBe('kenji.png')       // the first card's label wins
        expect(lib[1].cards).toEqual(['Zombie', 'Mailman'])
    })
    it('adds stored images no card names, labelled by a short hash, after the named ones', () => {
        const lib = collectLibrary(chars, ['assets/bbb22222.png', 'assets/f0f0f0f0f0f0.png', 'assets/notes.txt', 'database/x'])
        expect(lib.map((i) => i.path)).toEqual(['assets/aaa11111.webp', 'assets/bbb22222.png', 'assets/ddd44444.jpg', 'assets/f0f0f0f0f0f0.png'])
        expect(lib[3]).toMatchObject({ name: 'f0f0f0f0', cards: [] })
    })
    it('survives cards with no assets', () => {
        expect(collectLibrary([{ name: 'A' }, {} as never], [])).toEqual([])
    })
})

describe('filterLibrary', () => {
    const lib = collectLibrary(chars)
    it('matches every word against the name, the cards and the extension', () => {
        expect(filterLibrary(lib, 'kenji').map((i) => i.path)).toEqual(['assets/bbb22222.png'])
        expect(filterLibrary(lib, 'mailman jpg').map((i) => i.path)).toEqual(['assets/ddd44444.jpg'])
        expect(filterLibrary(lib, 'zombie mailman').length).toBe(2)
        expect(filterLibrary(lib, 'nothing')).toEqual([])
    })
    it('an empty query keeps everything', () => {
        expect(filterLibrary(lib, '  ')).toBe(lib)
    })
})

describe('entryFromLibrary', () => {
    it('reads the stored bytes and saves them like Choose Files, returning [name, path, ext]', async () => {
        const saved: unknown[] = []
        const e = await entryFromLibrary(
            { path: 'assets/bbb22222.png', ext: 'png', name: 'kenji.png', cards: ['Zombie'] },
            { getItem: async () => new Uint8Array([1, 2, 3]), saveAsset: async (d, p, x) => { saved.push([d.length, p, x]); return 'assets/new.png' } },
        )
        expect(e).toEqual(['kenji.png', 'assets/new.png', 'png'])
        expect(saved).toEqual([[3, '', 'png']])
    })
    it('names a hash-labelled image with its extension', async () => {
        const e = await entryFromLibrary(
            { path: 'assets/f0f0f0f0.webp', ext: 'webp', name: 'f0f0f0f0', cards: [] },
            { getItem: async () => new Uint8Array([9]), saveAsset: async () => 'assets/f0f0f0f0.webp' },
        )
        expect(e[0]).toBe('f0f0f0f0.webp')
    })
    it('refuses a missing or empty asset instead of saving nothing', async () => {
        await expect(entryFromLibrary(
            { path: 'assets/gone.png', ext: 'png', name: 'gone', cards: [] },
            { getItem: async () => null, saveAsset: async () => 'x' },
        )).rejects.toThrow(/empty or gone/)
    })
})

describe('extOf', () => {
    it('lowercases the extension and gives "" when there is none', () => {
        expect(extOf('assets/A.PNG')).toBe('png')
        expect(extOf('assets/noext')).toBe('')
    })
})
