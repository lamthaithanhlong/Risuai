// The scorer's own checks (node --test tests/acceptance/score.check.mjs). Each fixture is paired with its broken twin so a check
// that can never go red shows up here: a good record must pass, the same record with one thing broken must fail that one check.
import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreStory, suggestionCount, viShare, forbiddenTerms, hiddenLeak, menuLines, questionLines, recordLines, changed } from './lib/score.mjs'
import { readMainRequest, completionText } from './lib/play.mjs'

const VI = 'Gió thổi qua con hẻm. Anh đứng lại, nhìn những người đang chờ ở cổng và không nói gì. Cô ấy quay lại, hỏi anh là ai.'
const panel = { summary: '☾ Kenji · Aspirant', text: '' }
const vars0 = { st_name: 'Kenji', st_rank: 'Aspirant', st_date: 'Ngày 1', gm_arc: 'nợ | Varn | trả nợ | mất nhà', gm_beat: '1 | x | y' }
const turn = (label, kind, shown, vars, extra = {}) => ({ label, phase: 'story', kind, text: 'Tôi làm gì đó.', ok: true, ms: 30000, errors: [], reply: shown, shown, panel, images: [], vars, net: [{ type: 'completion', kind: 'main', event: '50', eventNew: false, gmNote: true }], ...extra })

function goodRecord() {
    const steps = [{ label: 's1', phase: 'creation', kind: 'creation', text: 'Hard. Từng bước.', ok: true, ms: 1, errors: [], reply: 'Đã ghi độ khó: **Hard**.\n\n1. Nam, 25 tuổi.\n2. Nữ, 32 tuổi.\n3. Nam, 47 tuổi.\n4. Để thế giới chọn.\n\n**Bạn chọn giới tính và tuổi nào?**', shown: 'Đã ghi độ khó: Hard.', panel: null, vars: {}, net: [] }]
    const record = 'Đã ghi độ khó: Hard.\n- Giới tính: Nam\n- Tuổi: 19\n- Tên: Minh\n- Ngoại hình: gầy\n- Nơi ở: ngoại ô\n- Nghề: thợ\n\nNgoại hình: giữ ngoại hình của persona hay dùng ngoại hình vừa bốc?\nĐược chưa? Sửa dòng nào cứ nói.'
    const play = [
        { label: 't1', phase: 'creation', kind: 'creation', text: 'Hard. Surprise me.', ok: true, ms: 1, errors: [], reply: record, shown: record, panel: null, vars: {}, net: [] },
        { label: 't2', phase: 'yes', kind: 'yes', text: 'Được', ok: true, ms: 1, errors: [], reply: VI.repeat(8), shown: VI.repeat(8), panel, vars: { ...vars0 }, net: [] },
    ]
    let v = { ...vars0 }
    for (let i = 0; i < 6; i++) {
        v = { ...v, st_date: `Ngày ${i + 2}`, gm_beat: `${i + 2} | a | b` }
        play.push(turn(`t${i + 3}`, i === 2 ? 'impossible' : i % 2 ? 'pause' : 'action', VI, v, i === 2 ? { net: [{ type: 'referee', result: { feasible: 0.2, dictates: 0.9, note: '\n\n[Referee: x]' } }, { type: 'completion', kind: 'main', event: '50', referee: 'x', gmNote: true }] } : {}))
    }
    v = { ...v, gm_path: 'nhóm của Nephis | mới vào | thử việc' }
    play.push(turn('t9', 'side', VI, { ...v, st_place: 'trại' }))
    for (const n of [10, 11, 12]) play.push(turn(`t${n}`, 'side-life', VI, { ...v, st_date: `Ngày ${n}` }))
    return { title: 'T', side: { match: 'Nephis' }, steps: { turns: steps }, play: { turns: play }, voice: { name: 'Spell', bracketLines: true, unbracketed: '^\\s*Ngươi đã giết' },
        final: { check: { status: 'ok', violations: [] }, dom: [{ idx: 3, images: [{ src: '/x.png', complete: true, w: 256, h: 256 }] }] } }
}
const byId = (checks, id) => checks.find((c) => c.id === id)

