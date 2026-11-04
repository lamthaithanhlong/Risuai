// node --test tests/acceptance/finds.check.mjs : each finds scorer must pass its good fixture and go RED on the broken twin
// (fixtures/finds/*.json), and a scorer that can never go red is caught by mutating its source.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { actCounts, actLeaks, actChecks } from './lib/act.mjs'
import { fixLatin1Utf8 } from './lib/play.mjs'
import { parseFinds, fingerprint, slug, dropProblems, noRepeatProblems, naturalProblems, savedProblems, findsChecks, forCard, earlyFinds, DEFAULT_TOOLS } from './lib/finds.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FX = path.join(HERE, 'fixtures', 'finds')
const fx = (n) => JSON.parse(fs.readFileSync(path.join(FX, n + '.json'), 'utf8')).runs
const STUB = path.join(FX, 'stub_tools')
const store = (n) => path.join(FX, n)
const rules = (ps) => [...new Set(ps.map((p) => p.rule))]
const SRC = fs.readFileSync(path.join(HERE, 'lib', 'finds.mjs'), 'utf8')
/** finds.mjs with one exact piece of source replaced; it imports narration.mjs, so it is written beside it and loaded from there */
async function mutant(from, to) {
    assert.ok(SRC.includes(from), `mutation target missing: ${from}`)
    const f = path.join(HERE, 'lib', `.finds.mut.${process.pid}.${Math.random().toString(36).slice(2)}.mjs`)
    fs.writeFileSync(f, SRC.replace(from, to))
    try { return await import(f + '?x=' + Math.random()) } finally { fs.unlinkSync(f) }
}

test('block parser: well-formed, malformed, none', () => {
    const ok = '[[FIND|skill|Nghe nhịp bước|Stair Ear|Phân biệt bước chân.|common|Cần yên lặng.|yes]]'
    const b = parseFinds('abc\n' + ok + '\n[[STATUS\nx\n]]')
    assert.equal(b.length, 1); assert.ok(b[0].ok); assert.equal(b[0].find.name.en, 'Stair Ear'); assert.equal(b[0].find.portable, true)
    assert.equal(parseFinds('không có gì').length, 0)
    assert.equal(parseFinds('[[FIND|skill|a|b|c|common|d]]')[0].ok, false, '6 fields')
    assert.equal(parseFinds(ok.replace('common', 'mythic'))[0].ok, false, 'rarity enum')
    assert.equal(parseFinds(ok.replace('|yes', '|maybe'))[0].ok, false, 'portable enum')
    assert.equal(parseFinds('[[FIND|skill|a')[0].ok, false, 'unterminated')
    assert.equal(parseFinds({ choices: [{ message: { content: ok } }] }).length, 1, 'a response object is searched as JSON text')
})

test('fingerprint: accents, punctuation, case, stopwords, token order', () => {
    assert.equal(fingerprint('Night Vision Goggles'), fingerprint('night-vision goggles'))
    assert.equal(fingerprint('the night-vision goggles'), fingerprint('Night Vision Goggles'))
    assert.equal(fingerprint('Goggles of Night Vision'), fingerprint('Night Vision Goggles'))
    assert.equal(fingerprint('Café Key'), fingerprint('cafe key'))
    assert.notEqual(fingerprint('Night Vision Goggles'), fingerprint('Night Vision Scope'))
    assert.equal(slug('Night Vision Goggles!'), 'night-vision-goggles')
    assert.equal(slug('Đèn Pin'), 'den-pin')
})

