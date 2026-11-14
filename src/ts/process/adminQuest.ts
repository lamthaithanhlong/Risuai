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

const OFFER = /【ADMIN:\s*Nhiệm vụ(?: mới| đang mở)?(?:\s*\(\s*(dễ|vừa|khó|rất khó)\s*\))?\s*[:—-]\s*([^】]+)】/gu
/** A mission's grade -> percent of what the Level needs, paid as Level EXP when it is done (owner 2026-11-13: one flat reward for every mission was
 *  too wide). No grade on the line = vừa. */
export const QUEST_TIER_PCT: Record<string, number> = { 'dễ': 5, 'vừa': 10, 'khó': 20, 'rất khó': 35 }
// "hết hạn" is the Admin module's line for a mission whose deadline passed (quests.lua): a mission not done in time is a mission failed
const CLOSE = /【ADMIN:\s*Nhiệm vụ (hoàn thành|thất bại|hết hạn|đã xong|đã hủy|đã huỷ)[^】]*】/gu
/** Does the Admin module's own quest script run in this chat (it seeds $quest_seed on its first request)? Then ONE system hands out and pays
 *  missions (owner 2026-11-13: "thưởng phạt ko rõ": two systems printed two different rewards for one mission and paid both): the module offers,
 *  counts and pays the EXP its lines state; the app only keeps the points (and the game over) and says them. */
export const moduleRunsQuests = (scriptstate: Record<string, unknown> | undefined): boolean => !!String(scriptstate?.$quest_seed ?? '')
/** The app's own line after a counted close; a line of this shape the model wrote is taken out (Admin never invents a number). */
const STAMP = /\n?[ \t]*【ADMIN:\s*(?:Điểm nhiệm vụ|GAME OVER)[^】]*】/gu

/** Mission points (owner 2026-11-13; proved in the Zombie repo, tools/stats/formal/quest_z3.py + quest.als): a chat starts at 3, a mission done
 *  gives +1 (ceiling 5), a mission failed costs 1; at 0 it is GAME OVER: the persona loses 30% of ALL the EXP it has earned (the Level can drop) and the points start again. */
export const POINTS_START = 3, POINTS_TOP = 5, PENALTY_PCT = 30

export type QuestState = { open: string; age: number; replies: number; points: number
    /** what the NEWEST reply did to the points: a counted close ('done' | 'fail'), and whether it was the game over */
    last: '' | 'done' | 'fail'; over: boolean; marks: number
    /** the grade of the open mission, and of the one the newest reply closed */
    tier: string; lastTier: string }

/** The mission open now ('' when none), how many replies ago it was last stated, how many replies the chat has, and the points.
 *  A close counts only for a mission that was open BEFORE the reply (a reply cannot hand one out and settle it at once), once per reply;
 *  a close that does not count is not read at all. "đã hủy" closes without a point either way. */
export function questState(messages: Msg[] | undefined): QuestState {
    let open = '', at = -1, replies = 0, points = POINTS_START, last: QuestState['last'] = '', over = false, seen = 0, tier = 'vừa', lastTier = 'vừa'
    for (const m of messages ?? []) {
        if (m?.role !== 'char') continue
        replies++
        last = ''; over = false
        const text = String(m.data ?? '')
        const marks: { i: number; open: string; close: string; tier?: string; again?: boolean }[] = []
        for (const x of text.matchAll(CLOSE)) marks.push({ i: x.index ?? 0, open: '', close: x[1] })
        for (const x of text.matchAll(OFFER)) {
            // the grade is also read right after the colon ("Nhiệm vụ: (dễ) …", measured on the model 2026-11-13)
            const g = /^\(\s*(dễ|vừa|khó|rất khó)\s*\)\s*/u.exec(x[2].trim())
            marks.push({ i: x.index ?? 0, open: x[2].trim().slice(g ? g[0].length : 0).replace(/\s+/g, ' '), close: '', tier: x[1] ?? g?.[1], again: /đang mở/u.test(x[0].slice(0, 30)) })
        }
        marks.sort((a, b) => a.i - b.i)
        const wasOpen = !!open
        let counted = false
        for (const k of marks) {
            seen++
            if (!k.close) { if (!(k.again && open)) tier = k.tier ?? 'vừa'; open = k.open; at = replies; continue }
            if (!wasOpen || counted) continue
            counted = true; open = ''; at = replies; lastTier = tier
            if (/hủy|huỷ/u.test(k.close)) continue
            if (k.close === 'thất bại' || k.close === 'hết hạn') {
                last = 'fail'
                if (points <= 1) { over = true; points = POINTS_START } else points--
            } else { last = 'done'; points = Math.min(POINTS_TOP, points + 1) }
        }
    }
    return { open, age: open ? replies - at : 0, replies, points, last, over, marks: seen, tier, lastTier }
}

