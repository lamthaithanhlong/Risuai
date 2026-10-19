// What the player sees of a story reply: no planning, no GM notes (asked 2026-10-19 after the Game Master A/B, where the judges
// saw the narrator's planning and GM notes in the story). Measured over 13 runs x 2 cards x 11 replies:
//   - "<thinking>…</thinking>" at the start of 18 replies: cot.ts (splitCoT) already moves it out of the chat into the thought
//     panel and keeps it in the stored message, as Risu does for reasoning, so it is left to cot.ts;
//   - planning written as plain English paragraphs inside a Vietnamese story ("The player has confirmed the character. Now I need
//     to run Initialization…", "Dice: QUIET — no new trouble…", "GM note says…") in 8 replies, up to 7,000 characters before
//     the story: no Risu stage handles it, so it is taken out of the shown text AND of the stored message;
//   - a thought opened and never closed at the start of a finished reply would hide the whole story in the thought panel: the
//     closing tag is put back where the story starts, so the reasoning stays stored and the story shows.

import { splitCoT } from '../parser/cot'

const VI = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/gi
const viRatio = (p: string) => (p.match(VI)?.length ?? 0) / Math.max(1, p.length)
const STOP = new Set(['the', 'and', 'to', 'of', 'is', 'a', 'i', 'it', 'that', 'this', 'but', 'so', 'need', 'should', 'player', 'reply',
    'let', 'me', 'we', 'be', 'in', 'for', 'with', 'now', 'not', 'what', 'they', 'he', 'she', 'his', 'her', 'will', 'must', 'can', 'my'])
