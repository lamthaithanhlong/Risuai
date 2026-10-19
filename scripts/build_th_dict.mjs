// Step 2 of public/dict/th-words.json (step 1: scripts/build_th_dict_tltk.py): every word of the list, "" when the spelling
// rules of src/ts/process/vietjiThai.ts read it as tltk does (same written units, same Việt-ji with the same tones), else
// tltk's reading, "2phon4'la3~3maaj3" (unit length, then the syllables said in it).
//
//     node scripts/build_th_dict.mjs ~/.risu-thai-build/tltk_words.json public/dict/th-words.json [differences.tsv]
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// esbuild comes with vite (pnpm keeps it out of the top node_modules)
const require = createRequire(import.meta.url)
const { buildSync } = createRequire(require.resolve('vite'))('esbuild')
const [src, dest, diffPath = join(tmpdir(), 'th-dict-diff.tsv')] = process.argv.slice(2)
const out = join(mkdtempSync(join(tmpdir(), 'th-dict-')), 'vietjiThai.mjs')
buildSync({ entryPoints: [new URL('../src/ts/process/vietjiThai.ts', import.meta.url).pathname], bundle: true, format: 'esm', outfile: out, logLevel: 'error' })
const { setThaiWords, thaiUnits } = await import(out)

const rows = JSON.parse(readFileSync(src, 'utf8'))
const words = {}
const stats = { words: 0, same: 0, listed: 0, unread: 0, why: { units: 0, syllables: 0, tone: 0, letters: 0 } }
const show = (units) => units.map((u) => `${u.text}[${u.vietji}]`).join(' ')
const ends = (texts) => { const o = new Set(); let at = 0; for (const t of texts) o.add(at += t.length); return o }
const samples = []
for (const [word, , parsed, pyUnits] of rows) {
    stats.words++
    words[word] = ''
    setThaiWords(null)
    const byRule = thaiUnits(word)
    if (!parsed) { stats.unread++; continue }
    // tltk's reading: written units, the syllables said in each
    const tUnits = parsed.flatMap(([units]) => units)
    const tGroups = parsed.flatMap(([, groups]) => groups).map((g) => g.map(([r, t]) => r + t))
    const encode = (units, groups) => units.map((u, k) => `${u.length}${groups[k].join("'")}`).join('~')
    setThaiWords({ [word]: encode(tUnits, tGroups) })
    const listed = thaiUnits(word)
    if (listed.length === 0 || listed.some((u) => !u.vietji) || listed.map((u) => u.text).join('') !== word) { stats.unread++; continue }
    const said = (units) => units.flatMap((u) => u.syllables.map((x) => x.vietji)).join('-')
    const agree = said(byRule) === said(listed)
    // the units shown: pythainlp's written syllables, as far as the reading can be laid on them. A unit of the reading that
    // pythainlp cuts further is split when the rules give its pieces as many syllables as it has (ศาสนา: ศา|สนา = saat | sa-naa);
    // then units are joined up to the next end pythainlp also has. tltk's syllables carry the reading (when agree is true they
    // are the rules' syllables, one for one).
    const flat = tGroups.flat()
    const src = agree ? byRule.map((u) => [u.text, u.syllables.length]) : tUnits.map((u, k) => [u, tGroups[k].length])
    const py = ends(pyUnits ?? [])
    const pieces = []                                            // [text, syllables]
    for (const [t, k] of src) {
        const cuts = []
        let from = 0
        for (let e = 1; e < t.length; e++) {
            const at = pieces.reduce((a, [x]) => a + x.length, 0) + e
            if (py.has(at)) { cuts.push(t.slice(from, e)); from = e }
        }
        cuts.push(t.slice(from))
        setThaiWords(null)
        const counts = cuts.map((c) => thaiUnits(c).flatMap((u) => u.syllables).length)
        if (cuts.length > 1 && counts.every((c) => c > 0) && counts.reduce((a, c) => a + c, 0) === k) cuts.forEach((c, i) => pieces.push([c, counts[i]]))
        else pieces.push([t, k])
    }
    const units = [], groups = []
    let text = '', n = 0, at = 0, used = 0
    for (const [t, k] of pieces) {
        text += t; n += k; at += t.length
        // close at a pythainlp end, or where pythainlp cut inside this piece and the reading could not follow (โชค|ดี, not โชคดี)
        const cutInside = [...py].some((e) => e > at - t.length && e < at)
        if (py.has(at) || cutInside || at === word.length) { units.push(text); groups.push(flat.slice(used, used + n)); used += n; text = ''; n = 0 }
    }
    const entry = encode(units, groups)
    setThaiWords({ [word]: entry })
    const chosen = thaiUnits(word)
    if (show(byRule) === show(chosen)) { stats.same++; continue }
    words[word] = entry
    stats.listed++
    const ruleSyl = byRule.flatMap((u) => u.syllables), listSyl = chosen.flatMap((u) => u.syllables)
    const why = agree ? 'units' : ruleSyl.length !== listSyl.length ? 'syllables' : ruleSyl.some((x, k) => x.tone !== listSyl[k].tone) ? 'tone' : 'letters'
    stats.why[why]++
    samples.push(`${why}\t${word}\t${show(byRule)}\t${show(chosen)}`)
}
setThaiWords(null)
const json = JSON.stringify({ about: 'Thai words for Risu learning mode, most used first (scripts/build_th_dict.mjs): "" read by rule, else units and tltk syllables', words })
writeFileSync(dest, json)
writeFileSync(diffPath, samples.join('\n'))
console.log(JSON.stringify(stats), 'bytes', Buffer.byteLength(json), 'differences', diffPath)
