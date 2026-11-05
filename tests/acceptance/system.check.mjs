// node --test tests/acceptance/system.check.mjs : the Hệ thống scorers (lib/system.mjs, lib/quests.mjs) and the explicit `companion: none` skip of
// companion.match. Every scorer passes its good run and goes RED on a broken twin built here on purpose; a scorer that can never go red is
// caught by mutating its source. The broken twins use the owner's own failure shapes (the System as a person, Evelyn back, a quest that pays nothing).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { presentProblems, noEvelynProblems, noCompanionProblems, parsePersonaFixture, systemChecks, systemSpeech, asSpeech } from './lib/system.mjs'
import { offeredProblems, trackedProblems, rewardedProblems, hiddenProblems, questChecks } from './lib/quests.mjs'
import { companionMatchResult } from './lib/score.mjs'
import { guideScoutProblems, guideNoSpoilerProblems } from './lib/narration.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const rules = (ps) => [...new Set(ps.map((p) => p.rule))].sort()
const SRC = { score: fs.readFileSync(path.join(HERE, 'lib', 'score.mjs'), 'utf8'), system: fs.readFileSync(path.join(HERE, 'lib', 'system.mjs'), 'utf8'), quests: fs.readFileSync(path.join(HERE, 'lib', 'quests.mjs'), 'utf8') }
async function mutant(file, from, to) {
    assert.ok(SRC[file].includes(from), `mutation target missing: ${from}`)
    const f = path.join(HERE, 'lib', `.${file}.mut.${process.pid}.${Math.random().toString(36).slice(2)}.mjs`)
    fs.writeFileSync(f, SRC[file].replace(from, to))
    try { return await import(f + '?x=' + Math.random()) } finally { fs.unlinkSync(f) }
}
const clone = (x) => JSON.parse(JSON.stringify(x))

// ---- a good run: the System speaks from turn 1, offers q1 at turn 2, the player does it, it is done at turn 6 and pays Thể lực +1.00% -------------------
const PROSE = 'Hành lang im phăng phắc. Kenji áp tai vào cánh cửa và nghe tiếng kéo lê xa dần phía cuối dãy.'
const OFFER = '【HỆ THỐNG: NHIỆM VỤ — Tìm nguồn nước sạch trong tòa nhà.】'
const STATS0 = { suc_manh: 1000, nhanh_nhen: 1000, the_luc: 1000, tinh_than: 1000, cam_nhan: 1000, y_chi: 1000 }
const REWARD = { kind: 'stat', key: 'the_luc', amount: 100 }
const ACTIVE = JSON.stringify({ id: 'q1', title: 'Tìm nguồn nước sạch', state: 'active', reward: REWARD })
function goodRun() {
    const turns = []
    for (let i = 0; i < 10; i++) {
        const t = { raw: PROSE, shown: `${PROSE}\n【HỆ THỐNG: Không phát hiện chuyển động trong 8 m.】`, reply: PROSE, stats: { ...STATS0 }, skills: {}, rank: 1, ticks: '', quest: '', hist: '[]' }
        if (i >= 1 && i < 5) { t.quest = ACTIVE }
        if (i === 1) { t.shown = `${PROSE}\n${OFFER}` }
        if (i === 4) { t.raw += '\n[[QUEST|done|q1]]'; t.quest = ''; t.hist = JSON.stringify([{ id: 'q1', state: 'done', reward: REWARD }]); t.stats = { ...STATS0, the_luc: 1101 }; t.ticks = 'Thể lực 11.01% (+0.01)' }
        if (i > 4) { t.hist = JSON.stringify([{ id: 'q1', state: 'done', reward: REWARD }]); t.stats = { ...STATS0, the_luc: 1101 } }
        turns.push(t)
    }
    return { turns }
}
const runs = (...rs) => rs

test('system.present: the good run passes; no voice, a person, a friend\'s register and Evelyn each go red', () => {
    assert.deepEqual(presentProblems(runs(goodRun())), [])
    const none = goodRun(); none.turns.forEach((t) => { t.shown = PROSE; t.reply = PROSE })
    assert.deepEqual(rules(presentProblems(runs(none))), ['no-voice'])
    const late = goodRun(); late.turns.forEach((t, i) => { if (i < 6) { t.shown = PROSE; t.reply = PROSE } })
    assert.deepEqual(rules(presentProblems(runs(late))), ['no-voice'], 'a voice after the first 6 turns is too late')
    const person = goodRun(); person.turns[3].shown += '\nHệ thống thì thầm vào tai anh: cẩn thận.'
    assert.deepEqual(rules(presentProblems(runs(person))), ['person'])
    const quoted = goodRun(); quoted.turns[3].shown += '\n“Đi nhanh lên.” Hệ thống cười khẽ.'
    assert.ok(rules(presentProblems(runs(quoted))).includes('person'))
    const friend = goodRun(); friend.turns[3].shown += '\n【HỆ THỐNG: Cậu ổn chứ? Tớ thấy cậu run đấy.】'
    assert.deepEqual(rules(presentProblems(runs(friend))), ['person'])
    const eve = goodRun(); eve.turns[3].shown += '\n【HỆ THỐNG: Evelyn đã ngừng liên lạc.】'
    assert.deepEqual(rules(presentProblems(runs(eve))), ['evelyn-voice'])
    assert.equal(systemChecks(runs(goodRun()))[0].status, 'PASS')
    assert.equal(systemChecks(runs(person))[0].status, 'FAIL')
    assert.equal(systemChecks([])[0].status, 'FAIL', 'no runs is not a pass')
})

