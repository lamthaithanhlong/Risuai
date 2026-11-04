// Scorers for the persona growth system (stats + skill mastery; spec: nguoi-dua-thu-khung-bo/.pm-risu-5h/stats-spec.md C, D, E, F).
// Pure and deterministic, no model. A scorer returns problems ([{rule, text}], empty = pass) over `runs`:
//   runs = [{ start?: {stats, skills}, turns: [turn] }]   the STORY turns of each fresh run in order (after the creation turns), where
//   turn = { raw, shown, reply?, ticks?, panel?, stats?, skills?, slots?, rank?, brk? }
//     raw    what the narrator wrote (the [[ACT|…]] / [[BREAK|…]] tags may still be in it)
//     shown  the prose the player saw; reply = the stored chat message (both must be free of tags)
//     ticks  chat var $stat_ticks as left after this turn (this turn's lines only); panel = the panel text (used when `ticks` is absent)
//     stats  chat var $stats  JSON {"suc_manh":int,...} in hundredths (object or JSON text)
//     skills chat var $skills JSON {"<id>":{"m":int,"eq":0|1,"link"?:[stat],"name"?:text}}
//     slots  chat var $slots; rank = $stat_rank (default 1); brk = $stat_break as left after the turn
//   start = the values before the first story turn (default: every stat 1000 = 10.00%, a skill first seen starts at 0, as a find's skill does).
// Each has to go red on its fixture (fixtures/stats/*.json, stats.check.mjs breaks them on purpose).

export const MIN_TURNS = 30               // story turns per run before the gate counts
export const STAT_KEYS = ['suc_manh', 'nhanh_nhen', 'the_luc', 'tinh_than', 'cam_nhan', 'y_chi']
export const LABELS = { suc_manh: 'Sức mạnh', nhanh_nhen: 'Nhanh nhẹn', the_luc: 'Thể lực', tinh_than: 'Tinh thần', cam_nhan: 'Cảm nhận', y_chi: 'Ý chí' }
export const SOFT_CAPS = [40, 60, 80]     // whole percent by world rank (zombie)
export const HARD_CAP = 100
export const SLOT_THRESHOLDS = [15, 30, 45, 60, 75]   // whole percent of Ý chí, one more slot each (max 6)
export const LINK_MARGIN = 25

const KEY_OF = Object.fromEntries(Object.entries(LABELS).map(([k, l]) => [l, k]))
const json = (v, d) => { if (v && typeof v === 'object') return v; try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : d } catch { return d } }
const hs = (n) => `${Math.floor(n / 100)}.${String(n % 100).padStart(2, '0')}`

/** "Sức mạnh 23.47% (+0.01)" / "Thành thạo Nghe nhịp bước 12.34% (+0.01)" lines -> [{kind, key?, name, value, delta}] (hundredths) */
export function parseTicks(text) {
    const out = []
    for (const line of String(text ?? '').split(/\r?\n/)) {
        const m = /^[\s*_>•\-]*(.+?)\s+(\d+)[.,](\d{2})\s*%\s*\(\s*([+-])\s*(\d+)[.,](\d{2})\s*\)[\s*_]*$/.exec(line)
        if (!m) continue
        let name = m[1].trim()
        const value = Number(m[2]) * 100 + Number(m[3])
        const delta = (m[4] === '-' ? -1 : 1) * (Number(m[5]) * 100 + Number(m[6]))
        const skill = /^Thành thạo\s+/i.test(name)
        if (skill) name = name.replace(/^Thành thạo\s+/i, '')
        out.push(!skill && KEY_OF[name] ? { kind: 'stat', key: KEY_OF[name], name, value, delta } : { kind: 'skill', name, value, delta })
    }
    return out
}
const isTickLine = (line) => parseTicks(line).length > 0
const ticksOf = (t) => parseTicks(t.ticks !== undefined ? t.ticks : t.panel)