test('helpers', () => {
    assert.equal(viShare(VI).isVi, true)
    assert.equal(viShare('He walked into the room and the door closed behind him, and it was dark.').isVi, false)
    assert.equal(forbiddenTerms('Anh mất 20 HP.'), 'HP')
    assert.equal(forbiddenTerms('Anh mất nhiều máu.'), '')
    assert.equal(hiddenLeak('xin chào\n[[STATUS\nfrag: 1\n]]'), '[[STATUS')
    assert.equal(menuLines('1. Chạy\n2. Trốn\n3. Đánh').length, 3)
    assert.equal(questionLines('a\n**Bạn chọn gì?**').length, 1)
    assert.equal(questionLines('Tên nhân vật là gì? Bạn có thể chọn **A**, **B**.').length, 1)
    assert.equal(suggestionCount('Tên là gì? Bạn có thể chọn **Julian Mercer**, **Nicolas Bellamy**, **Sota Ishikawa**, hoặc nói **“để thế giới chọn”**.'), 3)
    assert.equal(suggestionCount('Tên là gì? Bạn có thể chọn **Julian Mercer** hoặc nói **“để thế giới chọn”**.'), 1)
    assert.ok(recordLines('- Tên: Minh\n- Tuổi: 19').length === 2)
    assert.deepEqual(changed('st_', { st_a: '1' }, { st_a: '2', st_b: '' }), ['st_a'])
    assert.equal(completionText('data: {"choices":[{"delta":{"content":"Xin"}}]}\ndata: {"choices":[{"delta":{"content":" chào"}}]}\ndata: [DONE]'), 'Xin chào')
    const r = readMainRequest(JSON.stringify({ model: 'story', messages: [{ role: 'system', content: 'x\n* Event: 7. At a natural pause\n* Kind: a stranger.\n' }, { role: 'user', content: 'Tôi nghỉ.\n\n[Referee: beyond]\n\n[GM, hidden ... Dice: BUILD: no new event' }] }))
    assert.equal(r.kind, 'main'); assert.equal(r.eventNew, true); assert.equal(r.gmPace, 'BUILD'); assert.equal(r.referee, 'beyond')
    assert.equal(r.cardNew, false)
    assert.equal(readMainRequest(JSON.stringify({ messages: [{ role: 'system', content: '* Event: 7. x' }, { role: 'user', content: 'Tôi nghỉ.\n\n[GM (hidden, never named): Dice: QUIET: x. Card fate die: NEW EVENT. If this reply' }] })).cardNew, true)
    assert.equal(readMainRequest(JSON.stringify({ messages: [{ role: 'system', content: 'You are a literary translator. ...' }] })).kind, 'translate')
})