test('system.noEvelyn: the word Evelyn in any reply is red, the good run is clean', () => {
    assert.deepEqual(noEvelynProblems(runs(goodRun())), [])
    const eve = goodRun(); eve.turns[4].reply += ' Evelyn khẽ gọi anh.'
    assert.deepEqual(rules(noEvelynProblems(runs(eve))), ['evelyn'])
    const lower = goodRun(); lower.turns[2].shown += ' evelyn?'
    assert.deepEqual(rules(noEvelynProblems(runs(lower))), ['evelyn'])
    assert.deepEqual(noEvelynProblems(runs(goodRun())).length, 0)
    assert.deepEqual(noEvelynProblems(runs({ turns: [{ shown: 'Evelynn là tên khác.' }] })), [], 'a longer word is not her')
    assert.equal(systemChecks(runs(goodRun()), { all: runs(eve) })[1].status, 'FAIL', 'all = every turn incl. creation')
})

test('companion.match: skipped ONLY when the persona fixture declares `companion: none`', () => {
    const fx = parsePersonaFixture(fs.readFileSync(path.join(HERE, 'fixtures', 'personas', 'kenji-system.md'), 'utf8'))
    assert.equal(fx.companion, 'none'); assert.ok(!/evelyn/i.test(fx.text)); assert.ok(!/^companion:/im.test(fx.text), 'the declaration line is not persona text')
    assert.equal(parsePersonaFixture('**Evelyn — Linh Hồn Dẫn Lối:**\nx').companion, null, 'no declaration, no skip (never inferred from a missing name)')
    const record = '- Giới tính: Nam\n- Tuổi: 25\n- Tên: Kenji\n- Ngoại hình: gầy\n- Nơi ở: căn 704\n- Đồng hành: Không\n\nĐược chưa?'
    const sheets = [{ label: 'g1.1', reply: record }]
    const ok = companionMatchResult({ companions: [], declaredNone: true, sheets, replies: [PROSE] })
    assert.equal(ok.status, 'N/A'); assert.equal(ok.summary, 'N/A (no companion)', 'printed as N/A, never PASS')
    // declared none, but the record still has a companion
    const rec2 = companionMatchResult({ companions: [], declaredNone: true, sheets: [{ label: 'g1.1', reply: record.replace('Không', 'Evelyn, linh hồn dẫn lối') }], replies: [PROSE] })
    assert.equal(rec2.status, 'FAIL'); assert.ok(rec2.evidence.some((e) => /invented|Đồng hành/.test(e)))
    // declared none, the record is clean, but the prose still has a companion line or Evelyn
    const prose1 = companionMatchResult({ companions: [], declaredNone: true, sheets, replies: [`${PROSE}\nĐồng hành: Evelyn`] })
    assert.equal(prose1.status, 'FAIL')
    const prose2 = companionMatchResult({ companions: [], declaredNone: true, sheets, replies: [`${PROSE} Evelyn nói khẽ.`] })
    assert.equal(prose2.status, 'FAIL')
    assert.deepEqual(rules(noCompanionProblems({ record, replies: [`${PROSE}\nĐồng hành: Evelyn`] })), ['companion-line', 'evelyn'])
    // the default and Evelyn cases run exactly as before
    assert.equal(companionMatchResult({ companions: [], declaredNone: false, sheets, replies: [] }).status, 'N/A')
    assert.equal(companionMatchResult({ companions: [], declaredNone: false, sheets, replies: [] }).summary, 'the persona names no companion')
    const eve = companionMatchResult({ companions: ['Evelyn'], declaredNone: false, sheets: [{ label: 'g1.1', reply: record.replace('Không', 'Evelyn') }], replies: [] })
    assert.equal(eve.status, 'PASS'); assert.match(eve.summary, /1\/1 records name Evelyn/)
    assert.equal(companionMatchResult({ companions: ['Evelyn'], declaredNone: false, sheets, replies: [] }).status, 'FAIL', 'a persona that names Evelyn and a record that says Không is still red')
})

