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
const CLOSE = /【ADMIN:\s*Nhiệm vụ (hoàn thành|thất bại|đã xong|đã hủy|đã huỷ)[^】]*】/gu
/** The app's own line after a counted close; a line of this shape the model wrote is taken out (Admin never invents a number). */
const STAMP = /\n?[ \t]*【ADMIN:\s*(?:Điểm nhiệm vụ|GAME OVER)[^】]*】/gu

/** Mission points (owner 2026-11-13; proved in the Zombie repo, tools/stats/formal/quest_z3.py + quest.als): a chat starts at 3, a mission done
 *  gives +1 (ceiling 5), a mission failed costs 1; at 0 it is GAME OVER: the persona loses 30% of the EXP inside its Level and the points start again. */
export const POINTS_START = 3, POINTS_TOP = 5, PENALTY_PCT = 30

export type QuestState = { open: string; age: number; replies: number; points: number
    /** what the NEWEST reply did to the points: a counted close ('done' | 'fail'), and whether it was the game over */
    last: '' | 'done' | 'fail'; over: boolean; marks: number }

/** The mission open now ('' when none), how many replies ago it was last stated, how many replies the chat has, and the points.
 *  A close counts only for a mission that was open BEFORE the reply (a reply cannot hand one out and settle it at once), once per reply;
 *  a close that does not count is not read at all. "đã hủy" closes without a point either way. */
export function questState(messages: Msg[] | undefined): QuestState {
    let open = '', at = -1, replies = 0, points = POINTS_START, last: QuestState['last'] = '', over = false, seen = 0
    for (const m of messages ?? []) {
        if (m?.role !== 'char') continue
        replies++
        last = ''; over = false
        const text = String(m.data ?? '')
        const marks: { i: number; open: string; close: string }[] = []
        for (const x of text.matchAll(CLOSE)) marks.push({ i: x.index ?? 0, open: '', close: x[1] })
        for (const x of text.matchAll(OFFER)) marks.push({ i: x.index ?? 0, open: x[1].trim().replace(/\s+/g, ' '), close: '' })
        marks.sort((a, b) => a.i - b.i)
        const wasOpen = !!open
        let counted = false
        for (const k of marks) {
            seen++
            if (!k.close) { open = k.open; at = replies; continue }
            if (!wasOpen || counted) continue
            counted = true; open = ''; at = replies
            if (/hủy|huỷ/u.test(k.close)) continue
            if (k.close === 'thất bại') {
                last = 'fail'
                if (points <= 1) { over = true; points = POINTS_START } else points--
            } else { last = 'done'; points = Math.min(POINTS_TOP, points + 1) }
        }
    }
    return { open, age: open ? replies - at : 0, replies, points, last, over, marks: seen }
}

/** Level EXP for a mission done at Level L: a fifth of what the Level needs (need_level = floor(100 * L^1.5), event_ledger.py), at least 10. */
export const questReward = (level: number) => Math.max(10, Math.floor(Math.floor(Math.sqrt(10000 * Math.max(1, level) ** 3)) / 5))

/** The newest reply's ledger events: a mission done pays Level EXP, a game over is one penalty event (the store takes 30% of the EXP inside the
 *  Level at that place in the persona's history). They are posted as the events of the reply's own turn, so a regenerated reply replaces them. */
export function questEvents(messages: Msg[] | undefined, level: number): { kind: string; idx: string; level: number; stats: Record<string, number> }[] {
    const s = questState(messages)
    if (messages?.[messages.length - 1]?.role !== 'char') return []
    if (s.over) return [{ kind: 'penalty', idx: 'go', level: PENALTY_PCT, stats: {} }]
    return s.last === 'done' ? [{ kind: 'mission', idx: 'aq', level: questReward(level), stats: {} }] : []
}

