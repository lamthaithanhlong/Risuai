// The hidden growth tags the narrator writes ([[ACT|id|stat+stat|difficulty|skills]] and, rarely, [[BREAK|stat]]; the card's rule is in
// apocalypse-tham-hoa-zombie/fate-simulator/main_description.md "Growth"). The card's Lua (stats.lua) reads them and takes them out of the
// stored message; this is the client's second hand, the way stripFind is for [[FIND|..]]: a finished tag, and one still being streamed,
// never reach the screen, and one the script did not get to (a card without it) does not stay in the stored text either.

// What the narrator really writes (gate runs, 2026-11-04) is not always the card's form: the first pipe missing
// ("[[ACT leo-cầu-thang|the_luc+cam_nhan|normal|]]"), spaces after "[[", another case, the closing brackets missing (the tag then ends at
// its line). Every one of those is taken out too; stats.lua (S.hide / parse_act) reads the same variants.
const CLOSED = /(?:[ \t]*\n)?[ \t]*\[\[\s*(?:ACT|BREAK)(?![\p{L}\p{N}_])[^\]\n]*(?:\]\]?|(?=\n)|$)/giu
const OPEN_TAIL = /[ \t]*\[\[\s*(?:ACT|BREAK)(?![\p{L}\p{N}_])[^\]]*$/iu
const PREFIX_TAIL = /[ \t]*\[\[(?:A|AC|B|BR|BRE|BREA)$/i

/** The text with every growth tag taken out, and one still being streamed hidden; text without a tag comes back untouched. */
export function stripStatTags(text: string): string {
    const t = text ?? ''
    if (!/\[\[\s*[ab]/i.test(t)) return t
    const out = t.replace(CLOSED, '').replace(OPEN_TAIL, '').replace(PREFIX_TAIL, '')
    if (out === t) return t
    return out.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
}
