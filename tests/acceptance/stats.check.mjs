// node --test tests/acceptance/stats.check.mjs : each growth scorer must pass its good fixture and go RED on the broken twin
// (fixtures/stats/*.json), and a scorer that can never go red is caught by mutating its source.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseTicks, ticksProblems, consistentProblems, leakProblems, capProblems, equippedProblems, statsChecks, slotsFor } from './lib/stats.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const fx = (n) => JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'stats', n + '.json'), 'utf8')).runs
const rules = (ps) => [...new Set(ps.map((p) => p.rule))].sort()
const SRC = fs.readFileSync(path.join(HERE, 'lib', 'stats.mjs'), 'utf8')
async function mutant(from, to) {
    assert.ok(SRC.includes(from), `mutation target missing: ${from}`)
    const f = path.join(HERE, 'lib', `.stats.mut.${process.pid}.${Math.random().toString(36).slice(2)}.mjs`)
    fs.writeFileSync(f, SRC.replace(from, to))
    try { return await import(f + '?x=' + Math.random()) } finally { fs.unlinkSync(f) }
}
const ALL = [ticksProblems, consistentProblems, leakProblems, capProblems, equippedProblems]

test('tick parser: stat and skill lines, markdown noise, junk', () => {
    const t = parseTicks('Sức mạnh 23.47% (+0.01)\n**Thành thạo Nghe nhịp bước 12.34% (+0.01)**\nchữ thường\nThể lực 5,00 % (+0,01)')
    assert.deepEqual(t.map((x) => [x.kind, x.key ?? x.name, x.value, x.delta]), [['stat', 'suc_manh', 2347, 1], ['skill', 'Nghe nhịp bước', 1234, 1], ['stat', 'the_luc', 500, 1]])
    assert.deepEqual(parseTicks(''), [])
    assert.equal(slotsFor(1499), 1); assert.equal(slotsFor(1500), 2); assert.equal(slotsFor(7500), 6); assert.equal(slotsFor(10000), 6)
})

test('good fixture: every scorer passes', () => {
    for (const f of ALL) assert.deepEqual(f(fx('good')), [], f.name)
    assert.deepEqual(statsChecks(fx('good')).map((c) => c.status), ['PASS', 'PASS', 'PASS', 'PASS', 'PASS'])
})

test('stats.ticks: no skill tick is red; too few turns; no stat tick', () => {
    assert.deepEqual(rules(ticksProblems(fx('no-skill-tick'))), ['no-skill-tick'])
    assert.ok(rules(ticksProblems(fx('good').map((r) => ({ ...r, turns: r.turns.slice(0, 20) })))).includes('too-few-turns'))
    const noStat = fx('good').map((r) => ({ ...r, turns: r.turns.map((t) => ({ ...t, ticks: t.ticks.split('\n').filter((l) => /Thành thạo/.test(l)).join('\n') })) }))
    assert.deepEqual(rules(ticksProblems(noStat)), ['no-stat-tick'])
    assert.ok(rules(ticksProblems([])).length === 0, 'no runs: statsChecks handles it')
    assert.equal(statsChecks([])[0].status, 'FAIL', 'no runs is not a pass')
})

test('stats.consistent: a gain without a tick and a tick without a gain are red', () => {
    const p = consistentProblems(fx('inconsistent-value'))
    assert.deepEqual(rules(p), ['gain-without-tick', 'tick-without-gain'])
    assert.match(p.find((x) => x.rule === 'gain-without-tick').text, /run 1 turn 20: Sức mạnh went/)
    assert.match(p.find((x) => x.rule === 'tick-without-gain').text, /run 2 turn 9/)
    const wrong = fx('good'); wrong[0].turns[2].ticks = 'Sức mạnh 10.09% (+0.01)'      // the tick shows a value other than the stored one
    assert.ok(rules(consistentProblems(wrong)).includes('tick-value'))
    const bare = fx('good'); for (const t of bare[0].turns) delete t.stats
    assert.deepEqual(rules(consistentProblems(bare)), ['no-state'])
})

