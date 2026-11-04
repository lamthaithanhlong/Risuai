// node --test tests/acceptance/logicJudge.check.mjs : the causeless-effect judge (stubbed; no model is called)
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import { chatReplies, logicPrompt, parseLogic, judgeLogic } from './lib/logicJudge.mjs'

const chat = JSON.parse(fs.readFileSync(new URL('./fixtures/owner-chats/zombie-loa-rung-0204.json', import.meta.url), 'utf8'))
const BAD = 'Một tiếng cạ nhẹ ngoài cửa khiến loa điện thoại khẽ rung trong tay.'
const finding = (quote, reply = 2) => ({ reply, quote, cause: 'tiếng cạ nhẹ', effect: 'loa rung', why: 'a faint noise cannot shake a held phone' })

test('chatReplies: 3 char replies, bad sentence in index 2, markup stripped', () => {
    const r = chatReplies(chat)
    assert.equal(r.length, 3)
    assert.ok(r[2].includes(BAD))
    assert.ok(!r[1].includes('[[LOOK') && !r[2].includes('[💡'))
})

test('parseLogic keeps a verbatim quote', () => {
    const r = chatReplies(chat)
    const p = parseLogic(JSON.stringify({ findings: [finding(BAD)] }), r)
    assert.equal(p.findings.length, 1)
    assert.equal(p.rejected.length, 0)
})

test('parseLogic rejects a paraphrased quote', () => {
    const r = chatReplies(chat)
    const p = parseLogic(JSON.stringify({ findings: [finding('Tiếng cạ ngoài cửa làm loa điện thoại rung.')] }), r)
    assert.equal(p.findings.length, 0)
    assert.equal(p.rejected.length, 1)
})

test('prompt carries the verbatim-quote rule and the if-unsure rule', () => {
    const p = logicPrompt(['x'])
    assert.match(p, /verbatim/)
    assert.match(p, /If unsure, return nothing/)
})

test('prose around fenced JSON still parses (via judgeLogic with a stub)', async () => {
    const r = chatReplies(chat)
    const ask = async () => 'Here is my answer:\n```json\n' + JSON.stringify({ findings: [finding(BAD)] }) + '\n```\nHope that helps.'
    const out = await judgeLogic(r, { ask })
    assert.equal(out.findings.length, 1)
    assert.ok(out.raw.includes('Hope that helps'))
})