test('guide.scout / guide.noSpoiler stay as they are and read the System through an adapter', () => {
    const reply = `${PROSE}\n【QUÉT: Có một người đứng sát cửa căn 706, quay lưng về phía hành lang, áo xám.】`
    assert.deepEqual(systemSpeech(reply), ['Có một người đứng sát cửa căn 706, quay lưng về phía hành lang, áo xám.'])
    assert.deepEqual(guideScoutProblems(asSpeech(reply)), [])
    assert.deepEqual(rules(guideScoutProblems(asSpeech(PROSE))), ['no-report'], 'a System that reports nothing is red')
    const spoil = `${PROSE}\n【HỆ THỐNG: Sắp có một đợt zombie tấn công tòa nhà, cách 40 m.】`
    assert.ok(rules(guideNoSpoilerProblems(systemSpeech(spoil))).includes('future'))
    assert.ok(rules(guideNoSpoilerProblems(systemSpeech(spoil))).includes('range'))
})

// ---- Hệ thống → Admin rename (L1-approved 2026-11-05): the label ADMIN is ADDED next to HỆ THỐNG, nothing is loosened -------------------------
const ADMIN_SCAN = `${PROSE}\n【ADMIN: Có một người đứng sát cửa căn 706, quay lưng về phía hành lang, áo xám.】`
test('admin: a 【ADMIN: …】 line is System speech for guide.scout / guide.noSpoiler, its label is stripped like HỆ THỐNG', () => {
    assert.deepEqual(systemSpeech(ADMIN_SCAN), ['Có một người đứng sát cửa căn 706, quay lưng về phía hành lang, áo xám.'])
    assert.deepEqual(systemSpeech(`${PROSE}\n**【ADMIN — Mục tiêu đã khóa.】**`), ['Mục tiêu đã khóa.'])
    assert.deepEqual(guideScoutProblems(asSpeech(ADMIN_SCAN)), [])
    assert.deepEqual(guideNoSpoilerProblems(systemSpeech(ADMIN_SCAN)), [], 'the label itself is not System text inside the System voice')
    const tagged = `${PROSE}\n【ADMIN: Đã nhận diện KHÁCH-704, mức đồng bộ 12%.】`
    assert.ok(rules(guideNoSpoilerProblems(systemSpeech(tagged))).includes('system-text'), 'KHÁCH-704 / a % number in an ADMIN line is system text')
    // the old HỆ THỐNG fixtures, unchanged
    assert.deepEqual(systemSpeech(`${PROSE}\n【HỆ THỐNG: Không phát hiện chuyển động trong 8 m.】`), ['Không phát hiện chuyển động trong 8 m.'])
})

test('admin: "Admin lên tiếng" in prose makes the System a person; administrator / badminton / an email / a url do not', () => {
    const adm = goodRun(); adm.turns.forEach((t) => { t.shown = t.shown.replace('【HỆ THỐNG:', '【ADMIN:'); t.reply = t.reply.replace('【HỆ THỐNG:', '【ADMIN:') })
    assert.deepEqual(presentProblems(runs(adm)), [], 'a run whose voice is 【ADMIN: …】 is a good run')
    const person = goodRun(); person.turns[3].shown += '\nAdmin lên tiếng: cẩn thận.'
    assert.deepEqual(rules(presentProblems(runs(person))), ['person'])
    const quoted = goodRun(); quoted.turns[3].shown += '\n“Đi nhanh lên.” Admin đáp.'
    assert.ok(rules(presentProblems(runs(quoted))).includes('person'))
    for (const line of ['Gã administrator lên tiếng: cẩn thận.', 'Hai đứa trẻ chơi badminton cười rộ ngoài sân.', 'Tờ giấy ghi admin@example.com nói rõ giờ mở cửa.', 'Trang https://admin.example.com đáp lại bằng một dòng lỗi.', 'Hộp thư admin@khu-704.vn nhìn trống trơn.']) {
        const neg = goodRun(); neg.turns[3].shown += `\n${line}`
        assert.deepEqual(presentProblems(runs(neg)), [], `not the System as a person: ${line}`)
    }
    // the old HỆ THỐNG person fixture, unchanged
    const old = goodRun(); old.turns[3].shown += '\nHệ thống thì thầm vào tai anh: cẩn thận.'
    assert.deepEqual(rules(presentProblems(runs(old))), ['person'])
})