test('a good record passes and each breakage fails its own check', () => {
    const quietVoice = Object.fromEntries(['t3', 't4', 't5', 't6', 't7', 't8', 't9', 't10', 't11', 't12'].map((l) => [l, { speaks: false, decides: false, quote: '' }]))
    const J = { impossible: { granted: false, why: 'failed' }, sideLife: { t10: { follows: true }, t11: { follows: true }, t12: { follows: true } }, voice: quietVoice }
    const good = scoreStory(goodRecord(), J)
    for (const id of ['creation.difficulty', 'creation.step_by_step', 'creation.record', 'creation.duoc_chua', 'creation.look_question', 'creation.no_story_before_yes', 'creation.starts_after_yes', 'panel.present', 'panel.updated', 'panel.hidden_blocks', 'prose.vietnamese', 'voice.system', 'dice.events', 'gm.arc', 'jev.referee', 'prolog.check', 'images.scene', 'run.turns', 'gm.side', 'prose.no_leaks', 'voice.player']) {
        assert.equal(byId(good, id)?.status, 'PASS', `${id}: ${byId(good, id)?.summary}`)
    }
    const breaks = [
        ['creation.duoc_chua', (r) => { r.play.turns[0].reply = r.play.turns[0].reply.replace(/Được chưa\?/, '') }],
        ['creation.look_question', (r) => { r.play.turns[0].reply = r.play.turns[0].reply.replace(/Ngoại hình: giữ[^\n]*/, '') }],
        ['creation.no_story_before_yes', (r) => { r.play.turns[0].vars = { st_name: 'Minh' } }],
        ['creation.step_by_step', (r) => { r.steps.turns[0].reply = 'Đã ghi Hard. Bạn bao nhiêu tuổi? Tên gì? Ở đâu?\nBạn chọn gì?\nNghề gì?\nNhà ở đâu?' }],
        ['panel.present', (r) => { for (const t of r.play.turns.slice(1)) t.panel = null }],
        ['panel.updated', (r) => { for (const t of r.play.turns.slice(1)) t.vars = { ...vars0 } }],
        ['panel.hidden_blocks', (r) => { r.play.turns[4].shown += '\n[[GM\nbeat: 2 | a | b\n]]' }],
        ['prose.vietnamese', (r) => { for (const t of r.play.turns.slice(1)) t.shown = 'He walked into the room and the door closed behind him, and it was dark and cold.' }],
        ['voice.system', (r) => { r.play.turns[5].shown += '\nAnh nhận được 50 XP.' }],
        ['voice.system', (r) => { r.play.turns[5].shown += '\nNgươi đã giết một Thú Ngủ Say.' }],
        ['dice.events', (r) => { r.play.turns[5].reply += '\n1. Chạy\n2. Trốn\n3. Đánh' }],
        ['gm.arc', (r) => { for (const t of r.play.turns) { delete t.vars.gm_beat; t.vars.gm_beat = '' } }],
        ['jev.referee', (r) => { r.play.turns[4].net = [] }],
        ['prolog.check', (r) => { r.final.check.violations = [{ rule: 'rank_skipped', detail: {} }] }],
        ['images.scene', (r) => { r.final.dom[0].images[0].w = 0 }],
        ['run.turns', (r) => { r.play.turns[6].ok = false }],
        ['gm.side', (r) => { for (const t of r.play.turns) delete t.vars.gm_path }],
        ['gm.side', (r) => { for (const t of r.play.turns) if (t.vars.gm_path) t.vars.gm_path = 'Song | lính | mới' }],
        ['prose.no_leaks', (r) => { r.play.turns[5].shown += '\n\nBeat: 3 | the player meets the guard | next the camp' }],
        ['prose.no_leaks', (r) => { r.play.turns[5].shown += '\n\nSubtext (hidden drives; show them through action, tone and what is left unsaid, never state them): “Evelyn” wants distance.' }],
        ['prose.no_leaks', (r) => { r.play.turns[5].shown += '\n\nSubtext: Evelyn wants distance.' }],
        ['prose.no_leaks', (r) => { r.play.turns[5].shown += '\n\nThe guard looks at you and you know that the gate is closed for the night.' }],
    ]
    for (const [id, breakIt] of breaks) {
        const r = goodRecord()
        breakIt(r)
        assert.equal(byId(scoreStory(r, J), id).status, 'FAIL', `${id} did not go red`)
    }
    assert.equal(byId(scoreStory(goodRecord(), { ...J, impossible: { granted: true, why: 'it worked' } }), 'jev.referee').status, 'FAIL')
    // the narrator plays the character in 2 of 10 replies: a line the player never wrote, an offer accepted for them
    assert.equal(byId(scoreStory(goodRecord(), { ...J, voice: { ...quietVoice, t4: { speaks: true, decides: false, quote: '"Được," anh đáp.' }, t7: { speaks: false, decides: true, quote: 'Anh nhận lời đi theo bà ta.' } } }), 'voice.player').status, 'FAIL')
    assert.equal(byId(scoreStory(goodRecord(), { ...J, voice: { ...quietVoice, t4: { speaks: true, decides: false, quote: 'x' } } }), 'voice.player').status, 'PASS')
    assert.equal(byId(scoreStory(goodRecord(), { ...J, voice: {} }), 'voice.player').status, 'N/A')
    // the die said NEW at the pauses and the judge saw nothing new: the dice check goes red
    const unsaid = goodRecord()
    for (const t of unsaid.play.turns.filter((x) => x.kind === 'pause')) t.net = [{ type: 'completion', kind: 'main', event: '9', eventNew: true, gmNote: true }]
    const pauses = Object.fromEntries(unsaid.play.turns.filter((x) => x.kind === 'pause').map((t) => [t.label, { newThing: false, what: '' }]))
    assert.equal(byId(scoreStory(unsaid, { ...J, pauses }), 'dice.events').status, 'FAIL')
    assert.equal(byId(scoreStory(unsaid, { ...J, pauses: Object.fromEntries(Object.keys(pauses).map((l) => [l, { newThing: true, what: 'a stranger' }])) }), 'dice.events').status, 'PASS')
    assert.equal(byId(scoreStory(goodRecord(), { ...J, sideLife: { t10: { follows: false }, t11: { follows: false }, t12: { follows: true } } }), 'gm.side').status, 'FAIL')
})