test('stats.noLeak: whole tag, partial tag in the stored message, +0.01 and "Bạn nhận được", a percent are red; the panel line itself is fine', () => {
    const p = leakProblems(fx('leaked-tag'))
    assert.deepEqual(rules(p), ['number-in-prose', 'tag-visible'])
    assert.ok(p.some((x) => x.rule === 'tag-visible' && /run 1 turn 7 \(shown\)/.test(x.text)))
    assert.ok(p.some((x) => x.rule === 'tag-visible' && /run 2 turn 5 \(stored\)/.test(x.text)))
    assert.ok(p.some((x) => /run 3 turn 4/.test(x.text)) && p.some((x) => /run 4 turn 6/.test(x.text)))
    assert.ok(fx('good')[0].turns[2].shown.includes('(+0.01)'), 'the good fixture does show tick lines')
    for (const bit of ['[[BREAK|y_chi]]', '[[B', '[[ ACT|x']) { const g = fx('good'); g[0].turns[0].shown += bit; assert.ok(rules(leakProblems(g)).includes('tag-visible'), bit) }
})

test('stats.cap: over the soft cap without a BREAK, over 100, slots over $slots and wrong $slots are red; a BREAK allows the soft cap', () => {
    const p = capProblems(fx('over-cap'))
    assert.deepEqual(rules(p), ['over-hard-cap', 'over-soft-cap'])
    assert.match(p.find((x) => x.rule === 'over-soft-cap').text, /run 1 turn 6/)
    assert.match(p.find((x) => x.rule === 'over-hard-cap').text, /run 2 turn 3/)
    assert.ok(!p.some((x) => /run 2/.test(x.text) && x.rule === 'over-soft-cap'), 'run 2 has a BREAK recorded')
    const s = capProblems(fx('slots-over'))
    assert.deepEqual(rules(s), ['slots-over', 'slots-wrong'])
    assert.match(s.find((x) => x.rule === 'slots-over').text, /run 1 turn 16/)
    assert.match(s.find((x) => x.rule === 'slots-wrong').text, /run 2 turn 3.*gives 3/)
    const link = fx('good'); link[0].turns[20].skills = link[0].turns[20].skills.replace('"m":3', '"m":3600'); link[0].turns[20].stats = link[0].turns[20].stats
    assert.ok(rules(capProblems(link)).includes('skill-over-link'))
    const rank2 = fx('over-cap').slice(0, 1).map((r) => ({ ...r, turns: r.turns.map((t) => ({ ...t, rank: '2' })) }))
    assert.deepEqual(capProblems(rank2), [], 'rank 2 has soft cap 60')
    const noSlots = fx('good'); delete noSlots[0].turns[3].slots
    assert.deepEqual(rules(capProblems(noSlots)), ['no-slots'])
})

test('stats.equipped: mastery climbing on a skill that was never equipped is red', () => {
    const p = equippedProblems(fx('unequipped-gain'))
    assert.deepEqual(rules(p), ['unequipped-gain'])
    assert.match(p[0].text, /run 1 turn 17/)
    assert.deepEqual(rules(consistentProblems(fx('unequipped-gain'))), [], 'the numbers are consistent: only the equipped rule is broken')
})

test('statsChecks: shape, and each broken fixture turns exactly its own check FAIL', () => {
    assert.deepEqual(statsChecks(fx('good')).map((c) => c.id), ['stats.ticks', 'stats.consistent', 'stats.noLeak', 'stats.cap', 'stats.equipped'])
    const st = (n) => Object.fromEntries(statsChecks(fx(n)).map((c) => [c.id, c.status]))
    assert.equal(st('no-skill-tick')['stats.ticks'], 'FAIL')
    assert.equal(st('inconsistent-value')['stats.consistent'], 'FAIL')
    assert.equal(st('leaked-tag')['stats.noLeak'], 'FAIL')
    assert.equal(st('over-cap')['stats.cap'], 'FAIL')
    assert.equal(st('slots-over')['stats.cap'], 'FAIL')
    assert.equal(st('unequipped-gain')['stats.equipped'], 'FAIL')
})