test('admin: the zombie card\'s unbracketed-voice rule also catches an ADMIN: line outside brackets', async () => {
    const { STORIES } = await import('./stories.mjs')
    const re = STORIES.zombie.voice.unbracketed
    assert.ok(re.test('ADMIN: Mục tiêu đã khóa.'))
    assert.ok(re.test('*ADMIN: Mục tiêu đã khóa.'))
    assert.ok(re.test('HỆ THỐNG: Không phát hiện chuyển động.'), 'the old label still caught')
    assert.ok(!re.test('Gã administrator: một người đàn ông gầy.'))
    assert.ok(!re.test('Kenji nhìn dòng chữ admin@example.com.'))
})

// ---- quests -------------------------------------------------------------------------------------------------------------------------------------
test('quest.offered: good passes; no offer, late offer, silent offer, no reward each red', () => {
    assert.deepEqual(offeredProblems(runs(goodRun())), [])
    const none = goodRun(); none.turns.forEach((t) => { t.quest = ''; t.hist = '[]' })
    assert.deepEqual(rules(offeredProblems(runs(none))), ['no-offer'])
    const late = goodRun(); late.turns = [...Array(13).fill(0).map(() => ({ raw: PROSE, shown: PROSE, reply: PROSE, quest: '', hist: '[]' })), ...late.turns]
    assert.ok(rules(offeredProblems(runs(late))).includes('offer-late'))
    const silent = goodRun(); silent.turns[1].shown = PROSE
    assert.deepEqual(rules(offeredProblems(runs(silent))), ['offer-silent'])
    const noReward = goodRun(); noReward.turns.forEach((t) => { if (t.quest) t.quest = JSON.stringify({ id: 'q1', title: 'x', state: 'active' }) })
    assert.deepEqual(rules(offeredProblems(runs(noReward))), ['offer-no-reward'])
    const zero = goodRun(); zero.turns.forEach((t) => { if (t.quest) t.quest = JSON.stringify({ id: 'q1', state: 'active', reward: { kind: 'stat', key: 'the_luc', amount: 0 } }) })
    assert.ok(rules(offeredProblems(runs(zero))).includes('offer-no-reward'))
})

test('quest.tracked: good passes; two active, tag for an unknown/inactive quest, tag the store ignored, closed without a tag, closed twice are red', () => {
    assert.deepEqual(trackedProblems(runs(goodRun())), [])
    const two = goodRun(); two.turns[2].quest = JSON.stringify({ id: 'q2', state: 'active', reward: REWARD })
    assert.ok(rules(trackedProblems(runs(two))).includes('two-active'))
    const unknown = goodRun(); unknown.turns[7].raw += '\n[[QUEST|done|q9]]'
    assert.deepEqual(rules(trackedProblems(runs(unknown))), ['tag-unknown'])
    const ignored = goodRun(); ignored.turns[2].raw += '\n[[QUEST|fail|q1]]'
    assert.deepEqual(rules(trackedProblems(runs(ignored))), ['tag-ignored'])
    const noTag = goodRun(); noTag.turns[4].raw = PROSE
    assert.deepEqual(rules(trackedProblems(runs(noTag))), ['closed-without-tag'])
    const dup = goodRun(); dup.turns[8].hist = JSON.stringify([{ id: 'q1', state: 'done', reward: REWARD }, { id: 'q1', state: 'done', reward: REWARD }]); dup.turns[8].raw += '\n[[QUEST|done|q1]]'
    assert.ok(rules(trackedProblems(runs(dup))).includes('dup'))
    const stranger = goodRun(); stranger.turns[8].hist = JSON.stringify([{ id: 'q1', state: 'done', reward: REWARD }, { id: 'q7', state: 'done', reward: REWARD }]); stranger.turns[8].raw += '\n[[QUEST|done|q7]]'
    assert.ok(rules(trackedProblems(runs(stranger))).includes('closed-unknown'))
})