test('dice.events: a pause the GM pace pushed is not counted against the card die; a NEW not told still fails', () => {
    const rec = goodRecord()
    const pauses = rec.play.turns.filter((t) => t.kind === 'pause')
    const judge = { pauses: Object.fromEntries(pauses.map((t) => [t.label, { newThing: false }])) }
    // the card die quiet, the GM ADVANCE, the prose brings what is already there closer: not a miss
    pauses[0].net = [{ type: 'completion', kind: 'main', event: '58', eventNew: false, gmPace: 'ADVANCE', gmNote: true }]
    judge.pauses[pauses[0].label] = { newThing: true, what: 'x' }
    assert.equal(scoreStory(rec, judge).find((c) => c.id === 'dice.events').status, 'PASS')
    // the card die NEW, nothing new told: a miss, whatever the GM did
    for (const t of pauses) t.net = [{ type: 'completion', kind: 'main', event: '9', eventNew: true, gmPace: 'QUIET', gmNote: true }]
    for (const t of pauses) judge.pauses[t.label] = { newThing: false }
    assert.equal(scoreStory(rec, judge).find((c) => c.id === 'dice.events').status, 'FAIL')
})

test('facts.rumor / facts.outdated: the librarian tagged lines a turn carried, and what the judge said of the reply', async () => {
    const { factsIn } = await import('./lib/play.mjs')
    const block = '[Facts the librarian checked for this scene. FACT: true …]\n- FACT · Kai is a postman.\n- RUMOR · Some say Kai killed a man.\n- OUTDATED · Mặc Cúc works at the inn. (no longer: she died)\n- not a fact line'
    assert.deepEqual(factsIn('x\n' + block).map((f) => f.status), ['fact', 'rumor', 'outdated'])
    assert.deepEqual(factsIn('no block here'), [])
    const rec = goodRecord()
    const t5 = rec.play.turns.find((t) => t.label === 't5')
    t5.net = [{ type: 'completion', kind: 'main', event: '50', eventNew: false, gmNote: true }, { type: 'facts', status: 'ok', facts: factsIn(block) }]   // asked by the page
    const J = { impossible: { granted: false, why: 'failed' }, sideLife: { t10: { follows: true }, t11: { follows: true }, t12: { follows: true } } }
    const ok = { rumorAsFact: false, unknownRevealed: false, outdatedAsCurrent: false, touched: true, quote: 'người ta đồn Kai đã giết người' }
    assert.equal(byId(scoreStory(rec, { ...J, facts: { t5: ok } }), 'facts.rumor').status, 'PASS')
    assert.equal(byId(scoreStory(rec, { ...J, facts: { t5: ok } }), 'facts.outdated').status, 'PASS')
    assert.equal(byId(scoreStory(rec, { ...J, facts: { t5: { ...ok, rumorAsFact: true } } }), 'facts.rumor').status, 'FAIL')
    assert.equal(byId(scoreStory(rec, { ...J, facts: { t5: { ...ok, outdatedAsCurrent: true } } }), 'facts.outdated').status, 'FAIL')
    assert.equal(byId(scoreStory(rec, J), 'facts.rumor').status, 'N/A')                    // not judged (--no-judge)
    assert.match(byId(scoreStory(rec, J), 'lore.facts').summary, /1\/\d+ story turns got facts; .*rumor 1, unknown 0, outdated 1/)
})

