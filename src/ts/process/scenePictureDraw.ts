// Drawing one scene picture for a message: what a story script's generateImage() does, also used by the built-in scene
// pictures (scenePicturesPage.ts) for a story with no script of its own.

import type { Chat, character } from '../storage/database.svelte'
import { getDatabase } from '../storage/database.svelte'
import { generateAIImage, openaiCompatImageRequest } from './stableDiff'
import { queuePicture } from './imageJobClient'
import { writeInlayImage } from './files/inlays'
import { GENERATED_INLAY_MAX_SIDE } from './files/inlaySize'

/**
 * What a story script's generateImage() gets back when the picture was filed with the server: not a picture, and not an error. The
 * picture arrives in its message later, by message id (imageJobClient.ts); the script's turn goes on at once.
 */
export const PICTURE_QUEUED = 'Pending: the picture is queued on the server and will appear in this message when it is ready'

/**
 * Draws `prompt` for message `index` of `chat` (negative counts from the end; without it, the last message). On the Node server the
 * picture is a job in the server's picture queue (server/node/imageJobs.cjs), its own pipeline: this returns PICTURE_QUEUED at once, so
 * a slow, failing or retried picture never delays or fails the message turn that asked. The server draws it, writes it as inlays/<id>
 * and puts it into the message by message id, even when this page is closed. Asking again for the same message is the same picture;
 * `redraw` (a button press) asks for a new one that replaces it.
 * Elsewhere (no Node server, another image provider) the picture is drawn here and "{{inlay::<id>}}" or "Error: …" is returned.
 */
export async function drawScenePicture(char: character, chat: Chat | undefined, prompt: string, negative = '', index?: number, opts: { redraw?: boolean } = {}): Promise<string> {
    const db = getDatabase()
    const msgs = chat?.message ?? []
    const at = typeof index === 'number' ? (index < 0 ? msgs.length + index : index) : msgs.length - 1
    // the portraits of the characters this picture names go with it as references (portraitsPage.ts)
    const { sceneReferences, currentRoom } = await import('./portraitsPage')
    const scene = await sceneReferences(currentRoom(char), prompt, msgs[at]?.data ?? '')
    // the same flag as platform.ts isNodeServer, read here because platform.ts touches `window` when it loads
    const onNodeServer = !!(globalThis as typeof globalThis & { __NODE__?: boolean }).__NODE__
    if (onNodeServer && db.sdProvider === 'openai-compat' && db.openaiCompatImage?.url) {
        const target = { charId: char.chaId, chatId: chat?.id, chatIndex: char.chatPage, messageId: msgs[at]?.chatId, messageIndex: at, slot: 'main' }
        const { url, key, body, models } = openaiCompatImageRequest(scene.prompt, scene.images)
        try {
            // loaded here: the node storage module touches `window` when it loads, which scripts tests run without
            const { getNodeServerProxyAuth } = await import('../storage/nodeStorage')
            const redraw = opts.redraw ? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` : undefined
            const out = await queuePicture({ fetch: (input, init) => fetch(input, init), auth: getNodeServerProxyAuth }, { url, key, models, body }, target, { redraw })
            // the page looks at the new row now and then often while it is open (pictureWatch.svelte.ts); never awaited
            void import('./pictureWatch.svelte').then((m) => m.pictureFiled()).catch(() => {})
            return `${PICTURE_QUEUED} (job ${out.id})`
        } catch (e) {
            console.warn('[image] the server picture queue is unavailable, drawing in the page', e)
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
