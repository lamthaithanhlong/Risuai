// The Game Master: the player's own story inside the novel's world, for every story card (asked 2026-10-19: "có ai game master
// control event và sequences, tui là ai cũng được, khởi đầu random, có event riêng, reward riêng, enemy riêng, challenge riêng
// và hậu quả và thưởng riêng, ko theo cốt truyện nhưng vẫn sống trong thế giới … tồn tại sống song song các nhân vật trong
// truyện và không nhất thiết gặp nhau").
//
// The model keeps the GM's state in a hidden block at the end of a reply, only when something changed:
//   [[GM
//   arc: hook | antagonist | goal | stakes          the player's personal arc ("arc: done | how it ended" closes it)
//   beat: 2 | what is happening | what is due next
//   threat: name | progress in words | what happens when it fills       up to 3, merged by name ("threat: name | -" drops it)
//   reward: what | when it is paid                    the whole list is replaced when any reward line is written ("reward: -")
//   consequence: what | when it lands                 the same
//   canon: in-world date | what canon is doing off-screen
//   path: faction or road | stage | standing         the side the player chose in the canon world, villains included;
//                                                    a new name moves the old one to gm_left (they remember), "path: -" leaves it
//   enemy: who | why they oppose the player           up to 4, merged by name ("enemy: who | -" drops it)
//   gained: what the path has given                   up to 4, newest last ("gained: -" clears)
//   ]]
// (asked again 2026-10-19: "trở thành kẻ thù của Sunny, làm thuộc hạ cho Song", "trở thành Kẻ Gác Đêm hoặc gia nhập kẻ
// xấu": the player chooses a side inside the canon world and faces what it brings; paths open through meetings and acts,
// never a menu, and the card's own lore entries for a path, when the lorebook wakes them, say what that side asks and gives.)
// After the reply the app takes the block out of the message and keeps each value in a chat variable (gm_*, as the cards'
// status.lua keeps st_*); the screen hides a block still being streamed. Every turn the app puts one short note after the
// player's message (a system note alone is not read on this route, see playerAgency.ts): the state, and this turn's dice,
// rolled by the app (crypto), not by the model's whim. Before the character is confirmed (the card's "Được chưa?" step) the
// GM says nothing, and the reply to the yes (the card's Initialization) is left to the card; the reply after it seeds the arc.

export const GM_KEYS = ['gm_arc', 'gm_beat', 'gm_threats', 'gm_rewards_due', 'gm_consequences_due', 'gm_canon', 'gm_past',
    'gm_path', 'gm_enemies', 'gm_gained', 'gm_left'] as const
export type GmKey = (typeof GM_KEYS)[number]
/** The page's bookkeeping next to the notes: when the beat moved, when a side was taken, the reply that last changed them
 *  and the state before it (rollback). */
export const BOOK_KEYS = ['gm_beat_at', 'gm_path_at', 'gm_at', 'gm_prev'] as const
/** The pace clock, written by the request (the app's own dice), never by a reply or a rollback. */
export const PACE_KEYS = ['gm_adv_at', 'gm_adv_prev'] as const
export type GmState = Partial<Record<GmKey | (typeof BOOK_KEYS)[number] | (typeof PACE_KEYS)[number], string>>

const MAXLEN = 140
const MAX_THREATS = 3
const MAX_DUE = 3
const MAX_PAST = 3
const MAX_ENEMIES = 4
const MAX_GAINED = 4
const MAX_LEFT = 2

