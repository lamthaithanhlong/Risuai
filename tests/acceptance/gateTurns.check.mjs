// node --test tests/acceptance/gateTurns.check.mjs : what the gate types, and the no-Evelyn persona fixtures of the four stories.
// The Evelyn gate keeps its exact turns (history); a --system run never types Evelyn and plays <story>-system.md, which must declare `companion: none`.
// Every new rule is shown RED on a mutated copy of lib/gateTurns.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gateTurns, systemPersona, PERSONA_DIR } from './lib/gateTurns.mjs'
import { STORY_KEYS } from './stories.mjs'
import { companionMatchResult } from './lib/score.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = fs.readFileSync(path.join(HERE, 'lib', 'gateTurns.mjs'), 'utf8')
async function mutant(from, to) {
    assert.ok(SRC.includes(from), `mutation target missing: ${from}`)
    const f = path.join(HERE, 'lib', `.gateTurns.mut.${process.pid}.${Math.random().toString(36).slice(2)}.mjs`)
    fs.writeFileSync(f, SRC.replace(from, to))
    try { return await import(f + '?x=' + Math.random()) } finally { fs.unlinkSync(f) }
}
const EVELYN = /evelyn/i
const KEYS = ['zombie', 'mailman', 'ss', 'lotm']

test('the four stories are the four the System is built for', () => { assert.deepEqual([...STORY_KEYS].sort(), [...KEYS].sort()) })

test('the Evelyn gate keeps its exact turns (non-System runs are the history)', () => {
    assert.deepEqual(gateTurns({ key: 'zombie', hasPersona: true }), { creation: 'Hard. dùng persona kenji của tui', call1: 'evelyn', call2: 'Evelyn, nhìn thử ngoài hành lang giúp tôi xem có gì không.' })
    assert.equal(gateTurns({ key: 'zombie', hasPersona: false }).creation, 'Hard. dùng persona kenji của tui, ngoại hình để thế giới chọn')
})

test('a --system run never types Evelyn and talks to the System, in every story', () => {
    for (const key of KEYS) {
        const g = gateTurns({ key, system: true, hasPersona: true })
        for (const t of [g.creation, g.call1, g.call2]) assert.ok(!EVELYN.test(t), `${key}: «${t}»`)
        assert.match(g.call1, /Hệ thống/)
        assert.match(g.call2, /Hệ thống/)
    }
    assert.ok(!/kenji/i.test(gateTurns({ key: 'mailman', system: true }).creation), 'kenji is the zombie persona, not the others')
})

test('every story has a no-Evelyn persona fixture that declares companion: none', () => {
    for (const key of KEYS) {
        const fix = systemPersona(key)
        assert.equal(fix.companion, 'none', key)
        assert.ok(fix.text.length > 120 && /Năng lực/.test(fix.text), `${key}: a real persona`)
        assert.ok(!EVELYN.test(fix.text), `${key}: the persona names no Evelyn`)
        assert.ok(!/^\*\*[^*\n—:]{2,30}?\s*—/m.test(fix.text), `${key}: the persona names no companion line`)
    }
})

test('an undeclared or missing fixture stops the run before it starts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-'))
    try {
        fs.writeFileSync(path.join(dir, 'a.md'), 'Kenji: nam, 25 tuổi.\n')
        assert.throws(() => systemPersona('zombie', path.join(dir, 'a.md')), /companion: none/)
        assert.throws(() => systemPersona('mailman', null, path.join(dir, 'nowhere')), /no persona fixture/)
        fs.writeFileSync(path.join(dir, 'b.md'), 'companion: Evelyn\nKenji: nam.\n')
        assert.throws(() => systemPersona('zombie', path.join(dir, 'b.md')), /companion: none/, 'a named companion is not a declaration of none')
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a fixture that declares none makes companion.match N/A, and a companion in the record still goes red (the L1 rule, per story fixture)', () => {
    for (const key of KEYS) {
        const fix = systemPersona(key)
        const ok = companionMatchResult({ companions: [], declaredNone: fix.companion === 'none', sheets: [{ label: 'run 1', reply: 'Đồng hành: Không' }], replies: ['Anh bước ra hành lang.'] })
        assert.equal(ok.status, 'N/A', key)
        const bad = companionMatchResult({ companions: [], declaredNone: true, sheets: [{ label: 'run 1', reply: 'Đồng hành: Evelyn — hồn dẫn lối' }], replies: ['Anh bước ra hành lang.'] })
        assert.notEqual(bad.status, 'N/A', 'a companion in the record is not N/A')
    }
})

test('RED: the System turns mention Evelyn -> the no-Evelyn test would catch it', async () => {
    const m = await mutant("'Hệ thống, quét thử xung quanh giúp tôi xem có gì không.'", "'Evelyn, quét thử xung quanh giúp tôi xem có gì không.'")
    assert.ok(EVELYN.test(m.gateTurns({ key: 'mailman', system: true }).call2))
})

test('RED: the legacy turns change -> the history test would catch it', async () => {
    const m = await mutant("call1: 'evelyn',", "call1: 'Hệ thống',")
    assert.notEqual(m.gateTurns({ key: 'zombie', hasPersona: true }).call1, 'evelyn')
})

test('RED: undeclared fixture accepted -> the declaration test would catch it', async () => {
    const m = await mutant("fix.companion !== 'none'", 'false')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gt-'))
    try {
        fs.writeFileSync(path.join(dir, 'a.md'), 'Kenji: nam, 25 tuổi.\n')
        assert.doesNotThrow(() => m.systemPersona('zombie', path.join(dir, 'a.md')), 'the mutant lets it through')
        assert.throws(() => systemPersona('zombie', path.join(dir, 'a.md')))
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
