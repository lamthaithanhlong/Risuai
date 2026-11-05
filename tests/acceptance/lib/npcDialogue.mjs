// npc.dialogue: a model judge of how the people in the story talk (owner 2026-11-05: "npc hội thoại lúc nào cũng ngu ngu, đọc người
// phụ nữ hội thoại á nghe rất ngu người luôn"; the 704 balcony woman said “Đừng gọi ai. Tôi bị kính cửa thôi.” then a bare
// “Anh có thuốc giảm đau không?”). A regex cannot tell a whole Vietnamese sentence from a telegram, or a missing reason from a fine
// one, so each NPC line goes to the judge with its paragraph and is graded on six points: grammar, whole sentences (not telegram),
// address terms, motive, consistent with what the speaker needs, asked for and got (rule npc-contradicts-need: “Vậy anh giữ lại mà
// dùng. Tôi chỉ xin thuốc giảm đau.” right after she needed fever medicine and had pulled the painkillers over), not a quest giver (rule npc-quest-hook: owner 2026-11-05, “Có một phòng khám gần Kisaragi Cũ… nếu anh tìm
// được thuốc ở đó, tôi sẽ tin lời anh hơn.” is an errand-and-bargain, not a person), natural Vietnamese (not machine-translated).
// A line passes only when all seven hold.
// Not wired into run.mjs / questChecks: report-only until L1 approves it. The model call is injectable (`ask`, the same signature as
// judge.mjs askClaude), so the tests run with a stub and the live check with the acceptance runs' judge slot (claude:sonnet).
import { askClaude } from './judge.mjs'

// npcLines lives in the app's checker now (one extractor for the app, this judge and npcRules.mjs)
import { npcLines } from '../../../src/ts/process/npcCheck.mjs'
export { npcLines }

const stripped = (r) => String(r ?? '').replace(/\[\[[\s\S]*?\]\]/g, '').replace(/\[💡[\s\S]*?\]/g, '').trim()