/** the chat variables of a turn as numbers: {stats, skills, slots, rank} (undefined when the turn carries no state) */
export function stateOf(t) {
    const stats = t.stats === undefined || t.stats === '' ? undefined : json(t.stats, undefined)
    const skills = t.skills === undefined || t.skills === '' ? {} : json(t.skills, {})
    const slots = t.slots === undefined || t.slots === '' ? undefined : Number(t.slots)
    const rank = Math.min(3, Math.max(1, Number(t.rank) || 1))
    return { stats, skills, slots, rank }
}
const startOf = (run) => {
    const s = json(run.start?.stats, {})
    return { stats: Object.fromEntries(STAT_KEYS.map((k) => [k, Number.isFinite(Number(s[k])) ? Number(s[k]) : 1000])), skills: json(run.start?.skills, {}) }
}
const clip = (s, i, n = 70) => String(s).slice(Math.max(0, i - 20), i + n).replace(/\s+/g, ' ')

// ---- stats.ticks -----------------------------------------------------------------------------------------------------------------------

/** every run: >= MIN_TURNS story turns, at least one stat tick AND at least one skill-mastery tick somewhere in the run */
export function ticksProblems(runs) {
    const out = []
    runs.forEach((run, r) => {
        const turns = run.turns ?? []
        if (turns.length < MIN_TURNS) out.push({ rule: 'too-few-turns', text: `run ${r + 1}: ${turns.length} story turns, need ${MIN_TURNS}` })
        const all = turns.flatMap(ticksOf)
        if (!all.some((t) => t.kind === 'stat')) out.push({ rule: 'no-stat-tick', text: `run ${r + 1}: no stat tick in ${turns.length} turns` })
        if (!all.some((t) => t.kind === 'skill')) out.push({ rule: 'no-skill-tick', text: `run ${r + 1}: no skill-mastery tick in ${turns.length} turns` })
    })
    return out
}

// ---- stats.consistent ------------------------------------------------------------------------------------------------------------------

/**
 * After every turn the stored $stats/$skills equal the previous values plus that turn's ticks, exactly: no gain without a tick, no tick
 * without a gain, and the value a tick shows is the stored one. A skill seen for the first time starts at 0 (a find's skill).
 */
export function consistentProblems(runs) {
    const out = []
    runs.forEach((run, r) => {
        let { stats: prev, skills: prevSk } = startOf(run)
        let seen = 0
        ;(run.turns ?? []).forEach((t, i) => {
            const at = `run ${r + 1} turn ${i + 1}`
            const st = stateOf(t)
            if (!st.stats) return
            seen++
            const ticks = ticksOf(t)
            for (const k of STAT_KEYS) {
                const mine = ticks.filter((x) => x.kind === 'stat' && x.key === k)
                const want = mine.reduce((s, x) => s + x.delta, 0)
                const got = (Number(st.stats[k]) || 0) - prev[k]
                if (got !== want) out.push({ rule: got > want ? 'gain-without-tick' : 'tick-without-gain', text: `${at}: ${LABELS[k]} went ${hs(prev[k])} -> ${hs(Number(st.stats[k]) || 0)} (${got >= 0 ? '+' : ''}${got} hundredths) but the ticks sum to ${want}` })
                else if (mine.length && mine.at(-1).value !== Number(st.stats[k])) out.push({ rule: 'tick-value', text: `${at}: ${LABELS[k]} tick shows ${hs(mine.at(-1).value)} but ${hs(Number(st.stats[k]))} is stored` })
            }
            const byName = new Map()
            for (const [id, sk] of Object.entries(st.skills)) { byName.set(id, id); if (sk?.name) byName.set(sk.name, id) }
            const sk = {}
            for (const x of ticks.filter((x) => x.kind === 'skill')) {
                const id = byName.get(x.name)
                if (!id) { out.push({ rule: 'unknown-skill-tick', text: `${at}: tick for "${x.name}", which is not in $skills` }); continue }
                ;(sk[id] ??= []).push(x)
            }
            for (const [id, s] of Object.entries(st.skills)) {
                const before = prevSk[id]?.m ?? 0
                const mine = sk[id] ?? []
                const want = mine.reduce((a, x) => a + x.delta, 0)
                const got = (Number(s?.m) || 0) - before
                if (got !== want) out.push({ rule: got > want ? 'gain-without-tick' : 'tick-without-gain', text: `${at}: skill ${id} went ${hs(before)} -> ${hs(Number(s?.m) || 0)} but the ticks sum to ${want}` })
                else if (mine.length && mine.at(-1).value !== Number(s?.m)) out.push({ rule: 'tick-value', text: `${at}: skill ${id} tick shows ${hs(mine.at(-1).value)} but ${hs(Number(s?.m))} is stored` })
            }
            prev = Object.fromEntries(STAT_KEYS.map((k) => [k, Number(st.stats[k]) || 0]))
            prevSk = st.skills
        })
        if (!seen) out.push({ rule: 'no-state', text: `run ${r + 1}: no turn carries $stats, nothing to compare the ticks with` })
    })
    return out
}

