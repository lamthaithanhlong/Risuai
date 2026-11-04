// node --test tests/acceptance/luaGate.check.mjs : the gate's copy must carry the candidate's Lua, and the check must go red when it does not.
// Each check is shown red once by mutating lib/luaGate.mjs (the mutant must differ from the real one in outcome).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { candidateLua, luaHashCheck, patchGateCopy } from './lib/luaGate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { openSaveStore } = require('../../server/node/saveStore.cjs')
const { hexKey } = require('../../server/node/remoteCardPatch.cjs')
const SRC = fs.readFileSync(path.join(HERE, 'lib', 'luaGate.mjs'), 'utf8')
async function mutant(from, to) {
    assert.ok(SRC.includes(from), `mutation target missing: ${from}`)
    const f = path.join(HERE, 'lib', `.luaGate.mut.${process.pid}.${Math.random().toString(36).slice(2)}.mjs`)
    fs.writeFileSync(f, SRC.replace(from, to))
    try { return await import(f + '?x=' + Math.random()) } finally { fs.unlinkSync(f) }
}

const lua = (comment, code) => ({ comment, type: 'output', conditions: [], effect: [{ type: 'triggerlua', code }], lowLevelAccess: false })
const CHA = 'fc27f53b-0000'
function fixture({ oldLua, newLua }) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lua-gate-'))
    const cand = path.join(dir, 'cand')
    fs.mkdirSync(cand)
    fs.writeFileSync(path.join(cand, 'x_fate.json'), JSON.stringify({ data: { description: 'd', extensions: { risuai: { triggerscript: newLua } } } }))
    const saveDir = path.join(dir, 'save')
    fs.mkdirSync(saveDir)
    const st = openSaveStore({ saveDir, backend: 'files' })
    const card = { name: 'Z', chaId: CHA, desc: 'old', globalLore: [], triggerscript: oldLua, chats: [{ id: 'c', message: [{ role: 'user', data: 'hi' }] }] }
    st.write(hexKey(CHA), Buffer.from(JSON.stringify(card)))
    return { dir, cand, saveDir, st, card }
}
const run = (fx, mod = { patchGateCopy }) => mod.patchGateCopy({ saveDir: fx.saveDir, prefix: 'fc27', candidateDir: fx.cand, lore: [{ comment: 'L', key: 'l', content: 'c' }], desc: 'new desc', backupDir: path.join(fx.dir, 'bk'), store: fx.st, id: CHA })
const OLD = [lua('Illustration generator', '-- OLD lua'), lua('Owner', '-- mine')]
const NEW = [lua('Status panel', '-- NEW stats.lua status.lua')]

test('gate copy: the candidate Lua lands, the hash matches, chats and unknown scripts stay', () => {
    const fx = fixture({ oldLua: OLD, newLua: NEW })
    try {
        const r = run(fx)
        assert.equal(r.luaHash.copy, r.luaHash.candidate)
        assert.equal(r.luaHash.candidate, candidateLua(fx.cand).hash)
        const c = JSON.parse(fx.st.read(hexKey(CHA)).toString())
        assert.deepEqual(c.triggerscript.map((s) => s.comment), ['Illustration generator', 'Owner', 'Status panel'])
        assert.equal(c.triggerscript[2].effect[0].code, '-- NEW stats.lua status.lua')
        assert.deepEqual(c.chats, fx.card.chats)
        assert.deepEqual(r.scripts.map((s) => [s.name, s.action]), [['Status panel', 'add'], ['Illustration generator', 'keep'], ['Owner', 'keep']])
    } finally { fx.st.close() }
})

test('gate copy: --lua-drop removes the renamed old script', () => {
    const fx = fixture({ oldLua: OLD, newLua: NEW })
    try {
        const r = patchGateCopy({ saveDir: fx.saveDir, prefix: 'fc27', candidateDir: fx.cand, lore: [{ comment: 'L', key: 'l', content: 'c' }], desc: 'd2', drop: ['Illustration generator'], backupDir: path.join(fx.dir, 'bk'), store: fx.st, id: CHA })
        assert.deepEqual(JSON.parse(fx.st.read(hexKey(CHA)).toString()).triggerscript.map((s) => s.comment), ['Owner', 'Status panel'])
        assert.equal(r.luaHash.copy, r.luaHash.candidate)
    } finally { fx.st.close() }
})

test('gate.lua check: equal PASS; different, missing script, nothing recorded all FAIL', () => {
    const ok = { candidate: 'a'.repeat(64), copy: 'a'.repeat(64), found: 1, of: 1 }
    assert.equal(luaHashCheck(ok).status, 'PASS')
    assert.equal(luaHashCheck({ ...ok, copy: 'b'.repeat(64) }).status, 'FAIL')
    assert.equal(luaHashCheck({ ...ok, found: 0 }).status, 'FAIL')
    assert.equal(luaHashCheck({}).status, 'FAIL')
    assert.equal(luaHashCheck({ candidate: ok.candidate }).status, 'FAIL')
})

test('RED: a hash comparison that cannot fail is caught (mutant lets a different hash through)', async () => {
    const m = await mutant("else if (copy !== candidate) problems.push", "else if (false) problems.push")
    const bad = { candidate: 'a'.repeat(64), copy: 'b'.repeat(64), found: 1, of: 1 }
    assert.equal(luaHashCheck(bad).status, 'FAIL')
    assert.equal(m.luaHashCheck(bad).status, 'PASS', 'the mutant must differ: the real check is what turns this red')
})

test('RED: a gate that patches only lore and desc (the old behaviour) throws instead of playing old Lua', async () => {
    const m = await mutant('lua: { scripts: cand.scripts, drop }', 'lua: undefined')
    const fx = fixture({ oldLua: [lua('Status panel', '-- OLD status lua')], newLua: NEW })
    try {
        assert.throws(() => run(fx, m), /not the candidate's|only 0 of/)
        assert.equal(JSON.parse(fx.st.read(hexKey(CHA)).toString()).triggerscript[0].effect[0].code, '-- OLD status lua')
    } finally { fx.st.close() }
})

test('a candidate whose built card ships no Lua is refused (nothing is wiped)', () => {
    const fx = fixture({ oldLua: OLD, newLua: [] })
    try {
        assert.throws(() => run(fx), /ships no triggerscript/)
        assert.deepEqual(JSON.parse(fx.st.read(hexKey(CHA)).toString()).triggerscript, OLD)
    } finally { fx.st.close() }
})
