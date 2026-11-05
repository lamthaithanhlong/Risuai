// node --test tests/acceptance/quest_goal.check.mjs : the quest.goal scorer (lib/quests.mjs goalProblems / questGoalChecks), NOT wired into questChecks or any
// gate until L1 approves it. Red on the vague fixture and on the quest as the live card offers it today, green on the complete one (the lines quests.lua of
// ZR quest-goal prints); the existing scorers (stats.noLeak, guide.noSpoiler system-text, system.present) are run on the same lines and are NOT loosened: the
// reward number of a quest line already passes them, "Mức nhiễm 3%" in Admin's words is still system text, and a number in an Admin line that is not a quest
// line is red here. A scorer rule that can never go red is caught by mutating its source.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { goalProblems, questGoalChecks, questChecks, vagueGoal, offerGoal } from './lib/quests.mjs'
import { leakProblems } from './lib/stats.mjs'
import { presentProblems, systemSpeech } from './lib/system.mjs'
import { guideNoSpoilerProblems } from './lib/narration.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const fx = (n) => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'quests', n), 'utf8')).runs
const rules = (ps) => [...new Set(ps.map((p) => p.rule))].sort()
const clone = (x) => JSON.parse(JSON.stringify(x))
const SRC = fs.readFileSync(path.join(HERE, 'lib', 'quests.mjs'), 'utf8')
async function mutant(from, to) {
    assert.equal(SRC.split(from).length - 1, 1, `mutation target missing or not unique: ${from}`)
    const f = path.join(HERE, 'lib', `.quests.mut.${process.pid}.${Math.random().toString(36).slice(2)}.mjs`)
    fs.writeFileSync(f, SRC.replace(from, to))
    try { return await import(f + '?x=' + Math.random()) } finally { fs.unlinkSync(f) }
}

test('GREEN: the complete fixture passes quest.goal', () => {
    const p = goalProblems(fx('goal-complete.json'))
    console.log('goal-complete.json ->', JSON.stringify(p))
    assert.deepEqual(p, [])
    assert.equal(questGoalChecks(fx('goal-complete.json'))[0].status, 'PASS')
})

test('RED: the vague fixture fails quest.goal on every missing part', () => {
    const p = goalProblems(fx('goal-vague.json'))
    console.log('goal-vague.json ->', JSON.stringify(p, null, 1))
    assert.deepEqual(rules(p), ['goal-no-condition', 'goal-no-deadline', 'goal-no-progress', 'goal-no-reward', 'goal-no-tier', 'goal-vague'])
    assert.equal(questGoalChecks(fx('goal-vague.json'))[0].status, 'FAIL')
})

test('RED: the quest exactly as the live card (admin-fix2 6dd500f) offers it', () => {
    const p = goalProblems(fx('goal-live-6dd500f.json'))
    console.log('goal-live-6dd500f.json ->', JSON.stringify(p, null, 1))
    assert.deepEqual(rules(p), ['goal-no-condition', 'goal-no-progress', 'goal-no-reward', 'goal-no-tier', 'goal-no-deadline', 'goal-vague'].sort())
})

test('each rule alone: break the complete fixture one part at a time', () => {
    const one = (f) => { const r = clone(fx('goal-complete.json')); f(r); return rules(goalProblems(r)) }
    const offer = (r) => r[0].turns[1]
    const qOf = (t) => JSON.parse(t.quest)
    const setQ = (r, f) => r[0].turns.forEach((t) => { if (t.quest) { const q = qOf(t); f(q); t.quest = JSON.stringify(q) } })
    const swap = (r, a, b) => r[0].turns.forEach((t) => { for (const k of ['shown', 'reply', 'panel']) if (typeof t[k] === 'string') t[k] = t[k].split(a).join(b) })
    assert.deepEqual(one((r) => swap(r, 'Tìm 2 chai nước sạch còn niêm phong trong các căn hộ của tầng đang trú.', 'Khám phá xung quanh.')), ['goal-vague'])
    assert.deepEqual(one((r) => swap(r, 'Tìm 2 chai nước sạch còn niêm phong trong các căn hộ của tầng đang trú.', 'Tìm cách sống sót trong toà nhà thêm vài ngày.')), ['goal-vague'])
    assert.deepEqual(one((r) => setQ(r, (q) => { delete q.need })), ['goal-no-condition'])
    assert.deepEqual(one((r) => { swap(r, 'Xong khi: đủ 2/2 chai. ', ''); swap(r, 'Tiến độ 0/2 chai', 'Tiến độ —'); swap(r, 'Tiến độ 1/2 chai', 'Tiến độ —') }), ['goal-no-condition', 'goal-no-progress'])
    assert.deepEqual(one((r) => { swap(r, ' · Tiến độ 1/2 chai', ''); swap(r, ' · Tiến độ 0/2 chai', '') }), ['goal-no-progress'])
    assert.deepEqual(one((r) => { swap(r, 'Thưởng: Cảm nhận +0.20, Thành thạo Lục soát +0.10. ', ''); swap(r, 'Thưởng Cảm nhận +0.20, Thành thạo Lục soát +0.10', 'Thưởng có') }), ['goal-no-reward'])
    assert.deepEqual(one((r) => { swap(r, 'Thưởng: Cảm nhận +0.20', 'Thưởng: tăng Cảm nhận'); swap(r, 'Thưởng Cảm nhận +0.20', 'Thưởng tăng Cảm nhận') }), ['goal-no-reward'], 'a reward in words only has no number')
    assert.deepEqual(one((r) => { swap(r, 'Thưởng: Cảm nhận +0.20', 'Thưởng: +20 Cảm nhận'); swap(r, 'Thưởng Cảm nhận +0.20', 'Thưởng +20 Cảm nhận') }), ['goal-no-reward'], 'a reward not in the panel unit ("+20 Cảm nhận") is not the number the panel shows')
    assert.deepEqual(one((r) => setQ(r, (q) => { q.reward.amount = 10 })), ['reward-not-promised'], 'Admin promises +0.20, the store declares 10 hundredths')
    assert.deepEqual(one((r) => setQ(r, (q) => { delete q.tier })), ['goal-no-tier'])
    assert.deepEqual(one((r) => { swap(r, ' Hạn: 10 lượt.', ''); swap(r, ' · Hạn còn 10/10 lượt', ''); swap(r, ' · Hạn còn 9/10 lượt', '') }), ['goal-no-deadline'])
    // proportional: the rất khó quest of run 2 paying less than the vừa quest of run 1 is red
    const r = clone(fx('goal-complete.json'))
    r[1].turns.forEach((t) => { if (t.quest) { const q = JSON.parse(t.quest); q.reward.amount = 10; q.reward.skill_amount = 0; t.quest = JSON.stringify(q) } for (const k of ['shown', 'reply', 'panel']) if (typeof t[k] === 'string') t[k] = t[k].replace('Sức mạnh +0.50, Thành thạo Lục soát +0.20', 'Sức mạnh +0.10') })
    assert.deepEqual(rules(goalProblems(r)), ['reward-not-proportional'])
})

