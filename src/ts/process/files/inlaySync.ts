// Chat pictures (inlays) on the server, so every device sees them.
//
// An inlay used to live only in the IndexedDB of the browser that drew it: the chat (on the server) said {{inlay::<id>}}, and
// the phone, which never had the picture, showed the raw tag. On the Node server the picture is now also written as the file
// `inlays/<id>` through the same storage the database uses (/api/write, durable save queue); the browser copy stays as a cache.
// Reading: the browser copy first, else the server file, which is then cached. Pictures that exist only in one browser are
// uploaded the next time that browser opens Risu (`uploadPending`), so a picture drawn on the phone reaches the Mac and back.
//
// Everything that touches the outside is passed in, so the rules are tested without a browser or a server.

export type InlayKind = 'image' | 'video' | 'audio'

export type LocalInlay = { data: Blob | string; ext: string; type: InlayKind | 'signature'; name: string; synced?: boolean; width?: number; height?: number }

export interface InlayDeps {
    /** true on the Node server (the only place with a shared file store) */
    remoteEnabled: boolean
    readRemote(key: string): Promise<Uint8Array | null>
    writeRemote(key: string, bytes: Uint8Array): Promise<void>
    readLocal(id: string): Promise<LocalInlay | null>
    writeLocal(id: string, item: LocalInlay): Promise<void>
    listLocal(): Promise<[string, LocalInlay][]>
    log?: (message: string, error?: unknown) => void
}

export const remoteKey = (id: string) => `inlays/${id}`

/** The file type from its first bytes (the server file has no extension): webp, jpeg, png, gif, or a media guess. */
export function sniff(bytes: Uint8Array): { ext: string; mime: string; type: InlayKind } {
    const b = bytes
    const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to))
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp', type: 'image' }
    if (b[0] === 0xff && b[1] === 0xd8) return { ext: 'jpeg', mime: 'image/jpeg', type: 'image' }
    if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return { ext: 'png', mime: 'image/png', type: 'image' }
    if (ascii(0, 3) === 'GIF') return { ext: 'gif', mime: 'image/gif', type: 'image' }
    if (ascii(4, 8) === 'ftyp') return { ext: 'mp4', mime: 'video/mp4', type: 'video' }
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: 'webm', mime: 'video/webm', type: 'video' }
    if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { ext: 'mp3', mime: 'audio/mpeg', type: 'audio' }
    if (ascii(0, 4) === 'OggS') return { ext: 'ogg', mime: 'audio/ogg', type: 'audio' }
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return { ext: 'wav', mime: 'audio/wav', type: 'audio' }
    return { ext: 'png', mime: 'application/octet-stream', type: 'image' }
}

async function toBytes(data: Blob | string): Promise<Uint8Array | null> {
    if (typeof data === 'string') {
        const comma = data.indexOf(',')
        if (!data.startsWith('data:') || comma < 0) return null
        const bin = atob(data.slice(comma + 1))
        const out = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
        return out
    }
    return new Uint8Array(await data.arrayBuffer())
}

/** Writes one picture to the server and marks the browser copy as synced. False when it could not (it is retried next start). */
export async function upload(deps: InlayDeps, id: string, item: LocalInlay): Promise<boolean> {
    if (!deps.remoteEnabled || item.type === 'signature') return false
    try {
        const bytes = await toBytes(item.data)
        if (!bytes || bytes.length === 0) return false
        await deps.writeRemote(remoteKey(id), bytes)
        await deps.writeLocal(id, { ...item, synced: true })
        return true
    } catch (e) {
        deps.log?.(`[inlay] upload of ${id} failed; it stays in this browser and is tried again next start`, e)
        return false
    }
}

/** The picture for an id: the browser copy, else the server file (then cached in the browser). Null when neither has it. */
export async function readInlay(deps: InlayDeps, id: string): Promise<LocalInlay | null> {
    const local = await deps.readLocal(id)
    if (local) return local
    if (!deps.remoteEnabled) return null
    let bytes: Uint8Array | null = null
    try {
        bytes = await deps.readRemote(remoteKey(id))
    } catch (e) {
        deps.log?.(`[inlay] reading ${id} from the server failed`, e)
        return null
    }
    if (!bytes || bytes.length === 0) return null
    const kind = sniff(bytes)
    const item: LocalInlay = { name: id, data: new Blob([bytes as BlobPart], { type: kind.mime }), ext: kind.ext, type: kind.type, synced: true }
    try {
        await deps.writeLocal(id, item)
    } catch { /* the cache is a convenience; the server copy is the one that counts */ }
    return item
}

/** Uploads every browser picture the server does not have yet (not marked synced). Returns how many went up and failed. */
export async function uploadPending(deps: InlayDeps): Promise<{ uploaded: number; failed: number }> {
    if (!deps.remoteEnabled) return { uploaded: 0, failed: 0 }
    let uploaded = 0, failed = 0
    for (const [id, item] of await deps.listLocal()) {
        if (item.synced || item.type === 'signature') continue
        if (await upload(deps, id, item)) uploaded++
        else failed++
    }
    return { uploaded, failed }
}

/**
 * Runs `task` at most once at a time: a call while one is running gets that same run. Used for the upload pass, which a timer,
 * the browser's "online" event and the start can all ask for together.
 */
export function singleFlight<T>(task: () => Promise<T>): () => Promise<T> {
    let running: Promise<T> | null = null
    return () => {
        if (!running) running = task().finally(() => { running = null })
        return running
    }
}
