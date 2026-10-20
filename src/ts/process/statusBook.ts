// The status panel's bookkeeper: the card's [[STATUS]] keys (st_*) kept up to date when the narrator forgets them.
//
// Measured 2026-10-19: with the story combo on gpt-6-luna (twice as fast as gpt-6-sol), Shadow Slave's narrator wrote a STATUS
// block in 4 of 21 replies and the panel changed in 2 of 20 turns (sol: every turn that moved time or place). The panel is the
// card's (status.lua reads the block and keeps each value in a chat variable st_<key>; Module 07 in the lorebook prints them into
// every prompt), so the keys and their format are read from that lorebook entry, never assumed: any card whose lorebook teaches a
// [[STATUS]] block with {{getvar::st_<key>}} lines gets it. The question rides on the Game Master's bookkeeper call (one helper
// call per turn for both), and the answer is applied the way status.lua applies a block: each key to st_<key>, "-" clears it,
// values capped at 160 characters, only the card's own keys (never st_refused, which the card's script writes).

export type StatusSpec = { keys: string[]; guide: string }
type Card = { globalLore?: { content?: string }[] } | undefined

const MAXLEN = 160
const GUIDE_MAX = 4000
const TALK = /^(\(?(unchanged|no change|not changed|same( as before)?|n\/a|null|none|unknown|không đổi|chưa rõ)\)?\.?)$/i

/** The card's panel: its keys (from the {{getvar::st_*}} lines of the lorebook entry that teaches [[STATUS]]) and that entry's
 *  instructions (the part before the variables), or null for a card with no panel. */
