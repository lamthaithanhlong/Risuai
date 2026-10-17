// The story's own voice speaks when it should, in every story (asked 2026-10-16: "chú phải sửa để mọi truyện working", after a
// kill in Shadow Slave got no word from the Spell). A story's system voice (the Spell, a hunter System) is the card's business,
// but cards say it unevenly: Shadow Slave's rules described the Spell's messages and never when it reports a kill, Alternate
// Hunters' rules do say it. A vague reminder in the app ("if the story has a voice…") reached 1/4. So the helper reads each
// card's rules once (and what it knows of the source work) and writes the voice's profile: its name, the events it reports and
// one example line; each turn the reminder names that voice and those events. A story with no such voice gets nothing.
//
// Measured on a kill turn of each story, story model: Shadow Slave with its old rules 0/6 -> 6/6 announced; Alternate Hunters
// 4/4 -> 4/4; Lord of the Mysteries (no voice by design) 0/4 -> 0/4, its profile says none.

export type VoiceProfile = { voice: string | null; reports: string[]; format: string }

/** What the helper reads: the card's description and its always-on lore, at most this many characters. */
export const RULES_CHARS = 40_000

export function rulesOf(card: { desc?: string; globalLore?: { alwaysActive?: boolean; content?: string }[] }): string {
    return [card.desc ?? '', ...(card.globalLore ?? []).filter((l) => l.alwaysActive).map((l) => l.content ?? '')].join('\n\n').slice(0, RULES_CHARS)
}

/** A short stable key of the rules, so the profile is written again when they change. */
export function rulesKey(rules: string): string {
    let h = 5381
    for (let i = 0; i < rules.length; i++) h = ((h << 5) + h + rules.charCodeAt(i)) | 0
    return `${rules.length}:${(h >>> 0).toString(36)}`
}

export function profilePrompt(rules: string): string {
    return 'Below are the rules of an interactive story (the card\'s description and its always-on lore). Does this story have an in-world voice or system that'
        + ' sends the player\'s character messages about what happens (for example the Spell in Shadow Slave, the System of a hunter story)? Use the rules'
        + ' and what you know of the source work. Answer with only JSON: {"voice": "its name, or null when the story has none", "reports": ["the events it'
        + ' reports, short, e.g. kill, item gained, rank change"], "format": "one example line as it would appear, in the style the rules or the source use, with <name> where a name goes"}'
        + '\n\nRULES\n' + rules
}

export function parseProfile(answer: string): VoiceProfile | null {
    const m = /\{[\s\S]*\}/.exec(answer ?? '')
    if (!m) return null
    try {
        const j = JSON.parse(m[0])
        const voice = typeof j.voice === 'string' && j.voice.trim() && !/^(null|none)$/i.test(j.voice.trim()) ? j.voice.trim() : null
        const reports = Array.isArray(j.reports) ? j.reports.filter((x: unknown) => typeof x === 'string' && x.trim()).map((x: string) => x.trim()).slice(0, 10) : []
        return { voice, reports, format: typeof j.format === 'string' ? j.format.trim().slice(0, 200) : '' }
    } catch {
        return null
    }
}

/** The reminder at the end of the player's message, or '' for a story with no voice. */
export function voiceReminder(p: VoiceProfile | null | undefined): string {
    if (!p?.voice) return ''
    const reports = p.reports.join(', ') || 'an event it reports'
    return `\n\n[${p.voice}: when this reply has one of the events it reports (${reports}), it speaks right after that moment in its own lines,`
        + ` like ${p.format}, written in the story's language; never otherwise, and never a report it would not make.]`
}
