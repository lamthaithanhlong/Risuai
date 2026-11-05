// The hidden growth tags the narrator writes ([[ACT|id|stat+stat|difficulty|skills]] and, rarely, [[BREAK|stat]]; the card's rule is in
// apocalypse-tham-hoa-zombie/fate-simulator/main_description.md "Growth"). The card's Lua (stats.lua) reads them and takes them out of the
// stored message; this is the client's second hand, the way stripFind is for [[FIND|..]]: a finished tag, and one still being streamed,
// never reach the screen, and one the script did not get to (a card without it) does not stay in the stored text either.

// What the narrator really writes (gate runs, 2026-11-04) is not always the card's form: the first pipe missing
// ("[[ACT leo-cầu-thang|the_luc+cam_nhan|normal|]]"), spaces after "[[", another case, the closing brackets missing (the tag then ends at
// its line). Every one of those is taken out too; stats.lua (S.hide / parse_act) reads the same variants.
// [[NPC|id|wants now|feels|withholding]] (2026-11-05): the hidden inner line the narrator writes before an NPC speaks (npcCheck.mjs
// parseInner reads it from the raw reply); hidden the same way, finished or still streaming.
const CLOSED = /(?:[ \t]*\n)?[ \t]*\[\[\s*(?:ACT|BREAK|NPC)(?![\p{L}\p{N}_])[^\]\n]*(?:\]\]?|(?=\n)|$)/giu
// The quest tags (quests.lua; grammar in ~/.risu-story-work/quest-tag-grammar.md): [[QUEST|done|id]], [[QUEST|fail|id]] and, since the goal contract
// (2026-11-05), [[QUEST|progress|id|n]], with the same tolerance (first pipe missing, spaces, case, the close missing). Only these kinds: the Lua reads
// them before this runs (onOutput) and cuts them itself; the client never interprets one. A tag still streaming is hidden whatever its kind so far.
export const QUEST_KINDS = ['done', 'fail', 'progress'] as const
const QUEST_CLOSED = new RegExp(String.raw`(?:[ \t]*\n)?[ \t]*\[\[\s*QUEST(?![\p{L}\p{N}_])\s*\|?\s*(?:${QUEST_KINDS.join('|')})(?![\p{L}\p{N}_])[^\]\n]*(?:\]\]?|(?=\n)|$)`, 'giu')
const OPEN_TAIL = /[ \t]*\[\[\s*(?:ACT|BREAK|QUEST|NPC)(?![\p{L}\p{N}_])[^\]]*$/iu
const PREFIX_TAIL = /[ \t]*\[\[(?:A|AC|B|BR|BRE|BREA|Q|QU|QUE|QUES|N|NP)$/i

/** The text with every growth tag and quest tag taken out, and one still being streamed hidden; text without a tag comes back untouched. */
export function stripStatTags(text: string): string {
    const t = text ?? ''
    if (!/\[\[\s*[abqn]/i.test(t)) return t
    const out = t.replace(CLOSED, '').replace(QUEST_CLOSED, '').replace(OPEN_TAIL, '').replace(PREFIX_TAIL, '')
    if (out === t) return t
    return out.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
}
