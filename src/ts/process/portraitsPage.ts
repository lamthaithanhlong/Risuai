// The page's side of the portraits (portraits.ts): the note in the request, drawing after a reply, the reference images that go
// with a scene picture. Only with the OpenAI-compatible picture setting (9router), the one whose route takes reference images.

import { getDatabase, type character, type Chat } from '../storage/database.svelte'
import { adoptHandAssets, drawNewPortraits, keyOf, mimeOf, portraitNote, referencesFor, stateOf, withLooks, type PortraitState } from './portraits'
import type { OpenAIChat } from './index.svelte'

export function portraitsOn(): boolean {
    const db = getDatabase()
    return db.autoPortraits !== false && db.sdProvider === 'openai-compat' && !!db.openaiCompatImage?.url
}

/** The note goes in as a system message right before the last user message, like the learning note. */
export function portraitRequest<T extends OpenAIChat>(formated: T[], char: character | undefined, player: string): T[] {
    if (!portraitsOn() || !char || char.type !== 'character') return formated
    adoptHandAssets(char)
    const note = { role: 'system', content: portraitNote(stateOf(char), player) } as T
    const last = formated.map((m) => m.role).lastIndexOf('user')
    return last >= 0 ? [...formated.slice(0, last), note, ...formated.slice(last)] : [...formated, note]
}

/** After a reply: draw the characters it described for the first time (not awaited: the chat goes on meanwhile). */
export function notePortraits(charIndex: number, chat: Chat | undefined): void {
    if (!portraitsOn() || !chat) return
    const db = getDatabase()
    const char = db.characters[charIndex] as character
    if (!char || char.type !== 'character') return
    const reply = [...(chat.message ?? [])].reverse().find((m) => m.role === 'char')?.data ?? ''
    if (!reply.includes('[[LOOK')) return
    const save = () => { db.characters[charIndex] = char }
    drawNewPortraits(char, reply, {
        now: () => Date.now(),
        draw: async (prompt) => {
            const { openaiCompatImageRequest, generateAIImage } = await import('./stableDiff')
            if ((globalThis as typeof globalThis & { __NODE__?: boolean }).__NODE__) {
                const { drawOnServer } = await import('./imageJobClient')
                const { getNodeServerProxyAuth } = await import('../storage/nodeStorage')
                const { url, key, body, models } = openaiCompatImageRequest(prompt)
                // no target: a portrait belongs to no message, so a page that finds it later puts it nowhere
                return drawOnServer({ fetch: (i, o) => fetch(i, o), auth: getNodeServerProxyAuth }, { url, key, models, body }, null)
            }
            const gen = await generateAIImage(prompt, char, '', 'inlay')
            return gen ? { dataUrl: gen } : { error: 'Image generation failed' }
        },
        keep: async (pic) => {
            const { saveAsset } = await import('../globalApi.svelte')
            let bytes: Uint8Array | null = null, ext = 'png'
            if (pic.inlayId) {
                const { getInlayAssetBlob } = await import('./files/inlays')
                const img = await getInlayAssetBlob(pic.inlayId)
                if (img) { bytes = new Uint8Array(await img.data.arrayBuffer()); ext = img.ext || 'webp' }
            } else if (pic.dataUrl) {
                const m = /^data:image\/(\w+);base64,(.*)$/s.exec(pic.dataUrl)
                if (m) { ext = m[1]; bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0)) }
            }
            if (!bytes) return null
            return { path: await saveAsset(bytes, '', `portrait.${ext}`), ext }
        },
    }, save).catch((e) => console.warn('[portraits] drawing failed', e))
}

/** The portraits as references: by name, from the state and from Additional Assets the learner added by hand. */
function view(char: character): PortraitState {
    const state: PortraitState = { ...stateOf(char) }
    for (const [name, path] of char.additionalAssets ?? []) {
        const k = keyOf(name)
        if (!state[k] || state[k].status !== 'done') state[k] = { name, look: state[k]?.look ?? '', status: 'done', at: 0, asset: path }
    }
    return state
}

/**
 * For a scene picture: the prompt told who is who, and the portraits of the characters it names (in the prompt, or in the
 * message it is for) as data URLs for 9router's `images`.
 */
export async function sceneReferences(char: character | undefined, prompt: string, message = ''): Promise<{ prompt: string; images: string[] }> {
    if (!portraitsOn() || !char || char.type !== 'character') return { prompt, images: [] }
    const refs = referencesFor(view(char), prompt, message)
    if (!refs.length) return { prompt, images: [] }
    const { readImage } = await import('../globalApi.svelte')
    const images: string[] = []
    const used: typeof refs = []
    for (const r of refs) {
        try {
            const bytes = await readImage(r.asset!)
            if (!bytes?.length) continue
            let bin = ''
            for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
            images.push(`data:${mimeOf(bytes)};base64,${btoa(bin)}`)
            used.push(r)
        } catch { /* a missing file is skipped: the picture is still drawn, without that reference */ }
    }
    return { prompt: withLooks(prompt, used), images }
}