export function statusSpec(card: Card): StatusSpec | null {
    for (const l of card?.globalLore ?? []) {
        const c = l?.content ?? ''
        if (!/\[\[STATUS\b/.test(c)) continue
        const keys = [...new Set([...c.matchAll(/\{\{getvar::st_([a-z0-9_]+)\}\}/gi)].map((m) => m[1].toLowerCase()))].filter((k) => k !== 'refused')
        if (!keys.length) continue
        const lines = c.split('\n')
        let end = lines.findIndex((x) => /\{\{getvar::/.test(x))
        // the heading over the variables ("CURRENT PANEL (filled by the script …)") goes with them
        while (end > 0 && (/^\s*$/.test(lines[end - 1]) || /^\s*CURRENT\b/.test(lines[end - 1]))) end--
        return { keys, guide: lines.slice(0, Math.max(0, end)).join('\n').trim().slice(0, GUIDE_MAX) }
    }
    return null
}

const valueOf = (vars: Record<string, unknown> | undefined, k: string) => {
    const v = vars?.['$st_' + k]
    return v === undefined || v === null || String(v) === 'null' ? '' : String(v)
}

// ---- a reward is paid once -----------------------------------------------------------------------------------------------------
// Measured 2026-10-20 on the owner's Shadow Slave chat (save.story.sqlite history + 9router's logged answers): after the first kill
// the Soul Fragments went 0 -> 3 (the narrator's block) -> 8 (the helper, the same kill again, 6 s later), then 8 -> 12 on a turn
// that only looked through a door (the helper saw the body) and 12 -> 16 on a turn that said "the creature did not die" (the
// narrator, whose own block the card's script had cut from the reply it reads back, so it saw the kill line in the history and no
// sign it had been paid). Replayed 8 times, the helper paid the kill a second time in 8 of 8. So: what the narrator wrote for a
// reply is its own (the helper leaves that key alone), and a counter (a bare number or "x/N": fragments, post points) goes up only
// in a reply that has a line of the world's system in brackets ("[Ngươi đã giết một Thú Ngủ Say, …]", the Post Office's cold
// prompts): the event that pays. Going down (points spent) needs nothing.

const COUNTER = /^\s*(\d[\d.,]*)\s*(?:\/\s*\d[\d.,]*)?\s*$/
const counterOf = (v: string): number | null => {
    const m = COUNTER.exec(v ?? '')
    return m ? Number(m[1].replace(/[.,]/g, '')) : null
}

/** The value goes up as a counter ("12/1000" -> "16/1000", "12" -> "15"); a first value (the panel being filled) is not a rise. */
export function counterRises(was: string, now: string): boolean {
    const a = counterOf(was), b = counterOf(now)
    return a !== null && b !== null && b > a
}

/** The reply has a line of the world's system: a whole line in single brackets (not a [[block]] or the "[💡…]" plan line). */
export function hasSystemLine(reply: string): boolean {
    return (reply ?? '').split(/\r?\n/).some((raw) => {
        const l = raw.trim().replace(/^[*_]+|[*_]+$/g, '').trim()
        return /^\[(?!\[|💡)[^\[\]]+\][.!]?$/u.test(l)
    })
}

/** The panel's values for the card's keys ("" when not set). */
export function panelOf(spec: StatusSpec, vars: Record<string, unknown> | undefined): Record<string, string> {
    return Object.fromEntries(spec.keys.map((k) => [k, valueOf(vars, k)]))
}

/**
 * After the narrator's own block (the card's script has applied it): the keys it wrote for this reply, and the counters it raised
 * with no system line in the reply, which go back to what they were (`before` is the panel when the request was sent).
 */
export function narratorWrites(spec: StatusSpec, before: Record<string, string>, vars: Record<string, unknown> | undefined, reply: string): { written: Record<string, string>; unpaid: Record<string, string> } {
    const written: Record<string, string> = {}, unpaid: Record<string, string> = {}
    const paid = hasSystemLine(reply)
    for (const k of spec.keys) {
        const now = valueOf(vars, k), was = before[k] ?? ''
        if (now === was) continue
        if (!paid && counterRises(was, now)) unpaid[k] = was
        else written[k] = now
    }
    return { written, unpaid }
}

export type StatusTurn = { previous?: string; written?: Record<string, string> }

/** The helper's part of the request: the card's rules for the block, the panel as it is now, what to write. */
export function statusPrompt(spec: StatusSpec, vars: Record<string, unknown> | undefined, turn: StatusTurn = {}): string {
    const written = turn.written ?? {}
    const set = spec.keys.filter((k) => valueOf(vars, k)).map((k) => `${k}: ${valueOf(vars, k)}`)
    const unset = spec.keys.filter((k) => !valueOf(vars, k))
    const prev = (turn.previous ?? '').trim()
    const done = Object.keys(written)
    return `THE STATUS PANEL. The story's own rules for it:
${spec.guide}

THE PANEL NOW:
${set.length ? set.join('\n') : '(empty)'}${unset.length ? `\nnot set: ${unset.join(', ')}` : ''}
${prev ? `\nTHE REPLY BEFORE IT (everything it showed is already on the panel):\n${prev.length > 1500 ? '…' + prev.slice(-1500) : prev}\n` : ''}${done.length ? `\nThe story already wrote these for this reply, leave them out: ${done.map((k) => `${k}: ${written[k]}`).join('; ')}\n` : ''}
Then write one [[STATUS]] block with only the keys this reply changed, in the format and language the rules above give (time passed: date; the character moved: place; a wound, tiredness or healing: condition; a thing gained, used up or lost: its item key; money spent or earned: money; a power, rank or Sequence only when the reply shows it granted, by the rules above), or a key the story already knows that is not set yet. A gain is paid once, in the reply where it happens: a kill, a reward or a payment the reply before it showed is already counted, and a body, a wound or a reward seen again is not a new one. Only these keys: ${spec.keys.join(', ')}. "-" clears a key. No [[LEDGER]], no commentary; leave the block out when nothing on the panel changed.`
}

/**
 * The keys to write from the helper's answer: its [[STATUS]] lines for the card's keys, changed from the panel now. With `turn`:
 * never a key the narrator wrote for this reply, and a counter goes up only when the reply has a system line (see above).
 */
export function parseStatus(text: string, spec: StatusSpec, vars: Record<string, unknown> | undefined, turn?: { reply: string; written?: Record<string, string> }): Record<string, string> {
    const out: Record<string, string> = {}
    const t = text ?? ''
    const bodies = [...t.matchAll(/\[\[STATUS\b([\s\S]*?)(?:\]\]|$)/g)].map((m) => m[1])
    for (const body of bodies) {
        for (const raw of body.split(/\r?\n/)) {
            const m = /^\s*[-*•]?\s*([a-z0-9_]+)\s*:\s*(.*?)\s*$/i.exec(raw)
            if (!m) continue
            const key = m[1].toLowerCase()
            if (!spec.keys.includes(key)) continue
            let value = m[2].replace(/^\*\*|\*\*$/g, '').trim()
            if (!value || TALK.test(value)) continue
            if (value === '-' || value === '—') value = ''
            value = value.slice(0, MAXLEN)
            if (value === valueOf(vars, key)) continue
            if (turn && (key in (turn.written ?? {}) || (counterRises(valueOf(vars, key), value) && !hasSystemLine(turn.reply)))) continue
            out[key] = value
        }
    }
    return out
}

/** Writes the keys as status.lua's setChatVar would (chat variable "$st_<key>"). */
export function applyStatus(vars: Record<string, string | number | boolean>, updates: Record<string, string>): void {
    for (const [k, v] of Object.entries(updates)) vars['$st_' + k] = v
}
