// node tests/acceptance/npcDialogue.live.mjs [--model claude:sonnet] [--out FILE]
// The npc.dialogue judge with the REAL model, the acceptance runs' judge slot (run.mjs --judge-model default claude:sonnet, a lean
// `claude -p` on the plan). One judge call per set, run one after another. RED sets are the owner's live lines and gate lines;
// GREEN sets are the same scenes rewritten. Exit 1 when a red set is not red on its rule, or a green set is not green.
import fs from 'fs'
import { judgeDialogue } from './lib/npcDialogue.mjs'

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d }
const model = arg('--model', 'claude:sonnet')
const out = arg('--out', '')
const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/owner-chats/npc-dialogue-704.json', import.meta.url), 'utf8'))
const opt = { model, player: fx.player, listener: fx.listener }

// [name, replies, expect]: expect 'green', or { line, check } = that line must fail that check (plus the set must be red)
const SETS = [
    ['balcony 704 (owner, as shown)', [fx.balcony_bad], { line: 'Đừng gọi ai. Tôi bị kính cửa thôi.', check: 'grammar' }],
    ['balcony 704 rewritten', [fx.balcony_good], 'green'],
    ['telegram (gate 11-05)', [fx.telegram_bad], { line: 'Tôi chỉ cần nước. Túi đồ rơi mất rồi. Cầu thang… có thứ đang lên.', check: 'whole' }],
    ['telegram rewritten', [fx.telegram_good], 'green'],
    ['quest hook (owner, Kisaragi Cũ)', [fx.hook_bad], { line: 'Có một phòng khám gần Kisaragi Cũ… nếu anh tìm được thuốc ở đó, tôi sẽ tin lời anh hơn.', check: 'hook' }],
    ['owner\'s good arm line', [fx.hook_good], 'green'],
    ['contradicts need (owner, turn 13)', [fx.contra_prev, fx.contra_bad], { line: 'Vậy anh giữ lại mà dùng. Tôi chỉ xin thuốc giảm đau.', check: 'consistent' }],
    ['consistent rewrite', [fx.contra_prev, fx.contra_good], 'green'],
]

const log = []
let bad = 0
for (const [name, replies, expect] of SETS) {
    const t0 = Date.now()
    const r = await judgeDialogue(replies, opt)
    let pass
    if (expect === 'green') pass = r.score.ok && r.lines.every((l) => l.verdict === 'pass')
    else {
        const row = r.lines.find((l) => l.line === expect.line)
        pass = !r.score.ok && !!row && row[expect.check] === false
    }
    if (!pass) bad++
    const rows = r.lines.map((l) => `   ${l.verdict.padEnd(8)} “${l.line}”${l.failed?.length ? ` [${l.failed.join(', ')}] ${l.why}` : ''}`)
    const head = `${pass ? 'OK  ' : 'MISS'} ${expect === 'green' ? 'GREEN' : 'RED  '} ${name}: ok=${r.score.ok} failed=${r.score.failed}/${r.score.total} rules=${JSON.stringify(Object.fromEntries(Object.entries(r.score.byRule).filter(([, n]) => n)))} ${Math.round((Date.now() - t0) / 1000)}s`
    console.log([head, ...rows].join('\n'))
    log.push({ name, expect, pass, score: r.score, lines: r.lines, raw: r.raw })
}
if (out) fs.writeFileSync(out, JSON.stringify({ model, at: new Date().toISOString(), log }, null, 1))
console.log(`${SETS.length - bad}/${SETS.length} sets as expected (model ${model})`)
process.exit(bad ? 1 : 0)
