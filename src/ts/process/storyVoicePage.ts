// The page's side of the story voice (storyVoice.ts): the profile is written once per card by the helper and kept with the card
// (extentions.vjVoice), written again when the rules change; a failed or slow helper leaves the turn without the reminder,
// and a slow answer is still kept for the next turn (helperJob.ts).

import { getDatabase, type character } from '../storage/database.svelte'
import { sharedJob, waitAtMost } from './helperJob'
import { parseProfile, profilePrompt, rulesKey, rulesOf, voiceReminder, type VoiceProfile } from './storyVoice'

const TIMEOUT_MS = 30_000

export async function voiceProfileOf(card: character | undefined): Promise<VoiceProfile | null> {
    if (!card || (card as { type?: string }).type === 'group' || getDatabase().storyVoice === false) return null
    const rules = rulesOf(card)
    if (!rules.trim()) return null
    const key = rulesKey(rules)
    card.extentions ??= {}
    const kept = card.extentions.vjVoice as { key: string; profile: VoiceProfile | null } | undefined
    if (kept?.key === key) return kept.profile
    const job = sharedJob(`voice:${key}`, async (signal) => {
        const { requestChatData } = await import('./request/request')
        const res = await requestChatData({ formated: [{ role: 'user', content: profilePrompt(rules) }], bias: {}, useStreaming: false, noMultiGen: true }, 'submodel', signal)
        if (!res || res.type !== 'success' || typeof res.result !== 'string') return null
        const profile = parseProfile(res.result)
        if (profile) card.extentions.vjVoice = { key, profile }
        return profile
    })
    return waitAtMost(job, TIMEOUT_MS)
}

export function voiceRequest<T extends { role: string; content: unknown }>(formated: T[], profile: VoiceProfile | null): T[] {
    const note = voiceReminder(profile)
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (!note || last < 0 || typeof formated[last].content !== 'string') return formated
    return formated.map((m, i) => (i === last ? { ...m, content: (m.content as string) + note } : m))
}
