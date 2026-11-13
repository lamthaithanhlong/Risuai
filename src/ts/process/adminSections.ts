// Admin's text costs at most ADMIN_TOKEN_CAP tokens on every turn (owner 2026-11-13: first 1,500, then raised to 4,000; no rule dropped).
// Everything goes while it fits; when it does not, each "## " section goes only on the turns that need it. This file is the whole policy, as data:
//   - TRIGGERS: what a turn looks like, read from what adminBeforeRequest can see (the opening flag, the newest player message, the last
//     reply, the hidden notes already in the request, the chat's script state);
//   - SECTION_RULES: one row per heading (the heading without "## " and without its "@card" tags): when it is sent, and its place in the
//     drop order when a turn is still over the cap (cut: 1 goes first; null never goes);
//   - estimateTokens: a pure, synchronous, conservative token count (never below the real o200k count, at most 1.25 times it; the test
//     measures it against the real tokenizer on the real texts).

import { modeBefore, modeFromTurn } from './gmMachine'
import { parseAdminAsk } from './adminAsk'

/** Estimated tokens for Admin's text + the guide + the persona record + the framing lines, together. */
export const ADMIN_TOKEN_CAP = 4000

/**
 * An estimate that is never below the real o200k_base count on this text (words, Vietnamese words, numbers, symbols), and under 1.25 times it.
 * One token per plain ASCII word of up to 8 letters, more for longer ones; about 1.5 per word with diacritics (they split); digits in groups
 * of 3; one per symbol, 1.5 for wide ones (【 】 emoji). Calibrated on the five cards' Admin texts and the persona record samples.
 */
export function estimateTokens(text: string): number {
    let t = 0
    for (const m of String(text ?? '').matchAll(/\p{L}+|\p{N}+|[^\p{L}\p{N}\s]/gu)) {
        const w = m[0]
        if (/^\p{L}/u.test(w)) {
            if (/^[A-Za-z]+$/.test(w)) t += w.length <= 8 ? 1 : 1 + Math.ceil((w.length - 8) / 4)
            else t += 1.6 + (w.length > 5 ? 0.3 * (w.length - 5) : 0)
        } else if (/^\p{N}/u.test(w)) t += Math.ceil(w.length / 3) + 1
        else t += (w.codePointAt(0) ?? 0) > 255 ? 1.5 : 1
    }
    return Math.ceil(t * 1.03) + 1
}

// ---- what a turn looks like -------------------------------------------------------------------------------------------------------

export const TRIGGERS = [
    'opening',     // the first reply of the chat
    'ask',         // the newest player message is "@admin ..." / "/admin ..." / "hỏi admin: ...", or the request carries the ADMIN HỎI ĐÁP block
    'review',      // a hidden "GM xem lại" note is in the request
    'fight',       // the GM machine's mode is a fight, or fight words in the newest player message or the last reply, or a foe named a moment ago
    'find',        // a Find note is in the request, or a find is due in this reply (findDrop.findDueNow)
    'help',        // the player asks for help or a hint
    'record',      // the player talks about stats, skills, items, the record
    'scout',       // the player asks Admin to check a place
    'loadout',     // skills in slots, equipping; or a rest begins
    'mission',     // missions, stamps, points
    'learn',       // what he learned, why something changed
    'questEvent',  // the script put a quest note in the request: an offer, an expiry, a mission to draw
    'questWords',  // the player talks about the quest
    'questSkip',   // the player skips or swaps the quest
] as const
export type Trigger = typeof TRIGGERS[number]
export type TurnFacts = ReadonlySet<Trigger>

// whole words ("\b" is ASCII-only); matched on the lower-cased text, and again on the text with its diacritics removed (players type without them)
const words = (alts: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, 'u')
const plain = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')
const has = (re: RegExp, text: string) => { const t = text.toLowerCase().normalize('NFC'); return re.test(t) || re.test(plain(t)) }
const kw = words