const BLOCK = /\[\[GM\b([\s\S]*?)\]\]/g
/** a field name the model copied as a value ("hook|the debt|antagonist|Varn") */
/** a line that is commentary, not a value */
const NOTE_TALK = /^(\(?(unchanged|no change|not changed|same( as before)?|still the same|n\/a)\b|the player\b|player (committed|avoided|went|did)\b)/i
const NO_SIDE = /^(none|no side|chưa( chọn| có)?( bên| phe)?|không|<side>)$/i
const ARC_LABEL = /^<?(hook|antagonist|rival|goal|stakes?)>?$/i
const OPEN_TAIL = /\[\[GM\b[\s\S]*$/

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MAXLEN)
const isDash = (s: string) => /^(-|—|none|null)?$/i.test(s.trim())
const lines = (v: string | undefined) => (v ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
const nameOf = (l: string) => l.split('|')[0].trim().toLowerCase()
/** a due reward or consequence whose "when" says it already landed ("Đầu gối đau nhói | Đã xảy ra", measured on the Mailman
 *  chat 2026-10-20: kept for good and named in every turn's note as still due, so the knee was hurt again and again) */
const LANDED = /^(done|paid|landed|given|received|happened|resolved|xong|rồi|đã\s+(xảy ra|trả|nhận|đến|tới|xong|thực hiện|hoàn thành|diễn ra|giao|có|được trả))\b/i
export const isLanded = (l: string) => { const when = l.split('|').slice(1).map((x) => x.trim()).filter(Boolean); return when.length > 0 && LANDED.test(when.at(-1)!) }
/** the due lines still to come */
const due = (v: string | undefined) => lines(v).filter((l) => !isLanded(l))

/** The reply without any GM block, and one still being streamed hidden (for the screen). */
export function stripGm(text: string): string {
    return (text ?? '').replace(/[ \t]*\[\[GM\b[\s\S]*?\]\][ \t]*\n?/g, '').replace(OPEN_TAIL, '').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
}

/** The bodies of the GM blocks in a reply (an unclosed last block counts: the reply may have been cut). */
export function gmBlocks(text: string): string[] {
    const t = text ?? ''
    const out = [...t.matchAll(BLOCK)].map((m) => m[1])
    const rest = t.replace(BLOCK, '')
    const open = OPEN_TAIL.exec(rest)
    if (open) out.push(open[0].replace(/^\[\[GM\b/, ''))
    return out
}

/** A beat's step: its number, or its first field when it has none. */
const beatStep = (v: string) => { const f = (v ?? '').split('|')[0].trim().toLowerCase(); const n = /\d+/.exec(f); return n ? n[0] : f }

/** The state after one reply's blocks. `charCount` is the number of story replies, this one included (for the pace). */
export function applyGm(state: GmState, bodies: string[], charCount: number): GmState {
    const next: GmState = { ...state }
    let rewards: string[] | null = null
    let costs: string[] | null = null
    let threats = lines(state.gm_threats)
    let enemies = lines(state.gm_enemies)
    let gained: string[] | null = null
    let arcWritten = false
    let sideTaken = false
    for (const body of bodies) {
        for (const raw of body.split(/\r?\n/)) {
            const m = /^\s*[-*•]?\s*([a-z_]+)\s*:\s*(.*)$/i.exec(raw)
            if (!m) continue
            const key = m[1].toLowerCase()
            // "enemy: Aldric — now named. enemy: Aldric, the gate's Aspirant | …" (measured): the last value on the line counts
            const value = clean(m[2].replace(new RegExp(`^.*\\b${key}\\s*:\\s*`, 'i'), ''))
            // measured on the bookkeeper: "arc: unchanged (still …)", "enemy: no change.", "path: player avoided … — did they com…"
            if (NOTE_TALK.test(value) || ((key === 'path' || key === 'enemy') && /\?\s*$/.test(value))) continue
            if (key === 'arc') {
                const [head, ...rest] = value.split('|')
                if (/^(done|resolved|xong|kết thúc)$/i.test(head.trim()) || isDash(value)) {
                    // the arc ends; what it left behind seeds the next one
                    const how = clean(rest.join('|'))
                    const was = (state.gm_arc ?? '').split('|').slice(0, 2).map((x) => x.trim()).filter(Boolean).join(' / ')
                    const past = lines(next.gm_past)
                    if (was || how) past.push(clean(`${was}${was && how ? ' → ' : ''}${how}`))
                    next.gm_past = past.slice(-MAX_PAST).join('\n')
                    next.gm_arc = ''
                    next.gm_beat = ''
                    next.gm_beat_at = String(charCount)
                    threats = []
                } else if (value) {
                    arcWritten = true
                    next.gm_arc = value.split('|').map((x) => x.trim()).filter((x) => x && !ARC_LABEL.test(x)).join(' | ')
                }
            } else if (key === 'beat') {
                // the beat moved when its number (its first field) changed, not its wording: measured with the bookkeeper, which
                // rewrites the beat line every reply, the stall counter reset every reply and the dice held at 10% advance
                // (2 advances in 10 replies, 4 quiet replies in a row in one room)
                const was = state.gm_beat ?? ''
                next.gm_beat = isDash(value) ? '' : value
                if (beatStep(value) !== beatStep(was)) next.gm_beat_at = String(charCount)
            } else if (key === 'threat') {
                const name = nameOf(value)
                if (!name) continue
                const rest = value.split('|').slice(1)
                const gone = rest.length > 0 && rest.every(isDash)
                threats = threats.filter((t) => nameOf(t) !== name)
                if (!gone) threats.push(value)
            } else if (key === 'reward' || key === 'rewards') {
                // one that landed leaves the list (by its name), the others stay; it is never due again
                if (isLanded(value)) rewards = (rewards ?? due(state.gm_rewards_due)).filter((r) => nameOf(r) !== nameOf(value))
                else { rewards ??= []; if (!isDash(value)) rewards.push(value) }
            } else if (key === 'consequence' || key === 'consequences' || key === 'cost') {
                if (isLanded(value)) costs = (costs ?? due(state.gm_consequences_due)).filter((c) => nameOf(c) !== nameOf(value))
                else { costs ??= []; if (!isDash(value)) costs.push(value) }
            } else if (key === 'canon') {
                if (value) next.gm_canon = isDash(value) ? '' : value
            } else if (key === 'path' || key === 'allegiance' || key === 'faction') {
                const was = next.gm_path ?? ''
                // "path: — | chưa chọn bên" (measured: written while no side was taken) is no side
                const now = isDash(value.split('|')[0]) || NO_SIDE.test(value.split('|')[0].trim()) ? '' : value
                if (nameOf(was) && nameOf(was) !== nameOf(now)) next.gm_left = [...lines(next.gm_left), clean(`${was.split('|')[0].trim()} | left`)].slice(-MAX_LEFT).join('\n')
                if (now && nameOf(now) !== nameOf(was)) sideTaken = true
                next.gm_path = now
            } else if (key === 'enemy' || key === 'enemies') {
                const name = nameOf(value)
                if (!name) continue
                const rest = value.split('|').slice(1)
                enemies = enemies.filter((t) => nameOf(t) !== name)
                if (!(rest.length > 0 && rest.every(isDash))) enemies.push(value)
            } else if (key === 'gained') {
                gained ??= lines(state.gm_gained)
                if (isDash(value)) gained = []
                else gained.push(value)
            }
        }
    }
    // a side newly taken drives the story: its first order or test comes due, the arc is seeded again from it, and the GM's own
    // antagonist steps back to a background threat (measured on Shadow Slave path play: the GM's antagonist pulled focus from
    // the side the player had joined, 1 of 6 verdicts; the arm without a GM let the side drive the story)
    if (sideTaken) {
        next.gm_path_at = String(charCount)
        const old = (state.gm_arc ?? '').split('|').map((x) => x.trim())
        if (old[1] && !threats.some((t) => nameOf(t) === old[1].toLowerCase())) threats.unshift(clean(`${old[1]} | background | may return`))
        if (!arcWritten && state.gm_arc) {
            next.gm_past = [...lines(next.gm_past), clean(`${old.slice(0, 2).filter(Boolean).join(' / ')} → set aside for the side`)].slice(-MAX_PAST).join('\n')
            next.gm_arc = ''
            next.gm_beat = ''
            next.gm_beat_at = String(charCount)
        }
    }
    next.gm_threats = threats.slice(-MAX_THREATS).join('\n')
    next.gm_enemies = enemies.slice(-MAX_ENEMIES).join('\n')
    if (gained) next.gm_gained = gained.slice(-MAX_GAINED).join('\n')
    if (rewards) next.gm_rewards_due = rewards.slice(-MAX_DUE).join('\n')
    if (costs) next.gm_consequences_due = costs.slice(-MAX_DUE).join('\n')
    return next
}

type Msg = { role: string; data: string; chatId?: string }
type Card = { name?: string; desc?: string; firstMessage?: string; globalLore?: { comment?: string }[] } | undefined

/** The card makes the player confirm a character first (the Fate Simulator cards' "Character Creation" step). */
export function hasCreationStep(card: Card): boolean {
    return /character creation|tạo nhân vật|được chưa\s*\?/i.test(`${card?.desc ?? ''}\n${card?.firstMessage ?? ''}`)
}

/** The card's panel was written (status.lua keeps st_* only after Initialization, i.e. after the yes). */
export function hasPanel(vars: Record<string, unknown> | undefined): boolean {
    return Object.entries(vars ?? {}).some(([k, v]) => /^\$st_/.test(k) && v !== undefined && v !== null && !isDash(String(v)))
}

const ASKED = /được chưa\s*\?|ok chưa\s*\?|is (this|that|it) (ok|okay|right|good)\s*\?|confirm\s*\?/i
const YES = /^(được|duoc|ok|okay|oke|okie|ừ|ừm|uh|vâng|dạ|có|rồi|chốt|đồng ý|bắt đầu|yes|yep|yeah|sure|go|start|let'?s go|cross|step out|pick up)\b/i
const CHANGE = /\b(sửa|đổi|thay|bốc lại|reroll|change|edit|nhưng|but|không|chưa|no)\b/i

/** The player's message accepts the record (a short yes, no change asked). */
export function isYes(text: string): boolean {
    const t = (text ?? '').trim().replace(/^["“'(]+/, '')
    return t.length > 0 && t.length <= 120 && YES.test(t) && !CHANGE.test(t.replace(YES, ''))
}

/** Where the player answered a "Được chưa?" with a yes (the character is locked from there), or -1. */
export function yesAt(messages: Msg[]): number {
    return messages.findIndex((m, i) => m.role === 'user' && i > 0 && messages[i - 1].role === 'char' && ASKED.test(messages[i - 1].data ?? '') && isYes(m.data))
}

// ---- the creation gate -----------------------------------------------------------------------------------------------------
// Measured 2026-10-19 on the story combo moved to a faster narrator (gpt-6-luna): Infinite Mailman answered the look question
// ("Giữ ngoại hình của persona.") as if it were the yes and ran the story, panel and GM included, three replies before the yes;
// Shadow Slave's step-by-step offered two suggestions instead of three (0 of 4 question replies), and the first reply of two
// runs did not record the difficulty. The card says all of it; a fast model drops it. So until the character is confirmed the
// app puts its own short note at the end of the player's message, as it does for the GM (a system note alone is not followed).

const CREATION_ASK = /[?？]|\bbước\s*\d|\bstep\s*\d/i

/** The note for a turn of character creation, or '' once the character is confirmed (st_* written, or the yes given). */
// The player's persona is their own character sheet (asked 2026-10-19: "3 truyện phải lấy persona của tui"). In the owner's
// Mailman chat the persona (Kenji Park: ten secret abilities, the ghost Evelyn) was in every request, the look answer was
// "Lấy như profile", and the record and the story kept none of the abilities: the cards' creation rule rolls what the player
// does not type, and a fast model follows the note at the end of the message over the system prompt. So both notes say it.
// Measured on the same evening's run: with the persona the step-by-step interview asked the name, the sex and the look again
// (Mailman asked the look twice) and offered the persona's look as one choice of three; the items it fixes are named once.
const PERSONA_CREATION = ' The player has a persona (their own profile in the prompt): it is the character sheet. Take every item it states from it word for word, abilities and companions included, and list its abilities and companions in the record (Năng lực, Đồng hành). Step by step: the first reply opens with one line "Từ persona: …" naming what it fixes; then ask only the items it leaves open, in the card\'s order. Never ask the name, sex, age or look it gives, and never offer another name or look ("lấy như profile" = the persona\'s line).'
/** The yes turn (the card's Initialization), measured 2026-10-19 (SS, persona-plan): the player said "Được" to "Được chưa?" and
 *  the reply recapped the record and asked "Được chưa?" again, the only note on that turn being the persona's. */
export const INIT_STORY = '\n\n[Start (hidden, never named): the player said yes and the character is locked. This reply opens the story now (the card\'s Initialization): no record, no recap, no question, no "Được chưa?".]'
/** Every story turn of a card with the persona rule (canon judge, same run: "Kenji nói rõ cách anh sẽ đối phó…" for a player's
 *  conditional plan). The cards say it; the note at the end of the message is what a fast model follows. */
export const VOICE_STORY = '\n\n[Voice (hidden, never named): the player\'s character says, thinks and decides only what the player wrote; write no speech, plan or choice for them.]'
/** A card with a Future Plan rule (the Kairos Academy card's "Request Profile", asked 2026-10-19: "thiếu future plan"): the reply
 *  ends with "[💡Kế hoạch| names ]", whose names wake their lore next turn; the card's status.lua folds it and keeps only the newest. */
/** A card whose rules say the player's persona is the character sheet (the three story cards' "The Player's Persona"). */
export const hasPersonaRule = (card: Card | undefined) => /The Player's Persona/.test(card?.desc ?? '')
export const hasFuturePlan = (card: Card | undefined) => /\[💡Kế hoạch\|/.test(card?.desc ?? '')
export const PLAN_STORY = '\n\n[Future Plan (hidden, never named): end the reply with one line "[💡Kế hoạch| names ]" naming the characters of the novel the next scene needs (or "[💡Kế hoạch| Không ]"), before any STATUS, LEDGER or GM block. A character of the novel enters only after an earlier reply named them there.]'
/** After the yes: the persona's abilities and companions are the character's own, every turn. */
export const PERSONA_STORY = '\n\n[Persona (hidden, never named): the character is the player\'s persona. Its abilities and companions are real, with the limits it sets; they work whenever the player uses them, and secret ones stay unknown to NPCs without evidence. Do not use them for the player.]'

export function creationNote(card: Card, messages: Msg[], vars: Record<string, unknown> | undefined, state: GmState, persona = false): string {
    if (!hasCreationStep(card) || hasPanel(vars) || state.gm_arc || state.gm_past) return ''
    const last = messages.map((m) => m.role).lastIndexOf('user')
    if (last < 0 || yesAt(messages) >= 0) return ''
    const before = messages.slice(0, last).filter((m) => m.role === 'char')
    const asked = before.length ? before[before.length - 1].data ?? '' : card?.firstMessage ?? ''
    if (!CREATION_ASK.test(asked) && !ASKED.test(asked)) return ''
    const first = before.length === 0
    return '\n\n[Character creation (hidden, never named): the character is not confirmed yet. Answer only the creation step this message answers'
        + (first ? '; the reply opens with one line naming the difficulty the player chose, e.g. "Độ khó: Khó" (Hard when none was named)' : '')
        + '. Step by step: ask the next item only, as one question line ending in "?", then exactly three suggestions as a list (đúng ba gợi ý) and "để thế giới chọn" as a fourth line (an item with only two possible values offers both).'
        + (persona ? PERSONA_CREATION : '')
        + ' A record: show it again with what changed and end with "Được chưa?". Only the player\'s yes ("được", "ok", "bắt đầu") starts the story: until then no story prose, no [[STATUS]], [[LEDGER]] or [[GM]] block.]'
}

// ---- the side the player takes, in their own words -----------------------------------------------------------------------
// Measured 2026-10-19 (narrator gpt-6-luna): Shadow Slave's player wrote "tôi sẽ tìm mọi cách gia nhập nhóm của Nephis (Ngôi Sao
// Đổi Thay)" and the bookkeeper recorded "path: trại tù binh | 1 | mới được giao việc bổ củi" (the camp and the chore of that
// reply); Lord of the Mysteries' "tôi sẽ nộp đơn xin gia nhập Kẻ Gác Đêm (Nighthawks)" was never recorded (the reply showed no
// joining yet). The commitment is in the player's message, so it is read from there: the side they name is the path, and once
// a side is held, a model line naming another one stands only when the player's own turn joins or leaves a side.

const COMMIT = /(gia nhập|xin vào|xin theo|đầu quân (?:cho|vào)|làm thuộc hạ (?:cho|của)|làm tay sai (?:cho|của)|phục vụ(?: cho)?|thề trung thành (?:với|cho)|quy phục|đứng về phía|về phe|theo phe|bái sư|\bjoin(?:s|ing)?\b|\bserve\b|\bswear (?:fealty|allegiance|loyalty) to\b|\bpledge (?:myself |my loyalty )?to\b|\benlist (?:in|with)\b|\bside with\b)\s+(\S.*)$/i
const NEGATED = /(?<!\p{L})(?:không|chẳng|chả|chưa|đừng|never|not|won't|don't|do not|no)(?!\p{L})(?:\s+\S+)?\s*$/iu
const LEAVE = /(rời (?:bỏ|khỏi)|bỏ (?:phe|nhóm|đội|hội)|phản bội|ly khai|rút khỏi|thoát ly|\bleave\b|\bleaves\b|\bquit\b|\bbetray|\bdefect)/i
const SIDE_STOP = /^\s(?:và|rồi|dù|để|nhưng|mà|ở|tại|trong|nếu|khi|vì|sau|and|but|even|so|then|because|in|at|to|until)\s/i
const SIDE_NOISE = new Set(['nhóm', 'của', 'phe', 'đội', 'hội', 'bọn', 'đám', 'the', 'of', 'and', 'group', 'crew', 'side', 'người'])

/** The side the player's own message commits to ("gia nhập nhóm của Nephis …" → "nhóm của Nephis (…)"), or ''. */
// Going alone is a side of its own (Mailman's "Going alone" path card). Measured 2026-10-19: "tôi không gia nhập đoàn nào cả,
// tôi sẽ đi một mình và tự gây dựng tên tuổi…" was read as a negated join and no path was ever written. Turning down one named
// group ("không gia nhập nhóm của Nephis") is not going alone: only "no group at all" or "alone" is.
const SOLO = /(không (?:gia nhập|vào|theo|đầu quân cho) (?:đoàn|nhóm|phe|hội|tổ chức|băng)(?: đội)? nào|(?<!không )(?:sẽ |cứ |tự )?đi một mình|độc lai độc vãng|đơn thương độc mã|\bgo(?:ing)? (?:it )?alone\b|\bon my own\b|\bjoin no (?:one|side|group|faction|crew)\b)/i
const VI_LETTER = /[àáảãạăâđèéẻẽẹêìíỉĩịòóỏõọôơùúủũụưỳýỷỹỵ]/i

export function playerSide(text: string): string {
    const t = (text ?? '').replace(/\s+/g, ' ').trim()
    if (SOLO.test(t)) return VI_LETTER.test(t) ? 'đi một mình' : 'alone'
    const m = COMMIT.exec(t)
    if (!m || NEGATED.test(t.slice(0, m.index))) return ''
    const rest = m[2]
    let depth = 0, end = rest.length
    for (let i = 0; i < rest.length; i++) {
        const c = rest[i]
        if (c === '(') depth++
        else if (c === ')') depth = Math.max(0, depth - 1)
        else if (depth === 0 && (/[,.;!?:]/.test(c) || (c === ' ' && SIDE_STOP.test(rest.slice(i))))) { end = i; break }
    }
    const side = rest.slice(0, end).replace(/^(the|a|an)\s+/i, '').trim()
    return side.length >= 2 ? clean(side).slice(0, 90) : ''
}

const sideWords = (v: string) => new Set((v ?? '').split('|')[0].toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !SIDE_NOISE.has(w)))
/** Two path values name the same side (a word of the name in common). */
export function sameSide(a: string, b: string): boolean {
    const x = sideWords(a), y = sideWords(b)
    return [...x].some((w) => y.has(w))
}

const PATH_LINE = /^\s*[-*•]?\s*(path|allegiance|faction)\s*:\s*(.*)$/i
/**
 * The blocks with their path lines checked against the player's turn: a side the player committed to is the path (a model line
 * naming something else is dropped, and the player's side is written when no line names it); with a side already held and no
 * join or leave in the player's turn, only lines about that same side stand.
 */
export function sidePaths(bodies: string[], state: GmState, player: string): string[] {
    const side = playerSide(player)
    const cue = !!side || LEAVE.test(player ?? '')
    const held = state.gm_path ?? ''
    let named = false
    const out = bodies.map((body) => body.split(/\r?\n/).filter((line) => {
        const m = PATH_LINE.exec(line)
        if (!m) return true
        const v = m[2].replace(/^.*\b(path|allegiance|faction)\s*:\s*/i, '')
        if (side) { const ok = sameSide(v, side); named ||= ok; return ok }
        if (cue || !nameOf(held)) return true
        return sameSide(v, held)
    }).join('\n'))
    if (side && !named && !sameSide(held, side)) {
        const vi = VI_LETTER.test(player)
        const solo = side === 'đi một mình' || side === 'alone'
        const line = `path: ${side} | ${solo ? (vi ? 'tự đi | chưa có tên tuổi' : 'on their own | no name yet') : vi ? 'muốn gia nhập | chưa được nhận' : 'wants to join | not yet accepted'}`
        if (out.length) out[out.length - 1] = out[out.length - 1].trim() ? `${out[out.length - 1]}\n${line}` : line
        else out.push(line)
    }
    return out
}

export type GmPhase = 'silent' | 'seed' | 'run'

/**
 * When the GM speaks. Silent before the first reply, while a character is being made and on the Initialization reply that
 * answers the yes; 'seed' on the first turn after it with no arc yet, 'run' after.
 * A card with no creation step and no panel is not a story (a companion chat): silent.
 */
export function gmPhase(card: Card, messages: Msg[], vars: Record<string, unknown> | undefined, state: GmState, storyLike = false): GmPhase {
    const replies = messages.filter((m) => m.role === 'char')
    if (!replies.length) return 'silent'
    // confirmed: the panel was written, the GM already ran, or a "Được chưa?" was answered yes before this turn. The turn that
    // answers the yes is the card's Initialization and stays the card's own: seeding there wrote no block in 6 of 6 replies
    // (2 cards x 3 runs, 2026-10-19) and once printed the model's planning into the story; the next reply seeds.
    const yes = yesAt(messages)
    const initializing = yes >= 0 && !messages.slice(yes + 1).some((m) => m.role === 'char')
    if (initializing && !hasPanel(vars)) return 'silent'
    const confirmed = hasPanel(vars) || !!state.gm_arc || !!state.gm_past || yes >= 0
    if (!confirmed && (hasCreationStep(card) || !storyLike)) return 'silent'
    return state.gm_arc ? 'run' : 'seed'
}

/** A die from the app's randomness (crypto), never the model's. */
export function cryptoRandom(): number {
    const a = new Uint32Array(1)
    globalThis.crypto.getRandomValues(a)
    return a[0] / 2 ** 32
}

/** `cardNew`: the card's own fate die in this request said a new event surfaces at a pause (cardEvent); absent when it rolls none. */
export type GmDice = { pace: 'quiet' | 'build' | 'advance' | 'escalate'; surface: string; consequence: boolean; canon: boolean; firstOrder?: boolean; cardNew?: boolean }

/**
 * The card's own fate die as this request rolled it (the cards' Module 10: "* Event: NEW" / "* Event: quiet", or a number with
 * "1–20 means something new surfaces"): true when a new event is due at a pause, false when quiet, null when the card has none.
 * Measured 2026-10-19 (narrator gpt-6-luna, the three cards, acceptance runs): of 7 pauses where the card's die said NEW, 3
 * surfaced something new; 3 of the 4 misses carried this note's "QUIET: no new trouble", the 3 hits ADVANCE: the note at the end
 * of the player's message overruled the die in the system prompt. So the note says what the card's die said.
 */
export function cardEvent(formated: { content: unknown }[]): boolean | null {
    for (const m of formated) {
        if (typeof m.content !== 'string' || !m.content.includes('* Event:')) continue
        const word = /^\* Event: (NEW|quiet)\b/m.exec(m.content)
        if (word) return word[1] === 'NEW'
        const num = /^\* Event: (\d+)\.[^\n]*?\b1\s*[–-]\s*(\d+) means something new/m.exec(m.content)
        if (num) return Number(num[1]) <= Number(num[2])
    }
    return null
}

/** Replies since the player took their side, or -1 (no side, or taken before this was tracked). */
export function sideAge(state: GmState, charCount: number): number {
    if (!state.gm_path || !state.gm_path_at) return -1
    return Math.max(0, charCount - (Number(state.gm_path_at) || 0))
}
/** For this many replies after a side is taken, the side is the focus. */
export const SIDE_FOCUS = 3

/** Advance chance by replies since the beat last moved: a beat that just moved rests, a stalled one is pushed. */
const ADVANCE = [0.1, 0.3, 0.45, 0.6, 0.75, 0.85]

/**
 * Replies since the app's dice last advanced the story. Measured 2026-10-19: counted from the model's beat number, the
 * narrator and the bookkeeper raised the number almost every reply, so the dice always saw a beat that had just moved and
 * rolled 7-8 quiet replies in 10. The clock is the app's own: the request that rolls ADVANCE or ESCALATE marks the reply
 * it asks for (gm_adv_at = replies before it); a reroll of that reply goes back to the mark before (gm_adv_prev).
 * Before the first advance every reply counts.
 */
export function sinceAdvance(state: GmState, charCount: number): number {
    // no advance rolled yet: every reply so far counts (measured: falling back to the model's beat clock, which moved every
    // reply, Shadow Slave never rolled a first advance in 8 replies, so no mark was ever written)
    if (state.gm_adv_at === undefined || state.gm_adv_at === '') return charCount
    const at = Number(state.gm_adv_at) || 0
    if (charCount > at) return charCount - at - 1
    // the reply that advance was rolled for is gone (rerolled): the mark before it
    const prev = state.gm_adv_prev ? Number(state.gm_adv_prev) || 0 : null
    return prev === null ? charCount : Math.max(0, charCount - prev - 1)
}

/** The pace clock after this request's dice: moved when they advance, the old mark kept for a reroll. */
export function markAdvance(state: GmState, charCount: number, dice: GmDice): Pick<GmState, 'gm_adv_at' | 'gm_adv_prev'> | null {
    if (dice.pace !== 'advance' && dice.pace !== 'escalate') return null
    const at = state.gm_adv_at === undefined || state.gm_adv_at === '' ? null : Number(state.gm_adv_at) || 0
    // rolling again for the same reply (a reroll) keeps the earlier mark as the one before
    const prev = at !== null && at >= charCount ? (state.gm_adv_prev ?? '') : (at === null ? '' : String(at))
    return { gm_adv_at: String(charCount), gm_adv_prev: prev }
}

/** This turn's dice, rolled fresh every request. */
export function rollGm(state: GmState, charCount: number, rng: () => number = cryptoRandom): GmDice {
    const since = sinceAdvance(state, charCount)
    const advance = rng() < ADVANCE[Math.min(since, ADVANCE.length - 1)]
    const hot = rng() < 0.4
    const pace: GmDice['pace'] = advance ? (hot ? 'escalate' : 'advance') : (hot ? 'build' : 'quiet')
    const arc = (state.gm_arc ?? '').split('|').map((s) => s.trim())
    const threads = [
        arc[1] ? `the antagonist (${arc[1]})` : '',
        ...lines(state.gm_threats).map((t) => `the threat "${t.split('|')[0].trim()}"`),
        arc[2] ? 'the goal' : '',
        // the chosen side brings its own events (an order, a task, a test, a rival inside it) and its enemies come for the player
        ...(state.gm_path ? [`the path (${state.gm_path.split('|')[0].trim()}): an event of its own`, `the path (${state.gm_path.split('|')[0].trim()}): an event of its own`] : []),
        ...lines(state.gm_enemies).map((e) => `the enemy "${e.split('|')[0].trim()}"`),
    ].filter(Boolean)
    let surface = threads.length ? threads[Math.floor(rng() * threads.length)] : 'the arc'
    const consequence = !!lines(state.gm_consequences_due).length && rng() < 0.35
    const canon = rng() < 0.25
    // a side just taken: its first order or test comes due at once, and it stays the focus for the next beats
    const age = sideAge(state, charCount)
    if (age >= 0 && age < SIDE_FOCUS) {
        surface = `the side (${state.gm_path!.split('|')[0].trim()})`
        if (age === 0) return { pace: hot ? 'escalate' : 'advance', surface, consequence, canon, firstOrder: true }
    }
    return { pace, surface, consequence, canon }
}

const PACE: Record<GmDice['pace'], string> = {
    quiet: 'QUIET: no new trouble, the player\'s choice plays out',
    build: 'BUILD: no new event, a threat creeps (a sign at most)',
    advance: 'ADVANCE: the next event, enemy or obstacle, with a clear challenge',
    escalate: 'ESCALATE: the next beat hits and the stakes rise',
}

/** The card's fate die said NEW: it outranks a QUIET or BUILD pace, and it is the one new trouble of the reply. */
const CARD_NEW = 'Card fate die: NEW EVENT. If this reply reaches a natural pause (rest, waiting, a walk or journey, time passing), something new surfaces now, a person, creature, clue, message or threat not yet in the story, shown as a hook in the prose (the card\'s dice say what and how); it overrides a QUIET or BUILD pace and is this reply\'s one new trouble.'

/** Flavour only: the kind of personal trouble that fits the card's world (the GM itself is the same for every world). */
export function worldFlavour(card: Card): string {
    const text = `${card?.name ?? ''}\n${(card?.globalLore ?? []).map((l) => l?.comment ?? '').join('\n')}`
    if (/shadow slave|nô lệ bóng tối|nightmare engine|forgotten shore/i.test(text)) return 'a rival Sleeper, a clan\'s agent, a creature that marked them, a debt'
    if (/lord of (the )?myster|quỷ bí|beyonder potion|pathways and sequences/i.test(text)) return 'a hostile Beyonder, a secret order, a church inquiry, a debt'
    if (/infinite mailman|người đưa thư|delivery world|stamp book/i.test(text)) return 'a hostile recipient, a rival mailman, a broken delivery, a penalty'
    return 'a rival, a hunter, a debt, a secret'
}

const short = (v: string | undefined, n = 120) => { const s = (v ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }

/** The side the player chose, what it made and gave; or how a side is chosen when none is. */
export function pathLine(state: GmState): string {
    const enemies = lines(state.gm_enemies), gained = lines(state.gm_gained), left = lines(state.gm_left)
    const tail = [
        enemies.length ? `enemies: ${enemies.map((e) => short(e, 60)).join('; ')}` : '',
        gained.length ? `gained: ${gained.map((g) => short(g, 50)).join('; ')}` : '',
        left.length ? `left: ${left.map((l) => l.split('|')[0].trim()).join(', ')} (they remember)` : '',
    ].filter(Boolean).join('; ')
    if (state.gm_path) return `Path: ${short(state.gm_path, 100)}${tail ? `; ${tail}` : ''}; its events, enemies, rewards, costs from that side (its lore entry when present).`
    return `No side yet${tail ? ` (${tail})` : ''}: any side can be joined, villains included, through meetings and acts, never a menu; write path: on commit or switch.`
}

/** The note for this turn, or '' when the GM is silent. */
export function gmNote(phase: GmPhase, state: GmState, dice: GmDice, flavour: string): string {
    if (phase === 'silent') return ''
    const parts: string[] = []
    if (phase === 'seed') {
        const past = lines(state.gm_past).pop()
        const side = state.gm_path ? state.gm_path.split('|')[0].trim() : ''
        const fresh = dice.surface.startsWith('the side (')
        if (side) parts.push(`No arc yet: seed it from the side the player took (${short(side, 60)}): hook = its ${fresh ? 'first order or test, due now' : 'next order, job or test'}; antagonist = whom it is against or a rival inside the side; goal = to rise in it; stakes = their standing.`)
        else parts.push(`No arc yet: seed one fitted to who the character is (hook; an antagonist of their own, e.g. ${flavour}, never a canon villain; goal; stakes)${past ? `, grown from the last one: ${short(past)}` : ''}; in prose at most the hook.`)
    } else {
        parts.push(`Arc: ${short(state.gm_arc, 130)}.`)
        if (state.gm_beat) parts.push(`Beat: ${short(state.gm_beat, 100)}.`)
        const threats = lines(state.gm_threats)
        if (threats.length) parts.push(`Threat: ${threats.map((t) => short(t, 70)).join('; ')}.`)
        const rewards = due(state.gm_rewards_due), costs = due(state.gm_consequences_due)
        if (rewards.length) parts.push(`Reward: ${rewards.map((r) => short(r, 70)).join('; ')}.`)
        if (costs.length) parts.push(`Consequence: ${costs.map((c) => short(c, 70)).join('; ')}.`)
        // a side not here yet (SS t14-t17, 2026-10-19: "join Nephis's group" from inside the First Nightmare; 0 of 3 replies
        // followed it): what comes is a step toward it
        const away = dice.surface.startsWith('the side (') ? ' (not here yet: a step toward it, news or someone tied to it)' : ''
        parts.push(`Dice: ${dice.firstOrder ? 'the side\'s first order or test comes due now' : PACE[dice.pace]}; focus: ${dice.surface}${away}${dice.consequence ? '; a due consequence lands now' : ''}.`)
        if (dice.cardNew) parts.push(CARD_NEW)
    }
    parts.push(pathLine(state))
    parts.push(`Canon (${state.gm_canon ? short(state.gm_canon, 100) : 'set the in-world date'}): canon people live their own lives off-screen, heard as news or seen afar${dice.canon ? ' (some may come up now)' : ''}; met only when paths cross or the player seeks them, never forced; canon events still happen.`)
    // measured 2026-10-19 (DeepSeek v4.1 flash, 10 turns x 2 cards): "only changed lines" left the block out of 13 of 22
    // replies and the field names were copied as words ("hook|…|antagonist|…"); one seeding reply printed its planning
    const block = phase === 'seed'
        ? '[[GM\narc: <hook> | <antagonist> | <goal> | <stakes>\nbeat: 1 | <what is happening> | <what is due next>\nthreat: <name> | <progress> | <when full>\ncanon: <date> | <off-screen>\n]]'
        // "[[GM …]] + changed lines" was read as a second block named CHANGE (Mailman t10, 2026-10-19): the lines go inside it
        : '[[GM\nbeat: <n> | <now> | <due next>\n<only the changed lines, in this block: arc, threat, path: <side> | <stage> | <standing>, enemy: <who> | <why>, gained, reward/consequence: <what> | <when|done>, canon; arc: done | <how> ends it>\n]]'
    return '\n\n[GM (hidden, never named): the player\'s own story, not the novel\'s plot. ' + parts.join(' ')
        + ' The player\'s action happens; at most one new trouble a reply, card dice included; success pays, failure costs, within world rules (no free rank, Sequence, stamp, power).'
        + ` Story only, no planning notes; end, after any panel, with ${block}]`
}

/** The note at the end of the player's last message; unchanged without a note or a text message. */
export function gmRequest<T extends { role: string; content: unknown }>(formated: T[], note: string): T[] {
    if (!note) return formated
    const last = formated.map((m) => m.role).lastIndexOf('user')
    if (last < 0 || typeof formated[last].content !== 'string') return formated
    return formated.map((m, i) => (i === last ? { ...m, content: (m.content as string) + note } : m))
}

/** The GM's values from the chat's variables ("$gm_*", as setChatVar keeps them). */
export function gmStateOf(vars: Record<string, unknown> | undefined): GmState {
    const s: GmState = {}
    for (const k of [...GM_KEYS, ...BOOK_KEYS, ...PACE_KEYS]) {
        const v = vars?.['$' + k]
        if (v !== undefined && v !== null && String(v) !== 'null') s[k] = String(v)
    }
    return s
}

/**
 * The state the request should see: when the reply that last changed it is gone (rerolled, deleted), the state before it.
 * Returns the state and whether it was rolled back.
 */
export function settleGm(state: GmState, messages: Msg[]): { state: GmState; rolledBack: boolean } {
    if (!state.gm_at || messages.some((m) => m.chatId === state.gm_at)) return { state, rolledBack: false }
    let prev: GmState = {}
    try { prev = JSON.parse(state.gm_prev ?? '{}') ?? {} } catch { prev = {} }
    return { state: { ...prev, gm_at: '', gm_prev: '' }, rolledBack: true }
}

/**
 * After a reply: the state to keep (with what to roll back to) and the reply without its blocks; null when it changes nothing.
 * `player` is the turn the reply answers: a side it commits to is recorded even when the reply wrote no block (sidePaths).
 */
export function takeGm(state: GmState, reply: Msg, charCount: number, player = ''): { state: GmState; text: string } | null {
    const blocks = gmBlocks(reply.data)
    const bodies = sidePaths(blocks, state, player)
    if (!blocks.length && !bodies.length) return null
    const { gm_prev: _p, gm_at: _a, ...before } = state
    const next = applyGm(before, bodies, charCount)
    return { state: { ...next, gm_prev: JSON.stringify(before), gm_at: reply.chatId ?? '' }, text: stripGm(reply.data) }
}

// ---- the bookkeeper ------------------------------------------------------------------------------------------------------------
// The narrator alone keeps the notes badly (measured 2026-10-19, DeepSeek v4.1 flash, 10 turns per run): Shadow Slave wrote the
// block in 3 of 10 replies and took 5 replies to seed an arc, and in two runs where the player committed to a side (offering
// a girl to the slavers to join them; a pact with the voice in a trunk) no reply ever wrote path:, so the side would be lost
// in a long chat. So after every reply a small helper call (the submodel, as storyVoice uses) reads the reply and writes the
// notes that changed; its block goes through applyGm like the narrator's. A failed or slow helper changes nothing.

/** The current notes as lines for the helper ('none' when empty). */
export function stateLines(state: GmState): string {
    const out: string[] = []
    if (state.gm_arc) out.push(`arc: ${state.gm_arc}`)
    if (state.gm_beat) out.push(`beat: ${state.gm_beat}`)
    for (const t of lines(state.gm_threats)) out.push(`threat: ${t}`)
    if (state.gm_path) out.push(`path: ${state.gm_path}`)
    for (const e of lines(state.gm_enemies)) out.push(`enemy: ${e}`)
    for (const g of lines(state.gm_gained)) out.push(`gained: ${g}`)
    for (const r of due(state.gm_rewards_due)) out.push(`reward: ${r}`)
    for (const c of due(state.gm_consequences_due)) out.push(`consequence: ${c}`)
    if (state.gm_canon) out.push(`canon: ${state.gm_canon}`)
    for (const l of lines(state.gm_left)) out.push(`(left side: ${l.split('|')[0].trim()})`)
    for (const p of lines(state.gm_past)) out.push(`(past arc: ${p})`)
    return out.length ? out.join('\n') : 'none'
}

/**
 * The helper's request: the notes, the player's turn and the reply; it answers with one [[GM]] block. `status` is the card's
 * own panel part (statusBook.ts), asked in the same call so a turn costs one helper call; `state` null leaves the GM part out.
 */
export function bookkeepPrompt(state: GmState | null, player: string, reply: string, flavour: string, status = ''): string {
    const cut = (s: string, n: number) => { const t = (s ?? '').trim(); return t.length > n ? '…' + t.slice(-n) : t }
    const turn = `THE PLAYER'S LAST ACTION:
${cut(player, 800)}

THE STORY'S REPLY:
${cut(reply, 3500)}`
    if (!state) return `You keep the status panel of an interactive story.\n\n${turn}\n\n${status}`
    const side = playerSide(player)
    return `You keep the Game Master's notes for an interactive story: the player's own story inside a novel's world, not the novel's plot.

NOTES NOW:
${stateLines(state)}

${turn}
${side ? `\nTHE PLAYER COMMITTED TO A SIDE IN THEIR OWN WORDS: ${side} (the app records it as the path; write path: only with that side's name).\n` : ''}
Write the notes this reply changed, as one block:
[[GM
arc: <hook> | <antagonist> | <goal> | <stakes>
beat: <n> | <what is happening now> | <what is due next>   (n goes up only when a new event, enemy or obstacle arrived)
threat: <name> | <progress, e.g. 2/4> | <what happens when it fills>
path: <side> | <stage> | <standing>
enemy: <who> | <why they oppose the player>
gained: <what a side or deed gave>
reward: <what> | <when it is paid>   (paid in this reply: reward: <what> | done)
consequence: <what> | <when it lands>   (landed in this reply: consequence: <what> | done)
canon: <in-world date> | <what canon people are doing off-screen>
]]
Rules: leave out every line that did not change (never write "unchanged" or "no change"); always the beat line; each value a short fact, no questions or commentary. arc: only when there is none yet (invent one fitted to the character, an antagonist of their own such as ${flavour}, never a canon villain; when they have a side, from that side: its order or test, whom it is against or a rival inside it), or "arc: done | <how>" when this reply resolved it. path: only when the player joined, swore to, rose in or left a side in this reply: a faction, a group or crew, a person they now serve or work for, the villains' side included (never a place, a camp, a route, a job or a task they were given; "path: -" when they left one). enemy: someone who now opposes the player because of what they did. Write in the story's language. Never invent what the reply did not show, except a new arc.${status ? `\n\n${status}` : ''}`
}

/** The block in the helper's answer (a bare list of lines counts too), or null. Its [[STATUS]] block is not part of it. */
export function parseBookkeep(text: string): string[] | null {
    const t = (text ?? '').replace(/\[\[STATUS\b[\s\S]*?(\]\]|$)/g, '')
    const bodies = gmBlocks(t)
    if (bodies.length) return bodies
    const bare = t.split('\n').filter((l) => /^\s*(arc|beat|threat|path|enemy|gained|reward|consequence|canon)\s*:/i.test(l))
    return bare.length ? [bare.join('\n')] : null
}

/** The state after the helper's notes, attributed to the same reply as the narrator's (one rollback undoes both). */
export function applyBookkeep(state: GmState, bodies: string[], replyId: string, charCount: number, player = ''): GmState {
    const { gm_prev, gm_at, ...cur } = state
    const prev = gm_at === replyId && gm_prev ? gm_prev : JSON.stringify(cur)
    return { ...applyGm(cur, sidePaths(bodies, cur, player), charCount), gm_prev: prev, gm_at: replyId }
}