export function dialoguePrompt(items, { listener = '' } = {}) {
    const earlier = []
    const body = items.map((it, i) => {
        let head = ''
        if (it.earlier && !earlier.includes(it.earlier)) { earlier.push(it.earlier); head = `=== EARLIER IN THE SCENE (the reply before; context only, not graded) ===\n${it.earlier}\n\n` }
        return `${head}=== LINE ${i} ===\nParagraph: ${it.para}\nLine: “${it.line}”`
    }).join('\n\n')
    return `You grade the SPOKEN LINES of the non-player characters (NPCs) of a Vietnamese interactive story, as a native Vietnamese editor.
${listener ? `The player's character, whom NPCs usually talk to: ${listener}.\n` : ''}For each line, judge only the words inside the quotes, using the paragraph to know who speaks, to whom and in what situation.
Seven checks, each true or false:
- grammar: a correct Vietnamese sentence; no missing verb or wrong word ("Tôi bị kính cửa thôi" is false: the verb "cứa"/"cắt" is missing and "kính cửa" is a noun).
- whole: complete sentences with subject and verb, the way a real person talks; false for a telegram of bare fragments ("Căn 704. Đừng mở cửa. Có thứ đang lên.", "Tôi chỉ cần nước. Túi đồ rơi mất rồi."). A scream of a few words in a fight or a chase is true.
- address: address terms fit the speaker's and listener's age and relationship (anh, chị, em, cô, chú, bác, cậu, cháu, tôi, a name); false when a request or a question to the listener uses no address term at all, or the terms clash.
- motive: when the line asks for something, warns or proposes, the reason or the feeling behind it is in the line or the paragraph; false for a bare request with no reason ("Anh có thuốc giảm đau không?" with nothing about why). A line that asks nothing is true.
- hook: the line is a real person reacting to the person in front of them, saying what they know, feel and need; false (rule npc-quest-hook) when the NPC acts as a quest giver: sends the listener on an errand, points to another place to go, or offers a quest-style bargain "if you do X, I will Y" that the scene gave no reason for ("Có một phòng khám gần Kisaragi Cũ… nếu anh tìm được thuốc ở đó, tôi sẽ tin lời anh hơn." is false; "Cánh tay tôi bị cứa. Tôi cần thuốc hạ sốt, hoặc thứ gì đó để rửa vết thương." is true).
- consistent: the line agrees with what this speaker needs, asked for, received and said earlier in the scene (the earlier reply and her earlier lines); false (rule npc-contradicts-need) when, with no reason given in the scene, she refuses what she needs or asked for, asks for what she already received, or denies what she said ("Vậy anh giữ lại mà dùng. Tôi chỉ xin thuốc giảm đau." after she said she needs fever medicine and already pulled the painkillers over is false; "Anh còn thuốc giảm đau không? Tay tôi đau lắm." is true). With nothing earlier to compare, true.
- natural: it sounds like a real Vietnamese person of that age and situation, with feeling in the words; false when it reads machine-translated or flat ("Có thứ gì đó đang lên cầu thang", "Tôi không bảo anh tin tôi").
Be strict: a line a native speaker would find clipped, flat or odd fails. Do not grade the narration.

${body}

Answer only JSON, nothing else: {"lines":[{"i":<index>,"grammar":true|false,"whole":true|false,"address":true|false,"motive":true|false,"hook":true|false,"consistent":true|false,"natural":true|false,"why":"<one short reason in English for any false>"}]}`
}

const CHECKS = ['grammar', 'whole', 'address', 'motive', 'hook', 'consistent', 'natural']
/** the named rule a failed check reports under (hook is the owner's second class: the NPC used as a quest dispenser) */
export const RULE_OF = { grammar: 'npc-grammar', whole: 'npc-telegram', address: 'npc-address', motive: 'npc-motive', hook: 'npc-quest-hook', consistent: 'npc-contradicts-need', natural: 'npc-unnatural' }

/** The judge's answer, one verdict per line; a line the judge skipped or answered without all seven booleans is `unjudged`, never a pass. */
export function parseDialogue(text, items) {
    const out = { lines: items.map((it, i) => ({ i, line: it.line, verdict: 'unjudged' })) }
    const m = /\{[\s\S]*\}/.exec(String(text ?? '').replace(/```json|```/g, ''))
    if (!m) return out
    let j
    try { j = JSON.parse(m[0]) } catch { return out }
    for (const g of Array.isArray(j?.lines) ? j.lines : []) {
        const row = out.lines[g?.i]
        if (!row || row.verdict !== 'unjudged') continue
        if (!CHECKS.every((k) => typeof g[k] === 'boolean')) continue
        const failed = CHECKS.filter((k) => g[k] === false)
        Object.assign(row, Object.fromEntries(CHECKS.map((k) => [k, g[k]])), { failed, why: String(g.why ?? ''), verdict: failed.length ? 'fail' : 'pass' })
    }
    return out
}

/** npc.dialogue over judged lines: red when a judged line fails above maxFailRate, or when any line went unjudged. */
export function scoreDialogue(parsed, { maxFailRate = 0.2 } = {}) {
    const lines = parsed?.lines ?? []
    const judged = lines.filter((l) => l.verdict !== 'unjudged')
    const failed = judged.filter((l) => l.verdict === 'fail')
    const unjudged = lines.length - judged.length
    const rate = judged.length ? failed.length / judged.length : 0
    const byCheck = Object.fromEntries(CHECKS.map((k) => [k, judged.filter((l) => l[k] === false).length]))
    const byRule = Object.fromEntries(CHECKS.map((k) => [RULE_OF[k], byCheck[k]]))
    return {
        name: 'npc.dialogue',
        ok: unjudged === 0 && rate <= maxFailRate,
        total: lines.length, judged: judged.length, failed: failed.length, unjudged, rate, byCheck, byRule,
        examples: failed.slice(0, 3).map((l) => `“${l.line}” (${l.failed.join(', ')}${l.why ? ': ' + l.why : ''})`),
    }
}

/** Judge the NPC lines of some replies: { lines, score, raw }. No NPC line: nothing to grade, green, no model call. */
export async function judgeDialogue(replies, { model = 'claude:sonnet', ask = askClaude, player = '', listener = '', maxFailRate = 0.2 } = {}) {
    // each line carries the reply before it (its last 1800 characters) so the judge can tell a contradiction of a need or a gift
    const list = Array.isArray(replies) ? replies : [replies]
    const items = list.flatMap((r, k) => npcLines(r, { player }).map((it) => (k > 0 ? { ...it, earlier: stripped(list[k - 1]).slice(-1800) } : it)))
    if (!items.length) return { ...parseDialogue('', items), score: scoreDialogue({ lines: [] }, { maxFailRate }), raw: '' }
    const raw = await ask(String(model).replace(/^claude:/i, ''), dialoguePrompt(items, { listener }))
    const parsed = parseDialogue(raw, items)
    return { ...parsed, score: scoreDialogue(parsed, { maxFailRate }), raw }
}
