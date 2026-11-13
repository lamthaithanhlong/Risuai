// Admin's missions in a story with no quest script (owner 2026-11-13: "Admin giao nhiệm vụ, dẫn dắt truyện, hỗ trợ người chơi"): Zombie's Lua and
// the Post Office hand out their own; every other story gets a hidden note at the end of the player's message that says whether a mission is
// open and what Admin does about it this reply. Stateless: the open mission is read back from Admin's own lines in the chat
// (【ADMIN: Nhiệm vụ: …】 opens, 【ADMIN: Nhiệm vụ hoàn thành/thất bại: …】 closes). The rules it leans on: admin.md "Missions in every story".
import { WORDS } from './adminSections'

type Msg = { role?: string; data?: string }

/** Cards whose own script or world hands out missions: no note. */
export const SCRIPTED_QUEST_CARDS: readonly string[] = ['zombie', 'mailman']
/** Replies an open mission may go without a word before Admin is told to settle it. */
export const QUEST_STALE_REPLIES = 8

const OFFER = /【ADMIN:\s*Nhiệm vụ(?: mới| đang mở)?\s*[:—-]\s*([^】]+)】/gu
const CLOSE = /【ADMIN:\s*Nhiệm vụ (?:hoàn thành|thất bại|đã xong|đã hủy|đã huỷ)[^】]*】/gu

export type QuestState = { open: string; age: number; replies: number }

/** The mission open now ('' when none), how many replies ago it was last stated, and how many replies the chat has. */
export function questState(messages: Msg[] | undefined): QuestState {
    let open = '', at = -1, replies = 0
    for (const m of messages ?? []) {
        if (m?.role !== 'char') continue
        replies++
        const text = String(m.data ?? '')
        const marks: { i: number; open: string }[] = []
        for (const x of text.matchAll(CLOSE)) marks.push({ i: x.index ?? 0, open: '' })
        for (const x of text.matchAll(OFFER)) marks.push({ i: x.index ?? 0, open: x[1].trim().replace(/\s+/g, ' ') })
        marks.sort((a, b) => a.i - b.i)
        for (const k of marks) { open = k.open; at = replies }
    }
    return { open, age: open ? replies - at : 0, replies }
}

const has = (re: RegExp, text: string) => {
    const t = text.toLowerCase().normalize('NFC')
    return re.test(t) || re.test(t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd'))
}

/** The hidden note for this turn, '' on the opening (Admin connects first). */
export function questNote(messages: Msg[] | undefined): string {
    const s = questState(messages)
    if (s.replies === 0) return ''
    const player = [...(messages ?? [])].reverse().find((m) => m?.role === 'user')?.data ?? ''
    const asked = has(WORDS.questWords, player) || /(?<![a-z])nhiem vu(?![a-z])/i.test(player)
    if (!s.open) {
        return '\n\n[Nhiệm vụ (ẩn): no mission is open. In this reply Admin hands one out on its own line, 【ADMIN: Nhiệm vụ: … — ….】: one concrete thing'
            + ' doable in this scene or the next, tied to a person, place or thread already in this story, that moves the plot on. The story of this turn is told as usual and the reply ENDS with that line, as its last line. A reply that does not end with a 【ADMIN: Nhiệm vụ: …】 line is incomplete.'
            + (asked ? ' The player asked about the mission: that line is the answer, never silence.' : '') + ']'
    }
    let more = ' The story gives a chance at it without forcing the player. If this reply completes it or makes it impossible, Admin says so in one line'
        + ' (【ADMIN: Nhiệm vụ hoàn thành: ….】 or 【ADMIN: Nhiệm vụ thất bại: ….】); otherwise Admin does not repeat it.'
    if (asked) more = ' The player asked about it: Admin restates it in one line, 【ADMIN: Nhiệm vụ đang mở: ….】, with where it stands, never silence.'
    else if (s.age >= QUEST_STALE_REPLIES) more = ` It has gone ${s.age} replies without a word: in this reply Admin either restates it in one line (【ADMIN: Nhiệm vụ đang mở: ….】)`
        + ' with one concrete lead from what the character has recorded, or, if the story has moved past it, closes it (【ADMIN: Nhiệm vụ thất bại: ….】) and the next reply brings a new one.'
    return `\n\n[Nhiệm vụ (ẩn): open mission: "${s.open}".${more}]`
}

/** At the end of the player's message (where the model reads last); unchanged for a scripted card, an Admin ask or the opening. */
export function questRequest<T extends { role: string; content: unknown }>(formated: T[], cardId: string, messages: Msg[] | undefined, ask: boolean): T[] {
    if (ask || SCRIPTED_QUEST_CARDS.includes(cardId)) return formated
    const note = questNote(messages)
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (!note || last < 0 || typeof formated[last].content !== 'string') return formated
    return formated.map((m, i) => (i === last ? { ...m, content: (m.content as string) + note } : m))
}