export const WORDS = {
    help: kw('giúp|gợi ý|hint|help|làm gì|đi đâu|bí rồi|kẹt|không biết|nên làm|phải làm|chỉ giúp|chỉ đường|hướng nào'),
    record: kw('chỉ số|kỹ năng|vật phẩm|hồ sơ|túi đồ|trang bị|ô kỹ năng|stats?|skills?|items?|inventory|level|cấp|thành thạo|vì sao tăng|tăng lên|tiến bộ'),
    scout: kw('quét|dò|thăm dò|kiểm tra|tín hiệu|scan|scout|radar|check|xung quanh|quanh đây'),
    loadout: kw('trang bị|tháo|gỡ|equip|unequip|loadout|ô kỹ năng|kỹ năng|slot|đổi kỹ năng|gắn kỹ năng'),
    mission: kw('nhiệm vụ|mission|tem|điểm|stamp|points?|thưởng|bưu cục|bưu điện|hoàn thành|tỷ lệ'),
    learn: kw('học|học được|vì sao|tại sao|thay đổi|learned?|why|quét|kiểm tra|check'),
    questWords: kw('nhiệm vụ|mission|quest|tiến độ|hạn|thưởng|bỏ qua|skip|đổi nhiệm vụ|nhiệm vụ khác'),
    questSkip: kw('bỏ qua|skip|đổi nhiệm vụ|nhiệm vụ khác'),
    fight: kw('đánh|chém|đâm|bắn|tấn công|lao vào|đấm|đá|giết|ra tay|chiến đấu|giao chiến|đánh nhau|ẩu đả|tử chiến|kẻ địch|kẻ thù|quái|địch|hạ gục|ngã gục|máu|vung|attack|strike|stab|shoot|fight|punch|kill|combat|enemy|battle|slash|swing|blood'),
}
const FOES_TURNS = 2   // a foe named in the last replies keeps Defeats on (stats.lua keeps them 8 turns for the comparison note; two is enough for the kill tag)

type Msg = { role?: string; data?: string }
type Wire = { role: string; content: unknown }

/** The text of the last user message of the request (where the hidden notes of this turn were appended), '' when it is not a string. */
export function lastUserRequestText(formated: Wire[]): string {
    for (let i = formated.length - 1; i >= 0; i--) if (formated[i].role === 'user') return typeof formated[i].content === 'string' ? formated[i].content as string : ''
    return ''
}

export type TurnInput = {
    opening: boolean
    formated?: Wire[]
    messages?: Msg[]
    vars?: Record<string, unknown>
    /** findDrop.findDueNow for this chat, computed by the caller (it needs the card) */
    findDue?: boolean
}

