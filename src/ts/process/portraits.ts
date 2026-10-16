// Character portraits, drawn once and used as the model for every scene picture (asked 2026-10-15: "làm tự tạo chân dung NPC
// … cho cả nhân vật chính luôn kenji park để generate hình luôn đúng").
//
// The story writes one hidden line when a named character first appears, the player's own character included:
//   [[LOOK Elise | silver hair to the shoulders, grey eyes, black hooded cloak, about twenty]]
// Risu then draws that character's portrait once (the server picture queue), keeps it as an Additional Asset named after
// them (Character → Display → Additional Assets), and every scene picture that names them is sent with the portrait as a
// reference image: 9router's images route takes `images` (or `image`) and draws an edit from them, so Kenji looks like
// Kenji in every scene. Each portrait's state lives on the character card (extentions.vjPortraits).

export type Look = { name: string; look: string }
export type PortraitStatus = 'pending' | 'done' | 'error'
export type PortraitEntry = { name: string; look: string; status: PortraitStatus; at: number; asset?: string; error?: string
    /** the style it was drawn in (styleKey), to draw it again when the story's style changes; hand: a picture the learner added */
    style?: string; hand?: boolean }
export type PortraitState = Record<string, PortraitEntry>

const LOOK = /\[\[LOOK\s+([^|\]\n]{1,40}?)\s*\|\s*([^\]\n]{1,500}?)\s*\]\]/g
/** A pending portrait older than this is taken as lost (the page was closed while it was drawn) and may be asked again. */
export const STALE_MS = 10 * 60_000
/** At most this many reference portraits go with one scene picture. */
export const MAX_REFS = 3

export const keyOf = (name: string) => (name ?? '').trim().toLowerCase().normalize('NFC')

/** The LOOK lines in a reply, one per name (the first wins). */
export function parseLooks(text: string): Look[] {
    const out: Look[] = []
    for (const m of (text ?? '').matchAll(LOOK)) {
        const name = m[1].trim(), look = m[2].trim()
        if (name && look && !out.some((l) => keyOf(l.name) === keyOf(name))) out.push({ name, look })
    }
    return out
}

/** The reply as shown: LOOK lines taken out, and one still being streamed hidden. */
export function stripLooks(text: string): string {
    return (text ?? '').replace(/[ \t]*\[\[LOOK[^\]]*\]\][ \t]*\n?/g, '').replace(/\[\[LOOK[^\]]*$/, '').replace(/\n{3,}/g, '\n\n')
}

/** The looks that still need a portrait: none yet, a failed one, or a pending one that was lost. */
export function newLooks(state: PortraitState, looks: Look[], now: number): Look[] {
    return looks.filter((l) => {
        const e = state[keyOf(l.name)]
        return !e || e.status === 'error' || (e.status === 'pending' && now - e.at > STALE_MS)
    })
}

/** The player's own character: their persona's picture is their portrait and its description their look (asked: Kenji Park
 *  already has a persona picture; drawing him again gave someone else). */
export type Player = { name: string; icon?: string; prompt?: string }

/** The persona description as a look: {{user}} named, brackets gone, one line. */
export function playerLook(p: Player): string {
    return (p.prompt ?? '').replace(/\{\{user\}\}/gi, p.name).replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
}

/** The state with the player in it, drawn, when their persona has a picture. */
export function withPlayer(state: PortraitState, p: Player | undefined): PortraitState {
    if (!p?.name || !p.icon) return state
    return { ...state, [keyOf(p.name)]: { name: p.name, look: playerLook(p) || state[keyOf(p.name)]?.look || '', status: 'done', at: 0, asset: p.icon } }
}

/** The note for the story: which names to describe once, which are drawn already. */
export function portraitNote(state: PortraitState, player: string): string {
    const drawn = Object.values(state).filter((e) => e.status !== 'error').map((e) => e.name)
    return 'CHARACTER LOOKS. When a named character with no look yet appears or speaks, the player\'s own character'
        + (player ? ` (${player})` : '') + ' included (and characters met earlier in the story too), add one hidden line with how they look, so their picture stays the same:'
        + ' [[LOOK <name> | <hair, eyes, face, build, age, clothes, in English, one line>]]. Keep each look for the rest of the story.'
        + (drawn.length ? ` Already described, never again: ${drawn.join(', ')}.` : '')
}

/**
 * The same ask, put at the end of the player's message. Reported 2026-10-15: no portrait was ever drawn. Measured on the live
 * save: not one [[LOOK]] line in any reply, and no portrait job in the server queue. On the Adv1 chat with the story model:
 * the system note alone, 0 of 2 replies wrote a look; with this at the end of the player's message, 2 of 2 (Elise Moreau).
 * The learning note behaved the same way: a system note alone is not followed, the end of the player's message is.
 */
export function portraitReminder(state: PortraitState): string {
    const drawn = Object.values(state).filter((e) => e.status !== 'error').map((e) => e.name)
    return '\n\n[Also this reply: for each named character in the scene with no look yet'
        + (drawn.length ? ` (described already, never again: ${drawn.join(', ')})` : '')
        + ', add one hidden line at the very end: [[LOOK <name> | <hair, eyes, face, build, age, clothes, in English>]].]'
}