test('quest.rewarded: the reward is read in the STORE; none, wrong amount, paid on fail, no completion are red; the cap and a stat tick are honoured', () => {
    assert.deepEqual(rewardedProblems(runs(goodRun())), [])
    const unpaid = goodRun(); unpaid.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0, the_luc: 1001 } })   // the +0.01 tick yes, the +1.00 reward no
    assert.deepEqual(rules(rewardedProblems(runs(unpaid))), ['reward-mismatch'])
    const wrong = goodRun(); wrong.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0, the_luc: 1201 } })
    assert.deepEqual(rules(rewardedProblems(runs(wrong))), ['reward-mismatch'])
    const otherStat = goodRun(); otherStat.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0, the_luc: 1001, y_chi: 1100 } })
    assert.ok(rules(rewardedProblems(runs(otherStat))).includes('reward-mismatch'), 'paying the wrong stat is red')
    const failPaid = goodRun(); failPaid.turns[4].raw = failPaid.turns[4].raw.replace('done', 'fail'); failPaid.turns[4].hist = JSON.stringify([{ id: 'q1', state: 'fail', reward: REWARD }])
    assert.deepEqual(rules(rewardedProblems(runs(failPaid))), ['no-completion', 'reward-on-fail'])
    const failOk = clone(failPaid); failOk.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0, the_luc: 1001 } })
    assert.deepEqual(rules(rewardedProblems(runs(failOk))), ['no-completion'], 'a failed quest that pays nothing is fine, but it is not a completion')
    const none = goodRun(); none.turns.forEach((t) => { t.hist = '[]'; t.quest = '' })
    assert.deepEqual(rules(rewardedProblems(runs(none))), ['no-completion'])
    // the soft cap (rank 1: 40%) clamps the reward: a stat at 39.50% gets 0.50, not 1.00
    const capped = goodRun(); capped.start = { stats: { ...STATS0, the_luc: 3950 } }
    capped.turns.forEach((t, i) => { t.stats = { ...STATS0, the_luc: i >= 4 ? 4000 : 3950 }; if (i === 4) t.ticks = '' })
    assert.deepEqual(rewardedProblems(runs(capped)), [])
    // a skill reward: Nghe nhịp bước +0.50, linked to Cảm nhận (10%), the mastery cap is 35%
    const skillRw = { kind: 'skill', id: 'nghe-nhip-buoc', amount: 50 }
    const sk = goodRun(); sk.turns.forEach((t, i) => { t.quest = t.quest ? JSON.stringify({ id: 'q1', state: 'active', reward: skillRw }) : ''; t.skills = { 'nghe-nhip-buoc': { m: i >= 4 ? 450 : 400, eq: 1, link: ['cam_nhan'], name: 'Nghe nhịp bước' } }; t.stats = { ...STATS0 }; t.ticks = ''; if (i >= 4) t.hist = JSON.stringify([{ id: 'q1', state: 'done', reward: skillRw }]) })
    assert.deepEqual(rewardedProblems(runs(sk)), [])
    const skUnpaid = clone(sk); skUnpaid.turns.forEach((t) => { t.skills['nghe-nhip-buoc'].m = 400 })
    assert.deepEqual(rules(rewardedProblems(runs(skUnpaid))), ['reward-mismatch'])
})

// The script pays through stats.apply: the reward is a tick line ("Thể lực 10.01% (+0.01)") and the script records what it paid in $quest_last.delta.gains.
// (Measured on the gate of 2026-11-05: a ticked reward read as 0 moved beyond the ticks, so no correct payment could ever pass.)
const TICKED = { kind: 'stat', key: 'the_luc', amount: 1 }
function tickedRun() {
    const g = goodRun()
    g.turns.forEach((t, i) => {
        if (t.quest) t.quest = JSON.stringify({ id: 'q1', state: 'active', reward: TICKED })
        t.stats = { ...STATS0, the_luc: i >= 4 ? 1001 : 1000 }
        t.ticks = i === 4 ? 'Thể lực 10.01% (+0.01)' : ''
        if (i >= 4) t.hist = JSON.stringify([{ id: 'q1', state: 'done', reward: TICKED }])
        if (i === 4) t.qlast = JSON.stringify({ turn: 5, id: 'q1', event: 'done', delta: { gains: [{ key: 's:the_luc', before: 1000, after: 1001 }], hist: [] } })
    })
    return g
}
test('quest.rewarded with the script\'s own record: a reward shown as a tick line passes; unpaid, wrong stat, wrong amount and an untracked move are red', () => {
    assert.deepEqual(rewardedProblems(runs(tickedRun())), [], 'a +0.01 paid by stats.apply and shown as a tick line is a paid reward')
    const unpaid = tickedRun(); unpaid.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0 } }); unpaid.turns[4].ticks = ''; unpaid.turns[4].qlast = JSON.stringify({ turn: 5, id: 'q1', event: 'done', delta: { gains: [], hist: [] } })
    assert.deepEqual(rules(rewardedProblems(runs(unpaid))), ['reward-mismatch'], 'the script paid nothing')
    const wrongStat = tickedRun(); wrongStat.turns[4].qlast = JSON.stringify({ turn: 5, id: 'q1', event: 'done', delta: { gains: [{ key: 's:y_chi', before: 1000, after: 1001 }], hist: [] } })
    assert.ok(rules(rewardedProblems(runs(wrongStat))).includes('reward-mismatch'), 'the script paid another stat')
    const wrongAmount = tickedRun(); wrongAmount.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0, the_luc: 1003 } }); wrongAmount.turns[4].ticks = 'Thể lực 10.01% (+0.01)\nThể lực 10.02% (+0.01)\nThể lực 10.03% (+0.01)'; wrongAmount.turns[4].qlast = JSON.stringify({ turn: 5, id: 'q1', event: 'done', delta: { gains: [{ key: 's:the_luc', before: 1000, after: 1003 }], hist: [] } })
    assert.deepEqual(rules(rewardedProblems(runs(wrongAmount))), ['reward-mismatch'], 'three gains for a quest that declares one')
    const untracked = tickedRun(); untracked.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0, the_luc: 1002 } })
    assert.deepEqual(rules(rewardedProblems(runs(untracked))), ['untracked-move'], 'the store moved one more than the tick lines say')
    const failPaid = tickedRun(); failPaid.turns[4].raw = failPaid.turns[4].raw.replace('done', 'fail'); failPaid.turns.forEach((t, i) => { if (i >= 4) t.hist = JSON.stringify([{ id: 'q1', state: 'fail', reward: TICKED }]) }); failPaid.turns[4].qlast = JSON.stringify({ turn: 5, id: 'q1', event: 'fail', delta: { gains: [{ key: 's:the_luc', before: 1000, after: 1001 }], hist: [] } })
    assert.ok(rules(rewardedProblems(runs(failPaid))).includes('reward-on-fail'), 'a failed quest that paid')
    // a stat reward that also ticked the equipped skill (reward.skill) is not held to a skill amount, but the move must be on a tick line
    const bonus = tickedRun(); bonus.turns.forEach((t, i) => { t.skills = { 'nghe-nhip-buoc': { m: i >= 4 ? 1 : 0, eq: 1, link: ['cam_nhan'], name: 'Nghe nhịp bước' } } })
    bonus.turns[4].ticks = 'Thể lực 10.01% (+0.01)\nThành thạo Nghe nhịp bước 0.01% (+0.01)'
    bonus.turns[4].qlast = JSON.stringify({ turn: 5, id: 'q1', event: 'done', delta: { gains: [{ key: 's:the_luc', before: 1000, after: 1001 }, { key: 'k:nghe-nhip-buoc', before: 0, after: 1 }], hist: [] } })
    assert.deepEqual(rewardedProblems(runs(bonus)), [], 'the skill tick is a bonus of a stat reward')
    const bonusHidden = clone(bonus); bonusHidden.turns[4].ticks = 'Thể lực 10.01% (+0.01)'
    assert.deepEqual(rules(rewardedProblems(runs(bonusHidden))), ['untracked-move'], 'a skill move with no tick line is untracked')
})