test('fingerprint and slug cross-check against tools/assets/finds.py (skipped if the file is gone)', (t) => {
    const py = path.join(DEFAULT_TOOLS, 'finds.py')
    if (!fs.existsSync(py)) return t.skip(`${py} does not exist yet: nothing to cross-check, the JS rule follows the spec only`)
    const src = fs.readFileSync(py, 'utf8')
    assert.match(src, /def fingerprint\(/); assert.match(src, /def slug\(/)
    const names = ['Night Vision Goggles', 'night-vision goggles', 'the Night Vision Goggles', 'Goggles of Night Vision', 'Café Key', 'Stair Ear', "Guard's Whistle", 'Đèn Pin', 'A Pair of Boots', 'Hairpin  Picking!!', 'Ðồ Ngoại']
    const call = (fn) => JSON.parse(execFileSync('python3', ['-c', `import sys,json\nsys.path.insert(0,sys.argv[1])\nimport finds\nprint(json.dumps([finds.${fn}(n) for n in json.loads(sys.argv[2])]))`, DEFAULT_TOOLS, JSON.stringify(names)], { encoding: 'utf8' }))
    assert.deepEqual(names.map(fingerprint), call('fingerprint'), 'finds.mjs fingerprint() must equal finds.py fingerprint() exactly')
    assert.deepEqual(names.map(slug), call('slug'), 'finds.mjs slug() must equal finds.py slug() exactly')
})

test('finds.drop: good passes; two finds 3 turns apart and a run with none are red', () => {
    assert.deepEqual(dropProblems(fx('good')), [])
    assert.deepEqual(rules(dropProblems(fx('two-close'))), ['too-close'])
    assert.match(dropProblems(fx('two-close'))[0].text, /turns 5 and 8 \(3 apart/)
    assert.deepEqual(rules(dropProblems(fx('no-find'))), ['no-find'])
    const short = fx('good').map((r) => ({ turns: r.turns.slice(0, 12) }))
    assert.ok(rules(dropProblems(short)).includes('too-few-turns'), 'under 20 story turns is red')
    assert.deepEqual(earlyFinds(fx('good')), [])
})

test('finds.noRepeat: good passes; the same English name with another Vietnamese name is red', () => {
    assert.deepEqual(noRepeatProblems(fx('good')), [])
    const p = noRepeatProblems(fx('repeat'))
    assert.deepEqual(rules(p), ['repeat'])
    assert.match(p[0].text, /run 2 turn 6: .* repeats run 1 turn 15/)
})

test('finds.natural: good passes; popup, visible block, malformed block are red', () => {
    assert.deepEqual(naturalProblems(fx('good')), [])
    assert.deepEqual(rules(naturalProblems(fx('popup'))).filter((r) => r === 'popup'), ['popup'])
    assert.deepEqual(rules(naturalProblems(fx('block-visible'))), ['block-visible'])
    assert.deepEqual(rules(naturalProblems(fx('malformed'))), ['malformed'])
    const two = fx('good'); two[0].turns[4].raw += '\n[[FIND|item|Cái đinh|Rusty Nail|Một cái đinh gỉ.|common|Không có.|no]]'
    assert.ok(rules(naturalProblems(two)).includes('many-blocks'))
    const sys = fx('good'); sys[0].turns[2].shown += ' [Hệ thống: nhận kỹ năng mới]'
    assert.ok(rules(naturalProblems(sys)).includes('popup'))
    const plus = fx('good'); plus[1].turns[2].shown += '\n+ Skill mới: Gì đó'
    assert.ok(rules(naturalProblems(plus)).includes('popup'))
    const setup = fx('good'); setup[2].turns[3].shown += '\n[💡Kế hoạch| x ]'
    assert.ok(rules(naturalProblems(setup)).some((r) => r.startsWith('narration-')), 'narration.clean still runs inside finds.natural')
})

test('finds.saved: good store passes (stub loader); missing field, missing file, loader without the find are red', () => {
    const o = { toolsDir: STUB, storeDir: store('store-good') }
    assert.deepEqual(savedProblems(fx('good'), o), [])
    assert.deepEqual(rules(savedProblems(fx('good'), { ...o, storeDir: store('store-missing-field') })), ['missing-field'])
    assert.deepEqual(rules(savedProblems(fx('good'), { ...o, storeDir: store('store-partial') })).sort(), ['not-saved'])
    assert.ok(rules(savedProblems(fx('good'), { ...o, storeDir: path.join(FX, 'stub_tools') })).includes('not-saved'), 'a store without the records is red')
    assert.deepEqual(rules(savedProblems(fx('no-find'), o)), [], 'no-find fixture still has finds in runs 1 and 3, which are stored')
    assert.deepEqual(rules(savedProblems(fx('good'), { toolsDir: STUB })), ['no-store'])
    // the non-portable find must not load into another card, but loads into its own
    const names = forCard('fate', store('store-good'), STUB).map((a) => a.title)
    assert.ok(names.includes('Thu được: Kính nhìn đêm cũ')); assert.ok(!names.includes('Thu được: Chìa khóa kho Kisaragi'))
    assert.ok(forCard('zombie', store('store-good'), STUB).some((a) => a.title === 'Thu được: Chìa khóa kho Kisaragi'))
})

test('finds.saved against the real shared_assets.for_card (skipped until the loader knows finds)', (t) => {
    const src = fs.existsSync(path.join(DEFAULT_TOOLS, 'shared_assets.py')) ? fs.readFileSync(path.join(DEFAULT_TOOLS, 'shared_assets.py'), 'utf8') : ''
    if (!/finds/.test(src)) return t.skip('shared_assets.py has no finds loading yet: only the stub loader is exercised')
    assert.deepEqual(savedProblems(fx('good'), { storeDir: store('store-good'), otherCard: 'fate' }), [])
    assert.deepEqual(rules(savedProblems(fx('good'), { storeDir: store('store-partial'), otherCard: 'fate' })), ['not-saved'])
})

test('findsChecks: shape, all PASS on good, the four go FAIL on their fixtures', () => {
    const o = { toolsDir: STUB, storeDir: store('store-good') }
    const ok = findsChecks(fx('good'), o)
    assert.deepEqual(ok.map((c) => c.id), ['finds.drop', 'finds.noRepeat', 'finds.natural', 'finds.saved', 'finds.early'])
    assert.deepEqual(ok.map((c) => c.status), ['PASS', 'PASS', 'PASS', 'PASS', 'INFO'])
    const st = (n, extra) => Object.fromEntries(findsChecks(fx(n), { ...o, ...extra }).map((c) => [c.id, c.status]))
    assert.equal(st('two-close')['finds.drop'], 'FAIL')
    assert.equal(st('no-find')['finds.drop'], 'FAIL')
    assert.equal(st('repeat')['finds.noRepeat'], 'FAIL')
    assert.equal(st('popup')['finds.natural'], 'FAIL')
    assert.equal(st('block-visible')['finds.natural'], 'FAIL')
    assert.equal(st('good', { storeDir: store('store-partial') })['finds.saved'], 'FAIL')
    assert.equal(findsChecks([], o)[0].status, 'FAIL', 'no runs is not a pass')
})

test('mutations: a scorer with its rule removed lets the broken fixture through (so the rule is what turns it red)', async () => {
    let m = await mutant('fs_[i].turn - fs_[i - 1].turn < MIN_GAP', 'false')
    assert.deepEqual(m.dropProblems(fx('two-close')), []); assert.notDeepEqual(dropProblems(fx('two-close')), [])
    m = await mutant('if (seen.has(fp))', 'if (false)')
    assert.deepEqual(m.noRepeatProblems(fx('repeat')), []); assert.notDeepEqual(noRepeatProblems(fx('repeat')), [])
    m = await mutant("for (const re of POPUP) {", "for (const re of []) {")
    assert.ok(!m.naturalProblems(fx('popup')).some((p) => p.rule === 'popup')); assert.ok(naturalProblems(fx('popup')).some((p) => p.rule === 'popup'))
    m = await mutant('if (left) out.push', 'if (false) out.push')
    assert.deepEqual(m.naturalProblems(fx('block-visible')), []); assert.notDeepEqual(naturalProblems(fx('block-visible')), [])
    m = await mutant("if (!KINDS.includes(kind)) why.push", "if (false) why.push")
    assert.ok(m.parseFinds('[[FIND|gadget|a|b|c|common|d|yes]]')[0].ok); assert.ok(!parseFinds('[[FIND|gadget|a|b|c|common|d|yes]]')[0].ok)
})

test('fixLatin1Utf8: windows-1252 view (curly quotes, euro, dashes in the bytes) too', () => {
    const want = 'Persona ghi “10 năng lực” — ngoại hình… “ổ” ‘x’ €'
    const dec = new TextDecoder('windows-1252').decode(Buffer.from(want, 'utf8'))
    assert.notEqual(dec, want)
    assert.equal(fixLatin1Utf8(dec), want)
})

test('fixLatin1Utf8: the browser\'s Latin-1 view of a streamed reply is turned back; right text is left alone', () => {
    const want = '[[FIND|skill|Nghe tiếng bước chân|Muffled Footsteps|Nghe qua tường.|uncommon|Cần yên tĩnh|yes]]'
    const mangled = Buffer.from(want, 'utf8').toString('latin1')
    assert.notEqual(mangled, want)
    assert.equal(fixLatin1Utf8(mangled), want)
    assert.equal(fixLatin1Utf8(want), want)
    assert.equal(fixLatin1Utf8('plain ascii'), 'plain ascii')
    assert.equal(fixLatin1Utf8('Café'), 'Café')
    assert.equal(parseFinds(fixLatin1Utf8(mangled)).filter((b) => b.ok)[0].find.name.vi, 'Nghe tiếng bước chân')
    assert.notEqual(parseFinds(mangled).filter((b) => b.ok)[0]?.find.name.vi, 'Nghe tiếng bước chân') // without the fix the name is mangled
})

test('finds.noRepeat: two finds with the same head noun under different names are a problem (a real run saved Sound Rhythm and Stairwell Rhythm)', () => {
    const turn = (en) => ({ raw: `x [[FIND|skill|Tên|${en}|effect here.|rare|cond|yes]]`, shown: 'x' })
    const bad = noRepeatProblems([{ turns: [turn('Sound Rhythm')] }, { turns: [turn('Stairwell Rhythm')] }])
    assert.equal(bad.length, 1)
    assert.equal(bad[0].rule, 'similar')
    assert.deepEqual(noRepeatProblems([{ turns: [turn('Sound Rhythm')] }, { turns: [turn('Rusty Key')] }]), [])
})

test('act tags: counted per run from the raw reply; a tag left in the shown or stored text (finished or half-streamed) is red, a clean run is green', () => {
    const tag = '[[ACT|bẻ-khóa-cửa-kho|nhanh_nhen+cam_nhan|normal|giữ-im-lặng]]'
    const clean = [{ turns: [{ raw: 'a ' + tag, shown: 'a', reply: 'a' }, { raw: 'b', shown: 'b', reply: 'b' }] }, { turns: [{ raw: tag + tag, shown: 'x', reply: 'x' }] }]
    assert.deepEqual(actCounts(clean), [{ turns: 2, tags: 1 }, { turns: 1, tags: 2 }])
    assert.deepEqual(actLeaks(clean), [])
    assert.equal(actChecks(clean)[0].status, 'PASS')
    for (const bad of [{ raw: 'a ' + tag, shown: 'a ' + tag, reply: 'a' }, { raw: 'a', shown: 'a', reply: 'a ' + tag }, { raw: 'a', shown: 'a [[ACT|bẻ-khó', reply: 'a' }, { raw: 'a', shown: 'a', reply: 'a [[BREAK|cam_nhan]]' }]) {
        const r = actChecks([{ turns: [bad] }])
        assert.equal(r[0].status, 'FAIL', JSON.stringify(bad))
    }
    assert.equal(actChecks([])[0].status, 'FAIL')
})