/** Without a style of the story's own: anime, like the scene pictures of the owner's stories. */
export const DEFAULT_PORTRAIT_STYLE = 'Anime-style illustration: clean line art, cel shading, anime proportions, detailed anime art. '

/**
 * The story's own picture style: the STYLE its Lua gives every scene picture (local STYLE = "…" .. "…"). Reported
 * 2026-10-15: Elise's portrait came out photographic, because the portrait prompt carried no style at all while the scenes
 * get theirs from the card's Lua (Risu's global style field stays empty on purpose).
 */
export function storyStyle(card: { triggerscript?: unknown[] } | undefined): string {
    for (const t of (card?.triggerscript ?? []) as { effect?: { code?: string }[] }[]) {
        for (const e of t?.effect ?? []) {
            const m = /local\s+STYLE\s*=\s*((?:"(?:[^"\\]|\\.)*"\s*(?:\.\.\s*)?)+)/.exec(e.code ?? '')
            if (m) {
                const parts = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1].replace(/\\"/g, '"').replace(/\\n/g, ' '))
                const style = parts.join('').trim()
                if (style) return style.endsWith(' ') ? style : style + ' '
            }
        }
    }
    return DEFAULT_PORTRAIT_STYLE
}
/** A short key of a style, kept with a portrait to know when it is out of date. */
export const styleKey = (style: string) => { let h = 0; for (const c of style) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36) }

/** What is asked of the picture model for a portrait. */
export function portraitPrompt(l: Look, style = DEFAULT_PORTRAIT_STYLE): string {
    return `${style}Character portrait of ${l.name}, head and shoulders, facing the viewer, plain dark background, no text. ${l.name}: ${l.look}`
}

/**
 * The drawn portraits a scene picture needs: those whose name (or first name: Kenji for Kenji Park) is in the picture's
 * prompt or in the message it is for, the ones named in the prompt first.
 */
export function referencesFor(state: PortraitState, prompt: string, message = '', max = MAX_REFS): PortraitEntry[] {
    const named = (e: PortraitEntry, text: string) => {
        const t = ` ${(text ?? '').toLowerCase()} `
        const full = keyOf(e.name)
        const first = full.split(/\s+/)[0]
        const has = (w: string) => w.length >= 2 && new RegExp(`[^\\p{L}]${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\p{L}]`, 'u').test(t)
        return has(full) || (first !== full && has(first))
    }
    const done = Object.values(state).filter((e) => e.status === 'done' && e.asset)
    const inPrompt = done.filter((e) => named(e, prompt))
    const inMessage = done.filter((e) => !inPrompt.includes(e) && named(e, message))
    return [...inPrompt, ...inMessage].slice(0, max)
}

/** The scene prompt told which reference image is whom, with their looks. */
export function withLooks(prompt: string, refs: PortraitEntry[]): string {
    if (!refs.length) return prompt
    const who = refs.map((e, i) => `${e.name} is the person in image${i + 1} (${e.look})`).join('; ')
    return `${prompt}\n\nKeep each character exactly as in the reference images: ${who}.`
}

/** The picture's type from its first bytes (an asset path does not always end with it). */
export function mimeOf(b: Uint8Array): string {
    if (b[0] === 0x89 && b[1] === 0x50) return 'image/png'
    if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
    if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp'
    if (b[0] === 0x47 && b[1] === 0x49) return 'image/gif'
    return 'image/png'
}

/** For a provider that takes no reference image: the looks in words, so each character is described the same way. */
export function withLooksText(prompt: string, refs: PortraitEntry[]): string {
    const looks = refs.filter((e) => e.look)
    return looks.length ? `${prompt}\n\nCharacters: ${looks.map((e) => `${e.name}: ${e.look}`).join('; ')}.` : prompt
}

/**
 * The portraits shown under a reply: the drawn characters it names (Elise for Elise Moreau), as small round pictures with
 * their names. Reported 2026-10-15: Elise's portrait was drawn at 22:58 and kept as an Additional Asset, but nothing showed
 * it; the asset macro {{path::<name>}} gives the picture's address when the message is drawn.
 */
export function castStrip(card: CardLike, text: string, max = 4): string {
    const state = (card.extentions?.vjPortraits ?? {}) as PortraitState
    const assets = card.additionalAssets ?? []
    const shown = referencesFor(state, stripLooks(text).replace(/<[^>]+>/g, ' '), '', max)
        .map((e) => assets.find((a) => keyOf(a[0]) === keyOf(e.name))?.[0])
        .filter((n): n is string => !!n && !/[{}]/.test(n))
    if (!shown.length) return ''
    const q = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
    return '\n\n<div style="display:flex;gap:.6em;flex-wrap:wrap;margin-top:.5em">' + shown.map((n) =>
        `<span style="display:inline-flex;flex-direction:column;align-items:center;font-size:.72em;opacity:.85">`
        + `<img src="{{path::${n}}}" alt="${q(n)}" title="${q(n)}" style="width:3.4em;height:3.4em;border-radius:50%;object-fit:cover;object-position:top;border:1px solid #8fb8ff66"/>`
        + `${q(n.split(/\s+/)[0])}</span>`).join('') + '</div>'
}

