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
//   ]]
// After the reply the app takes the block out of the message and keeps each value in a chat variable (gm_*, as the cards'
// status.lua keeps st_*); the screen hides a block still being streamed. Every turn the app puts one short note after the
// player's message (a system note alone is not read on this route, see playerAgency.ts): the state, and this turn's dice,
// rolled by the app (crypto), not by the model's whim. Before the character is confirmed (the card's "Được chưa?" step) the
// GM says nothing; the reply that answers the yes seeds the first arc.

export const GM_KEYS = ['gm_arc', 'gm_beat', 'gm_threats', 'gm_rewards_due', 'gm_consequences_due', 'gm_canon', 'gm_past'] as const
export type GmKey = (typeof GM_KEYS)[number]
export type GmState = Partial<Record<GmKey | 'gm_beat_at' | 'gm_at' | 'gm_prev', string>>

const MAXLEN = 140
const MAX_THREATS = 3
const MAX_DUE = 3
const MAX_PAST = 3

const BLOCK = /\[\[GM\b([\s\S]*?)\]\]/g
const OPEN_TAIL = /\[\[GM\b[\s\S]*$/

const clean = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, MAXLEN)
const isDash = (s: string) => /^(-|—|none|null)?$/i.test(s.trim())
const lines = (v: string | undefined) => (v ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
const nameOf = (l: string) => l.split('|')[0].trim().toLowerCase()

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

/** The state after one reply's blocks. `charCount` is the number of story replies, this one included (for the pace). */
export function applyGm(state: GmState, bodies: string[], charCount: number): GmState {
    const next: GmState = { ...state }
    let rewards: string[] | null = null
    let costs: string[] | null = null
    let threats = lines(state.gm_threats)
    for (const body of bodies) {
        for (const raw of body.split(/\r?\n/)) {
            const m = /^\s*[-*•]?\s*([a-z_]+)\s*:\s*(.*)$/i.exec(raw)
            if (!m) continue
            const key = m[1].toLowerCase()
            const value = clean(m[2])
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
                } else if (value) next.gm_arc = value
            } else if (key === 'beat') {
                if (value !== (state.gm_beat ?? '')) { next.gm_beat = isDash(value) ? '' : value; next.gm_beat_at = String(charCount) }
            } else if (key === 'threat') {
                const name = nameOf(value)
                if (!name) continue
                const rest = value.split('|').slice(1)
                const gone = rest.length > 0 && rest.every(isDash)
                threats = threats.filter((t) => nameOf(t) !== name)
                if (!gone) threats.push(value)
            } else if (key === 'reward' || key === 'rewards') {
                rewards ??= []
                if (!isDash(value)) rewards.push(value)
            } else if (key === 'consequence' || key === 'consequences' || key === 'cost') {
                costs ??= []
                if (!isDash(value)) costs.push(value)
            } else if (key === 'canon') {
                if (value) next.gm_canon = isDash(value) ? '' : value
            }
        }
    }
    next.gm_threats = threats.slice(-MAX_THREATS).join('\n')
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

export type GmPhase = 'silent' | 'seed' | 'run'

/**
 * When the GM speaks. Silent before the first reply and while a character is being made; 'seed' on the turn that confirms it
 * (or the first turn with no arc yet), 'run' after.
 * A card with no creation step and no panel is not a story (a companion chat): silent.
 */
export function gmPhase(card: Card, messages: Msg[], vars: Record<string, unknown> | undefined, state: GmState, storyLike = false): GmPhase {
    const replies = messages.filter((m) => m.role === 'char')
    if (!replies.length) return 'silent'
    // confirmed: the panel was written, the GM already ran, or a "Được chưa?" was answered yes (this turn or before)
    const confirmed = hasPanel(vars) || !!state.gm_arc || !!state.gm_past
        || messages.some((m, i) => m.role === 'user' && i > 0 && messages[i - 1].role === 'char' && ASKED.test(messages[i - 1].data ?? '') && isYes(m.data))
    if (!confirmed && (hasCreationStep(card) || !storyLike)) return 'silent'
    return state.gm_arc ? 'run' : 'seed'
}

/** A die from the app's randomness (crypto), never the model's. */
export function cryptoRandom(): number {
    const a = new Uint32Array(1)
    globalThis.crypto.getRandomValues(a)
    return a[0] / 2 ** 32
}

export type GmDice = { pace: 'quiet' | 'build' | 'advance' | 'escalate'; surface: string; consequence: boolean; canon: boolean }

/** Advance chance by replies since the beat last moved: a beat that just moved rests, a stalled one is pushed. */
const ADVANCE = [0.1, 0.3, 0.45, 0.6, 0.75, 0.85]

/** This turn's dice, rolled fresh every request. */
export function rollGm(state: GmState, charCount: number, rng: () => number = cryptoRandom): GmDice {
    const since = Math.max(0, charCount - (Number(state.gm_beat_at ?? '') || 0))
    const advance = rng() < ADVANCE[Math.min(since, ADVANCE.length - 1)]
    const hot = rng() < 0.4
    const pace: GmDice['pace'] = advance ? (hot ? 'escalate' : 'advance') : (hot ? 'build' : 'quiet')
    const arc = (state.gm_arc ?? '').split('|').map((s) => s.trim())
    const threads = [
        arc[1] ? `the antagonist (${arc[1]})` : '',
        ...lines(state.gm_threats).map((t) => `the threat "${t.split('|')[0].trim()}"`),
        arc[2] ? 'the goal' : '',
    ].filter(Boolean)
    const surface = threads.length ? threads[Math.floor(rng() * threads.length)] : 'the arc'
    const consequence = !!lines(state.gm_consequences_due).length && rng() < 0.35
    const canon = rng() < 0.25
    return { pace, surface, consequence, canon }
}

const PACE: Record<GmDice['pace'], string> = {
    quiet: 'QUIET beat: no new trouble; let the player\'s choice play out and breathe',
    build: 'BUILD: no new event; one threat creeps a step (a sign at most)',
    advance: 'ADVANCE: the arc\'s next event, enemy or obstacle arrives with a clear challenge',
    escalate: 'ESCALATE: the arc\'s next beat arrives and the stakes rise',
}

/** Flavour only: the kind of personal trouble that fits the card's world (the GM itself is the same for every world). */
export function worldFlavour(card: Card): string {
    const text = `${card?.name ?? ''}\n${(card?.globalLore ?? []).map((l) => l?.comment ?? '').join('\n')}`
    if (/shadow slave|nô lệ bóng tối|nightmare engine|forgotten shore/i.test(text)) return 'a rival Sleeper, a clan\'s agent, a creature that marked them, a debt'
    if (/lord of (the )?myster|quỷ bí|beyonder potion|pathways and sequences/i.test(text)) return 'a hostile Beyonder, a secret order, a church inquiry, a debt'
    if (/infinite mailman|người đưa thư|delivery world|stamp book/i.test(text)) return 'a hostile recipient, a rival mailman, a broken delivery, a penalty'
    return 'a rival, a hunter, a debt, a secret'
}

const short = (v: string | undefined, n = 120) => { const s = (v ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s }

/** The note for this turn, or '' when the GM is silent. */
export function gmNote(phase: GmPhase, state: GmState, dice: GmDice, flavour: string): string {
    if (phase === 'silent') return ''
    const parts: string[] = []
    if (phase === 'seed') {
        const past = lines(state.gm_past).pop()
        parts.push(`No arc yet: seed one fitted to who the character is (hook, an antagonist of their own such as ${flavour}, never a canon villain; a goal; stakes)${past ? `, grown from the last one: ${short(past)}` : ''}. In prose at most the first hook.`)
    } else {
        parts.push(`Arc: ${short(state.gm_arc, 130)}.`)
        if (state.gm_beat) parts.push(`Beat: ${short(state.gm_beat, 100)}.`)
        const threats = lines(state.gm_threats)
        if (threats.length) parts.push(`Threat: ${threats.map((t) => short(t, 70)).join('; ')}.`)
        const rewards = lines(state.gm_rewards_due), costs = lines(state.gm_consequences_due)
        if (rewards.length) parts.push(`Reward: ${rewards.map((r) => short(r, 70)).join('; ')}.`)
        if (costs.length) parts.push(`Consequence: ${costs.map((c) => short(c, 70)).join('; ')}.`)
        parts.push(`Dice: ${PACE[dice.pace]}; surfaces: ${dice.surface}${dice.consequence ? '; a due consequence lands now' : ''}.`)
    }
    parts.push(`Canon: ${state.gm_canon ? short(state.gm_canon, 100) : 'set the in-world date'}; canon people live their own lives off-screen: news or a distant sighting only${dice.canon ? ' (some may come up now)' : ''}, a meeting only if paths cross naturally; never rewrite canon.`)
    const fields = phase === 'seed'
        ? 'arc: hook|antagonist|goal|stakes, beat: n|now|due next, threat: name|progress|when full (up to 3), reward: what|when, consequence: what|when, canon: date|off-screen'
        : 'the keys above, fields split by |; arc: done|how ends the arc'
    return '\n\n[GM, hidden, never named in the story: the player\'s own arc, not the novel\'s plot. ' + parts.join(' ')
        + ' The player\'s action still happens; at most one new trouble a reply, the card\'s own dice included. Success pays, failure costs, inside the world\'s rules (no free rank, Sequence, stamp or power).'
        + ` Last, after any panel: [[GM]] with only changed lines (${fields}).]`
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
    for (const k of [...GM_KEYS, 'gm_beat_at', 'gm_at', 'gm_prev'] as const) {
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

/** After a reply: the state to keep (with what to roll back to) and the reply without its blocks; null when it has none. */
export function takeGm(state: GmState, reply: Msg, charCount: number): { state: GmState; text: string } | null {
    const bodies = gmBlocks(reply.data)
    if (!bodies.length) return null
    const { gm_prev: _p, gm_at: _a, ...before } = state
    const next = applyGm(before, bodies, charCount)
    return { state: { ...next, gm_prev: JSON.stringify(before), gm_at: reply.chatId ?? '' }, text: stripGm(reply.data) }
}
