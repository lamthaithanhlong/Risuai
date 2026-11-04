// Regenerate-once for a story reply (2026-11-03): prompt rules did not stop setup exposition, a repeated sentence or an unchanged System
// line, so the app checks the finished reply (replyCheck.mjs, the same checker the acceptance scorer uses) and asks once more.
import { replyHits, type ReplyHit } from './replyCheck.mjs'

/** Only the first attempt is ever redone: never a loop. */
export function shouldRegenerate(hits: ReplyHit[], attempt: number): boolean {
    return hits.length > 0 && attempt === 0
}

const LABEL: Record<ReplyHit['rule'], string> = { setup: 'setup exposition', repeat: 'repeated sentence', dialogue: 'repeated line of dialogue', system: 'unchanged System line', lang: 'narration not in Vietnamese (trả lời bằng tiếng Việt)', scene: 'repeated scene sentence', tag: 'malformed hidden tag (viết thẻ đúng dạng [[ACT|id|stat|độ khó|skill]] hoặc bỏ thẻ)' }

/** The hidden line added to the player's message for the second draft; '' when there is nothing to name. */
export function regenerationNote(hits: ReplyHit[]): string {
    if (!hits.length) return ''
    const said = hits.filter((h) => h.rule === 'dialogue' || h.rule === 'scene')
    const rest = hits.filter((h) => h.rule !== 'dialogue' && h.rule !== 'scene')
    const parts = [
        ...rest.map((h) => `${LABEL[h.rule]} "${h.text.slice(0, 160)}"`),
        ...said.map((h) => `đừng lặp câu đã nói: "${h.text.slice(0, 160)}"`),
    ]
    return `\n\n[Rewrite (hidden, never named): the last draft had: ${parts.join(' / ')}. Rewrite the reply without them.]`
}

/** Rules that mean "said it again": only these earn a second redo (setup/system/lang/tag keep exactly one). */
export const REPEAT_RULES: ReplyHit['rule'][] = ['repeat', 'dialogue', 'scene']
export const MAX_REDOS = 2

/** The stronger hidden line for the second redo: names the exact lines still repeated and asks for a different direction. */
export function strongRegenerationNote(hits: ReplyHit[]): string {
    if (!hits.length) return ''
    const lines = hits.map((h) => `"${h.text.slice(0, 160)}"`).join(' / ')
    return `\n\n[Rewrite (hidden, never named): the last two drafts still repeated what was already said. đừng lặp câu đã nói: ${lines}; viết hướng khác hẳn (đổi lời thoại, đổi hành động, không nói lại ý đó dưới dạng khác).]`
}

/**
 * Check `first`; when it has hits, ask `redo` with the note and use its draft. When what is left is only repeat-type hits, ask once more
 * with the stronger note (at most MAX_REDOS redos in all, never a loop); of the redo drafts the one with fewer hits is kept (a tie keeps the
 * later). `redo` returning null (request failed) keeps the best draft so far, or the first one when the first redo failed.
 * `redos` and `afterFirst` are additions to the record; `fired`/`left`/`redoFailed` keep their meaning (`left` = after the last redo kept).
 */
export type RegenRecord = { fired: string[]; left: string[]; redoFailed: boolean; redos?: number; afterFirst?: string[] }

export async function settleReply(first: string, previous: string[], redo: (note: string) => Promise<string | null>, warn: (m: string) => void = () => {}, record: (r: RegenRecord) => void = () => {}): Promise<string> {
    const hits = replyHits(first, previous)
    if (!shouldRegenerate(hits, 0)) return first
    const fired = hits.map((h) => h.rule)
    const second = await redo(regenerationNote(hits))
    if (second === null || !second.trim()) { warn('reply check: redo failed, first draft kept'); record({ fired, left: fired, redoFailed: true, redos: 1 }); return first }
    const left = replyHits(second, previous)
    if (left.length && left.every((h) => REPEAT_RULES.includes(h.rule))) {
        const third = await redo(strongRegenerationNote(left))
        const usable = third !== null && third.trim() !== ''
        const left3 = usable ? replyHits(third as string, previous) : left
        const keepThird = usable && left3.length <= left.length
        const kept = keepThird ? (third as string) : second
        const keptLeft = keepThird ? left3 : left
        record({ fired, left: keptLeft.map((h) => h.rule), redoFailed: !usable, redos: 2, afterFirst: left.map((h) => h.rule) })
        if (keptLeft.length) warn(`reply check: after 2 redos still has ${keptLeft.map((h) => `${h.rule} "${h.text.slice(0, 60)}"`).join(', ')}`)
        return kept
    }
    record({ fired, left: left.map((h) => h.rule), redoFailed: false, redos: 1 })
    if (left.length) warn(`reply check: second draft still has ${left.map((h) => `${h.rule} "${h.text.slice(0, 60)}"`).join(', ')}`)
    return second
}
