// A small, card-independent scene memory. The existing story.sqlite indexes these chat variables.
// Only a quoted fact from the latest turn may change the in-world time or place.

type Vars = Record<string, unknown> | undefined
type SceneChat = { scriptstate?: Record<string, string | number | boolean>; message?: { role: string; data?: string; chatId?: string }[] }

export const SCENE_VARS = ['$scene_date', '$scene_place', '$scene_date_source', '$scene_place_source'] as const

const value = (vars: Vars, key: string): string => {
    const raw = vars?.[key]
    const text = raw === undefined || raw === null ? '' : String(raw).trim()
    return text === 'null' || text === '-' || text === '—' ? '' : text
}

export function sceneNote(vars: Vars): string {
    const date = value(vars, '$scene_date')
    const place = value(vars, '$scene_place')
    if (!date && !place) return ''
    return `\n\n[SCENE MEMORY (the last confirmed scene, not a new event): in-world date/time: ${date || 'unknown'}; current location: ${place || 'unknown'}. Carry these forward unless the player's action or the story explicitly changes them. A future appointment is not the current time or place. Do not invent a more precise clock or address.]`
}

export function sceneAsk(vars: Vars, history = false): string {
    return `SCENE MEMORY FOR THIS CHAT. Before the latest turn: in-world date/time: ${value(vars, '$scene_date') || 'unknown'}; current location: ${value(vars, '$scene_place') || 'unknown'}.
${history ? 'Read the recent story above in order. Find the present scene at the END of the LAST story reply; an older explicit fact still applies until the story changes it.' : "Read only THE PLAYER'S LAST ACTION and THE STORY'S REPLY above. At the END of that reply, did the present scene's date/time or location explicitly change or become clear?"} Ignore future plans and appointments, memories, ID cards, lore, UI panels, and quoted speech about elsewhere. Never infer a precise date, hour, building or room from general context. Keep an unchanged field by omitting it. For each changed field give a short, exact quote from ${history ? 'these turns' : 'those two texts'} as evidence. If there is no such quote, omit the field. Answer only:
[[SCENE
date: <current in-world date/time>
date_source: <exact quote>
place: <current location>
place_source: <exact quote>
]]
Omit both lines for a field you cannot support; omit the whole block when neither changed. Write values in the story's language.`
}

const field = (body: string, key: string): string => body.split(/\r?\n/).map((line) => line.trim()).find((line) => line.toLowerCase().startsWith(key + ':'))?.slice(key.length + 1).trim() ?? ''
const normal = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
const unknown = /^(?:-|—|\?|unknown|unclear|not stated|không rõ|chưa rõ|không biết|n\/a|null)$/i

export function parseScene(answer: string, turn: string, vars: Vars): Record<string, string> {
    const body = [...(answer ?? '').matchAll(/\[\[SCENE\b([\s\S]*?)\]\]/gi)].at(-1)?.[1]
    if (!body) return {}
    const out: Record<string, string> = {}
    const source = normal(turn)
    for (const [name, key] of [['date', '$scene_date'], ['place', '$scene_place']] as const) {
        const next = field(body, name).replace(/^['“”"]|['“”"]$/g, '').trim()
        const quote = field(body, name + '_source').replace(/^['“”"]|['“”"]$/g, '').trim()
        if (!next || unknown.test(next) || next.length > 120 || quote.length < 3 || quote.length > 160 || !source.includes(normal(quote))) continue
        if (next === value(vars, key)) continue
        out[key] = next
        out[name === 'date' ? '$scene_date_source' : '$scene_place_source'] = quote
    }
    return out
}

/** Backfill a pre-existing chat once, before its next model request. Later turns use the normal bookkeeper call. */
export async function seedScene(chat: SceneChat | undefined, ask: (prompt: string) => Promise<string | null>): Promise<boolean> {
    if (!chat?.message?.length) return false
    const lastReply = [...chat.message].reverse().find((m) => m.role === 'char' && m.data?.trim())
    if (!lastReply?.chatId) return false
    const vars = chat.scriptstate ??= {}
    if ((value(vars, '$scene_date') && value(vars, '$scene_place')) || value(vars, '$scene_seeded_reply') === lastReply.chatId) return false
    const end = chat.message.lastIndexOf(lastReply)
    const recent = chat.message.slice(0, end + 1).filter((m) => (m.role === 'user' || m.role === 'char') && m.data?.trim()).slice(-8)
    // Status panels can be much longer than the scene itself; keep both ends of each turn.
    const cut = (s: string) => s.length <= 2500 ? s : s.slice(0, 1800) + '\n[…]\n' + s.slice(-700)
    const text = recent.map((m) => `${m.role === 'user' ? 'PLAYER' : 'STORY'}: ${cut(m.data ?? '')}`).join('\n\n')
    const prompt = `Find the current in-world date/time and location at the END of the LAST story reply below. Earlier turns may establish a value that has not changed. Quote exact evidence from these turns. A future appointment, an ID card, static lore or a plan is not the current scene. Never guess a precise date or place. If no reliable evidence exists, omit that field.\n\n${text}\n\n${sceneAsk(vars, true)}`
    // The helper is optional; a failed extraction must never stop the main story request.
    let answer: string | null
    try { answer = await ask(prompt) } catch { return false }
    if (!answer || chat.message.lastIndexOf(lastReply) < 0) return false
    const updates = parseScene(answer, text, vars)
    for (const [key, next] of Object.entries(updates)) if (!value(vars, key)) vars[key] = next
    vars.$scene_seeded_reply = lastReply.chatId
    return Object.keys(updates).some((key) => key === '$scene_date' || key === '$scene_place')
}
