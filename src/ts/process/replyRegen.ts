// Regenerate-once for a story reply (2026-11-03): prompt rules did not stop setup exposition, a repeated sentence or an unchanged System
// line, so the app checks the finished reply (replyCheck.mjs, the same checker the acceptance scorer uses) and asks once more.
import { replyHits, type ReplyHit } from './replyCheck.mjs'

/** Only the first attempt is ever redone: never a loop. */
export function shouldRegenerate(hits: ReplyHit[], attempt: number): boolean {
    return hits.length > 0 && attempt === 0
}

const LABEL: Record<ReplyHit['rule'], string> = { setup: 'setup exposition', repeat: 'repeated sentence', system: 'unchanged System line' }

/** The hidden line added to the player's message for the second draft; '' when there is nothing to name. */
export function regenerationNote(hits: ReplyHit[]): string {
    if (!hits.length) return ''
    return `\n\n[Rewrite (hidden, never named): the last draft had: ${hits.map((h) => `${LABEL[h.rule]} "${h.text.slice(0, 160)}"`).join(' / ')}. Rewrite the reply without them.]`
}

/**
 * Check `first`; when it has hits, ask `redo` once with the note and use its draft. A second draft that still has hits is kept and
 * reported through `warn`. `redo` returning null (request failed) keeps the first draft.
 */
export async function settleReply(first: string, previous: string[], redo: (note: string) => Promise<string | null>, warn: (m: string) => void = () => {}): Promise<string> {
    const hits = replyHits(first, previous)
    if (!shouldRegenerate(hits, 0)) return first
    const second = await redo(regenerationNote(hits))
    if (second === null || !second.trim()) { warn('reply check: redo failed, first draft kept'); return first }
    const left = replyHits(second, previous)
    if (left.length) warn(`reply check: second draft still has ${left.map((h) => `${h.rule} "${h.text.slice(0, 60)}"`).join(', ')}`)
    return second
}