test('stats.noLeak: the System bracket line may report the infection percent (card spec), nothing else', () => {
    const run = (shown) => [{ turns: [{ shown, reply: shown, raw: shown, ticks: '' }] }]
    const sys = '【HỆ THỐNG: KHÁCH-704 · Quyền truy cập: KHÁCH · Mức nhiễm: 3%.】'
    assert.deepEqual(leakProblems(run(`Một vệt chữ nhạt.\n${sys}\n【HỆ THỐNG: Chức năng khả dụng — QUÉT.】`)), [], 'the infection line of the card is fine')
    assert.deepEqual(rules(leakProblems(run('【HỆ THỐNG: Sức mạnh 23.47%.】'))), ['number-in-prose'], 'a stat percent in a System line is still a leak')
    assert.deepEqual(rules(leakProblems(run('【HỆ THỐNG: Mức nhiễm: 3%. Sức mạnh +0.01】'))), ['number-in-prose'], 'a tick in a System line is still a leak')
    assert.deepEqual(rules(leakProblems(run('Mức nhiễm của anh đã lên 3%.'))), ['number-in-prose'], 'the same words in plain prose are still a leak')
    assert.deepEqual(rules(leakProblems(run('Kenji thở dốc. Sức mạnh 12.34% sau cú đẩy.'))), ['number-in-prose'], 'a stat percent in the narration is red')
    assert.deepEqual(rules(leakProblems(run('【HỆ THỐNG: nhiễm 3%.】'))), ['number-in-prose'], 'only "Mức nhiễm N%" is exempt')
    assert.deepEqual(rules(leakProblems(run('【HỆ THỐNG: Thành thạo Nghe nhịp bước 12.34%.】'))), ['number-in-prose'], 'a mastery percent in a System line is red')
})

test('mutations: a scorer with its rule removed lets the broken fixture through (so the rule is what turns it red)', async () => {
    const slip = async (from, to, fn, fixture, rule) => {
        const runs = typeof fixture === 'string' ? fx(fixture) : fixture
        const m = await mutant(from, to)
        assert.ok(!m[fn](runs).some((p) => p.rule === rule), `mutant of ${fn} still reports ${rule}`)
        assert.ok(fn in m && ({ ticksProblems, consistentProblems, leakProblems, capProblems, equippedProblems })[fn](runs).some((p) => p.rule === rule), `the real ${fn} must report ${rule}`)
    }
    await slip("if (!all.some((t) => t.kind === 'skill')) out.push", 'if (false) out.push', 'ticksProblems', 'no-skill-tick', 'no-skill-tick')
    await slip("if (!all.some((t) => t.kind === 'stat')) out.push", 'if (false) out.push', 'ticksProblems', fx('good').map((r) => ({ ...r, turns: r.turns.map((t) => ({ ...t, ticks: t.ticks.split('\n').filter((l) => /Thành thạo/.test(l)).join('\n') })) })), 'no-stat-tick')
    await slip('if (got !== want) out.push({ rule: got > want ?', 'if (false) out.push({ rule: got > want ?', 'consistentProblems', 'inconsistent-value', 'gain-without-tick')
    await slip("if (m) out.push({ rule: 'tag-visible'", "if (false) out.push({ rule: 'tag-visible'", 'leakProblems', 'leaked-tag', 'tag-visible')
    {   // the infection allowance is what lets the card's System line through: without it the same text is red
        const sys = [{ turns: [{ shown: '【HỆ THỐNG: Mức nhiễm: 3%.】', reply: '', raw: '', ticks: '' }] }]
        const m = await mutant('const stripInfection = (line) => (/^\\s*【/.test(line) ? line.replace(INFECTION, \'\') : line)', 'const stripInfection = (line) => line')
        assert.deepEqual(leakProblems(sys), []); assert.ok(m.leakProblems(sys).some((p) => p.rule === 'number-in-prose'))
    }
    await slip('for (const re of PROSE) {', 'for (const re of []) {', 'leakProblems', 'leaked-tag', 'number-in-prose')
    await slip('&& !broken.has(k)) out.push', '&& false) out.push', 'capProblems', 'over-cap', 'over-soft-cap')
    await slip('if (v > HARD_CAP * 100) out.push', 'if (false) out.push', 'capProblems', 'over-cap', 'over-hard-cap')
    await slip('if (used > st.slots) out.push', 'if (false) out.push', 'capProblems', 'slots-over', 'slots-over')
    await slip('if (st.slots !== want) out.push', 'if (false) out.push', 'capProblems', 'slots-over', 'slots-wrong')
    await slip("Number(before.eq) !== 1 && Number(s?.eq) !== 1) out.push", 'false) out.push', 'equippedProblems', 'unequipped-gain', 'unequipped-gain')
    // a mutant that makes the scorer too lax in the other direction: counting a tick without a gain as fine
    const m = await mutant("const got = (Number(st.stats[k]) || 0) - prev[k]", 'const got = want')
    assert.ok(!m.consistentProblems(fx('inconsistent-value')).some((p) => p.rule === 'gain-without-tick' && /run 1/.test(p.text)))
})
