// The story's own words, in every story (reported 2026-10-17 in Shadow Slave: "nó chẳng biết tiếng vọng và ký ức"). The player
// writes the terms of the novel's Vietnamese translation ("tiếng vọng" = Echo, "ký ức" = Memory); the rules and lore say them in
// English, so no key fires and the model reads the words as they sound: asked to look for an Echo, it listened for an echo.
// The helper reads each card's rules once and writes a glossary (the Vietnamese term, the term the lore uses, what it means in
// that world), kept with the card; a turn whose player message uses a term gets its meaning at the end of the message.
// Measured on that turn, story model, 4 replies each: an Echo understood 0/4 as it was, 4/4 with this reminder.

export type Term = { vi: string; lore: string; means: string }

export function glossaryPrompt(rules: string): string {
    return 'Below are the rules of an interactive story. List the game and world terms of this story that a player may type in Vietnamese, the way the'
        + ' Vietnamese translation of the source work (or the rules) names them, at most 25, the gameplay and system terms first. For each: the Vietnamese term,'
        + ' the term the rules and lore use, and what it means in this world in at most 25 words (what it is and how it works, not a literal reading).'
        + ' Answer with only JSON: [{"vi": "...", "lore": "...", "means": "..."}]\n\nRULES\n' + rules
}

export function parseGlossary(answer: string): Term[] | null {
    const m = /\[[\s\S]*\]/.exec(answer ?? '')
    if (!m) return null
    try {
        const arr = JSON.parse(m[0])
        if (!Array.isArray(arr)) return null
        return arr.filter((x) => x && typeof x.vi === 'string' && x.vi.trim().length >= 2 && typeof x.lore === 'string' && typeof x.means === 'string')
            .slice(0, 25).map((x) => ({ vi: x.vi.trim(), lore: x.lore.trim(), means: x.means.trim().slice(0, 240) }))
    } catch {
        return null
    }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The terms the player's message uses (whole words, any case), at most six. */
export function termsUsed(glossary: Term[] | null | undefined, text: string): Term[] {
    const t = (text ?? '').toLowerCase().normalize('NFC')
    return (glossary ?? []).filter((x) => new RegExp(`(?<!\\p{L})${escapeRe(x.vi.toLowerCase().normalize('NFC'))}(?!\\p{L})`, 'u').test(t)).slice(0, 6)
}

export function termsReminder(used: Term[]): string {
    if (!used.length) return ''
    return '\n\n[Terms in this story: ' + used.map((x) => `"${x.vi}" is ${x.lore}: ${x.means}`).join('; ') + ']'
}
