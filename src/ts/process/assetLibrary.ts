// "Từ Asset Manager": the images the owner's cards already hold (every card's additional assets, icon and emotion images) plus any image the
// server stores that no card names, listed so one can be added to the open card without going through the phone's file sheet.
// Pure helpers; the picker (AssetPicker.svelte) and CharConfig.svelte call them.

export type LibItem = {
    path: string      // 'assets/<hash>.<ext>', what a card stores
    ext: string
    name: string      // the label a card gave it, or the short hash
    cards: string[]   // names of the cards that hold it ([] for a stored file no card names)
}

const IMAGE_EXT = ['png', 'webp', 'jpg', 'jpeg', 'gif', 'avif', 'svg']
export const MAX_SHOWN = 120

export function extOf(path: string): string {
    const m = /\.([A-Za-z0-9]+)$/.exec(path ?? '')
    return m ? m[1].toLowerCase() : ''
}

const isLibraryPath = (p: unknown): p is string =>
    typeof p === 'string' && p.startsWith('assets/') && IMAGE_EXT.includes(extOf(p))

type CharLike = {
    name?: string
    image?: string
    additionalAssets?: string[][]
    emotionImages?: string[][]
}

/** Every image path the cards name, then the stored files none of them name. A path appears once; `cards` lists who holds it. */
export function collectLibrary(characters: CharLike[], storedKeys: string[] = []): LibItem[] {
    const byPath = new Map<string, LibItem>()
    const add = (path: unknown, name: string, card: string) => {
        if (!isLibraryPath(path)) return
        let it = byPath.get(path)
        if (!it) {
            it = { path, ext: extOf(path), name: name || shortHash(path), cards: [] }
            byPath.set(path, it)
        }
        if (card && !it.cards.includes(card)) it.cards.push(card)
    }
    for (const c of characters ?? []) {
        const card = String(c?.name ?? '')
        add(c?.image, 'icon', card)
        for (const a of c?.additionalAssets ?? []) add(a?.[1], String(a?.[0] ?? ''), card)
        for (const e of c?.emotionImages ?? []) add(e?.[1], String(e?.[0] ?? ''), card)
    }
    const named = [...byPath.values()]
    const loose: LibItem[] = []
    for (const key of storedKeys ?? []) {
        if (!isLibraryPath(key) || byPath.has(key)) continue
        loose.push({ path: key, ext: extOf(key), name: shortHash(key), cards: [] })
    }
    return [...named, ...loose]
}

function shortHash(path: string): string {
    return path.replace(/^assets\//, '').replace(/\.[A-Za-z0-9]+$/, '').slice(0, 8)
}

/** The items whose name or card matches every word of `q` (case-insensitive); an empty query keeps all. */
export function filterLibrary(items: LibItem[], q: string): LibItem[] {
    const words = String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return items
    return items.filter((it) => {
        const hay = `${it.name} ${it.cards.join(' ')} ${it.ext}`.toLowerCase()
        return words.every((w) => hay.includes(w))
    })
}

/** What Choose Files does for one file, for a stored image: read the bytes, save them as an asset, return the card entry. The save
 *  dedupes by content, so an image the card already stores comes back with the same path. */
export async function entryFromLibrary(
    item: LibItem,
    deps: {
        getItem: (path: string) => Promise<Uint8Array | null | undefined>
        saveAsset: (data: Uint8Array, prefix: string, ext: string) => Promise<string>
    },
): Promise<[string, string, string]> {
    const data = await deps.getItem(item.path)
    if (!data || !data.length) throw new Error(`the asset ${item.path} is empty or gone`)
    const name = /\.[A-Za-z0-9]+$/.test(item.name) ? item.name : `${item.name}.${item.ext}`
    const path = await deps.saveAsset(data, '', item.ext)
    return [name, path, item.ext]
}
