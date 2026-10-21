'use strict'
// decide() micro-bench (plan risu-npc-psych, S7): p50 / p95 over 50 solves of one scene, three ways:
//   today   no npc module at all (what the server did before)
//   0 npcs  the module on, nobody in the scene has a profile (the price of having it: one resolve per present person)
//   6 npcs  the module on, six profiled people in the scene (engine asp: the local fold, no sidecar)
// Usage: node server/node/story/npcs/build/bench.cjs [runs]      (needs clingo, ~/.risu-lan/clingo-venv)
const fs = require('fs')
const os = require('os')
const path = require('path')
const NODE = path.join(__dirname, '../../..')
const G = require(path.join(NODE, 'gmSolver.cjs'))
const { openStoryStore } = require(path.join(NODE, 'storyStore.cjs'))
const np = require(path.join(NODE, 'npcPsych.cjs'))

const RUNS = Number(process.argv[2]) || 50
if (!G.findClingo()) { console.error('clingo is not installed: nothing to measure'); process.exit(1) }
const names = ['Marek', 'Evelyn', 'Torben', 'Sasha', 'Ilya', 'Doran']
const tr = (open, consc, extra, agree, neuro) => ({ open, consc, extra, agree, neuro })
const seed = {
    world: 'shadow_slave', version: 1, built: '2026-10-21',
    npcs: names.map((n, i) => ({ id: n.toLowerCase(), name: n, importance: 80 - i, traits: tr(40 + i, 50, 30 + 6 * i, 30 + 8 * i, 60 - 5 * i), speech: ['warm', 'cold', 'blunt', 'terse', 'timid', 'formal'][i], wants_to_say: 'something said ' + i, wants_to_hide: i % 2 ? 'something hidden ' + i : null, hide_fid: null })),
    relations: names.flatMap((n, i) => [
        { p: n.toLowerCase(), q: 'player', trust: 25 + 10 * i, affection: 40 + 6 * i, debt: i * 8, grudge: 40 - 6 * i },
        ...names.filter((m) => m !== n).slice(0, 2).map((m) => ({ p: n.toLowerCase(), q: m.toLowerCase(), trust: 50, affection: 40, debt: 0, grudge: 10 })),
    ]),
}
const mk = (s) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'npc-bench-'))
    if (s) fs.writeFileSync(path.join(d, 'shadow_slave.json'), JSON.stringify(s))
    const store = openStoryStore({ dbFile: ':memory:' })
    return np.openNpcPsych({ db: store.db, npcDir: d, engine: 'asp' })
}
const vars = {
    st_name: 'Kenji Park', st_place: 'Khu chợ',
    gm_arc: 'phe đang nắm quyền | người cầm gậy | chứng minh lòng trung thành | chỗ đứng',
    gm_threats: 'Ba kẻ lạ mặt | 3/4 | xông vào', gm_enemies: 'người cầm gậy | muốn lục soát Kenji',
    led_rel: names.map((n) => `${n} | Kenji Park | ally`).join('\n'),
    led_ev: 'Đêm mưa | Kenji tỉnh lại ở bến cảng',
    led_soc: ['1 | player | help | Marek', '2 | player | gift | Evelyn', '2 | Torben | insult | player', '3 | player | save | Sasha', '3 | Ilya | lie | player', '3 | player | promise_broken | Doran'].join('\n'),
}
const scene = (withNames) => ({
    chatId: 'bench1', world: 'shadow_slave', phase: 'run', vars, dice: { pace: 'quiet', cardNew: true }, kinds: ['a stranger'], stance: 'friendly',
    messages: [{ role: 'char', text: (withNames ? names.join(', ') + ' đứng quanh sạp cá. ' : 'Sạp cá vắng. ') + 'Ba kẻ lạ mặt đứng ở cổng.' }, { role: 'user', text: 'Kenji nhìn quanh chợ.' }],
})
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)] }
async function run(label, input, opts) {
    for (let i = 0; i < 5; i++) await G.decide(input, { budgetMs: 5000, ...opts })        // warm: file cache, JIT
    const ms = []
    let people = 0
    for (let i = 0; i < RUNS; i++) {
        const t0 = process.hrtime.bigint()
        const r = await G.decide(input, opts)
        ms.push(Number(process.hrtime.bigint() - t0) / 1e6)
        if (r.status !== 'ok') throw new Error(`${label}: ${r.status} ${r.reason}`)
        people = r.npc?.actions?.length ?? 0
    }
    console.log(`${label.padEnd(28)} p50 ${pct(ms, 0.5).toFixed(1).padStart(6)} ms   p95 ${pct(ms, 0.95).toFixed(1).padStart(6)} ms   max ${Math.max(...ms).toFixed(1).padStart(6)} ms   (${RUNS} solves, ${people} people with a social act)`)
    return pct(ms, 0.95)
}
;(async () => {
    const none = mk(null), six = mk(seed)
    const today = await run('today (no module)', scene(true), {})
    const zero = await run('module, 0 profiled present', scene(false), { npc: six })
    const zeroNames = await run('module, names but no profile', scene(true), { npc: none })
    const withSix = await run('module, 6 profiled present', scene(true), { npc: six })
    console.log(`\ngate: p95 with 6 profiled people < 120 ms: ${withSix < 120 ? 'ok' : 'FAIL'}; 0 profiled p95 ${zero.toFixed(1)} / ${zeroNames.toFixed(1)} vs today ${today.toFixed(1)} ms`)
    process.exit(withSix < 120 ? 0 : 1)
})()