/** Level EXP for a mission done at Level L: its grade's percent of what the Level needs (need_level = floor(100 * L^1.5), event_ledger.py), at least 5. */
export const questReward = (level: number, tier = 'vừa') =>
    Math.max(5, Math.floor(Math.floor(Math.sqrt(10000 * Math.max(1, level) ** 3)) * (QUEST_TIER_PCT[tier] ?? QUEST_TIER_PCT['vừa']) / 100))

/** The newest reply's ledger events: a mission done pays Level EXP, a game over is one penalty event (the store takes 30% of all the EXP earned,
 *  at that place in the persona's history; the Level can drop). They are posted as the events of the reply's own turn, so a regenerated reply replaces them. */
export function questEvents(messages: Msg[] | undefined, level: number, scripted = false): { kind: string; idx: string; level: number; stats: Record<string, number> }[] {
    const s = questState(messages)
    if (messages?.[messages.length - 1]?.role !== 'char') return []
    if (s.over) return [{ kind: 'penalty', idx: 'go', level: PENALTY_PCT, stats: {} }]
    return s.last === 'done' && !scripted ? [{ kind: 'mission', idx: 'aq', level: questReward(level, s.lastTier), stats: {} }] : []
}

/** The newest reply with the app's points line after its counted close (and without any such line the model wrote). Unchanged when nothing counted. */
export function stampPoints(messages: Msg[] | undefined, level: number, scripted = false): string | null {
    const m = messages?.[messages.length - 1]
    if (!m || m.role !== 'char') return null
    const text = String(m.data ?? '')
    const clean = text.replace(STAMP, '')
    const s = questState([...messages!.slice(0, -1), { role: 'char', data: clean }])
    let out = clean
    if (s.last) {
        const line = s.over ? `【ADMIN: GAME OVER — hết điểm nhiệm vụ. Phạt: −${PENALTY_PCT}% tổng EXP, cấp có thể tụt. Điểm nhiệm vụ đặt lại ${s.points}/${POINTS_TOP}.】`
            // the module's own line above this one already states the EXP it paid: the app adds only the points, and what losing them means
            : s.last === 'done' ? (scripted ? `【ADMIN: Điểm nhiệm vụ: ${s.points}/${POINTS_TOP} (+1, tối đa ${POINTS_TOP}). Thất bại hoặc hết hạn: −1 điểm; về 0 là GAME OVER, mất ${PENALTY_PCT}% tổng EXP.】`
                : `【ADMIN: Điểm nhiệm vụ: ${s.points}/${POINTS_TOP} (+1). Thưởng (${s.lastTier}): Level +${questReward(level, s.lastTier)} EXP.】`)
            : `【ADMIN: Điểm nhiệm vụ: ${s.points}/${POINTS_TOP} (−1, không có thưởng). Về 0 điểm là GAME OVER, mất ${PENALTY_PCT}% tổng EXP.】`
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
        + ` and the story gives one concrete edge for it. A mission failed costs 1 point; at 0 it is GAME OVER and ${PENALTY_PCT}% of all its EXP is lost (the Level can drop).`
    if (!s.open) {
        return '\n\n[Nhiệm vụ (ẩn): no mission is open. In this reply Admin hands one out on its own line, 【ADMIN: Nhiệm vụ (dễ|vừa|khó|rất khó): … — ….】, graded honestly by its risk and effort (the grade sets the EXP; most are dễ or vừa): one concrete thing'
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
export function questRequest<T extends { role: string; content: unknown }>(formated: T[], cardId: string, messages: Msg[] | undefined, ask: boolean, scripted = false): T[] {
    if (ask || scripted || SCRIPTED_QUEST_CARDS.includes(cardId)) return formated
    const note = questNote(messages)
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (!note || last < 0 || typeof formated[last].content !== 'string') return formated
    return formated.map((m, i) => (i === last ? { ...m, content: (m.content as string) + note } : m))
}