// ---- stats.noLeak ----------------------------------------------------------------------------------------------------------------------

const TAG = /\[\[\s*(?:A(?:C(?:T)?)?|B(?:R(?:E(?:A(?:K)?)?)?)?)(?![A-Za-z])|\bACT\|[a-z_]+\|/i
const PROSE = [/\+\s*0[.,]0\d\b/, /\d+(?:[.,]\d+)?\s*%/, /bạn nhận được/i]

/** neither the displayed reply nor the stored message has a tag (whole or partial); the prose, outside the panel tick lines, has no +0.01, percent or "Bạn nhận được" */
export function leakProblems(runs) {
    const out = []
    runs.forEach((run, r) => {
        ;(run.turns ?? []).forEach((t, i) => {
            const at = `run ${r + 1} turn ${i + 1}`
            for (const [field, text] of [['shown', t.shown], ['stored', t.reply]]) {
                if (text === undefined || text === null) continue
                const s = String(text)
                const m = TAG.exec(s)
                if (m) out.push({ rule: 'tag-visible', text: `${at} (${field}): «${clip(s, m.index)}»` })
            }
            const prose = String(t.shown ?? '').split(/\r?\n/).filter((l) => !isTickLine(l)).join('\n')
            for (const re of PROSE) { const m = re.exec(prose); if (m) { out.push({ rule: 'number-in-prose', text: `${at}: «${clip(prose, m.index)}»` }); break } }
        })
    })
    return out
}

// ---- stats.cap -------------------------------------------------------------------------------------------------------------------------

/** the stats a [[BREAK|…]] tag names (a tag naming none = all of them) */
const breaks = (raw) => {
    const keys = new Set()
    for (const m of String(typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')).matchAll(/\[\[\s*BREAK\|([^\]]*)\]\]/gi)) {
        const named = m[1].split(/[+,|\s]+/).filter((k) => STAT_KEYS.includes(k))
        for (const k of named.length ? named : STAT_KEYS) keys.add(k)
    }
    return keys
}

/** the slots a persona has: 1 + the Ý chí thresholds passed (value in hundredths) */
export const slotsFor = (yChi) => 1 + SLOT_THRESHOLDS.filter((p) => yChi >= p * 100).length

/**
 * No stat above its soft cap (by $stat_rank) unless a BREAK was recorded for it, none above 100; no skill above its linked stat + 25;
 * equipped skills never above $slots; $slots = 1 + thresholds passed from y_chi.
 */
export function capProblems(runs) {
    const out = []
    runs.forEach((run, r) => {
        const broken = new Set()
        ;(run.turns ?? []).forEach((t, i) => {
            const at = `run ${r + 1} turn ${i + 1}`
            for (const k of breaks(t.raw)) broken.add(k)
            for (const k of String(t.brk ?? '').split(/[+,|\s]+/)) if (STAT_KEYS.includes(k)) broken.add(k)
            const st = stateOf(t)
            if (!st.stats) return
            for (const k of STAT_KEYS) {
                const v = Number(st.stats[k]) || 0
                if (v > HARD_CAP * 100) out.push({ rule: 'over-hard-cap', text: `${at}: ${LABELS[k]} ${hs(v)}% is above ${HARD_CAP}` })
                else if (v > SOFT_CAPS[st.rank - 1] * 100 && !broken.has(k)) out.push({ rule: 'over-soft-cap', text: `${at}: ${LABELS[k]} ${hs(v)}% is above the rank ${st.rank} soft cap ${SOFT_CAPS[st.rank - 1]} and no BREAK was recorded` })
            }
            for (const [id, s] of Object.entries(st.skills)) {
                if (!Array.isArray(s?.link) || !s.link.length) continue
                const cap = Math.min(HARD_CAP * 100, Math.max(...s.link.map((k) => Number(st.stats[k]) || 0)) + LINK_MARGIN * 100)
                if ((Number(s.m) || 0) > cap) out.push({ rule: 'skill-over-link', text: `${at}: skill ${id} mastery ${hs(Number(s.m))}% is above its linked stat + ${LINK_MARGIN} (${hs(cap)}%)` })
            }
            if (st.slots === undefined || !Number.isFinite(st.slots)) { out.push({ rule: 'no-slots', text: `${at}: $slots is missing` }); return }
            const used = Object.values(st.skills).filter((s) => Number(s?.eq) === 1).length
            if (used > st.slots) out.push({ rule: 'slots-over', text: `${at}: ${used} skills equipped but $slots is ${st.slots}` })
            const want = slotsFor(Number(st.stats.y_chi) || 0)
            if (st.slots !== want) out.push({ rule: 'slots-wrong', text: `${at}: $slots is ${st.slots}, Ý chí ${hs(Number(st.stats.y_chi) || 0)}% gives ${want}` })
        })
    })
    return out
}

// ---- stats.equipped --------------------------------------------------------------------------------------------------------------------

/** a skill that was not equipped (before or after the turn) gains no mastery */
export function equippedProblems(runs) {
    const out = []
    runs.forEach((run, r) => {
        let prevSk = startOf(run).skills
        ;(run.turns ?? []).forEach((t, i) => {
            const st = stateOf(t)
            if (!st.stats) return
            for (const [id, s] of Object.entries(st.skills)) {
                const before = prevSk[id]
                const gained = (Number(s?.m) || 0) - (before?.m ?? 0)
                if (gained > 0 && before !== undefined && Number(before.eq) !== 1 && Number(s?.eq) !== 1) out.push({ rule: 'unequipped-gain', text: `run ${r + 1} turn ${i + 1}: skill ${id} gained ${gained} hundredths while it was not equipped` })
                if (gained > 0 && before === undefined && Number(s?.eq) !== 1 && Number(s?.m) > 0) out.push({ rule: 'unequipped-gain', text: `run ${r + 1} turn ${i + 1}: skill ${id} appeared with ${hs(Number(s.m))}% and was never equipped` })
            }
            prevSk = st.skills
        })
    })
    return out
}

// ---- checks for the gate/summary -------------------------------------------------------------------------------------------------------

/** the five check objects (score.mjs shape) over the story turns of the fresh runs */
export function statsChecks(runs) {
    const n = runs.length
    const total = runs.reduce((s, r) => s + (r.turns?.length ?? 0), 0)
    const ticks = runs.reduce((s, r) => s + (r.turns ?? []).flatMap(ticksOf).length, 0)
    const mk = (id, title, probs) => ({ id, title, status: n && !probs.length ? 'PASS' : 'FAIL', summary: probs.length ? `${probs.length} problem(s) over ${n} runs / ${total} story turns` : `${n} runs, ${total} story turns, ${ticks} ticks`, evidence: probs.map((p) => `${p.rule}: ${p.text}`) })
    return [
        mk('stats.ticks', `>= ${MIN_TURNS} story turns with at least one stat tick and one skill-mastery tick in each of ${n} fresh runs`, ticksProblems(runs)),
        mk('stats.consistent', 'Stored $stats/$skills = start + the ticks seen, exactly (hundredths)', consistentProblems(runs)),
        mk('stats.noLeak', 'No [[ACT / [[BREAK / partial tag in any reply; no +0.01, percent or "Bạn nhận được" in the prose', leakProblems(runs)),
        mk('stats.cap', 'Soft cap 40 (rank 1) unless a BREAK, never above 100, slots used <= $slots, $slots = 1 + thresholds passed', capProblems(runs)),
        mk('stats.equipped', 'A skill that was never equipped gains no mastery', equippedProblems(runs)),
    ]
}
