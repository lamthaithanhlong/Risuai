// Scoring of one played story. Pure functions over the run record (run.mjs writes it as <story>.json), so a scorecard can be
// recomputed from a saved record (`run.mjs --rescore <dir>`) and every check is tested on fixtures (score.check.mjs).
//
// A check is { id, title, status: PASS | FAIL | N/A | INFO, summary, evidence: ["t12: «quote»", ...] }.
// Turn labels: s1.. = the step-by-step creation run, t1.. = the surprise run (creation replies first, then the ~20 story turns).

const VI_WORDS = new Set('và của là không một những người có đã trong được này cho với anh cô tôi bạn ngươi lại ra vào như thì mà đến nó gì sẽ đang cũng còn khi từ trên dưới hắn họ ta mình chỉ rồi đó nào'.split(' '))
const EN_WORDS = new Set('the and of to was is you your that with his her it in for on as at be are were this from have had not but they'.split(' '))
const FORBIDDEN = /\b(HP|XP|EXP|MP)\b|\blevel(?:\s*up)?\b|\blevels\b|lên cấp|thăng cấp|điểm kinh nghiệm|thanh máu|\bcấp độ\s*\d/i
const HIDDEN = /\[\[\s*(STATUS|LEDGER|GM)\b|\[\[[A-Z_]{2,}\s*\n/
const MENU_LINE = /^\s*(?:\d{1,2}[.)]|[a-dA-D][.)])\s+\S/
const SUGGEST_LINE = /^\s*(?:\d{1,2}[.)]|[-*•])\s+\S/
const RECORD_LINE = /^\s*(?:[-*•]\s*)?(?:\*\*)?[\p{L}\p{N} ()/&,.-]{2,40}?(?:\*\*)?\s*[:：]\s*(?:\*\*)?\s*\S/u
const WORLD_PICKS = /thế giới chọn|để thế giới|ngẫu nhiên|bốc ngẫu nhiên/i

export const oneLine = (s, n = 140) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t }
export const quote = (label, s, n = 140) => `${label}: «${oneLine(s, n)}»`

export function viShare(text) {
    const words = String(text ?? '').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)
    let vi = 0, en = 0
    for (const w of words) { if (VI_WORDS.has(w)) vi++; else if (EN_WORDS.has(w)) en++ }
    return { vi, en, isVi: vi >= 3 && vi >= 3 * en }
}

