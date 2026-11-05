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

// How many +0.01 gains the narrator's own [[ACT|id|stat+stat|difficulty|skill]] tags of a turn can add (one per stat, one for the skill): the most an action
// may move the store besides the quest reward, so that "the reward moved the store by what the script declared" can be held to an exact amount.
const ACT_TAG = /\[\[\s*ACT\s*\|[^|\]]*\|([^|\]]*)\|[^|\]]*(?:\|([^|\]]*))?\]\]/gi
function actMax(t) {
    const stats = {}, skills = {}
    for (const m of String(t.raw ?? t.reply ?? '').matchAll(ACT_TAG)) {
        for (const k of String(m[1]).split('+').map((x) => x.trim()).filter(Boolean)) stats[k] = (stats[k] || 0) + 1
        const sk = String(m[2] ?? '').trim()
        if (sk) skills[sk] = (skills[sk] || 0) + 1
    }
    return { stats, skills }
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
                // The reward goes through stats.apply, so the panel shows it as tick lines and the store beyond the turn's ticks (`net`) is 0. The script's own record
                // of what it paid, $quest_last.delta.gains ("s:<stat>" / "k:<skill id>", before/after in hundredths), says how much; with that record the paid amount is
                // read from it and the store must have moved only by ticks (nothing untracked). Without the record (older runs, fixtures) the store beyond the ticks is read.
                const ql = json(t.qlast, null)
                const gains = ql && String(ql.id) === String(e.id) && ql.delta && Array.isArray(ql.delta.gains) ? ql.delta.gains : null
                const paid = { stats: {}, skills: {} }
                for (const g of gains ?? []) {
                    const kind = String(g.key).slice(0, 1), key = String(g.key).slice(2), d = (Number(g.after) || 0) - (Number(g.before) || 0)
                    if (kind === 's') paid.stats[key] = (paid.stats[key] || 0) + d
                    else if (kind === 'k') paid.skills[key] = (paid.skills[key] || 0) + d
                }
                const rule = e.state === 'done' ? 'reward-mismatch' : 'reward-on-fail'
                for (const k of STAT_KEYS) {
                    const got = gains ? (paid.stats[k] || 0) : (net.stats[k] || 0)
                    if (got !== (want.stats[k] || 0)) out.push({ rule, text: `${at}: quest ${e.id} ${e.state}: stat ${k} moved ${got}${gains ? ' by the quest' : ' beyond its ticks'}, the store should show ${want.stats[k] || 0}` })
                    if (gains && (net.stats[k] || 0) !== 0) out.push({ rule: 'untracked-move', text: `${at}: quest ${e.id} ${e.state}: stat ${k} moved ${net.stats[k]} that no tick line shows` })
                    // $quest_last.delta.gains is the script's own claim; the STORE must have moved by exactly that (plus at most the turn's own ACT ticks): a claim the store does not
                    // show (paid on paper only) or a store that moved more than the claim (paid another amount) is red. The tick lines already agree with the store here (net 0).
                    if (gains && (net.stats[k] || 0) === 0) {
                        const moved = (Number(after.stats[k]) || 0) - (Number(before.stats[k]) || 0), declared = paid.stats[k] || 0, room = actMax(t).stats[k] || 0
                        if (moved < declared || moved > declared + room) out.push({ rule: 'store-vs-gains', text: `${at}: quest ${e.id} ${e.state}: the script declares stat ${k} +${declared} but the store moved ${moved}${room ? ` (${room} ACT tick(s) possible)` : ''}` })
                    }
                }
                for (const id of Object.keys(net.skills)) {
                    // a stat reward may also tick the equipped skill (reward.skill): that is a bonus, only a skill reward is held to an amount
                    const held = !gains || rw?.kind === 'skill'
                    const got = gains ? (paid.skills[id] || 0) : (net.skills[id] || 0)
                    if (held && got !== (want.skills[id] || 0)) out.push({ rule, text: `${at}: quest ${e.id} ${e.state}: skill ${id} moved ${got}${gains ? ' by the quest' : ' beyond its ticks'}, the store should show ${want.skills[id] || 0}` })
                    if (gains && (net.skills[id] || 0) !== 0) out.push({ rule: 'untracked-move', text: `${at}: quest ${e.id} ${e.state}: skill ${id} moved ${net.skills[id]} that no tick line shows` })
                }
                for (const id of Object.keys(paid.skills)) {
                    if ((net.skills[id] || 0) !== 0) continue
                    const moved = (Number(after.skills[id]?.m) || 0) - (Number(before.skills[id]?.m) || 0), declared = paid.skills[id] || 0, room = actMax(t).skills[id] || 0
                    if (moved < declared || moved > declared + room) out.push({ rule: 'store-vs-gains', text: `${at}: quest ${e.id} ${e.state}: the script declares skill ${id} +${declared} but the store moved ${moved}${room ? ` (${room} ACT tick(s) possible)` : ''}` })
                }
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

// ---- quest.goal (owner 2026-11-05 "nhiệm vụ admin phải có goal mục tiêu rõ ràng"; L1: the reward grows with the difficulty, Admin states it with numbers) ----
// NOT in questChecks and not in any gate until L1 approves it. Every offered quest: a concrete goal (a verb, an object, a place, not vague) in the
// 【…Nhiệm vụ…】 offer line, a countable condition ($quest.need, shown as "Xong khi: đủ N" or "Tiến độ p/N"), its progress shown while open, a reward
// with its number ("+N <stat or skill>" in the offer line or the panel row) equal to what the store declares, a reward that does not shrink as the tier
// grows, and the deadline shown when it has one. Numbers in Admin's words are allowed in the quest line only: a 【ADMIN: …】 line that is not a quest
// line carries no digit, and a quest line still carries no percent, no mức nhiễm and no KHÁCH-n code (those stay system text).
export const TIERS = { de: 1, vua: 2, kho: 3, rat_kho: 4 }
const GOAL_VERB = /^(tìm|kiếm|nhặt|lấy|đi tới|đi đến|lên|xuống|đưa|dẫn|gia cố|làm|tự chế|sửa|thăm dò|bắt|lách qua|mang|chặn|dọn)(?!\p{L})/iu
const GOAL_PLACE = /(?<!\p{L})(trong|ở|tới|tại|qua|khỏi|về|vào|ra|lên|xuống|từ|đến|trên|dọc)(?!\p{L})/iu
const VAGUE = /(?<!\p{L})(sống sót|khám phá xung quanh|khám phá khu vực|tồn tại|cẩn thận|tìm hiểu|mạnh lên|làm gì đó|tuỳ ý|tùy ý)(?!\p{L})/iu
const QUEST_LINE = /^[\s*_>]*【\s*(?:ADMIN|HỆ THỐNG)\s*:\s*NHIỆM VỤ(?!\p{L})[^】\n]*】?/imu
const ADMIN_LINE = /^[\s*_>]*【\s*ADMIN\s*:([^】\n]*)】?/imu
const SYSTEM_TEXT = /\d+(?:[.,]\d+)?\s?%|mức\s+nhiễm|KHÁCH-\d+/iu
const sees = (t) => [t.shown, t.panel].filter((x) => typeof x === 'string' && x).join('\n')
/** the goal of an offer line: after "Nhiệm vụ —" and an optional "<title>:", up to "Xong khi" / "Thưởng" / "Hạn" / the end */
export function offerGoal(line) {
    let s = String(line).replace(/^[\s*_>]*【\s*(?:ADMIN|HỆ THỐNG)\s*:\s*NHIỆM VỤ\s*[—–:-]?\s*/iu, '').replace(/】.*$/u, '')
    s = s.split(/\s(?:Xong khi|Thưởng|Hạn)\s*:/u)[0].trim()
    const m = /^[^:.]{1,40}:\s+(.+)$/u.exec(s)
    return (m ? m[1] : s).trim()
}
export const vagueGoal = (goal) => {
    const g = String(goal ?? '').trim()
    if (g.split(/\s+/).filter(Boolean).length < 5) return 'too short'
    if (!GOAL_VERB.test(g)) return 'no concrete verb'
    if (!GOAL_PLACE.test(g)) return 'no place'
    if (VAGUE.test(g)) return 'vague'
    return ''
}
const labelOf = (key) => ({ suc_manh: 'Sức mạnh', nhanh_nhen: 'Nhanh nhẹn', the_luc: 'Thể lực', tinh_than: 'Tinh thần', cam_nhan: 'Cảm nhận', y_chi: 'Ý chí' })[key] ?? key
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function goalProblems(runs) {
    const out = []
    const offered = []
    runs.forEach((run, r) => {
        const turns = run.turns ?? []
        const seen = new Set()
        turns.forEach((t, i) => {
            const at = `run ${r + 1} turn ${i + 1}`
            for (const x of new Set([t.shown, t.reply])) {
                for (const m of String(x ?? '').matchAll(new RegExp(ADMIN_LINE.source, 'gimu'))) {
                    const line = m[0]
                    if (QUEST_LINE.test(line)) { if (SYSTEM_TEXT.test(line)) out.push({ rule: 'quest-line-system-text', text: `${at}: «${clip(line, 0, 120)}»` }) }
                    else if (/\d/.test(m[1])) out.push({ rule: 'number-in-admin-line', text: `${at}: «${clip(line, 0, 120)}»` })
                }
            }
            const q = activeOf(t)
            if (!q || seen.has(q.id)) return
            seen.add(q.id)
            const window = turns.slice(i, i + 2).map(sees).join('\n')
            const line = (window.match(QUEST_LINE) || [''])[0]
            const where = `${at}: quest ${q.id}`
            const why = vagueGoal(line ? offerGoal(line) : q.goal)
            if (why) out.push({ rule: 'goal-vague', text: `${where}: goal «${clip(line ? offerGoal(line) : q.goal ?? '', 0, 90)}» (${why})` })
            const need = Number(q.need)
            if (!(Number.isInteger(need) && need >= 1)) out.push({ rule: 'goal-no-condition', text: `${where}: no countable condition ($quest.need ${JSON.stringify(q.need)})` })
            else if (!new RegExp(`(?:Xong khi:\\s*đủ\\s*${need}(?!\\d)|Tiến độ\\s*\\d+\\s*/\\s*${need}(?!\\d))`, 'u').test(window)) out.push({ rule: 'goal-no-condition', text: `${where}: the condition (${need}) is shown neither in the offer line nor in the panel` })
            const open = []
            for (let j = i; j < turns.length && activeOf(turns[j])?.id === q.id; j++) open.push(turns[j])
            if (!open.some((u) => /Tiến độ\s*\d+\s*\/\s*\d+/u.test(sees(u)))) out.push({ rule: 'goal-no-progress', text: `${where}: no "Tiến độ p/N" while it is open` })
            const rw = q.reward ?? {}
            const amount = Number(rw.amount)
            const name = rw.kind === 'skill' ? (rw.name ?? rw.id) : labelOf(rw.key)
            const stated = new RegExp(`Thưởng\\s*:?\\s*[^】\\n]*?\\+\\s*(\\d+)\\s+${esc(name)}`, 'iu').exec(window)
            if (!stated) out.push({ rule: 'goal-no-reward', text: `${where}: no reward with its number ("Thưởng: +N ${name}") in the offer line or the panel` })
            else if (!(amount > 0) || Number(stated[1]) !== amount) out.push({ rule: 'reward-not-promised', text: `${where}: Admin promises +${stated[1]} ${name}, the store declares ${JSON.stringify(rw.amount)}` })
            if (!(q.tier in TIERS)) out.push({ rule: 'goal-no-tier', text: `${where}: no difficulty tier (${JSON.stringify(q.tier)})` })
            else offered.push({ where, rank: TIERS[q.tier], amount: amount + (Number(rw.skill_amount) || 0), tier: q.tier })
            const dl = Number(q.deadline_turns)
            if (Number.isInteger(dl) && dl > 0 && !/(?<!\p{L})Hạn(?!\p{L})/u.test(window)) out.push({ rule: 'goal-no-deadline', text: `${where}: a ${dl}-turn deadline that is not shown` })
        })
    })
    for (const a of offered) for (const b of offered) if (a.rank > b.rank && a.amount < b.amount) out.push({ rule: 'reward-not-proportional', text: `${a.where} (${a.tier}) pays ${a.amount}, less than ${b.where} (${b.tier}) pays ${b.amount}` })
    return out
}

export function questGoalChecks(runs) {
    const n = runs.length
    const probs = goalProblems(runs)
    const total = runs.reduce((s, r) => s + (r.turns?.length ?? 0), 0)
    return [{ id: 'quest.goal', title: 'Every offered quest has a concrete goal, a countable condition, its progress, a reward with its number that grows with the difficulty, and its deadline; numbers in Admin lines only in quest lines', status: n && !probs.length ? 'PASS' : 'FAIL', summary: probs.length ? `${probs.length} problem(s) over ${n} runs / ${total} turns` : `${n} runs, ${total} turns`, evidence: probs.map((p) => `${p.rule}: ${p.text}`) }]
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
