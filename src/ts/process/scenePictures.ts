// Scene pictures for every story (asked 2026-10-16: "làm sao mọi story đều kết quả tốt như vậy", on a Shadow Slave reply
// that opened with a drawn picture). That picture came from the card's own Lua script; on the live save two of the five
// story cards have one (Shadow Slave, Lord of the Mysteries) and their second copies do not, so a reply there showed the
// "[[img: …]]" line as English text. This is the same behaviour built in, for a story with no picture script of its own:
// the model is asked for one [[img: …]] line when a picture is allowed, and after the reply the line becomes a picture,
// under the script's rules (imagegen.lua of the Shadow Slave card):
//   only the first tag is used, any other is removed; none when the reply shows a library image ({{image::…}}); at most
//   one picture in every three replies; after a failure it stays off for ten minutes; a failure never damages the reply.

export const SCENE_COOLDOWN_MS = 10 * 60_000
export const MIN_PROMPT = 12
export const MAX_PROMPT = 400
/** The script's negative prompt, without its world-specific part. */
export const SCENE_NEGATIVE = 'photorealistic, 3d render, text, watermark, logo, subtitles, extra fingers'
/** Where the cooldown is kept: the chat's script state, as the script keeps its own. */
export const COOLDOWN_KEY = 'vj_scene_off_until'

const TAG = /\[\[img:\s*([\s\S]*?)\]\]/i
const ANY_TAG = /[ \t]*\[\[img:[\s\S]*?\]\][ \t]*\n?/gi

type Card = {
    triggerscript?: { effect?: { type?: string; code?: string }[] }[]
    prebuiltAssetCommand?: boolean
    additionalAssets?: [string, string, string][]
    extentions?: { vjPortraits?: Record<string, { name?: string }> }
}
type Msg = { role: string; data: string }

/** The card's own script turns [[img:]] into pictures (it mentions the tag, as Lua pattern or as text). */
export function cardDrawsPictures(card: Card | undefined): boolean {
    return (card?.triggerscript ?? []).some((t) => (t.effect ?? []).some((e) => /\[\[img|%\[%\[\[iI\]\[mM\]\[gG\]/.test(e.code ?? '')))
}

/**
 * The card already shows pictures its own way: a picture script, Risu's asset command (<img="name">, how Alternate Hunters
 * shows its 2,450 images), or an image library of its own (Additional Assets that are not portraits). Those are left alone.
 */
export function cardHasOwnPictures(card: Card | undefined): boolean {
    if (cardDrawsPictures(card) || card?.prebuiltAssetCommand) return true
    const portraits = new Set(Object.values(card?.extentions?.vjPortraits ?? {}).map((e) => (e?.name ?? '').trim().toLowerCase()))
    return (card?.additionalAssets ?? []).some((a) => !portraits.has((a?.[0] ?? '').trim().toLowerCase()))
}

/** A picture is allowed now: none in the two replies before, and not cooling down after a failure. */
export function pictureAllowed(earlier: Msg[], offUntil: number, now: number): boolean {
    if (now < offUntil) return false
    const replies = earlier.filter((m) => m.role === 'char').slice(-2)
    return !replies.some((m) => /\{\{inlay(?:ed|eddata)?::/.test(m.data ?? ''))
}

export type ScenePlan = { prompt: string | null; cleaned: string; why?: string }

/** What to do with a finished reply: the reply without its tags, and the description to draw, or why not. */
export function planScenePicture(text: string, earlier: Msg[], offUntil: number, now: number): ScenePlan | null {
    const m = TAG.exec(text ?? '')
    if (!m) return null
    const cleaned = (text ?? '').replace(ANY_TAG, '').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n')
    const prompt = m[1].trim().slice(0, MAX_PROMPT)
    let why: string | undefined
    if (/\{\{image::/.test(text)) why = 'the reply already shows a library image'
    else if (prompt.length < MIN_PROMPT) why = 'the description is too short to draw'
    else if (!pictureAllowed(earlier, 0, now)) why = 'a picture was drawn in the last two replies'
    else if (now < offUntil) why = 'cooling down after a failure'
    return { prompt: why ? null : prompt, cleaned, why }
}

/** The ask, at the end of the player's message (a system note alone is not followed, measured for the portraits). */
export const SCENE_ASK = '\n\n[Picture: if this reply opens a new place or first shows a creature, an object or an event worth seeing,'
    + ' put one line [[img: DESCRIPTION]] on its own line right before the scene\'s first paragraph. DESCRIPTION: 15 to 40 words,'
    + ' English, only what the scene shows: the kind of place, the main subject, the light and weather, the mood; no names of real'
    + ' people, no text in the picture, nothing the character cannot see. Never inside a sentence, never explained; none this'
    + ' time if nothing new is seen.]'