test('npc.subtext / npc.emotion_consistent / npc.lines: the GM decisions the server logged, and what the judge said of the replies', () => {
    const SUB = 'Subtext (hidden drives; show them through action, tone and what is left unsaid, never state them): “Evelyn” wants to reconcile but keeps distance; cold, few words. “Marek” wants to help; warm.'
    const withDecide = () => {
        const r = goodRecord()
        for (const t of r.play.turns.filter((x) => ['t3', 't4', 't5', 't6', 't7', 't8'].includes(x.label)))
            t.net = [...t.net, { at: 1, type: 'decide', status: 'ok', ms: 40, npc: { source: t.label < 't6' ? 'asp' : 'fatima', ms: 12, subtext: SUB, actions: [{ who: 'Evelyn', action: 'keep_distance', demeanor: 'cold' }] } }]
        return r
    }
    const J = { impossible: { granted: false, why: 'failed' }, sideLife: { t10: { follows: true }, t11: { follows: true }, t12: { follows: true } } }
    const person = (over = {}) => ({ name: 'Evelyn', inReply: true, shown: true, stated: false, consistent: true, quote: 'cô ấy quay đi, không nhìn anh' , ...over })
    const sub = (statedOn = []) => Object.fromEntries(['t3', 't4', 't5', 't6'].map((l, i) => [l, { people: [person(statedOn.includes(i) ? { stated: true, quote: 'cô ấy cảm thấy tức giận' } : {})] }]))
    const pair = (k, over = {}) => [`t${k}>t${k + 1}:Evelyn`, { consistent: true, shift: false, justified: true, quote: 'vẫn lạnh', ...over }]
    const cons = (badOn = [], n = 3) => Object.fromEntries(Array.from({ length: n }, (_, i) => pair(3 + i, badOn.includes(i) ? { consistent: false, shift: true, justified: false, quote: 'bỗng ôm lấy anh' } : {})))
    const rec = withDecide()
    // the good case
    assert.equal(byId(scoreStory(rec, { ...J, npcSubtext: sub(), npcConsistent: cons() }), 'npc.subtext').status, 'PASS')
    assert.equal(byId(scoreStory(rec, { ...J, npcSubtext: sub(), npcConsistent: cons() }), 'npc.emotion_consistent').status, 'PASS')
    assert.match(byId(scoreStory(rec, { ...J, npcSubtext: sub(), npcConsistent: cons() }), 'npc.subtext').summary, /4\/4 shown, 0\/4 stated; 6\/10 turns had subtext \(fatima 3, asp 3\)/)
    // breakage: the narrator states the feeling on 2 of 4 judged turns -> red; 1 of 4 is exactly 25% -> still green
    assert.equal(byId(scoreStory(rec, { ...J, npcSubtext: sub([0, 2]), npcConsistent: cons() }), 'npc.subtext').status, 'FAIL')
    assert.equal(byId(scoreStory(rec, { ...J, npcSubtext: sub([1]), npcConsistent: cons() }), 'npc.subtext').status, 'PASS')
    // breakage: nothing is shown (people in the reply, none conveyed) -> red
    assert.equal(byId(scoreStory(rec, { ...J, npcSubtext: Object.fromEntries(Object.keys(sub()).map((l) => [l, { people: [person({ shown: false })] }])), npcConsistent: cons() }), 'npc.subtext').status, 'FAIL')
    // breakage: a contradiction on 2 of 3 pairs -> red (one of 3 too: floor(3 * 0.2) = 0)
    assert.equal(byId(scoreStory(rec, { ...J, npcSubtext: sub(), npcConsistent: cons([0, 2]) }), 'npc.emotion_consistent').status, 'FAIL')
    assert.equal(byId(scoreStory(rec, { ...J, npcSubtext: sub(), npcConsistent: cons([1]) }), 'npc.emotion_consistent').status, 'FAIL')
    // one in five is allowed, two are not
    assert.equal(byId(scoreStory(rec, { ...J, npcSubtext: sub(), npcConsistent: cons([1], 5) }), 'npc.emotion_consistent').status, 'PASS')
    assert.equal(byId(scoreStory(rec, { ...J, npcSubtext: sub(), npcConsistent: cons([1, 3], 5) }), 'npc.emotion_consistent').status, 'FAIL')
    // a shift with no cause is a contradiction even if the judge called it "consistent"
    assert.equal(byId(scoreStory(rec, { ...J, npcSubtext: sub(), npcConsistent: { ...cons([], 2), ...Object.fromEntries([pair(5, { consistent: true, shift: true, justified: false })]) } }), 'npc.emotion_consistent').status, 'FAIL')
    // people who never appeared in a reply count as neither shown nor stated
    assert.equal(byId(scoreStory(rec, { ...J, npcSubtext: Object.fromEntries(Object.keys(sub()).map((l) => [l, { people: [person({ inReply: false, shown: false })] }])), npcConsistent: cons() }), 'npc.subtext').status, 'N/A')
    // no decide nets (npc-psych off, or no GM log): N/A and no INFO line
    const none = goodRecord()
    for (const id of ['npc.subtext', 'npc.emotion_consistent']) assert.equal(byId(scoreStory(none, { ...J, npcSubtext: sub(), npcConsistent: cons() }), id).status, 'N/A', id)
    assert.equal(byId(scoreStory(none, J), 'npc.lines'), undefined)
    // decide nets with no npc field at all (the server with psychology off): still N/A
    const off = goodRecord()
    for (const t of off.play.turns.filter((x) => x.phase === 'story')) t.net = [...t.net, { at: 1, type: 'decide', status: 'ok', ms: 30 }]
    assert.equal(byId(scoreStory(off, { ...J, npcSubtext: sub() }), 'npc.subtext').status, 'N/A')
    assert.match(byId(scoreStory(off, J), 'npc.lines').summary, /^0\/10 story turns had a Subtext line/)
    // not judged (--no-judge)
    assert.equal(byId(scoreStory(rec, J), 'npc.subtext').status, 'N/A'); assert.match(byId(scoreStory(rec, J), 'npc.subtext').summary, /not judged/)
    assert.equal(byId(scoreStory(rec, J), 'npc.emotion_consistent').status, 'N/A')
    // INFO npc.lines
    const info = byId(scoreStory(rec, J), 'npc.lines')
    assert.equal(info.status, 'INFO')
    assert.match(info.summary, /6\/10 story turns had a Subtext line; 2 NPCs\/turn median, \d+ chars median; npc ms p50 12 \/ p95 12; sources asp 3, fatima 3/)
})