// L1's condition on the script's self-declared gains: what $quest_last.delta.gains says must be what the STORE did, before/after the completing turn.
test('quest.rewarded: the script\'s declared gains must match the store - declared but not added, or added by another amount, is red; the turn\'s own ACT tick is allowed', () => {
    // Lua mutant 1: delta.gains says +1 but stats.apply never ran (no tick line, store unchanged)
    const notAdded = tickedRun(); notAdded.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0 } }); notAdded.turns[4].ticks = ''
    assert.deepEqual(rules(rewardedProblems(runs(notAdded))), ['store-vs-gains'], 'a reward on paper only')
    assert.ok(rewardedProblems(runs(notAdded))[0].text.includes('the store moved 0'))
    // Lua mutant 2: delta.gains says +1, the store (with its own tick lines) moved +3
    const wrongBy = tickedRun(); wrongBy.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0, the_luc: 1003 } }); wrongBy.turns[4].ticks = 'Thể lực 10.01% (+0.01)\nThể lực 10.02% (+0.01)\nThể lực 10.03% (+0.01)'
    assert.deepEqual(rules(rewardedProblems(runs(wrongBy))), ['store-vs-gains'], 'the store paid 3 for a declared 1')
    // a skill claim the store does not show
    const skillRw = { kind: 'skill', id: 'nghe-nhip-buoc', amount: 1 }
    const sk = tickedRun(); sk.turns.forEach((t, i) => { t.quest = t.quest ? JSON.stringify({ id: 'q1', state: 'active', reward: skillRw }) : ''; t.stats = { ...STATS0 }; t.ticks = ''; t.skills = { 'nghe-nhip-buoc': { m: 400, eq: 1, link: ['cam_nhan'], name: 'Nghe nhịp bước' } }; if (i >= 4) t.hist = JSON.stringify([{ id: 'q1', state: 'done', reward: skillRw }]) })
    sk.turns[4].qlast = JSON.stringify({ turn: 5, id: 'q1', event: 'done', delta: { gains: [{ key: 'k:nghe-nhip-buoc', before: 400, after: 401 }], hist: [] } })
    assert.deepEqual(rules(rewardedProblems(runs(sk))), ['store-vs-gains'], 'a skill reward on paper only')
    const skOk = clone(sk); skOk.turns.forEach((t, i) => { if (i >= 4) t.skills['nghe-nhip-buoc'].m = 401 }); skOk.turns[4].ticks = 'Thành thạo Nghe nhịp bước 4.01% (+0.01)'
    assert.deepEqual(rewardedProblems(runs(skOk)), [], 'the same claim with the store and the tick line is a paid reward')
    // the same turn also holds an action of the narrator on the reward's stat: +1 reward and +1 ACT tick = 2 in the store, still fine; 3 is not
    const withAct = tickedRun(); withAct.turns[4].raw += '\n[[ACT|keo-cua|the_luc+suc_manh|normal|]]'
    withAct.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0, the_luc: 1002 } }); withAct.turns[4].ticks = 'Thể lực 10.01% (+0.01)\nThể lực 10.02% (+0.01)'
    assert.deepEqual(rewardedProblems(runs(withAct)), [], 'one ACT tick on the same stat is not a mismatch')
    const tooMany = clone(withAct); tooMany.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0, the_luc: 1003 } }); tooMany.turns[4].ticks += '\nThể lực 10.03% (+0.01)'
    assert.deepEqual(rules(rewardedProblems(runs(tooMany))), ['store-vs-gains'], 'one more than the claim and the one possible ACT tick')
    // a failed quest and a run with no declared record behave as before
    assert.deepEqual(rewardedProblems(runs(tickedRun())), [])
    assert.deepEqual(rewardedProblems(runs(goodRun())), [])
})