test('the one relaxation is the quest line; everything else Admin writes stays as strict as before', () => {
    const good = fx('goal-complete.json')
    const offerLine = good[0].turns[1].shown.split('\n').pop()
    // existing scorers on the real quest line: unchanged code, already green (the reward "Cảm nhận +0.20" is not a percent, not +0.0n, not KHÁCH-n)
    assert.deepEqual(leakProblems(good), [], 'stats.noLeak passes the quest lines and panel rows')
    assert.deepEqual(guideNoSpoilerProblems(systemSpeech(offerLine)), [], 'guide.noSpoiler (system-text) passes the quest line')
    assert.deepEqual(presentProblems(good, 99).filter((p) => p.rule !== 'no-voice'), [], 'system.present passes')
    // still red: "Mức nhiễm 3%" in Admin's words (system-text, unchanged), also inside a quest line (quest.goal)
    const inf = '【ADMIN: Mức nhiễm 3%.】'
    assert.ok(guideNoSpoilerProblems(systemSpeech(inf)).some((p) => p.rule === 'system-text'), 'mức nhiễm 3% is still system text')
    const infQuest = clone(good); infQuest[0].turns[1].shown = infQuest[0].turns[1].shown.replace('Hạn: 10 lượt.', 'Hạn: 10 lượt. Mức nhiễm 3%.')
    assert.ok(guideNoSpoilerProblems(systemSpeech(infQuest[0].turns[1].shown)).some((p) => p.rule === 'system-text'), 'and inside a quest line too (system-text)')
    assert.ok(rules(goalProblems(infQuest)).includes('quest-line-system-text'), 'and quest.goal says so')
    const code = clone(good); code[0].turns[1].shown = code[0].turns[1].shown.replace('Hạn: 10 lượt.', 'Hạn: 10 lượt, KHÁCH-704.')
    assert.ok(rules(goalProblems(code)).includes('quest-line-system-text'), 'a KHÁCH-n code in a quest line is red')
    // why the bands start at +0.10: a +0.0N reward in the quest line is a stats.noLeak number-in-prose (that scorer is not loosened)
    const small = clone(good); small[0].turns[1].shown = small[0].turns[1].shown.replace('Cảm nhận +0.20', 'Cảm nhận +0.02')
    assert.deepEqual(rules(leakProblems(small)), ['number-in-prose'], 'a +0.02 reward would trip stats.noLeak')
    // still red: a growth or status number in an Admin line that is not a quest line (the reward outside the quest line, a stat value, a signed number, the
    // infection, the subject code)
    for (const line of ['【ADMIN: Thưởng: Cảm nhận +0.20.】', '【ADMIN: Thưởng: +2 Cảm nhận.】', '【ADMIN: Thể lực đang ở 10.02.】', '【ADMIN: Thành thạo Lục soát 0.10.】', '【ADMIN: Chủ thể KHÁCH-704.】', '【ADMIN: Mức nhiễm: 3%.】']) {
        const r = clone(good); r[0].turns[2].shown += '\n' + line
        assert.deepEqual(rules(goalProblems(r)), ['number-in-admin-line'], line)
    }
    // narrowed (L1, after the old gate records): a floor, a room, a date, a count of rooms, turns or metres is not a growth number
    for (const line of ['【ADMIN: Đã quét 3 phòng.】', '【ADMIN: Ngày 1 · 15 tháng 8 năm 2026, buổi sáng · Chung cư Kisaragi, căn 704.】', '【ADMIN: Hành lang tầng 6 trống trong 8 m; cửa chặn được 3 lượt.】', '【ADMIN: Sức mạnh nhích lên.】']) {
        const r = clone(good); r[0].turns[2].shown += '\n' + line
        assert.deepEqual(goalProblems(r), [], line)
    }
    // the shown and the stored reply carry the same line: one hit, not two
    const twice = clone(good); twice[0].turns[2].shown += '\n【ADMIN: Mức nhiễm: 3%.】'; twice[0].turns[2].reply += '\n【ADMIN: Mức nhiễm: 3%.】'
    assert.equal(goalProblems(twice).length, 1)
    // a non-Admin bracket line (QUÉT: a reading within about 10 m) keeps its own rules (guide.scout / range), quest.goal does not touch it
    assert.ok(good[0].turns[0].shown.includes('【QUÉT: Một chuyển động sau cửa, cách 8 m'))
})