/** Words a planning paragraph uses about the reply itself. */
const PLAN = /\b(let me|i need|i'll|i will|i should|the player|the reply|this reply|gm note|the note|dice|focus|beat|the arc|the scene should|status block|module \d+|initialization)\b/i

/** A paragraph of English planning: many English words, mostly function words, few Vietnamese letters, and talk of the reply. */
export function isPlanning(p: string): boolean {
    const t = p.trim()
    if (!t || /^\s*[[【☆★◆]/.test(t)) return false          // a panel line or a script block, not prose
    if (viRatio(t) >= 0.04) return false
    const words = t.toLowerCase().match(/[a-z']+/g) ?? []
    if (words.length < 12) return false
    const stop = words.filter((w) => STOP.has(w)).length / words.length
    return stop >= 0.2 && PLAN.test(t)
}

/** English prose (not a panel, not a script line): once a reply has planning in it, its other English prose paragraphs are planning
 *  too (measured: "Hmm, Whitlock isn't really an enemy…", "Simpler: consequence = …", "Write in Vietnamese, dark prose…" carry no
 *  planning word of their own). */
export function isEnglishProse(p: string): boolean {
    const t = p.trim()
    if (!t || /^\s*[[【☆★◆]/.test(t)) return false
    // a draft that opens like one ("Let me write the three questions. Marlowe asks: 1. "Nếu…"") even with Vietnamese quoted in it
    if (/^(let me|let's|i'll|i will|maybe|alternatively|hmm|actually)\b/i.test(t) && viRatio(t) < 0.1) return true
    // a Vietnamese word quoted inside the plan ("Mắt Cân", "bạn") raises the share a little; the story itself is 0.10 and up
    if (viRatio(t) >= 0.08) return false
    if (/^(let me|let's|i'll|i will|now (i|let)|text|draft|plan)\b[^\n]{0,40}[.:]?$/i.test(t)) return true     // "Let me draft."
    const words = t.toLowerCase().match(/[a-z']+/g) ?? []
    if (words.length < 6) return false
    return words.filter((w) => STOP.has(w)).length / words.length >= 0.12 || /^(hmm|actually|alternative|simpler|better|also|so|then|wait|ok|okay)\b/i.test(t)
}

/** The reply's story is told in Vietnamese (at least one paragraph clearly is). */
export function toldInVietnamese(paras: string[]): boolean {
    return paras.some((p) => viRatio(p) >= 0.1 && p.trim().length >= 40)
}

/** A GM or bookkeeper note line outside a [[GM]] block: "[GM: …]", "(GM note …)", "GM note says …", "Dice: QUIET …". */
const GM_LINE = /^[ \t]*(?:\[(?!\[)\s*(?:GM|Game Master)\b[^\n]*|\(\s*(?:GM|Game Master)\b[^\n]*|(?:GM|Game Master|Bookkeeper) note\b[^\n]*|(?:Dice|Focus|Pace)\s*:\s*(?:QUIET|BUILD|ADVANCE|ESCALATE|the (?:side|arc|antagonist|threat|enemy|goal|path)\b)[^\n]*)[ \t]*(?:\n|$)/gim

export function stripGmTalk(text: string): string {
    const t = text ?? ''
    const out = t.replace(GM_LINE, '')
    return out === t ? t : out.replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n')
}

/** The reply without planning paragraphs, for a story told in Vietnamese; unchanged otherwise. A thought (<Thoughts>, <think>)
 *  is cot.ts's: only the text outside it is looked at, the thought is kept as written. */
export function dropPlanning(text: string): string {
    const t = text ?? ''
    const parts = splitCoT(t).parts
    const outside = parts.filter((p) => p.kind === 'text').map((p) => p.text).join('\n\n').split(/\n[ \t]*\n/)
    if (!toldInVietnamese(outside) || !outside.some(isPlanning)) return t
    const out = parts.map((p) => {
        if (p.kind !== 'text') return p.text
        const paras = p.text.split(/(\n[ \t]*\n)/)
        const kept: string[] = []
        for (let i = 0; i < paras.length; i += 2) if (!isPlanning(paras[i]) && !isEnglishProse(paras[i])) kept.push(paras[i])
        return kept.join('\n\n')
    }).join('')
    return out.replace(/^\s+(?=\S)/, '').replace(/\n{3,}/g, '\n\n')
}

const OPEN = /^\s*<(Thoughts|thinking|think)>/
/** A finished reply that opens a thought and never closes it: the closing tag goes back where the Vietnamese story starts. */
export function closeLeadingThought(text: string): string {
    const t = text ?? ''
    const m = OPEN.exec(t)
    if (!m || new RegExp(`</${m[1]}>`).test(t)) return t
    const body = t.slice(m[0].length)
    const paras = body.split(/(\n[ \t]*\n)/)
    for (let i = 0; i < paras.length; i += 2) {
        if (i > 0 && viRatio(paras[i]) >= 0.1 && paras[i].trim().length >= 40) {
            const head = paras.slice(0, i).join('')
            return `${m[0]}${head.replace(/\s+$/, '')}</${m[1]}>\n\n${paras.slice(i).join('').replace(/^\s+/, '')}`
        }
    }
    return t
}

/** What to keep of a finished reply (stored): the thought closed, planning paragraphs and GM note lines out. */
export function tidyReply(text: string): string {
    return dropPlanning(stripGmTalk(closeLeadingThought(text)))
}

/** What the screen shows of any message (after cot.ts took the thought out). */
export function tidyDisplay(text: string): string {
    return dropPlanning(stripGmTalk(text))
}

/** After a reply: the chat's last story reply is stored tidy (not a group's other messages, not the player's). */
export function tidyLastReply(chat: { message: { role: string; data: string }[] } | undefined): boolean {
    const at = (chat?.message?.length ?? 0) - 1
    const reply = chat?.message?.[at]
    if (!chat || !reply || reply.role !== 'char') return false
    const tidy = tidyReply(reply.data)
    if (tidy === reply.data) return false
    chat.message[at] = { ...reply, data: tidy }
    return true
}

// Measured 2026-10-19 (narrator gpt-6-luna, Infinite Mailman t3): the Initialization reply opened its panel block with a CJK
// bracket, "【STATUS … ]]", so the card's script (which reads "[[STATUS … ]]") never saw it and the player read the block as
// text. A block opener written with other brackets is put back in the cards' form before the card's script reads the reply.
const OPENER = /^([ \t]*)(?:【{1,2}|［{1,2}|〔{1,2}|\[(?!\[)|\[\[\s+)\s*(STATUS|LEDGER|GM)\b/gm
const CLOSER = /^([ \t]*)(?:】{1,2}|］{1,2}|〕{1,2})[ \t]*$/gm

// Measured 2026-10-19 afternoon (the story slot answering through ChatGPT web, acceptance: 44 of 50 replies over three cards):
// the text comes back as Markdown copied from the rendered page. "[[STATUS" arrives as "\[\[STATUS  " (escaped, a hard-break
// double space), the Spell's line as "\[Ứng viên! …\]", and the cards' tags as links: "[[LOOK Elias Mercer | <look>]]" as
// "[<look>](<LOOK Elias Mercer.md>)", "[[img: <scene>]]" as "[img: <scene>](<img: <scene>.md>)". No block reached the card's
// script: no panel, no GM notes, every block shown to the player. Both are put back first.
const WIKILINK = /\[([^[\]\n]*)\]\(<([^<>\n]+?)\.md>\)/g
const MD_ESCAPE = /\\([\\`*_{}[\]()#+\-.!|>~=])/g

/** A reply written as rendered-then-copied Markdown, back in the plain text the cards read; any other reply unchanged. */
export function unMarkdown(text: string): string {
    let t = text ?? ''
    if (/\]\(<[^<>\n]+?\.md>\)/.test(t)) t = t.replace(WIKILINK, (_, alias: string, target: string) => alias.trim() === target.trim() ? `[[${target.trim()}]]` : `[[${target.trim()} | ${alias.trim()}]]`)
    if (/\\[[\]]/.test(t)) t = t.replace(MD_ESCAPE, '$1').replace(/[ \t]+$/gm, '').replace(/^([ \t]*)\]{3,}$/gm, '$1]]')
    return t
}

/** The reply with its hidden blocks opened "[[STATUS", "[[LEDGER", "[[GM" and closed "]]" whatever brackets the model used. */
// Measured 2026-10-19 evening (Infinite Mailman t10, gpt-6-luna): after a right "[[GM … ]]" the narrator wrote a block of its
// own name, "[[CHANGE\nenemy: … | …\nthreat: … | …\n]]" (the GM note said "[[GM …]] + changed lines"); no script knows CHANGE,
// so the player read it. A block whose every line is a GM note line is a GM block, whatever it is called.
const STRAY = /^([ \t]*)\[\[([A-Z][A-Z_]{1,20})[ \t]*\n([\s\S]*?)\n[ \t]*\]\]/gm
const KNOWN_BLOCK = new Set(['STATUS', 'LEDGER', 'GM', 'LOOK', 'IMG'])
const GM_NOTE_ROW = /^[ \t]*(arc|beat|threat|path|enemy|enemies|gained|reward|consequence|canon)[ \t]*:/i
const strayToGm = (t: string) => t.replace(STRAY, (all, pad: string, name: string, body: string) => {
    const rows = body.split('\n').filter((l) => l.trim())
    return !KNOWN_BLOCK.has(name) && rows.length && rows.every((l) => GM_NOTE_ROW.test(l)) ? `${pad}[[GM\n${body}\n]]` : all
})

export function fixBlockBrackets(text: string): string {
    const t = strayToGm(unMarkdown(text ?? ''))
    if (!/(【|［|〔|\[(?!\[)|\[\[\s+)\s*(STATUS|LEDGER|GM)\b/.test(t)) return t
    return t.replace(OPENER, '$1[[$2').replace(CLOSER, '$1]]')
}

/** Before the card's output script: the last story reply's block brackets fixed (fixBlockBrackets). */
export function fixLastReplyBlocks(chat: { message: { role: string; data: string }[] } | undefined): boolean {
    const at = (chat?.message?.length ?? 0) - 1
    const reply = chat?.message?.[at]
    if (!chat || !reply || reply.role !== 'char') return false
    const fixed = fixBlockBrackets(reply.data)
    if (fixed === reply.data) return false
    chat.message[at] = { ...reply, data: fixed }
    return true
}