test('quest.hidden: a whole or half-streamed [[QUEST tag in the shown or stored text is red', () => {
    assert.deepEqual(hiddenProblems(runs(goodRun())), [])
    const shown = goodRun(); shown.turns[4].shown += '\n[[QUEST|done|q1]]'
    assert.deepEqual(rules(hiddenProblems(runs(shown))), ['quest-visible-shown'])
    const stored = goodRun(); stored.turns[4].reply += '\n[[QUEST|done|q1]]'
    assert.deepEqual(rules(hiddenProblems(runs(stored))), ['quest-visible-stored'])
    const half = goodRun(); half.turns[4].shown += ' [[QUE'
    assert.deepEqual(rules(hiddenProblems(runs(half))), ['quest-visible-shown'])
})

test('questChecks / systemChecks: all pass on the good run, and each check goes FAIL on its own breakage', () => {
    assert.deepEqual(questChecks(runs(goodRun())).map((c) => c.status), ['PASS', 'PASS', 'PASS', 'PASS'])
    assert.deepEqual(questChecks([]).map((c) => c.status), ['FAIL', 'FAIL', 'FAIL', 'FAIL'])
    assert.deepEqual(questChecks(runs(goodRun())).map((c) => c.id), ['quest.offered', 'quest.tracked', 'quest.rewarded', 'quest.hidden'])
})

