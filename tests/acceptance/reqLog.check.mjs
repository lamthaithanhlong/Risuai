// node --test --test-force-exit tests/acceptance/reqLog.check.mjs (an idle keep-alive socket holds node open): the request-token proxy counts the lore message's books and facts apart and forwards untouched
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'http'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { splitRequest, startReqLog, summarise, tok } from './lib/reqLog.mjs'

const books = 'Shadow Slave lore book one. '.repeat(40)
const facts = '[Facts the librarian checked for this scene. FACT / RUMOR]\nFACT: Sunny lives in the Academy.\nRUMOR: Mordret is his kin.'
const loreMsg = { role: 'user', content: ['system: [Lore for this scene]', books.trim(), facts].join('\n\n') }
const body = { model: 'story', messages: [{ role: 'system', content: 'You are the narrator.' }, loreMsg, { role: 'user', content: 'Tôi đi tới cổng.' }] }

test('splitRequest: books and facts are counted apart, the rest is not lore', () => {
    const s = splitRequest(body)
    assert.equal(s.hasLore, true)
    assert.equal(s.facts, tok(facts))
    assert.equal(s.books, tok(['system: [Lore for this scene]', books.trim()].join('\n\n')))
    assert.ok(s.total > s.lore && s.lore === s.books + s.facts)
    assert.equal(s.system, tok('You are the narrator.'))
    assert.equal(s.total, s.system + s.lore + s.chat)
})

test('splitRequest: a request without the lore message has none', () => {
    const s = splitRequest({ model: 'x', messages: [{ role: 'user', content: 'hi' }] })
    assert.equal(s.hasLore, false)
    assert.equal(s.lore, 0)
})

test('proxy forwards the body and the answer unchanged and logs the narrator request', async () => {
    let seen = null
    const up = http.createServer(async (req, res) => { const c = []; for await (const x of req) c.push(x); seen = JSON.parse(Buffer.concat(c).toString()); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":1}') })
    await new Promise((r) => up.listen(0, '127.0.0.1', r))
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'reqlog-')), 'r.jsonl')
    const px = await startReqLog({ upstream: `http://127.0.0.1:${up.address().port}`, file })
    const r = await fetch(px.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal(await r.text(), '{"ok":1}')
    assert.deepEqual(seen, body)
    const sum = summarise(file)
    assert.equal(sum.narrator, 1)
    assert.equal(sum.meanFacts, tok(facts))
    await px.close(); up.close(); up.closeAllConnections()
})
