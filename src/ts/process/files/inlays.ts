import localforage from "localforage";
import { v4 } from "uuid";
import { getImageType } from "src/ts/media";
import { getDatabase } from "../../storage/database.svelte";
import { getModelInfo, LLMFlags, LLMFormat } from "src/ts/model/modellist";
import { asBuffer } from "../../util";
import { isNodeServer } from "src/ts/platform";
import { readInlay, singleFlight, upload, uploadPending, type InlayDeps, type LocalInlay } from "./inlaySync";

export type InlayAsset = {
    data: string | Blob
    /** File extension */
    ext: string
    height?: number
    name: string
    type: 'image' | 'video' | 'audio' | 'signature'
    width?: number
    /** true once the server has the file inlays/<id> (inlaySync.ts) */
    synced?: boolean
}

const inlayImageExts = [
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'
]

const inlayAudioExts = [
    'wav', 'mp3', 'ogg', 'flac'
]

const inlayVideoExts = [
    'webm', 'mp4', 'mkv'
]

const inlayStorage = localforage.createInstance({
    name: 'inlay',
    storeName: 'inlay'
})

// The browser copy (IndexedDB) is a cache; on the Node server every picture is also the file inlays/<id> (inlaySync.ts).
// globalApi is imported when needed: importing it here would make a cycle through the parser.
const inlayDeps: InlayDeps = {
    remoteEnabled: isNodeServer,
    async readRemote(key) {
        const { forageStorage } = await import('../../globalApi.svelte')
        const data = await forageStorage.getItem(key)
        return data ? new Uint8Array(data) : null
    },
    async writeRemote(key, bytes) {
        const { forageStorage } = await import('../../globalApi.svelte')
        await forageStorage.setItem(key, bytes)
    },
    readLocal: (id) => inlayStorage.getItem<LocalInlay | null>(id),
    writeLocal: async (id, item) => { await inlayStorage.setItem(id, item) },
    listLocal: () => listInlayAssets() as Promise<[string, LocalInlay][]>,
    log: (message, error) => console.warn(message, error),
}

/** Puts on the server every picture this browser has that the server lacks (one pass at a time). */
export const syncInlaysToServer = singleFlight(async () => {
    const result = await uploadPending(inlayDeps)
    if (result.uploaded || result.failed) {
        console.log(`[inlay] uploaded ${result.uploaded} picture(s) to the server, ${result.failed} failed (tried again later)`)
    }
    return result
})

// A failed upload must not wait for the next start: a Risu tab can stay open for days, and the phone would show the raw tag all
// that time (TLC: with uploads only at start, "every picture reaches the server" fails; with this timer it holds).
const RETRY_EVERY_MS = 5 * 60 * 1000
let retryTimer: ReturnType<typeof setInterval> | null = null

/** Uploads now, then every five minutes and whenever the network comes back. Safe to call more than once. */
export function startInlaySync() {
    if (!isNodeServer || retryTimer) return
    void syncInlaysToServer().catch((e) => console.warn('[inlay] sync failed', e))
    retryTimer = setInterval(() => { void syncInlaysToServer().catch(() => {}) }, RETRY_EVERY_MS)
    globalThis.addEventListener?.('online', () => { void syncInlaysToServer().catch(() => {}) })
}

export async function postInlayAsset(img:{
    name:string,
    data:Uint8Array
}){

    const extention = img.name.split('.').at(-1)
    const imgObj = new Image()

    if(inlayImageExts.includes(extention)){
        imgObj.src = URL.createObjectURL(new Blob([asBuffer(img.data)], {type: `image/${extention}`}))

        return await writeInlayImage(imgObj, {
            name: img.name,
            ext: extention
        })
    }

    if(inlayAudioExts.includes(extention)){
        const audioBlob = new Blob([asBuffer(img.data)], {type: `audio/${extention}`})
        const imgid = v4()

        const item = {
            name: img.name,
            data: audioBlob,
            ext: extention,
            type: 'audio' as const
        }
        await inlayStorage.setItem(imgid, item)
        await upload(inlayDeps, imgid, item)

        return `${imgid}`
    }

    if(inlayVideoExts.includes(extention)){
        const videoBlob = new Blob([asBuffer(img.data)], {type: `video/${extention}`})
        const imgid = v4()

        const item = {
            name: img.name,
            data: videoBlob,
            ext: extention,
            type: 'video' as const
        }
        await inlayStorage.setItem(imgid, item)
        await upload(inlayDeps, imgid, item)

        return `${imgid}`
    }

    return null
}

export { GENERATED_INLAY_MAX_SIDE, fitInlaySize } from './inlaySize'
import { fitInlaySize } from './inlaySize'

