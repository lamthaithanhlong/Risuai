// The page's side of the portraits (portraits.ts): the note in the request, drawing after a reply, the reference images that go
// with a scene picture. Only with the OpenAI-compatible picture setting (9router), the one whose route takes reference images.

import { get } from 'svelte/store'
import { getDatabase, type character, type Chat, type groupChat } from '../storage/database.svelte'
import { selectedCharID } from '../stores.svelte'
import { checkPersonaBinded, getPersonaPrompt, getUserName } from '../util'
import { adoptFromSiblings, adoptHandAssets, metInChat, portraitReminder, storyStyle, withLooksText, drawNewPortraits, keyOf, mimeOf, withPlayer, type CardLike, type Player, portraitNote, referencesFor, stateOf, withLooks, type PortraitState } from './portraits'
import type { OpenAIChat } from './index.svelte'

/** The player's character as the chat sees it: the bound persona, else the selected one. */
export function currentPlayer(): Player {
    const bound = checkPersonaBinded()
    return { name: getUserName(), icon: bound ? bound.icon : getDatabase().userIcon, prompt: getPersonaPrompt() }
}

/** Portraits are drawn with whatever picture provider is set; only 9router (OpenAI-compatible) also takes them as references. */
export function portraitsOn(): boolean {
    const db = getDatabase()
    return db.autoPortraits !== false && !!db.sdProvider && (db.sdProvider !== 'openai-compat' || !!db.openaiCompatImage?.url)
}
const referencesOn = () => getDatabase().sdProvider === 'openai-compat'

/** Where a chat's portraits live: its character card, or the group in a group chat (every member shares them), with the
 *  same story's other copies (cards of the same name) taken in first. */
type Room = character | groupChat
function room(r: Room | undefined): (Room & CardLike) | null {
    if (!r) return null
    const card = r as Room & CardLike
    const db = getDatabase()
    adoptFromSiblings(card, db.characters.filter((c) => c && c !== r && c.type === r.type && c.name === r.name) as CardLike[])
    adoptHandAssets(card)
    return card
}
/** The chat being written in: its card or group (a script runs as a member, the portraits belong to the room). */
export function currentRoom(fallback?: character): Room | undefined {
    const db = getDatabase()
    return (db.characters[get(selectedCharID)] as Room | undefined) ?? fallback
}

/** The note goes in as a system message right before the last user message, like the learning note. */
export function portraitRequest<T extends OpenAIChat>(formated: T[], chatRoom: Room | undefined, player: Player = currentPlayer()): T[] {
    const card = portraitsOn() ? room(chatRoom) : null
    if (!card) return formated
    // only who this chat has met is "already described": another chat's cast read as people the story already has (metInChat)
    const said = formated.filter((m) => m.role !== 'system' && typeof m.content === 'string').map((m) => m.content as string).join('\n')
    const state = metInChat(withPlayer(stateOf(card), player), said, player.name)
    const note = { role: 'system', content: portraitNote(state, player.name) } as T
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (last < 0) return [...formated, note]
    // the reminder at the end of the player's message is what the model follows (measured: 0/2 without, 2/2 with)
    const user = formated[last]
    const reminded = typeof user.content === 'string' ? { ...user, content: user.content + portraitReminder(state) } : user
    return [...formated.slice(0, last), note, reminded, ...formated.slice(last + 1)]
}

/** After a reply: draw the characters it described for the first time (not awaited: the chat goes on meanwhile). */
export function notePortraits(charIndex: number, chat: Chat | undefined): void {
    if (!portraitsOn() || !chat) return
    const db = getDatabase()
    const card = room(db.characters[charIndex] as Room)
    if (!card) return
    // the picture settings of a character: the card itself, or in a group its first member
    const char = (card.type === 'group' ? db.characters.find((c) => c.chaId === (card as groupChat).characters?.[0]) : card) as character
    const reply = [...(chat.message ?? [])].reverse().find((m) => m.role === 'char')?.data ?? ''
    // every reply: a new LOOK is drawn, and a portrait of ours drawn in an older style is drawn again when its character is named
    const save = () => { db.characters[charIndex] = card }
    drawNewPortraits(card, reply, {
        now: () => Date.now(),
        // the story's own picture style (its Lua's STYLE), the card's or in a group its first member's
        style: storyStyle((card.type === 'group' ? char : card) as character),
        draw: async (prompt) => {
            const { openaiCompatImageRequest, generateAIImage } = await import('./stableDiff')
            if (referencesOn() && (globalThis as typeof globalThis & { __NODE__?: boolean }).__NODE__) {
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
    }, save, currentPlayer()).catch((e) => console.warn('[portraits] drawing failed', e))
}

/** The portraits as references: by name, from the state and from Additional Assets the learner added by hand. */
function view(card: Room & CardLike): PortraitState {
    const state: PortraitState = withPlayer({ ...stateOf(card) }, currentPlayer())
    for (const [name, path] of card.additionalAssets ?? []) {
        const k = keyOf(name)
        if (!state[k] || state[k].status !== 'done') state[k] = { name, look: state[k]?.look ?? '', status: 'done', at: 0, asset: path }
    }
    return state
}

/**
 * For a scene picture: the prompt told who is who, and the portraits of the characters it names (in the prompt, or in the
 * message it is for) as data URLs for 9router's `images`.
 */
export async function sceneReferences(chatRoom: Room | undefined, prompt: string, message = ''): Promise<{ prompt: string; images: string[] }> {
    const card = portraitsOn() ? room(chatRoom) : null
    if (!card) return { prompt, images: [] }
    const refs = referencesFor(view(card), prompt, message)
    if (!refs.length) return { prompt, images: [] }
    // a provider that takes no reference image still gets the looks in words: the same character described the same way
    if (!referencesOn()) return { prompt: withLooksText(prompt, refs), images: [] }
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