/** Which triggers this turn fires. Pure: reads, never writes. */
export function turnFacts(i: TurnInput): Set<Trigger> {
    const out = new Set<Trigger>()
    const msgs = i.messages ?? []
    const req = lastUserRequestText(i.formated ?? [])
    const player = [...msgs].reverse().find((m) => m.role === 'user')?.data ?? ''
    const lastReply = [...msgs].reverse().find((m) => m.role === 'char')?.data ?? ''
    const replies = msgs.filter((m) => m.role === 'char').length
    const text = player || req
    if (i.opening) out.add('opening')
    if (parseAdminAsk(player) !== null || /\[ADMIN HỎI ĐÁP/.test(req)) out.add('ask')
    if (/\[GM xem lại/.test(req)) out.add('review')
    const mode = modeBefore(i.vars, replies)
    let foe = false
    try {
        const foes = JSON.parse(String(i.vars?.$foes ?? '{}')) as Record<string, { t?: number }>
        foe = Object.values(foes ?? {}).some((f) => Number(f?.t) >= replies - FOES_TURNS)
    } catch { foe = false }
    if (mode.combat === 'fight' || modeFromTurn(mode, player).combat === 'fight' || has(WORDS.fight, text) || has(WORDS.fight, lastReply) || foe) out.add('fight')
    if (/\[Find \(hidden/.test(req) || i.findDue === true) out.add('find')
    if (has(WORDS.help, text)) out.add('help')
    if (has(WORDS.record, text)) out.add('record')
    if (has(WORDS.scout, text)) out.add('scout')
    if (has(WORDS.loadout, text) || mode.scene === 'rest') out.add('loadout')
    if (has(WORDS.mission, text)) out.add('mission')
    if (has(WORDS.learn, text)) out.add('learn')
    if (/\[Nhiệm vụ \(ẩn|\[Admin cần giao 1 mission/.test(req)) out.add('questEvent')
    if (has(WORDS.questWords, text) || String(i.vars?.$quest_line ?? '').trim() !== '') out.add('questWords')
    if (has(WORDS.questSkip, text)) out.add('questSkip')
    return out
}

// ---- when each section goes -------------------------------------------------------------------------------------------------------

export type Rule = {
    /** 'always', or the triggers that send it (any one) */
    on: 'always' | readonly Trigger[]
    /** triggers that hold it back even when `on` says send (an ask is not a story turn: no hidden tags, no loot, no quests) */
    off?: readonly Trigger[]
    /** the place in the drop order when a turn is over the cap: 1 goes first; null is never dropped */
    cut: number | null
}

const STORY: readonly Trigger[] = ['ask']   // the "off" list of a rule that is for story turns only

/**
 * One row per heading. Drop order when a turn is still over ADMIN_TOKEN_CAP (lowest number first):
 * the hints, scouting, loadout and "what he learned" notes, then missions and the zombie quest notes, the tier effects, the record rules,
 * Finds, Defeats, the quest line formats, Admin's line format, and last of the droppable ones the ask rules. Never dropped (null): the intro,
 * Connecting, Standing duties, Stat scale, Training (the TRAIN tag rules), the per-card voice, the guide's "what it never does", and
 * the persona record block (it is not a section: it is passed beside the text).
 */
export const SECTION_RULES: Record<string, Rule> = {
    'Asking Admin outside the story': { on: ['ask', 'review'], cut: 14 },
    'Connecting': { on: ['opening'], cut: null },
    'Standing duties': { on: 'always', cut: null },
    'Connecting and standing duties': { on: 'always', cut: null },   // the heading before the split: a copy cached by the server before the new file

    'Admin lines': { on: 'always', cut: 13 },
    'Stats and skills': { on: ['opening', 'record'], cut: 5 },
    'Loadout advice': { on: ['loadout'], cut: 2 },
    'Quests': { on: ['questEvent', 'questWords', 'ask'], off: [], cut: 12 },
    'Admin hands out quests on its own': { on: ['questEvent', 'questSkip'], cut: 11 },
    'Scouting': { on: ['opening', 'scout'], cut: 3 },
    'Missions, stamps and points': { on: ['opening', 'mission'], cut: 6 },
    'No senses': { on: 'always', cut: null },
    'Reading what he learned': { on: ['opening', 'learn', 'scout', 'record'], cut: 4 },
    'Persona record': { on: ['opening', 'record', 'ask'], cut: 9 },
    'Stat scale': { on: 'always', off: STORY, cut: null },
    'Training': { on: 'always', off: STORY, cut: null },
    'Tier effects': { on: 'always', off: STORY, cut: 8 },
    'Defeats': { on: ['fight'], off: STORY, cut: 10 },
    'Finds': { on: ['find'], off: STORY, cut: 10 },
    'Voice here': { on: 'always', cut: null },
    'Guide: what it never does': { on: 'always', cut: null },
    'Guide: hints': { on: ['help', 'ask'], cut: 1 },
}

/** The key of a "## " line: its text without the hashes and without the "@card, card" tags. '' for an intro. */
export function headingKey(head: string): string {
    return head.replace(/^##\s*/, '').replace(/\s+@.*$/, '').trim()
}

/** Unknown headings (a section added to admin.md before this table knew it) are sent every turn and dropped before any known one but the hints. */
const UNKNOWN: Rule = { on: 'always', cut: 2.5 }

export const ruleOf = (key: string): Rule => SECTION_RULES[key] ?? UNKNOWN

/** Is the section sent on this turn? An intro (key '') always is; `facts` undefined means "no turn known": everything is sent (then the cap decides). */
export function sentOn(key: string, facts: TurnFacts | undefined): boolean {
    if (!key || !facts) return true
    const r = ruleOf(key)
    if (r.off?.some((t) => facts.has(t))) return false
    return r.on === 'always' || r.on.some((t) => facts.has(t))
}
