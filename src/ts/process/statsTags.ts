// The hidden growth tags the narrator writes ([[ACT|id|stat+stat|difficulty|skills]] and, rarely, [[BREAK|stat]]; the card's rule is in
// apocalypse-tham-hoa-zombie/fate-simulator/main_description.md "Growth"). The card's Lua (stats.lua) reads them and takes them out of the
// stored message; this is the client's second hand, the way stripFind is for [[FIND|..]]: a finished tag, and one still being streamed,
// never reach the screen, and one the script did not get to (a card without it) does not stay in the stored text either.

const CLOSED = /(?:[ \t]*\n)?[ \t]*\[\[(?:ACT|BREAK)\|[^\]]*\]\]/g
const OPEN_TAIL = /[ \t]*\[\[(?:ACT|BREAK)[^\]]*$/
const PREFIX_TAIL = /[ \t]*\[\[(?:A|AC|B|BR|BRE|BREA)$/

/** The text with every growth tag taken out, and one still being streamed hidden; text without a tag comes back untouched. */
export function stripStatTags(text: string): string {
    const t = text ?? ''
    if (!t.includes('[[A') && !t.includes('[[B')) return t
    const out = t.replace(CLOSED, '').replace(OPEN_TAIL, '').replace(PREFIX_TAIL, '')
    if (out === t) return t
    return out.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
}