// ---- the effects, with their dependencies passed in (tested without a page) ------------------------------------------------

export interface PortraitDeps {
    /** Draws a picture: an inlay id (server queue) or a data URL (drawn in the page). */
    draw(prompt: string): Promise<{ inlayId?: string; dataUrl?: string; error?: string }>
    /** The story's picture style (storyStyle); portraits drawn in another style are drawn again when next named. */
    style?: string
    /** The picture's bytes as an asset: its path, or null. */
    keep(picture: { inlayId?: string; dataUrl?: string }): Promise<{ path: string; ext: string } | null>
    now(): number
}

export type CardLike = { additionalAssets?: [string, string, string][]; extentions?: { [key: string]: any } }

export function stateOf(card: CardLike): PortraitState {
    card.extentions ??= {}
    card.extentions.vjPortraits ??= {}
    return card.extentions.vjPortraits as PortraitState
}

/**
 * After a reply: each new LOOK is drawn once and kept as an Additional Asset with the character's name. The state is written
 * before drawing, so a second reply naming the same character while it is drawn does not draw it again; an asset already
 * named so (one the learner added by hand) is never replaced.
 */
export async function drawNewPortraits(card: CardLike, reply: string, deps: PortraitDeps, save: () => void = () => {}, player?: Player): Promise<string[]> {
    const state = stateOf(card)
    const style = deps.style ?? DEFAULT_PORTRAIT_STYLE
    const key = styleKey(style)
    const todo = newLooks(withPlayer(state, player), parseLooks(reply), deps.now())
    // ours, drawn in another style, and named in this reply: drawn again in the story's style (never one the learner added)
    const restyle = referencesFor(state, stripLooks(reply), '', 99)
        .filter((e) => !e.hand && e.look && e.style !== key && !todo.some((l) => keyOf(l.name) === keyOf(e.name)))
        .map((e) => ({ name: e.name, look: e.look }))
    const all = [...todo, ...restyle]
    if (!all.length) return []
    const oldAsset = new Map(restyle.map((l) => [keyOf(l.name), state[keyOf(l.name)].asset]))
    for (const l of all) state[keyOf(l.name)] = { ...state[keyOf(l.name)], name: l.name, look: l.look, status: 'pending', at: deps.now() }
    save()
    const made: string[] = []
    await Promise.all(all.map(async (l) => {
        const k = keyOf(l.name)
        try {
            const pic = await deps.draw(portraitPrompt(l, style))
            if (pic.error || (!pic.inlayId && !pic.dataUrl)) throw new Error(pic.error ?? 'no picture')
            const kept = await deps.keep(pic)
            if (!kept) throw new Error('could not keep the picture')
            card.additionalAssets ??= []
            const existing = card.additionalAssets.find((a) => keyOf(a[0]) === k)
            let path = kept.path
            if (!existing) card.additionalAssets.push([l.name, kept.path, kept.ext])
            else if (oldAsset.has(k) && existing[1] === oldAsset.get(k)) { existing[1] = kept.path; existing[2] = kept.ext }   // our own, redrawn
            else path = existing[1]                                                                                       // the learner's: kept
            state[k] = { ...state[k], status: 'done', at: deps.now(), asset: path, style: key }
            made.push(l.name)
        } catch (e) {
            state[k] = { ...state[k], status: 'error', at: deps.now(), error: String((e as Error)?.message ?? e).slice(0, 200) }
        }
        save()
    }))
    return made
}

/**
 * Copies of the same story (cards with the same name) share their portraits: what one drew is taken by the other instead of
 * being drawn again (the owner has two "Shadow Slave" cards).
 */
export function adoptFromSiblings(card: CardLike, siblings: CardLike[]): void {
    const state = stateOf(card)
    for (const sib of siblings) {
        if (sib === card) continue
        for (const [k, e] of Object.entries(sib.extentions?.vjPortraits ?? {}) as [string, PortraitEntry][]) {
            if (e.status !== 'done' || !e.asset || state[k]?.status === 'done') continue
            state[k] = { ...e }
            card.additionalAssets ??= []
            if (!card.additionalAssets.some((a) => keyOf(a[0]) === k)) {
                const own = sib.additionalAssets?.find((a) => keyOf(a[0]) === k)
                card.additionalAssets.push([e.name, e.asset, own?.[2] ?? 'webp'])
            }
        }
    }
}

/** A portrait the learner added by hand (Additional Assets, named like a described character) counts as drawn. */
export function adoptHandAssets(card: CardLike): void {
    const state = stateOf(card)
    for (const [name, path] of card.additionalAssets ?? []) {
        const e = state[keyOf(name)]
        if (e && e.status !== 'done') state[keyOf(name)] = { ...e, status: 'done', asset: path, hand: true }
    }
}
