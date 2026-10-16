// Drawing one scene picture for a message: what a story script's generateImage() does, also used by the built-in scene
// pictures (scenePicturesPage.ts) for a story with no script of its own.

import type { Chat, character } from '../storage/database.svelte'
import { getDatabase } from '../storage/database.svelte'
import { alertError } from '../alert'
import { generateAIImage, openaiCompatImageRequest } from './stableDiff'
import { drawOnServer } from './imageJobClient'
import { writeInlayImage } from './files/inlays'
import { GENERATED_INLAY_MAX_SIDE } from './files/inlaySize'

/**
 * Draws `prompt` for message `index` of `chat` (negative counts from the end; without it, the last message) and returns
 * "{{inlay::<id>}}", or "Error: …". On the Node server the picture is drawn as a server job (imageJobClient.ts): it is finished
 * and saved even if this page is closed meanwhile, and put in its message at the next start.
 */
export async function drawScenePicture(char: character, chat: Chat | undefined, prompt: string, negative = '', index?: number): Promise<string> {
    const db = getDatabase()
    const msgs = chat?.message ?? []
    const at = typeof index === 'number' ? (index < 0 ? msgs.length + index : index) : msgs.length - 1
    // the portraits of the characters this picture names go with it as references (portraitsPage.ts)
    const { sceneReferences, currentRoom } = await import('./portraitsPage')
    const scene = await sceneReferences(currentRoom(char), prompt, msgs[at]?.data ?? '')
    // the same flag as platform.ts isNodeServer, read here because platform.ts touches `window` when it loads
    const onNodeServer = !!(globalThis as typeof globalThis & { __NODE__?: boolean }).__NODE__
    if (onNodeServer && db.sdProvider === 'openai-compat' && db.openaiCompatImage?.url) {
        const target = { charId: char.chaId, chatId: chat?.id, chatIndex: char.chatPage, messageId: msgs[at]?.chatId, messageIndex: at }
        const { url, key, body, models } = openaiCompatImageRequest(scene.prompt, scene.images)
        try {
            // loaded here: the node storage module touches `window` when it loads, which scripts tests run without
            const { getNodeServerProxyAuth } = await import('../storage/nodeStorage')
            const out = await drawOnServer({ fetch: (input, init) => fetch(input, init), auth: getNodeServerProxyAuth }, { url, key, models, body }, target)
            if (out.inlayId) {
                return `{{inlay::${out.inlayId}}}`
            }
            alertError(out.error ?? 'Image generation failed')
            return 'Error: ' + (out.error ?? 'Image generation failed')
        } catch (e) {
            console.warn('[image] server job unavailable, drawing in the page', e)
        }
    }
    const gen = await generateAIImage(scene.prompt, char, negative, 'inlay', scene.images)
    if (!gen) {
        return 'Error: Image generation failed'
    }
    const imgHTML = new Image()
    imgHTML.src = gen
    const inlay = await writeInlayImage(imgHTML, { maxSide: GENERATED_INLAY_MAX_SIDE })
    return `{{inlay::${inlay}}}`
}
