// The page's side of the story glossary (storyTerms.ts): written once per card by the helper, kept with the card
// (extentions.vjTerms), written again when the rules change; a failed or slow helper leaves the turn without it,
// and a slow answer is still kept for the next turn (helperJob.ts).

import { getDatabase, type character } from '../storage/database.svelte'
import { sharedJob, waitAtMost } from './helperJob'
import { rulesKey, rulesOf } from './storyVoice'
import { glossaryPrompt, parseGlossary, termsReminder, termsUsed, type Term } from './storyTerms'

const TIMEOUT_MS = 40_000

export async function glossaryOf(card: character | undefined): Promise<Term[] | null> {
    if (!card || (card as { type?: string }).type === 'group' || getDatabase().storyTerms === false) return null
    const rules = rulesOf(card)
    if (!rules.trim()) return null
    const key = rulesKey(rules)
    card.extentions ??= {}
    const kept = card.extentions.vjTerms as { key: string; terms: Term[] } | undefined
    if (kept?.key === key) return kept.terms
    const job = sharedJob(`terms:${key}`, async (signal) => {
        const { requestChatData } = await import('./request/request')
        const res = await requestChatData({ formated: [{ role: 'user', content: glossaryPrompt(rules) }], bias: {}, useStreaming: false, noMultiGen: true }, 'submodel', signal)
        if (!res || res.type !== 'success' || typeof res.result !== 'string') return null
        const terms = parseGlossary(res.result)
        if (terms) card.extentions.vjTerms = { key, terms }
        return terms
    })
    return waitAtMost(job, TIMEOUT_MS)
}

/** The meanings of the terms the player's message uses, at the end of that message. */
export function termsRequest<T extends { role: string; content: unknown }>(formated: T[], glossary: Term[] | null, playerText: string): T[] {
    const note = termsReminder(termsUsed(glossary, playerText))
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (!note || last < 0 || typeof formated[last].content !== 'string') return formated
    return formated.map((m, i) => (i === last ? { ...m, content: (m.content as string) + note } : m))
}