test('helpers: the goal of an offer line, vague goals', () => {
    assert.equal(offerGoal('【ADMIN: Nhiệm vụ — Nước sạch: Tìm 2 chai nước sạch trong bếp. Xong khi: đủ 2/2 chai. Thưởng: Cảm nhận +0.20. Hạn: 10 lượt.】'), 'Tìm 2 chai nước sạch trong bếp.')
    assert.equal(offerGoal('【HỆ THỐNG: NHIỆM VỤ — Tìm nguồn nước sạch trong tòa nhà.】'), 'Tìm nguồn nước sạch trong tòa nhà.')
    assert.equal(vagueGoal('Hãy sống sót.'), 'too short')
    assert.equal(vagueGoal('Khám phá xung quanh toà nhà một lúc.'), 'no concrete verb')
    assert.equal(vagueGoal('Tìm 2 chai nước sạch còn niêm phong.'), 'no place')
    assert.equal(vagueGoal('Tìm cách sống sót trong toà nhà thêm vài ngày.'), 'vague')
    assert.equal(vagueGoal('Đi tới cầu thang B của toà nhà và xem lối thoát.'), '')
})

test('not in the gate: questChecks is unchanged (4 checks, no quest.goal)', () => {
    assert.deepEqual(questChecks(fx('goal-complete.json')).map((c) => c.id), ['quest.offered', 'quest.tracked', 'quest.rewarded', 'quest.hidden'])
})

test('mutation: each quest.goal rule can go red', async () => {
    const cases = [
        ["if (why) out.push({ rule: 'goal-vague'", "if (false) out.push({ rule: 'goal-vague'", 'goal-vague.json', 'goal-vague'],
        ["out.push({ rule: 'goal-no-condition', text: `${where}: no countable", "void ({ rule: 'x', text: `${where}: no countable", 'goal-vague.json', 'goal-no-condition'],
        ["if (!open.some((u) => /Tiến độ", "if (false && !open.some((u) => /Tiến độ", 'goal-vague.json', 'goal-no-progress'],
        ["if (!stated) out.push({ rule: 'goal-no-reward'", "if (!stated) void ({ rule: 'x'", 'goal-vague.json', 'goal-no-reward'],
        ["if (!(q.tier in TIERS)) out.push(", "if (false) out.push(", 'goal-vague.json', 'goal-no-tier'],
        ["&& !/(?<!\\p{L})Hạn(?!\\p{L})/u.test(window)) out.push(", "&& false) out.push(", 'goal-vague.json', 'goal-no-deadline'],
    ]
    for (const [from, to, file, rule] of cases) {
        const m = await mutant(from, to)
        assert.ok(rules(goalProblems(fx(file))).includes(rule), `the real scorer sees ${rule}`)
        assert.ok(!rules(m.goalProblems(fx(file))).includes(rule), `the mutant no longer sees ${rule}`)
    }
    const m = await mutant("else if (ADMIN_NUMBER.test(body)) out.push(", "else if (false) out.push(")
    const r = clone(fx('goal-complete.json')); r[0].turns[2].shown += '\n【ADMIN: Thể lực đang ở 10.02.】'
    assert.ok(!m.goalProblems(r).length && goalProblems(r).length, 'number-in-admin-line can be removed and a test notices')
    const m2 = await mutant("if (a.rank > b.rank && a.amount < b.amount)", "if (false)")
    const p = clone(fx('goal-complete.json'))
    p[1].turns.forEach((t) => { if (t.quest) { const q = JSON.parse(t.quest); q.reward.amount = 10; q.reward.skill_amount = 0; t.quest = JSON.stringify(q) } for (const k of ['shown', 'reply', 'panel']) if (typeof t[k] === 'string') t[k] = t[k].replace('Sức mạnh +0.50, Thành thạo Lục soát +0.20', 'Sức mạnh +0.10') })
    assert.ok(!m2.goalProblems(p).length && goalProblems(p).length, 'reward-not-proportional can be removed and a test notices')
})
