// node --test tests/acceptance/npcDialogue.check.mjs : the npc.dialogue judge with a stubbed model (no model is called).
// The real-model red/green proof is npcDialogue.live.mjs (one judge call per set, the acceptance runs' judge slot).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import { npcLines, dialoguePrompt, parseDialogue, scoreDialogue, judgeDialogue } from './lib/npcDialogue.mjs'

const fx = JSON.parse(fs.readFileSync(new URL('./fixtures/owner-chats/npc-dialogue-704.json', import.meta.url), 'utf8'))
const verdict = (i, bad = []) => ({ i, grammar: !bad.includes('grammar'), whole: !bad.includes('whole'), address: !bad.includes('address'), motive: !bad.includes('motive'), hook: !bad.includes('hook'), consistent: !bad.includes('consistent'), natural: !bad.includes('natural'), why: bad.length ? 'x' : '' })

test('npcLines: the two balcony lines, in order, with their paragraph', () => {
    const l = npcLines(fx.balcony_bad, { player: fx.player })
    assert.deepEqual(l.map((x) => x.line), ['Đừng gọi ai. Tôi bị kính cửa thôi.', 'Anh có thuốc giảm đau không?'])
    assert.ok(l[1].para.includes('Cô nuốt khan'))
})

test('npcLines: the player\'s own speech (before or after the quote) and Admin lines are not NPC lines', () => {
    const l = npcLines(fx.player_speech, { player: fx.player })
    assert.deepEqual(l.map((x) => x.line), ['Tôi ổn mà, cảm ơn anh đã hỏi.'])
})

test('prompt names the five checks, the 704 example and the telegram example', () => {
    const p = dialoguePrompt(npcLines(fx.balcony_bad, { player: fx.player }), { listener: fx.listener })
    for (const k of ['grammar:', 'whole:', 'address:', 'motive:', 'hook:', 'consistent:', 'natural:', 'npc-quest-hook', 'npc-contradicts-need', 'Kisaragi Cũ', 'kính cửa', 'telegram', fx.listener]) assert.ok(p.includes(k), k)
})

test('parseDialogue: fenced JSON with prose around it; a line failing any check fails', () => {
    const items = npcLines(fx.balcony_bad, { player: fx.player })
    const raw = 'Sure:\n```json\n' + JSON.stringify({ lines: [verdict(0, ['grammar', 'whole']), verdict(1, ['motive'])] }) + '\n```'
    const p = parseDialogue(raw, items)
    assert.deepEqual(p.lines.map((l) => l.verdict), ['fail', 'fail'])
    assert.deepEqual(p.lines[0].failed, ['grammar', 'whole'])
})

test('parseDialogue: a skipped line, a bad index, a duplicate or a missing boolean is unjudged, never a pass', () => {
    const items = npcLines(fx.telegram_bad, { player: fx.player })
    assert.equal(items.length, 3)
    const half = { ...verdict(1) }; delete half.natural
    const p = parseDialogue(JSON.stringify({ lines: [verdict(0), verdict(0, ['whole']), half, verdict(7)] }), items)
    assert.deepEqual(p.lines.map((l) => l.verdict), ['pass', 'unjudged', 'unjudged'])
    const s = scoreDialogue(p)
    assert.equal(s.ok, false, 'an unjudged line keeps the scorer red')
    assert.equal(parseDialogue('not json', items).lines.every((l) => l.verdict === 'unjudged'), true)
})

test('scoreDialogue: red above the fail rate, green at or below it; counts per check', () => {
    const items = [{ line: 'a', para: 'a' }, { line: 'b', para: 'b' }, { line: 'c', para: 'c' }, { line: 'd', para: 'd' }, { line: 'e', para: 'e' }]
    const red = scoreDialogue(parseDialogue(JSON.stringify({ lines: [verdict(0, ['whole']), verdict(1, ['whole', 'address']), verdict(2), verdict(3), verdict(4)] }), items))
    assert.equal(red.ok, false)
    assert.equal(red.rate, 0.4)
    assert.deepEqual(red.byCheck, { grammar: 0, whole: 2, address: 1, motive: 0, hook: 0, consistent: 0, natural: 0 })
    const green = scoreDialogue(parseDialogue(JSON.stringify({ lines: [verdict(0, ['natural']), verdict(1), verdict(2), verdict(3), verdict(4)] }), items))
    assert.equal(green.ok, true)
    assert.equal(green.name, 'npc.dialogue')
})

test('judgeDialogue: the injected model gets the model name without "claude:" and the prompt; no NPC line, no call', async () => {
    const calls = []
    const ask = async (model, prompt) => { calls.push({ model, prompt }); return JSON.stringify({ lines: [verdict(0, ['grammar']), verdict(1, ['motive'])] }) }
    const out = await judgeDialogue([fx.balcony_bad], { ask, player: fx.player, listener: fx.listener })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].model, 'sonnet')
    assert.ok(calls[0].prompt.includes('Tôi bị kính cửa thôi.'))
    assert.equal(out.score.ok, false)
    const none = await judgeDialogue(['Hành lang im lặng.'], { ask, player: fx.player })
    assert.equal(calls.length, 1)
    assert.equal(none.score.ok, true)
    assert.equal(none.score.total, 0)
})

test('npc-quest-hook: the Kisaragi Cũ line failing hook is reported under that rule; the arm line passes', () => {
    const items = npcLines(fx.hook_bad + '\n\n' + fx.hook_good, { player: fx.player })
    assert.deepEqual(items.map((x) => x.line), ['Có một phòng khám gần Kisaragi Cũ… nếu anh tìm được thuốc ở đó, tôi sẽ tin lời anh hơn.', 'Cánh tay tôi bị cứa. Tôi cần thuốc hạ sốt, hoặc thứ gì đó để rửa vết thương.'])
    const s = scoreDialogue(parseDialogue(JSON.stringify({ lines: [verdict(0, ['hook']), verdict(1)] }), items))
    assert.equal(s.byRule['npc-quest-hook'], 1)
    assert.equal(s.ok, false)
    assert.ok(s.examples[0].includes('hook'))
})

test('npc-contradicts-need: a line of the second reply carries the first reply as context; failing consistent reports that rule', async () => {
    let prompt = ''
    const ask = async (m, p) => { prompt = p; return JSON.stringify({ lines: [verdict(0), verdict(1, ['consistent']), verdict(2)] }) }
    const out = await judgeDialogue([fx.contra_prev, fx.contra_bad], { ask, player: fx.player })
    assert.ok(prompt.includes('EARLIER IN THE SCENE') && prompt.includes('Tôi cần thuốc hạ sốt'))
    assert.equal(prompt.split('EARLIER IN THE SCENE').length, 2, 'the earlier reply is shown once')
    assert.equal(out.lines[1].line, 'Vậy anh giữ lại mà dùng. Tôi chỉ xin thuốc giảm đau.')
    assert.equal(out.score.byRule['npc-contradicts-need'], 1)
    assert.equal(out.score.ok, false)
})

test('npcLines: a reply opening with a bare-quote paragraph (the player\'s echoed words) does not count it as an NPC line', () => {
    assert.deepEqual(npcLines(fx.contra_good, { player: fx.player }).map((x) => x.line), ['Anh còn thuốc giảm đau không? Tay tôi đau lắm.'])
})