test('npcPeople / npcSubtextOf: the named people of a Subtext line, the last decide net that carried one', async () => {
    const { npcPeople, npcSubtextOf } = await import('./lib/score.mjs')
    const line = 'Subtext (hidden drives; show them through action, tone and what is left unsaid, never state them): “Evelyn” wants to reconcile but keeps distance; cold, few words; may stay silent. “Marek” grateful, offers help unasked; warm.'
    assert.deepEqual(Object.keys(npcPeople(line)), ['Evelyn', 'Marek'])
    assert.match(npcPeople(line).Marek, /^“Marek” grateful/)
    assert.doesNotMatch(npcPeople(line).Evelyn, /Marek/)
    assert.deepEqual(npcPeople(''), {})
    assert.equal(npcSubtextOf({ net: [{ type: 'decide', npc: { subtext: 'a' } }, { type: 'decide', npc: { subtext: '' } }] }), 'a')
    assert.equal(npcSubtextOf({ net: [{ type: 'decide' }] }), '')
    assert.equal(npcSubtextOf({}), '')
})

test('the judge on the Claude subscription (--judge-model claude:sonnet): claude -p lean call, its JSON, its error flag, at most 4 at once', async () => {
    const fs = await import('fs'); const os = await import('os'); const path = await import('path')
    const { askClaude, isClaudeModel } = await import('./lib/judge.mjs')
    assert.equal(isClaudeModel('claude:sonnet'), true); assert.equal(isClaudeModel('claude-haiku-5-5'), true); assert.equal(isClaudeModel('main-deepseek'), false)
    assert.equal(isClaudeModel('sonnet-something-routed'), false)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-'))
    const bin = path.join(dir, 'claude')
    // a fake claude: checks the lean flags, logs its start and end (ms), sleeps 300 ms, echoes the prompt back as the result
    fs.writeFileSync(bin, [
        '#!/bin/sh',
        'case "$*" in *"--tools  --strict-mcp-config"*"--setting-sources  --disable-slash-commands --no-session-persistence --output-format json"*) ;; *) echo "bad args: $*" >&2; exit 2;; esac',
        `echo "s $(perl -MTime::HiRes=time -e 'printf "%d", time*1000')" >> "${dir}/log"`,
        'p=$(cat); sleep 0.3',
        `echo "e $(perl -MTime::HiRes=time -e 'printf "%d", time*1000')" >> "${dir}/log"`,
        'case "$p" in *FAIL*) printf \'{"is_error":true,"result":"limit reached"}\';; *) printf \'{"is_error":false,"result":"%s"}\' "$p";; esac',
    ].join('\n') + '\n')
    fs.chmodSync(bin, 0o755)
    assert.equal(await askClaude('sonnet', 'ok', { bin }), 'ok')
    await assert.rejects(askClaude('sonnet', 'FAIL', { bin }), /limit reached/)
    fs.writeFileSync(path.join(dir, 'log'), '')
    await Promise.all(Array.from({ length: 10 }, (_, i) => askClaude('sonnet', `q${i}`, { bin })))
    const ev = fs.readFileSync(path.join(dir, 'log'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')).map(([k, t]) => [Number(t), k === 's' ? 1 : -1])
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    let run = 0, peak = 0
    for (const [, d] of ev) { run += d; peak = Math.max(peak, run) }
    assert.ok(peak <= 4, `peak ${peak} > 4`)
    assert.ok(peak >= 2, `peak ${peak}: they did not run in parallel`)
})