const PLAN_MARK = /(^|\n)\s*(?:\*\*)?(plan|planning|note|notes|ooc|beat|arc|threat|dice|referee|gm|status|ledger|path|reward|consequence|canon|next)(?:\*\*)?\s*:/i
const PLAN_WORDS = /\[GM\b|\bthe player\b|\bthe narrator\b|\bthis reply\b|\bI will\b|\bI'll\b|\(OOC|\bwordcount\b|\bhidden block\b/i
/** what of the narrator's planning or untranslated English reached the player: [{kind, text}] */
export function shownLeaks(text) {
    const out = []
    const t = String(text ?? '')
    const m = PLAN_MARK.exec(t); if (m) out.push({ kind: 'planning', text: t.slice(m.index, m.index + 120) })
    const w = PLAN_WORDS.exec(t); if (w) out.push({ kind: 'planning', text: t.slice(Math.max(0, w.index - 40), w.index + 80) })
    for (const para of t.split(/\n\s*\n|\n/)) {
        const v = viShare(para)
        if (v.en >= 5 && v.en > v.vi) { out.push({ kind: 'english', text: para }); break }
    }
    return out
}
export const forbiddenTerms = (text) => { const m = FORBIDDEN.exec(String(text ?? '')); return m ? m[0] : '' }
export const hiddenLeak = (text) => { const m = HIDDEN.exec(String(text ?? '')); return m ? m[0].trim() : '' }
export const menuLines = (text) => String(text ?? '').split('\n').filter((l) => MENU_LINE.test(l))
export const suggestionLines = (text) => String(text ?? '').split('\n').filter((l) => SUGGEST_LINE.test(l))
export const questionLines = (text) => String(text ?? '').replace(/[*_`>]/g, '').split(/(?<=[.!?？。])\s+|\n+/).map((l) => l.trim()).filter((l) => /[?？]["”»]?$/.test(l))
/** the suggestions a creation question offers: list lines, or the bold choices in the paragraph that asks (not the "world picks" one) */
export function suggestionCount(text) {
    const t = String(text ?? '')
    const list = suggestionLines(t).filter((l) => !WORLD_PICKS.test(l)).length
    const asking = t.split(/\n\s*\n/).filter((p) => /[?？]/.test(p) || /gợi ý|chọn/i.test(p))
    const bold = asking.flatMap((p) => [...p.matchAll(/\*\*([^*\n]{2,160})\*\*/g)].map((m) => m[1])).filter((b) => !WORLD_PICKS.test(b) && !/[?？]/.test(b))
    // "Bạn có thể chọn nam, 25 tuổi; nữ, 34 tuổi; nam, 61 tuổi." — choices separated by semicolons after "chọn"
    const semi = Math.max(0, ...asking.map((p) => { const m = /(?:chọn|gợi ý)[^:;]*?:?\s*([^\n]*;[^\n]*)/i.exec(p.replace(/\*\*/g, '')); return m ? m[1].split(';').filter((x) => x.trim() && !WORLD_PICKS.test(x)).length : 0 }))
    return Math.max(list, bold.length, semi)
}
export const recordLines = (text) => String(text ?? '').split('\n').filter((l) => RECORD_LINE.test(l) && !/[?？]\s*$/.test(l))
export const bracketLines = (text) => [...String(text ?? '').matchAll(/\[[^\]\n]{3,240}\]/g)].map((m) => m[0])
export const asksDuocChua = (text) => /được chưa/i.test(String(text ?? ''))
export const asksLook = (text) => /ngoại hình/i.test(text ?? '') && /persona|giữ|bốc|khác/i.test(text ?? '')
const isSet = (v) => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== 'null'
export const stKeys = (vars) => Object.entries(vars ?? {}).filter(([k, v]) => /^st_/.test(k) && isSet(v)).map(([k]) => k)
export const gmKeys = (vars) => Object.entries(vars ?? {}).filter(([k, v]) => /^gm_(arc|beat|threats|rewards_due|consequences_due|canon)$/.test(k) && isSet(v)).map(([k]) => k)

/** keys whose value changed between two variable snapshots */
export function changed(prefix, before, after) {
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})].filter((k) => k.startsWith(prefix)))
    return [...keys].filter((k) => String(before?.[k] ?? '') !== String(after?.[k] ?? '') && (isSet(after?.[k]) || isSet(before?.[k])))
}

const check = (id, title, status, summary, evidence = []) => ({ id, title, status, summary, evidence: evidence.filter(Boolean).slice(0, 12) })
const pass = (ok) => (ok ? 'PASS' : 'FAIL')

/** the score of one story; `judge` holds the model judge's answers (judge.mjs), or {} when it was not run */
export function scoreStory(rec, judge = {}) {
    const out = []
    const steps = rec.steps?.turns ?? []
    const play = rec.play?.turns ?? []
    const creation = play.filter((t) => t.phase === 'creation')
    const story = play.filter((t) => t.phase === 'story' && t.ok)
    const yes = play.find((t) => t.phase === 'yes')

    // ---- creation flow --------------------------------------------------------------------------------------------------------
    const s1 = steps[0], t1 = creation[0]
    const diffOk = [s1, t1].filter(Boolean).map((t) => /\bhard\b|độ khó|khó/i.test(t.reply))
    out.push(check('creation.difficulty', 'Difficulty is read and recorded from the answer', diffOk.length ? pass(diffOk.every(Boolean)) : 'N/A',
        diffOk.length ? `${diffOk.filter(Boolean).length}/${diffOk.length} first replies name the difficulty` : 'no creation reply',
        [s1 && quote(s1.label, s1.reply), t1 && quote(t1.label, t1.reply)]))

    const stepQ = steps.filter((t) => t.ok && !asksDuocChua(t.reply))
    // a card item with two values only (LotM "way in": born here or transmigrator) offers two
    const binary = rec.binaryItem ? new RegExp(rec.binaryItem, 'i') : null
    const need = (t) => (binary && binary.test(t.reply) ? 2 : 3)
    const stepBad = stepQ.filter((t) => questionLines(t.reply).length < 1 || questionLines(t.reply).length > 2 || suggestionCount(t.reply) < need(t) || !WORLD_PICKS.test(t.reply))
    out.push(check('creation.step_by_step', 'Step by step: one item per reply, three suggestions + "để thế giới chọn"', stepQ.length ? pass(!stepBad.length) : 'N/A',
        stepQ.length ? `${stepQ.length - stepBad.length}/${stepQ.length} question replies have the shape` : 'the step-by-step run did not get a question reply',
        [...stepBad.map((t) => `${t.label}: ${questionLines(t.reply).length} question line(s), ${suggestionCount(t.reply)} suggestion(s), world-picks ${WORLD_PICKS.test(t.reply) ? 'yes' : 'no'} — ${quote('', t.reply, 120).slice(2)}`),
            ...stepQ.slice(0, 3).filter((t) => !stepBad.includes(t)).map((t) => quote(t.label, questionLines(t.reply)[0] ?? t.reply, 120))]))

    const recReply = creation.find((t) => recordLines(t.reply).length >= 5 || asksDuocChua(t.reply))
    out.push(check('creation.record', 'Quick sketch ("Surprise me") shows the whole character as a compact record', recReply ? pass(recordLines(recReply.reply).length >= 5) : 'FAIL',
        recReply ? `${recordLines(recReply.reply).length} record lines in ${recReply.label}` : 'no record reply before the yes',
        recReply ? recordLines(recReply.reply).slice(0, 6).map((l) => quote(recReply.label, l, 90)) : creation.map((t) => quote(t.label, t.reply))))

    const duoc = creation.filter((t) => asksDuocChua(t.reply))
    out.push(check('creation.duoc_chua', 'The record ends with "Được chưa?"', pass(duoc.length > 0), duoc.length ? `asked in ${duoc.map((t) => t.label).join(', ')}` : 'never asked',
        duoc.map((t) => quote(t.label, t.reply.slice(t.reply.search(/được chưa/i) - 40), 120))))

    const look = creation.find((t) => asksLook(t.reply))
    out.push(check('creation.look_question', 'Rolled look: asked whether to keep the persona look', t1 ? pass(!!look) : 'N/A',
        look ? `asked in ${look.label}` : 'the look was rolled ("Surprise me") but no look question',
        [look && quote(look.label, look.reply.slice(Math.max(0, look.reply.search(/ngoại hình/i) - 20)), 160)]))

    const before = [...steps, ...creation].filter((t) => t.ok)
    const early = before.filter((t) => stKeys(t.vars).length || gmKeys(t.vars).length || t.panel || t.reply.length > 2500)
    out.push(check('creation.no_story_before_yes', 'No story, panel or GM before the player says yes', before.length ? pass(!early.length) : 'N/A',
        early.length ? `${early.length}/${before.length} pre-yes replies already ran the story` : `${before.length} pre-yes replies: no st_*/gm_* set, no panel, short`,
        early.map((t) => `${t.label}: st=[${stKeys(t.vars).join(',')}] gm=[${gmKeys(t.vars).join(',')}] panel=${t.panel ? 'yes' : 'no'} len=${t.reply.length} — ${oneLine(t.reply, 90)}`)))

    out.push(check('creation.starts_after_yes', 'The yes starts the story: prose, the first panel', yes ? pass(yes.ok && yes.reply.length > 600 && stKeys(yes.vars).length >= 2) : 'FAIL',
        yes ? `${yes.label}: ${yes.reply.length} chars, st_* set: ${stKeys(yes.vars).join(', ') || 'none'}` : 'the run never reached the yes',
        [yes && quote(yes.label, yes.reply, 200)]))

    // ---- status panel ---------------------------------------------------------------------------------------------------------
    const after = [yes, ...story].filter((t) => t?.ok)
    const withPanel = after.filter((t) => t.panel)
    out.push(check('panel.present', 'Status panel shows under the latest reply', after.length ? pass(withPanel.length >= Math.ceil(after.length * 0.9)) : 'N/A',
        `${withPanel.length}/${after.length} story replies show the panel`,
        [withPanel.at(-1) && quote(withPanel.at(-1).label, withPanel.at(-1).panel.summary, 120), ...after.filter((t) => !t.panel).slice(0, 4).map((t) => `${t.label}: no panel`)]))

    const changes = []
    for (let i = 1; i < after.length; i++) { const c = changed('st_', after[i - 1].vars, after[i].vars); if (c.length) changes.push({ t: after[i], c }) }
    const dateMoved = changes.some((x) => x.c.some((k) => k === 'st_date' || k === 'st_place'))
    out.push(check('panel.updated', 'Panel values (st_*) change with the story', after.length > 1 ? pass(changes.length >= 3 && dateMoved) : 'N/A',
        `${changes.length}/${Math.max(0, after.length - 1)} turns changed st_*; date/place moved: ${dateMoved ? 'yes' : 'no'}; keys at the end: ${stKeys(after.at(-1)?.vars).length}`,
        changes.slice(0, 8).map((x) => `${x.t.label}: ${x.c.map((k) => `${k}=${oneLine(x.t.vars[k], 40)}`).join('; ')}`)))

    const leaks = [...steps, ...play].filter((t) => t.ok && (hiddenLeak(t.shown) || hiddenLeak(t.reply)))
    out.push(check('panel.hidden_blocks', 'Hidden blocks ([[STATUS]], [[LEDGER]], [[GM]]) never reach the player', pass(!leaks.length),
        leaks.length ? `${leaks.length} replies show a hidden block` : 'no block in any shown reply or stored message',
        leaks.map((t) => `${t.label}: ${hiddenLeak(t.shown) ? 'shown' : 'stored'} «${hiddenLeak(t.shown) || hiddenLeak(t.reply)}»`)))

    const rawBlocks = after.filter((t) => t.raw != null)
    if (rawBlocks.length) {
        const emitted = rawBlocks.filter((t) => /\[\[STATUS/.test(t.raw)).length
        out.push(check('panel.model_blocks', 'The model writes [[STATUS]] blocks (raw response)', 'INFO', `${emitted}/${rawBlocks.length} raw story responses carry a STATUS block`, []))
    }

    // ---- language and voice ---------------------------------------------------------------------------------------------------
    const proseTurns = after.filter((t) => t.shown)
    const notVi = proseTurns.filter((t) => !viShare(t.shown).isVi)
    out.push(check('prose.vietnamese', 'Story prose is Vietnamese', proseTurns.length ? pass(notVi.length <= Math.floor(proseTurns.length * 0.1)) : 'N/A',
        `${proseTurns.length - notVi.length}/${proseTurns.length} replies read as Vietnamese`, notVi.map((t) => quote(t.label, t.shown))))

    const forb = proseTurns.map((t) => ({ t, w: forbiddenTerms(t.shown) })).filter((x) => x.w)
    const brackets = proseTurns.flatMap((t) => bracketLines(t.shown).map((b) => ({ t, b })))
    const unbr = rec.voice?.unbracketed ? proseTurns.filter((t) => t.shown.split('\n').some((l) => new RegExp(rec.voice.unbracketed, 'm').test(l) && !/^\s*\[/.test(l))) : []
    const voiceOk = !forb.length && !unbr.length
    out.push(check('voice.system', `System voice${rec.voice?.name ? ` (${rec.voice.name} in brackets)` : ''}; no HP/XP/level`, proseTurns.length ? pass(voiceOk) : 'N/A',
        `${forb.length} replies with game-stat words; ${brackets.length} bracket lines${rec.voice?.bracketLines ? '' : ' (this world has no system voice)'}; ${unbr.length} unbracketed system lines`,
        [...forb.map((x) => quote(x.t.label, `«${x.w}» in ${oneLine(x.t.shown.slice(Math.max(0, x.t.shown.indexOf(x.w) - 60)), 120)}`)), ...unbr.map((t) => `${t.label}: unbracketed system line`), ...brackets.slice(0, 5).map((x) => quote(x.t.label, x.b, 120))]))

    // ---- fate dice --------------------------------------------------------------------------------------------------------------
    const dice = story.map((t) => ({ t, main: (t.net ?? []).filter((n) => n.type === 'completion' && n.kind === 'main').at(-1) })).filter((x) => x.main?.event != null)
    const pauses = story.filter((t) => t.kind === 'pause')
    const menus = after.filter((t) => menuLines(t.reply).length >= 3)
    const pj = judge.pauses ?? {}
    const judged = pauses.filter((t) => pj[t.label])
    const agree = judged.filter((t) => { const m = (t.net ?? []).filter((n) => n.kind === 'main').at(-1); return m && m.eventNew != null && !!pj[t.label].newThing === !!m.eventNew })
    const rolledNew = dice.filter((x) => x.main.eventNew).length
    const twoInRow = judged.some((t, i) => i > 0 && pj[t.label].newThing && pj[judged[i - 1].label]?.newThing && story.indexOf(t) === story.indexOf(judged[i - 1]) + 1)
    out.push(check('dice.events', 'Fate dice: events surface at pauses (~20%), as hooks in prose, never menus', !dice.length && !pauses.length ? 'N/A' : pass(!menus.length && (!judged.length || agree.length >= Math.ceil(judged.length * 0.6)) && !twoInRow),
        `die read in ${dice.length} requests, NEW rolled ${rolledNew}/${dice.length} (${dice.length ? Math.round(100 * rolledNew / dice.length) : 0}%); pauses judged ${judged.length}, prose agrees with the die ${agree.length}/${judged.length}; menus ${menus.length}`,
        [...pauses.map((t) => { const m = (t.net ?? []).filter((n) => n.kind === 'main').at(-1); const j = pj[t.label]; return `${t.label} (pause): die ${m?.event ?? '?'}${m?.eventNew ? ' → NEW' : ''}; judge: ${j ? (j.newThing ? 'new: ' + oneLine(j.what, 80) : 'nothing new') : 'n/a'}` }),
            ...menus.map((t) => `${t.label}: menu ${oneLine(menuLines(t.reply).join(' / '), 120)}`)]))

    // ---- Game Master ------------------------------------------------------------------------------------------------------------
    const gmReq = story.filter((t) => (t.net ?? []).some((n) => n.kind === 'main' && n.gmNote))
    const last = after.at(-1)
    const beats = []
    for (let i = 1; i < after.length; i++) if (String(after[i].vars?.gm_beat ?? '') !== String(after[i - 1].vars?.gm_beat ?? '') && isSet(after[i].vars?.gm_beat)) beats.push(after[i])
    const arcAt = after.find((t) => isSet(t.vars?.gm_arc))
    const gmLanded = gmReq.length > 0 || after.some((t) => gmKeys(t.vars).length)
    out.push(check('gm.arc', 'Game Master: gm_* arc keys appear and advance', gmLanded ? pass(!!arcAt && beats.length >= 1) : 'N/A',
        gmLanded ? `GM note in ${gmReq.length}/${story.length} story requests; arc set at ${arcAt?.label ?? 'never'}; beat moved ${beats.length} times; keys at the end: ${gmKeys(last?.vars).join(', ') || 'none'}` : 'no GM note in any request and no gm_* key (feature not in this build)',
        [arcAt && quote(arcAt.label, `gm_arc = ${arcAt.vars.gm_arc}`, 160), ...beats.slice(0, 6).map((t) => quote(t.label, `gm_beat = ${t.vars.gm_beat}`, 140))]))

    // ---- Jev referee ------------------------------------------------------------------------------------------------------------
    const imp = story.find((t) => t.kind === 'impossible') ?? play.find((t) => t.kind === 'impossible')
    if (!imp) out.push(check('jev.referee', 'Jev referee: the impossible/dictated turn gets a note and does not happen as written', 'N/A', 'the impossible turn was not played'))
    else {
        const ref = (imp.net ?? []).filter((n) => n.type === 'referee').at(-1)
        const inReq = (imp.net ?? []).some((n) => n.kind === 'main' && n.referee)
        const j = judge.impossible
        const flagged = !!ref?.result?.note
        out.push(check('jev.referee', 'Jev referee: the impossible/dictated turn gets a note and does not happen as written', pass(flagged && inReq && (!j || !j.granted)),
            `referee ${ref ? (ref.result ? `feasible=${ref.result.feasible ?? '?'} dictates=${ref.result.dictates ?? '?'} note=${flagged ? 'yes' : 'no'}` : 'no answer') : 'not called'}; note in the model request: ${inReq ? 'yes' : 'no'}; judge: ${j ? (j.granted ? 'the outcome was granted' : 'not granted') : 'n/a'}`,
            [quote(`${imp.label} (player)`, imp.text, 160), quote(imp.label, imp.reply, 220), j && `judge: ${oneLine(j.why, 200)}`]))
    }

    // ---- Prolog -----------------------------------------------------------------------------------------------------------------
    const pc = rec.final?.check
    const viol = pc?.violations ?? []
    out.push(check('prolog.check', 'Prolog canon check (/api/story/:id/check) finds no violation', pc && pc.status === 'ok' ? pass(!viol.length) : 'FAIL',
        pc ? `status ${pc.status ?? pc.http}${pc.world ? `, world ${pc.world}` : ''}, ${viol.length} violation(s)${pc.reason ? `, ${pc.reason}` : ''}${pc.error ? `, ${oneLine(pc.error, 120)}` : ''}` : 'not run',
        [...viol.slice(0, 8).map((v) => `${v.rule}: ${oneLine(JSON.stringify(v.detail ?? {}), 160)}`), pc?.line && quote('prompt line', pc.line, 200)]))

    // ---- images -----------------------------------------------------------------------------------------------------------------
    const imgs = (rec.final?.dom ?? []).flatMap((d) => d.images.map((i) => ({ ...i, idx: d.idx })))
    const broken = imgs.filter((i) => !i.complete || !i.w)
    const imgReq = play.flatMap((t) => (t.net ?? []).filter((n) => n.type === 'image'))
    out.push(check('images.scene', 'A scene picture or portrait appears and loads', pass(imgs.length > 0 && !broken.length),
        `${imgs.length} picture(s) in the chat, ${broken.length} not loaded; ${imgReq.length} image request(s) seen`,
        [...imgs.slice(0, 4).map((i) => `message ${i.idx}: ${i.w}x${i.h} ${i.src}`), ...broken.slice(0, 4).map((i) => `message ${i.idx}: NOT LOADED ${i.src}`)]))

    // ---- canon ------------------------------------------------------------------------------------------------------------------
    const canon = judge.canon ?? []
    if (!canon.length) out.push(check('canon.judge', 'Canon fit of 5 sampled replies (model judge)', 'N/A', judge.error ? `judge failed: ${oneLine(judge.error, 160)}` : 'judge not run'))
    else {
        const fits = canon.map((c) => c.fit).filter((x) => typeof x === 'number')
        const mean = fits.length ? fits.reduce((a, b) => a + b, 0) / fits.length : 0
        const major = canon.flatMap((c) => (c.slips ?? []).filter((s) => s.severity === 'major').map((s) => ({ ...s, label: c.label })))
        out.push(check('canon.judge', 'Canon fit of 5 sampled replies (model judge)', pass(mean >= 2 && !major.length),
            `mean fit ${mean.toFixed(1)}/3 over ${fits.length}; ${major.length} major slip(s), ${canon.flatMap((c) => c.slips ?? []).length} slip(s) in all`,
            canon.flatMap((c) => [`${c.label}: fit ${c.fit}/3 — ${oneLine(c.summary, 140)}`, ...(c.slips ?? []).map((s) => `  ${c.label} [${s.severity}] ${oneLine(s.slip, 200)}`)])))
    }

    // ---- the side the player takes ---------------------------------------------------------------------------------------------
    const sideT = story.find((t) => t.kind === 'side')
    if (!sideT) out.push(check('gm.side', 'A side the player commits to is recorded (gm_path) and its events follow', 'N/A', 'no side turn played'))
    else {
        const i = story.indexOf(sideT)
        const win = story.slice(i, i + 3)
        const rec1 = win.find((t) => isSet(t.vars?.gm_path))
        const life = story.filter((t) => t.kind === 'side-life')
        const sj = judge.sideLife ?? {}
        const follows = life.filter((t) => sj[t.label]?.follows)
        const focus = story.slice(i + 1, i + 5).filter((t) => (t.net ?? []).some((n) => n.kind === 'main' && n.sideFocus))
        const matchRe = rec.side?.match ? new RegExp(rec.side.match, 'i') : null
        const named = rec1 && (!matchRe || matchRe.test(rec1.vars.gm_path))
        out.push(check('gm.side', 'A side the player commits to is recorded (gm_path) and its events follow', pass(!!rec1 && !!named && life.length > 0 && follows.length >= Math.ceil(life.length * 2 / 3)),
            `gm_path ${rec1 ? `set at ${rec1.label}${named ? '' : ' (does not name the side)'}` : 'not set within 2 replies'}; side focus in ${focus.length} following request(s); living turns that follow the side ${follows.length}/${life.length}${Object.keys(sj).length ? '' : ' (not judged)'}`,
            [quote(`${sideT.label} (player)`, sideT.text, 160), quote(sideT.label, sideT.shown || sideT.reply, 200), rec1 && quote(rec1.label, `gm_path = ${rec1.vars.gm_path}`, 160),
                ...life.map((t) => `${t.label}: ${sj[t.label] ? (sj[t.label].follows ? 'follows: ' : 'does NOT follow: ') + oneLine(sj[t.label].how, 150) : 'not judged'} — ${oneLine(t.shown || t.reply, 100)}`)]))
    }

    // ---- what reaches the player ------------------------------------------------------------------------------------------------
    const leaked = [...steps, ...play].filter((t) => t.ok).map((t) => ({ t, l: shownLeaks(t.shown) })).filter((x) => x.l.length)
    out.push(check('prose.no_leaks', 'No planning notes or English leak into what the player sees', pass(!leaked.length),
        leaked.length ? `${leaked.length} replies show planning or English` : 'no planning marker or English paragraph in any shown reply',
        leaked.flatMap((x) => x.l.map((l) => quote(`${x.t.label} ${l.kind}`, l.text, 160)))))

    const proseScores = canon.map((c) => c.prose).filter((x) => typeof x === 'number')
    if (proseScores.length) out.push(check('prose.quality', 'Prose quality of the sampled replies (model judge)', 'INFO',
        `mean ${(proseScores.reduce((a, b) => a + b, 0) / proseScores.length).toFixed(1)}/3 over ${proseScores.length}`,
        canon.filter((c) => c.proseNotes).map((c) => `${c.label}: ${c.prose}/3 — ${oneLine(c.proseNotes, 200)}`)))

    // ---- the run itself ---------------------------------------------------------------------------------------------------------
    const all = [...steps, ...play]
    const failed = all.filter((t) => !t.ok)
    const errs = all.flatMap((t) => (t.errors ?? []).map((e) => ({ t, e })))
    out.push(check('run.turns', 'Every turn got a reply (retries allowed)', pass(!failed.length && all.length > 0),
        `${all.length - failed.length}/${all.length} turns answered; ${errs.length} request error(s); median reply ${median(all.filter((t) => t.ok).map((t) => t.ms / 1000)).toFixed(0)} s`,
        [...failed.map((t) => `${t.label}: no reply${t.timeout ? ' (timeout)' : ''}`), ...errs.slice(0, 6).map((x) => `${x.t.label}: ${oneLine(x.e.error, 160)}`)]))
    const lat = all.filter((t) => t.ok && t.phase === 'story').map((t) => t.ms / 1000)
    if (lat.length) out.push(check('run.latency', 'Seconds from send to a settled reply (story turns)', 'INFO',
        `median ${median(lat).toFixed(0)} s, p90 ${pct(lat, 0.9).toFixed(0)} s, max ${Math.max(...lat).toFixed(0)} s over ${lat.length} turns; mean reply ${Math.round(after.reduce((a, t) => a + (t.shown || '').length, 0) / Math.max(1, after.length))} chars`, []))
    return out
}

function pct(xs, p) { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
function median(xs) { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

export function tally(checks) {
    const n = (s) => checks.filter((c) => c.status === s).length
    return { pass: n('PASS'), fail: n('FAIL'), na: n('N/A'), info: n('INFO') }
}
