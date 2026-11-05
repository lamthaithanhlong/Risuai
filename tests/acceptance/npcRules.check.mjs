// node --test tests/acceptance/npcRules.check.mjs : npc.dialogue's deterministic rules on the owner's 704-balcony lines (no model).
// RED/GREEN per rule as in the design table (§5); the contradiction is read against the ledger the previous turn left.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import { npcChecks, npcTurnHits, playerOf } from './lib/npcRules.mjs'

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/owner-chats/npc-dialogue-704.json', import.meta.url), 'utf8'))
const player = playerOf('Kenji Park (nhân vật chính): nam, 25 tuổi')
const LEDGER = '9 | ban-cong-704 | meet Người phụ nữ ban công 704;tôi;anh;30s\n10 | ban-cong-704 | recv thuốc giảm đau\n11 | ban-cong-704 | need+ thuốc hạ sốt\n11 | ban-cong-704 | need+ rửa vết thương\n11 | ban-cong-704 | trust low'
const rulesOf = (reply, prev = '', text = '') => npcTurnHits([{ shown: '', vars: { led_npc: prev } }, { shown: reply, text }], { player })[1].hits.filter((h) => !h.soft).map((h) => h.rule)

test('playerOf reads the persona name', () => assert.equal(player, 'Kenji Park'))

test('npc-grammar: RED balcony_bad and telegram_bad; GREEN balcony_good, hook_good, telegram_good', () => {
    assert.ok(rulesOf(fx.balcony_bad).includes('npc-grammar'))
    assert.ok(rulesOf(fx.telegram_bad).includes('npc-grammar'))
    for (const k of ['balcony_good', 'hook_good', 'telegram_good']) assert.ok(!rulesOf(fx[k]).includes('npc-grammar'), k)
})

test('npc-quest-hook: RED on the Kisaragi Cũ line, GREEN on the owner\'s “Cánh tay tôi bị cứa…” line', () => {
    assert.deepEqual(rulesOf(fx.hook_bad), ['npc-quest-hook'])
    assert.deepEqual(rulesOf(fx.hook_good), [])
})

test('npc-contradicts-need: RED on turn 13 after turn 11\'s ledger, GREEN on “Anh còn thuốc giảm đau không? Tay tôi đau lắm.”', () => {
    const said = 'thật ra tui có trong phòng 1 ít thuốc hạ sốt đấy'
    assert.ok(rulesOf(fx.contra_bad, LEDGER, said).includes('npc-contradicts-need'))
    assert.deepEqual(rulesOf(fx.contra_good, LEDGER, said), [])
    // without the state the contradiction cannot be seen (the reason the ledger exists): only the length rule is left
    assert.ok(!rulesOf(fx.contra_bad, '', said).includes('npc-contradicts-need'))
})

test('npc-address (owner popup a): RED on “Còn nhiều thuốc không?”, GREEN on “Anh còn thuốc không, cho em xin ít?”', () => {
    assert.deepEqual(rulesOf('Cô hỏi: “Còn nhiều thuốc không?”', LEDGER), ['npc-address'])
    assert.deepEqual(rulesOf('Cô hỏi: “Anh còn thuốc không, cho em xin ít?”', LEDGER), [])
})

test('owner popup (b): a refusal with distrust and a stated reason is GREEN, without the reason RED', () => {
    assert.deepEqual(rulesOf('Cô lùi lại. “Tôi chưa dám nhận đồ của người lạ, anh cứ giữ thuốc hạ sốt đi.”', LEDGER), [])
    assert.deepEqual(rulesOf('Cô lùi lại. “Anh cứ giữ thuốc hạ sốt đi.”', LEDGER), ['npc-contradicts-need'])
})

test('npc-exposition: RED on the owner\'s turn-15 line', () => {
    assert.deepEqual(rulesOf('Cô quay đi. “Tôi không biết ngoài kia chuyện gì xảy ra hơn anh đâu. Tôi chỉ đang cố giữ cánh tay này khỏi nhiễm trùng.”', LEDGER), ['npc-exposition'])
})

test('npcChecks: report-only is INFO whatever it finds; gating FAILs above 5% of lines and PASSes on clean runs', () => {
    const bad = [{ turns: [{ shown: fx.hook_bad }, { shown: fx.balcony_bad }] }]
    const ro = npcChecks(bad, { player })[0]
    assert.equal(ro.id, 'npc.dialogue')
    assert.equal(ro.status, 'INFO')
    assert.match(ro.summary, /npc-quest-hook 1/)
    assert.equal(npcChecks(bad, { player, gate: true })[0].status, 'FAIL')
    const good = [{ turns: [{ shown: fx.hook_good }, { shown: fx.telegram_good }, { shown: fx.contra_good }] }]
    const g = npcChecks(good, { player, gate: true })[0]
    assert.equal(g.status, 'PASS', g.summary)
})

test('npc-inner: the raw reply\'s inner line is read even though the shown reply has none', () => {
    const raw = 'Cô nhìn sang.\n[[NPC|ban-cong-704|đồ ăn|đói|chồng tôi bị cắn]]\n“Anh cứ giữ đồ ăn đi.”'
    const shown = 'Cô nhìn sang.\n“Anh cứ giữ đồ ăn đi.”'
    const hits = npcTurnHits([{ shown: '', vars: { led_npc: LEDGER } }, { shown, raw }], { player })[1].hits.map((h) => h.rule)
    assert.ok(hits.includes('npc-inner'), hits.join(','))
})
