// Scorers for the System's quests (owner 2026-11-05: the System gives quests, counts stats and skills). The grammar is fixtures/quests/GRAMMAR.md
// (a draft for the quest Lua, agreed with the quest worker W-S2). Pure and deterministic, no model. The reward is checked against the STORE
// ($stats / $skills of the turns), never against prose.
//   runs = [{ start?: {stats, skills}, turns: [turn] }]   turn = { raw, shown, reply, ticks?, panel?, stats?, skills?, rank?, brk?, quest?, hist? }
//     quest  chat var $quest  = JSON of the ACTIVE quest {id, title, state:"active", reward:{kind:"stat"|"skill", key|id, amount}} (amount in hundredths) or "" when none
//     hist   chat var $quest_hist = JSON array of the closed quests, oldest first: {id, state:"done"|"fail", reward?}
import { STAT_KEYS, SOFT_CAPS, HARD_CAP, LINK_MARGIN, parseTicks, stateOf } from './stats.mjs'

export const OFFER_WITHIN = 12                      // a quest is offered within the first 12 story turns of a run
const TAG = /\[\[\s*QUEST\s*\|\s*(done|fail)\s*\|\s*([A-Za-z0-9_-]+)\s*\]\]/g
const LEFT = /\[\[\s*QUEST\b|\bQUEST\|(?:done|fail)\||\[\[(?:Q|QU|QUE|QUES)(?:\s|$)/i
const OFFER_LINE = /^[\s*_>]*【[^】\n]*NHIỆM VỤ/mi
const json = (v, d) => { if (v && typeof v === 'object') return v; try { const o = JSON.parse(v); return o && typeof o === 'object' ? o : d } catch { return d } }
const activeOf = (t) => { const q = t.quest === undefined || t.quest === '' ? null : json(t.quest, null); return q && !Array.isArray(q) && q.id ? q : null }
const histOf = (t) => { const h = json(t.hist, []); return Array.isArray(h) ? h : [] }
const tagsOf = (t) => [...String(t.raw ?? t.reply ?? '').matchAll(TAG)].map((m) => ({ state: m[1].toLowerCase(), id: m[2] }))
const clip = (s, i, n = 70) => String(s).slice(Math.max(0, i - 20), i + n).replace(/\s+/g, ' ')

/** every run: a quest becomes active within OFFER_WITHIN turns, the player sees the System's 【…NHIỆM VỤ…】 line for it, and it declares a real reward */
export function offeredProblems(runs, within = OFFER_WITHIN) {
    const out = []
    runs.forEach((run, r) => {
        const turns = run.turns ?? []
        const i = turns.findIndex((t) => activeOf(t) || histOf(t).length)
        if (i < 0) { out.push({ rule: 'no-offer', text: `run ${r + 1}: no quest in ${turns.length} turns` }); return }
        if (i + 1 > within) out.push({ rule: 'offer-late', text: `run ${r + 1}: first quest at turn ${i + 1} (> ${within})` })
        const q = activeOf(turns[i]) ?? histOf(turns[i])[0]
        const seen = turns.slice(i, i + 2).some((t) => OFFER_LINE.test(t.shown || '') || OFFER_LINE.test(t.panel || ''))
        if (!seen) out.push({ rule: 'offer-silent', text: `run ${r + 1}: quest ${q?.id} is set at turn ${i + 1} but no 【…NHIỆM VỤ…】 line shows it` })
        const rw = q?.reward
        if (!(rw && (rw.kind === 'stat' ? STAT_KEYS.includes(rw.key) : rw.kind === 'skill' && rw.id) && Number(rw.amount) > 0)) out.push({ rule: 'offer-no-reward', text: `run ${r + 1}: quest ${q?.id} declares no stat or skill reward` })
    })
    return out
}

/** one quest at a time; every done / fail tag is for the active quest and is applied (and only then); a closed quest has its tag */
export function trackedProblems(runs) {
    const out = []
    runs.forEach((run, r) => {
        let prev = null, prevHist = 0
        const closed = new Set()
        ;(run.turns ?? []).forEach((t, i) => {
            const at = `run ${r + 1} turn ${i + 1}`
            const cur = activeOf(t), hist = histOf(t), tags = tagsOf(t)
            const added = hist.slice(prevHist)
            for (const e of added) {
                if (closed.has(e.id)) out.push({ rule: 'dup', text: `${at}: quest ${e.id} closed twice` })
                closed.add(e.id)
                if (e.id !== prev?.id && e.id !== cur?.id) out.push({ rule: 'closed-unknown', text: `${at}: quest ${e.id} closed but it was never the active one` })
                if (!tags.some((g) => g.id === e.id && g.state === e.state)) out.push({ rule: 'closed-without-tag', text: `${at}: quest ${e.id} ${e.state} with no [[QUEST|${e.state}|${e.id}]] in the reply` })
            }
            for (const g of tags) {
                if (g.id !== prev?.id && g.id !== cur?.id) out.push({ rule: 'tag-unknown', text: `${at}: [[QUEST|${g.state}|${g.id}]] for a quest that is not active` })
                else if (!added.some((e) => e.id === g.id && e.state === g.state)) out.push({ rule: 'tag-ignored', text: `${at}: [[QUEST|${g.state}|${g.id}]] was written but the store did not close it` })
            }
            if (cur && prev && cur.id !== prev.id && !added.some((e) => e.id === prev.id)) out.push({ rule: 'two-active', text: `${at}: quest ${cur.id} offered while ${prev.id} is still active` })
            prev = cur
            prevHist = hist.length
        })
    })
    return out
}

const tickSum = (t, f) => parseTicks(t.ticks !== undefined ? t.ticks : t.panel).filter(f).reduce((a, x) => a + x.delta, 0)
/** a quest that is done adds its reward to the STORE (stat or skill mastery, capped as the growth rules cap it); a failed one adds nothing; >= 1 done in the whole gate */
export function rewardedProblems(runs) {
    const out = []
    let done = 0
    runs.forEach((run, r) => {
        const s0 = Object.fromEntries(STAT_KEYS.map((k) => [k, Number(json(run.start?.stats, {})[k]) || 1000]))
        let before = { stats: s0, skills: json(run.start?.skills, {}) }
        let prevHist = 0
        ;(run.turns ?? []).forEach((t, i) => {
            const at = `run ${r + 1} turn ${i + 1}`
            const st = stateOf(t)
            const after = { stats: st.stats ?? before.stats, skills: st.skills ?? before.skills }
            const hist = histOf(t)
            for (const e of hist.slice(prevHist)) {
                const rw = e.reward
                const cap = (t.brk ? HARD_CAP : SOFT_CAPS[st.rank - 1]) * 100
                const net = { stats: {}, skills: {} }
                for (const k of STAT_KEYS) net.stats[k] = (Number(after.stats[k]) || 0) - (Number(before.stats[k]) || 0) - tickSum(t, (x) => x.kind === 'stat' && x.key === k)
                for (const id of new Set([...Object.keys(after.skills), ...Object.keys(before.skills)])) {
                    const name = String(after.skills[id]?.name ?? before.skills[id]?.name ?? id)
                    net.skills[id] = (Number(after.skills[id]?.m) || 0) - (Number(before.skills[id]?.m) || 0) - tickSum(t, (x) => x.kind === 'skill' && x.name === name)
                }
                let want = { stats: {}, skills: {} }
                if (e.state === 'done') {
                    done++
                    if (!rw) { out.push({ rule: 'no-reward-record', text: `${at}: quest ${e.id} done with no reward in the history` }); continue }
                    if (rw.kind === 'stat' && STAT_KEYS.includes(rw.key)) want.stats[rw.key] = Math.max(0, Math.min(Number(rw.amount), cap - (Number(before.stats[rw.key]) || 0)))
                    else if (rw.kind === 'skill' && rw.id) {
                        const link = after.skills[rw.id]?.link ?? before.skills[rw.id]?.link
                        const room = Array.isArray(link) && link.length ? Math.max(...link.map((k) => Number(after.stats[k]) || 0)) + LINK_MARGIN * 100 : Infinity
                        want.skills[rw.id] = Math.max(0, Math.min(Number(rw.amount), room - (Number(before.skills[rw.id]?.m) || 0)))
                    } else out.push({ rule: 'bad-reward', text: `${at}: quest ${e.id} reward ${JSON.stringify(rw)}` })
                }
                for (const k of STAT_KEYS) if ((net.stats[k] || 0) !== (want.stats[k] || 0)) out.push({ rule: e.state === 'done' ? 'reward-mismatch' : 'reward-on-fail', text: `${at}: quest ${e.id} ${e.state}: stat ${k} moved ${net.stats[k]} beyond its ticks, the store should show ${want.stats[k] || 0}` })
                for (const id of Object.keys(net.skills)) if ((net.skills[id] || 0) !== (want.skills[id] || 0)) out.push({ rule: e.state === 'done' ? 'reward-mismatch' : 'reward-on-fail', text: `${at}: quest ${e.id} ${e.state}: skill ${id} moved ${net.skills[id]} beyond its ticks, the store should show ${want.skills[id] || 0}` })
            }
            before = after
            prevHist = hist.length
        })
    })
    if (!done) out.push({ rule: 'no-completion', text: `no quest was completed in ${runs.length} runs, so no reward could be checked against the store` })
    return out
}

/** no [[QUEST…]] tag, whole or half-streamed, in the text the player saw or in the stored reply */
export function hiddenProblems(runs) {
    const out = []
    runs.forEach((run, r) => (run.turns ?? []).forEach((t, i) => {
        for (const [where, text] of [['shown', t.shown], ['stored', t.reply]]) {
            const m = LEFT.exec(String(text ?? ''))
            if (m) out.push({ rule: `quest-visible-${where}`, text: `run ${r + 1} turn ${i + 1}: «${clip(text, m.index)}»` })
        }
    }))
    return out
}

export function questChecks(runs) {
    const n = runs.length
    const total = runs.reduce((s, r) => s + (r.turns?.length ?? 0), 0)
    const mk = (id, title, probs) => ({ id, title, status: n && !probs.length ? 'PASS' : 'FAIL', summary: probs.length ? `${probs.length} problem(s) over ${n} runs / ${total} turns` : `${n} runs, ${total} turns`, evidence: probs.map((p) => `${p.rule}: ${p.text}`) })
    return [
        mk('quest.offered', `A quest is offered (visible 【…NHIỆM VỤ…】 line, a stat or skill reward declared) within ${OFFER_WITHIN} turns in each of ${n} runs`, offeredProblems(runs)),
        mk('quest.tracked', 'One quest active at a time; every [[QUEST|done|fail|id]] is for the active quest and the store closes it', trackedProblems(runs)),
        mk('quest.rewarded', 'A done quest adds exactly its reward to $stats / $skills (capped as growth is), a failed one adds nothing; at least one quest is completed', rewardedProblems(runs)),
        mk('quest.hidden', 'No [[QUEST…]] tag in the shown or the stored reply', hiddenProblems(runs)),
    ]
}