/** The newest reply with the app's points line after its counted close (and without any such line the model wrote). Unchanged when nothing counted. */
export function stampPoints(messages: Msg[] | undefined, level: number): string | null {
    const m = messages?.[messages.length - 1]
    if (!m || m.role !== 'char') return null
    const text = String(m.data ?? '')
    const clean = text.replace(STAMP, '')
    const s = questState([...messages!.slice(0, -1), { role: 'char', data: clean }])
    let out = clean
    if (s.last) {
        const line = s.over ? `【ADMIN: GAME OVER — hết điểm nhiệm vụ. Phạt: −${PENALTY_PCT}% EXP của cấp hiện tại. Điểm nhiệm vụ đặt lại ${s.points}/${POINTS_TOP}.】`
            : s.last === 'done' ? `【ADMIN: Điểm nhiệm vụ: ${s.points}/${POINTS_TOP} (+1). Thưởng: +${questReward(level)} EXP.】`
            : `【ADMIN: Điểm nhiệm vụ: ${s.points}/${POINTS_TOP} (−1). Hết điểm là GAME OVER, mất ${PENALTY_PCT}% EXP.】`
        const before = questState(messages!.slice(0, -1))
        let hit = -1, len = 0
        if (before.open) for (const x of clean.matchAll(CLOSE)) { hit = x.index ?? 0; len = x[0].length; break }   // the counted close is the first one
        out = hit < 0 ? clean : clean.slice(0, hit + len) + '\n' + line + clean.slice(hit + len)
    }
    return out === text ? null : out
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
    const stakes = ` Mission points: ${s.points}/${POINTS_TOP}. A mission done makes the persona stronger: +1 point and EXP (the app pays and prints both; Admin writes no number),`
        + ` and the story gives one concrete edge for it. A mission failed costs 1 point; at 0 it is GAME OVER and ${PENALTY_PCT}% of the EXP is lost.`
    if (!s.open) {
        return '\n\n[Nhiệm vụ (ẩn): no mission is open. In this reply Admin hands one out on its own line, 【ADMIN: Nhiệm vụ: … — ….】: one concrete thing'
            + ' doable in this scene or the next, tied to a person, place or thread already in this story, that moves the plot on. The story of this turn is told as usual and the reply ENDS with that line, as its last line. A reply that does not end with a 【ADMIN: Nhiệm vụ: …】 line is incomplete.'
            + (asked ? ' The player asked about the mission: that line is the answer, never silence.' : '') + (s.over ? ' The last reply was the GAME OVER: this scene opens on what that failure cost.' : '') + (s.last === 'done' ? ' The last reply completed a mission: this scene shows the one concrete edge it earned.' : '') + stakes + ']'
    }
    let more = ' The story gives a chance at it without forcing the player. If this reply completes it or makes it impossible, Admin says so in one line'
        + ' (【ADMIN: Nhiệm vụ hoàn thành: ….】 or 【ADMIN: Nhiệm vụ thất bại: ….】); otherwise Admin does not repeat it.'
    if (asked) more = ' The player asked about it: Admin restates it in one line, 【ADMIN: Nhiệm vụ đang mở: ….】, with where it stands, never silence.'
    else if (s.age >= QUEST_STALE_REPLIES) more = ` It has gone ${s.age} replies without a word: in this reply Admin either restates it in one line (【ADMIN: Nhiệm vụ đang mở: ….】)`
        + ' with one concrete lead from what the character has recorded, or, if the story has moved past it, closes it (【ADMIN: Nhiệm vụ thất bại: ….】) and the next reply brings a new one.'
    return `\n\n[Nhiệm vụ (ẩn): open mission: "${s.open}".${more}${stakes}]`
}

/** At the end of the player's message (where the model reads last); unchanged for a scripted card, an Admin ask or the opening. */
export function questRequest<T extends { role: string; content: unknown }>(formated: T[], cardId: string, messages: Msg[] | undefined, ask: boolean): T[] {
    if (ask || SCRIPTED_QUEST_CARDS.includes(cardId)) return formated
    const note = questNote(messages)
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (!note || last < 0 || typeof formated[last].content !== 'string') return formated
    return formated.map((m, i) => (i === last ? { ...m, content: (m.content as string) + note } : m))
}
