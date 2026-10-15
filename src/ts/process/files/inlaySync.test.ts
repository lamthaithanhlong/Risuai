import { describe, expect, it } from 'vitest'
import { readInlay, remoteKey, singleFlight, sniff, upload, uploadPending, type InlayDeps, type LocalInlay } from './inlaySync'

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 4, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2, 3])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9])

/** Two browsers sharing one server: each has its own local store. */
function world() {
    const server = new Map<string, Uint8Array>()
    let failWrites = 0
    const device = (remoteEnabled = true) => {
        const local = new Map<string, LocalInlay>()
        const logs: string[] = []
        const deps: InlayDeps = {
            remoteEnabled,
            readRemote: async (k) => server.get(k) ?? null,
            writeRemote: async (k, b) => { if (failWrites > 0) { failWrites--; throw new Error('connection reset') } server.set(k, b) },
            readLocal: async (id) => local.get(id) ?? null,
            writeLocal: async (id, item) => { local.set(id, item) },
            listLocal: async () => [...local.entries()],
            log: (m) => logs.push(m),
        }
        return { deps, local, logs }
    }
    return { server, device, failNext: (n: number) => { failWrites = n } }
}

const pic = (bytes: Uint8Array, extra: Partial<LocalInlay> = {}): LocalInlay =>
    ({ name: 'p', data: new Blob([bytes as BlobPart], { type: 'image/webp' }), ext: 'webp', type: 'image', ...extra })

describe('sniff', () => {
    it('tells the picture type from its first bytes', () => {
        expect(sniff(WEBP)).toMatchObject({ ext: 'webp', type: 'image' })
        expect(sniff(JPEG)).toMatchObject({ ext: 'jpeg', type: 'image' })
        expect(sniff(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toMatchObject({ ext: 'png' })
        expect(sniff(new Uint8Array([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]))).toMatchObject({ ext: 'mp4', type: 'video' })
    })
})

describe('a picture drawn on one device shows on another', () => {
    it('the Mac draws, uploads; the phone reads it from the server and caches it', async () => {
        const w = world(), mac = w.device(), phone = w.device()
        mac.local.set('a', pic(WEBP))
        expect(await upload(mac.deps, 'a', mac.local.get('a')!)).toBe(true)
        expect(w.server.get(remoteKey('a'))).toEqual(WEBP)
        expect(mac.local.get('a')!.synced).toBe(true)

        const got = await readInlay(phone.deps, 'a')
        expect(got?.ext).toBe('webp')
        expect(new Uint8Array(await (got!.data as Blob).arrayBuffer())).toEqual(WEBP)
        expect(phone.local.has('a')).toBe(true)              // cached: the next read does not go to the server
        w.server.clear()
        expect(await readInlay(phone.deps, 'a')).not.toBe(null)
    })
    it('the browser copy wins when there is one', async () => {
        const w = world(), mac = w.device()
        mac.local.set('a', pic(JPEG, { ext: 'jpeg' }))
        w.server.set(remoteKey('a'), WEBP)
        expect((await readInlay(mac.deps, 'a'))?.ext).toBe('jpeg')
    })
    it('neither has it: null (the tag stays, nothing breaks)', async () => {
        const w = world()
        expect(await readInlay(w.device().deps, 'missing')).toBe(null)
    })
    it('not on the Node server (Tauri, web): no server reads or writes at all', async () => {
        const w = world(), d = w.device(false)
        d.local.set('a', pic(WEBP))
        expect(await upload(d.deps, 'a', d.local.get('a')!)).toBe(false)
        expect(w.server.size).toBe(0)
        expect(await uploadPending(d.deps)).toEqual({ uploaded: 0, failed: 0 })
    })
})

describe('pictures that exist in only one browser', () => {
    it('go up at the next start; synced ones and signatures are skipped', async () => {
        const w = world(), phone = w.device()
        phone.local.set('old1', pic(WEBP))
        phone.local.set('old2', { ...pic(JPEG), data: 'data:image/jpeg;base64,' + btoa(String.fromCharCode(...JPEG)) })   // stored as base64 by older builds
        phone.local.set('done', pic(WEBP, { synced: true }))
        phone.local.set('sig', { name: 's', data: '{}', ext: 'json', type: 'signature' })
        expect(await uploadPending(phone.deps)).toEqual({ uploaded: 2, failed: 0 })
        expect(w.server.get(remoteKey('old2'))).toEqual(JPEG)
        expect(w.server.has(remoteKey('done'))).toBe(false)
        expect(w.server.has(remoteKey('sig'))).toBe(false)
    })
    it('a failed upload keeps the picture local, unsynced, logged, and the next start sends it', async () => {
        const w = world(), mac = w.device()
        mac.local.set('a', pic(WEBP))
        w.failNext(1)
        expect(await uploadPending(mac.deps)).toEqual({ uploaded: 0, failed: 1 })
        expect(mac.local.get('a')!.synced).toBeUndefined()
        expect(mac.logs[0]).toContain('tried again next start')
        expect(await uploadPending(mac.deps)).toEqual({ uploaded: 1, failed: 0 })
        expect(w.server.get(remoteKey('a'))).toEqual(WEBP)
    })
})

describe('the retry pass', () => {
    it('runs one pass at a time: calls during a pass share it', async () => {
        let runs = 0
        let release!: () => void
        const pass = singleFlight(() => { runs++; return new Promise<number>((r) => { release = () => r(runs) }) })
        const a = pass(), b = pass()
        release()
        expect(await a).toBe(1)
        expect(await b).toBe(1)
        expect(runs).toBe(1)
        const c = pass(); release()
        expect(await c).toBe(2)                          // a new pass once the first is done
    })
    it('a failed upload goes up on the next pass while the app stays open (no restart needed)', async () => {
        const w = world(), mac = w.device()
        mac.local.set('a', pic(WEBP))
        w.failNext(1)
        expect(await upload(mac.deps, 'a', mac.local.get('a')!)).toBe(false)   // at draw time
        expect(await uploadPending(mac.deps)).toEqual({ uploaded: 1, failed: 0 })   // the timer's pass
    })
})

