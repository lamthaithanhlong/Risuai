// Report-only "causeless effect" judge (ConStory-Bench causal-logic error type): an effect with no plausible cause in the scene's
// own world, e.g. a faint scratch outside the door making a phone speaker vibrate in someone's hand. It never changes a score;
// it lists findings, and a finding whose quote is not copied verbatim from the reply is not trusted (moved to `rejected`).
import { askClaude } from './judge.mjs'

/** the char replies of a risuChat export, with [💡…] and [[…]] blocks and 【HỆ THỐNG…】 lines stripped */
export function chatReplies(exportJson) {
    const msgs = exportJson?.data?.message ?? exportJson?.message ?? []
    return msgs
        .filter((m) => m && m.role === 'char')
        .map((m) => String(m.data ?? '')
            .replace(/\[\[[\s\S]*?\]\]/g, '')
            .replace(/\[💡[\s\S]*?\]/g, '')
            .replace(/^.*【HỆ THỐNG[^\n]*$/gm, '')
            .replace(/\n{3,}/g, '\n\n')
            .trim())
}

export function logicPrompt(replies) {
    const body = replies.map((r, i) => `=== REPLY ${i} ===\n${r}`).join('\n\n')
    return `You check the narrator's prose of an interactive story (written in Vietnamese) for CAUSELESS EFFECTS.
A finding is one of:
- an effect that has no plausible physical or causal path from its cause in the scene's own world (sound moves an object only through contact or strong vibration; light, smell or a faint noise do not move or shake held things);
- a thing known that nobody in the scene could know;
- an object that appears or changes without any cause;
- a contradiction with an earlier sentence.
Rules:
- Genre fiction events are allowed (zombies, a System overlay, supernatural powers). Only report the causal link that the text itself states or implies.
- If unsure, return nothing: an empty findings list is a good answer.
- The quote MUST be copied verbatim (character for character) from the reply it names; never paraphrase or shorten with "...".
- "reply" is the index of the reply the quote comes from.

${body}

Answer only JSON, nothing else: {"findings":[{"reply":<index>,"quote":"<exact sentence from the reply>","cause":"<the stated or implied cause>","effect":"<the stated effect>","why":"<why the cause cannot produce the effect>"}]}`
}

export function parseLogic(text, replies) {
    const out = { findings: [], rejected: [] }
    const m = /\{[\s\S]*\}/.exec(String(text ?? '').replace(/```json|```/g, ''))
    if (!m) return out
    let j
    try { j = JSON.parse(m[0]) } catch { return out }
    for (const f of Array.isArray(j?.findings) ? j.findings : []) {
        const src = replies[f?.reply]
        if (typeof f?.quote === 'string' && f.quote && typeof src === 'string' && src.includes(f.quote)) out.findings.push(f)
        else out.rejected.push(f)
    }
    return out
}

export async function judgeLogic(replies, { model = 'claude:sonnet', ask = askClaude } = {}) {
    const raw = await ask(String(model).replace(/^claude:/i, ''), logicPrompt(replies))
    return { ...parseLogic(raw, replies), raw }
}