export async function writeInlayImage(imgObj:HTMLImageElement, arg:{name?:string, ext?:string, id?:string, maxSide?:number} = {}) {

    let drawHeight = 0
    let drawWidth = 0
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    await new Promise((resolve) => {
        imgObj.onload = () => {
            //resize image to fit inlay: at most 1024*1024 pixels in total, and at most arg.maxSide on the long side when it is given
            const fitted = fitInlaySize(imgObj.width, imgObj.height, { maxSide: arg.maxSide })
            drawWidth = fitted.width
            drawHeight = fitted.height

            canvas.width = drawWidth
            canvas.height = drawHeight
            ctx.drawImage(imgObj, 0, 0, drawWidth, drawHeight)
            resolve(null)
        }
    })
    // WebP at 0.8: a 360 px picture is about 16 KB instead of 223 KB as PNG (measured). A browser that cannot encode WebP
    // returns PNG from toBlob; then JPEG at 0.8 (about 41 KB) is used.
    let imageBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.8))
    if (!imageBlob || imageBlob.type !== 'image/webp') {
        imageBlob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    }
    const ext = imageBlob?.type === 'image/webp' ? 'webp' : 'jpeg'

    const imgid = arg.id ?? v4()

    const item = {
        name: arg.name ?? imgid,
        data: imageBlob,
        ext,
        height: drawHeight,
        width: drawWidth,
        type: 'image' as const
    }
    await inlayStorage.setItem(imgid, item)
    // on the server too, so the phone (or another browser) shows it; a failure keeps it here and is retried next start
    await upload(inlayDeps, imgid, item)

    return `${imgid}`
}

export type InlaySignature = {
    signatures: {
        type: 'function'|'text'
        content: string
    }[],
    sourceFormat: LLMFormat,
    source: string
}

export async function saveInlayedSignature(sigid:string,signature:InlaySignature){
    await inlayStorage.setItem(sigid, {
        name: sigid,
        data: JSON.stringify(signature),
        ext: 'json',
        type: 'signature'
    } satisfies InlayAsset)
    return sigid
}


function base64ToBlob(b64: string): Blob {
    const splitDataURI = b64.split(',');
    const byteString = atob(splitDataURI[1]);
    const mimeString = splitDataURI[0].split(':')[1].split(';')[0];

    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }

    return new Blob([ab], { type: mimeString });
}

function blobToBase64(blob: Blob): Promise<string> {
    const reader = new FileReader();
    reader.readAsDataURL(blob);
    return new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
            resolve(reader.result as string);
        };
        reader.onerror = reject;
    });
}

// Returns with base64 data URI
export async function getInlayAsset(id: string){
    const img = await readInlay(inlayDeps, id) as InlayAsset | null
    if(img === null){
        return null
    }

    let data: string;
    if(img.data instanceof Blob){
        data = await blobToBase64(img.data)
    } else {
        data = img.data as string
    }

    return { ...img, data }
}

// Returns with Blob
export async function getInlayAssetBlob(id: string){
    const img = await readInlay(inlayDeps, id) as InlayAsset | null
    if(img === null){
        return null
    }

    let data: Blob;
    if(typeof img.data === 'string'){
        // Migrate to Blob
        data = base64ToBlob(img.data)
        setInlayAsset(id, { ...img, data })
    } else {
        data = img.data
    }

    return { ...img, data }
}

export async function listInlayAssets(): Promise<[id: string, InlayAsset][]> {
    const assets: [id: string, InlayAsset][] = []
    await inlayStorage.iterate<InlayAsset, void>((value, key) => {
        assets.push([key, value])
    })

    return assets
}

export async function setInlayAsset(id: string, img: InlayAsset){
    await inlayStorage.setItem(id, img)
}

export async function removeInlayAsset(id: string){
    await inlayStorage.removeItem(id)
}

export function supportsInlayImage(){
    const db = getDatabase()
    return getModelInfo(db.aiModel).flags.includes(LLMFlags.hasImageInput)
}

export async function reencodeImage(img:Uint8Array){
    if(getImageType(img) === 'PNG'){
        return img
    }
    const canvas = document.createElement('canvas')
    const imgObj = new Image()
    imgObj.src = URL.createObjectURL(new Blob([asBuffer(img)], {type: `image/png`}))
    await imgObj.decode()
    let drawHeight = imgObj.height
    let drawWidth = imgObj.width
    canvas.width = drawWidth
    canvas.height = drawHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(imgObj, 0, 0, drawWidth, drawHeight)
    const b64 = canvas.toDataURL('image/png').split(',')[1]
    const b = Buffer.from(b64, 'base64')
    return b
}