test('mutation: a scorer that can never go red is caught', async () => {
    const m1 = await mutant('system', "if (!turns.slice(0, within).some((t) => texts(t).some((x) => voiceLines(x).length)))", 'if (false)')
    const none = goodRun(); none.turns.forEach((t) => { t.shown = PROSE; t.reply = PROSE })
    assert.deepEqual(m1.presentProblems(runs(none)), [], 'the mutant no longer sees a missing voice')
    assert.ok(presentProblems(runs(none)).length, 'the real scorer does')
    const m2 = await mutant('system', 'for (const re of PERSON_RE) {', 'for (const re of []) {')
    const person = goodRun(); person.turns[3].shown += '\nHệ thống thì thầm vào tai anh: cẩn thận.'
    assert.ok(!m2.presentProblems(runs(person)).some((p) => p.rule === 'person'), 'mutant misses the person'); assert.ok(presentProblems(runs(person)).some((p) => p.rule === 'person'))
    const m3 = await mutant('quests', 'if (!done) out.push', 'if (false) out.push')
    const none3 = goodRun(); none3.turns.forEach((t) => { t.hist = '[]'; t.quest = '' })
    assert.deepEqual(m3.rewardedProblems(runs(none3)), []); assert.ok(rewardedProblems(runs(none3)).length)
    const m4 = await mutant('quests', "if (got !== (want.stats[k] || 0)) out.push", 'if (false) out.push')
    const unpaid = goodRun(); unpaid.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0, the_luc: 1001 } })
    assert.deepEqual(m4.rewardedProblems(runs(unpaid)), []); assert.ok(rewardedProblems(runs(unpaid)).length)
    // the script's own record: reading the paid amount from it, and the untracked-move rule, can each be removed and a test must notice
    const m8 = await mutant('quests', "const got = gains ? (paid.stats[k] || 0) : (net.stats[k] || 0)", 'const got = want.stats[k] || 0')
    const unpaidTicked = tickedRun(); unpaidTicked.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0 } }); unpaidTicked.turns[4].ticks = ''; unpaidTicked.turns[4].qlast = JSON.stringify({ turn: 5, id: 'q1', event: 'done', delta: { gains: [], hist: [] } })
    assert.deepEqual(m8.rewardedProblems(runs(unpaidTicked)), [], 'the mutant no longer sees the unpaid reward'); assert.ok(rewardedProblems(runs(unpaidTicked)).length)
    const m9 = await mutant('quests', "if (gains && (net.stats[k] || 0) !== 0) out.push", 'if (false) out.push')
    const untrackedMove = tickedRun(); untrackedMove.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0, the_luc: 1002 } })
    assert.deepEqual(m9.rewardedProblems(runs(untrackedMove)), []); assert.ok(rewardedProblems(runs(untrackedMove)).length)
    // L1: the declared gains held against the store; both Lua mutants must stop being caught when the new comparison is removed
    const m10 = await mutant('quests', "if (moved < declared || moved > declared + room) out.push({ rule: 'store-vs-gains', text: `${at}: quest ${e.id} ${e.state}: the script declares stat", "if (false) out.push({ rule: 'store-vs-gains', text: `${at}: quest ${e.id} ${e.state}: the script declares stat")
    const notAdded = tickedRun(); notAdded.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0 } }); notAdded.turns[4].ticks = ''
    assert.deepEqual(m10.rewardedProblems(runs(notAdded)), [], 'the mutant no longer sees gains that the store never got'); assert.ok(rewardedProblems(runs(notAdded)).length)
    const wrongBy = tickedRun(); wrongBy.turns.forEach((t, i) => { if (i >= 4) t.stats = { ...STATS0, the_luc: 1003 } }); wrongBy.turns[4].ticks = 'Thể lực 10.01% (+0.01)\nThể lực 10.02% (+0.01)\nThể lực 10.03% (+0.01)'
    assert.deepEqual(m10.rewardedProblems(runs(wrongBy)), [], 'nor a store that moved by another amount'); assert.ok(rewardedProblems(runs(wrongBy)).length)
    const m11 = await mutant('quests', 'if (moved < declared || moved > declared + room) out.push({ rule: \'store-vs-gains\', text: `${at}: quest ${e.id} ${e.state}: the script declares skill', "if (false) out.push({ rule: 'store-vs-gains', text: `${at}: quest ${e.id} ${e.state}: the script declares skill")
    const skNot = tickedRun(); skNot.turns.forEach((t, i) => { t.quest = t.quest ? JSON.stringify({ id: 'q1', state: 'active', reward: { kind: 'skill', id: 'nghe-nhip-buoc', amount: 1 } }) : ''; t.stats = { ...STATS0 }; t.ticks = ''; t.skills = { 'nghe-nhip-buoc': { m: 400, eq: 1, link: ['cam_nhan'], name: 'Nghe nhịp bước' } }; if (i >= 4) t.hist = JSON.stringify([{ id: 'q1', state: 'done', reward: { kind: 'skill', id: 'nghe-nhip-buoc', amount: 1 } }]) })
    skNot.turns[4].qlast = JSON.stringify({ turn: 5, id: 'q1', event: 'done', delta: { gains: [{ key: 'k:nghe-nhip-buoc', before: 400, after: 401 }], hist: [] } })
    assert.deepEqual(m11.rewardedProblems(runs(skNot)), []); assert.ok(rewardedProblems(runs(skNot)).length)
    const m7 = await mutant('score', "return bad.length ? { status: 'FAIL'", "return false ? { status: 'FAIL'")
    const sheets = [{ label: 'g1.1', reply: '- Đồng hành: Không\n- a: 1\n- b: 2\n- c: 3\n- d: 4' }]
    const args = { companions: [], declaredNone: true, sheets, replies: ['Đồng hành: Evelyn'] }
    assert.equal(m7.companionMatchResult(args).status, 'N/A', 'the mutant skips although a companion is in the prose'); assert.equal(companionMatchResult(args).status, 'FAIL')
    const m5 = await mutant('quests', "if (cur && prev && cur.id !== prev.id", 'if (false && cur && prev && cur.id !== prev.id')
    const two = goodRun(); two.turns[2].quest = JSON.stringify({ id: 'q2', state: 'active', reward: REWARD })
    assert.ok(!m5.trackedProblems(runs(two)).some((p) => p.rule === 'two-active')); assert.ok(trackedProblems(runs(two)).some((p) => p.rule === 'two-active'))
    const m6 = await mutant('quests', "if (!seen) out.push", 'if (false) out.push')
    const silent = goodRun(); silent.turns[1].shown = PROSE
    assert.deepEqual(m6.offeredProblems(runs(silent)), []); assert.ok(offeredProblems(runs(silent)).length)
})
