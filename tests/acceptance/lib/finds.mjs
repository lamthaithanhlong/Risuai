// Scorers for the finds feature (skills/items the character stumbles on while playing; spec: nguoi-dua-thu-khung-bo/.pm-risu-5h/finds-spec.md).
// Pure and deterministic, no model. A scorer returns problems ([{rule, text}], empty = pass) over `runs`:
//   runs = [{ turns: [{ raw, shown }] }]   the STORY turns of each fresh run in order (after the creation turns); `raw` is what the
//   narrator wrote (the model's response, block still in it), `shown` what the player saw (block stripped).
// Each has to go red on its fixture (fixtures/finds/*.json, finds.check.mjs breaks them on purpose).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { narrationProblems } from './narration.mjs'

export const MIN_GAP = 8          // at most one find in any window of 8 story turns
export const MIN_TURNS = 20       // fresh story turns per run before the gate counts
export const KINDS = ['skill', 'item']
export const RARITIES = ['common', 'uncommon', 'rare', 'epic']
export const DEFAULT_TOOLS = path.join(os.homedir(), 'Downloads', 'apocalypse-tham-hoa-zombie', 'tools', 'assets')

// [[FIND|skill|Tên VI|Name EN|effect|rarity|conditions|portable]]   (portable = yes|no, no pipes inside a field)
const BLOCK_ANY = /\[\[\s*FIND\b[^\]\n]*(?:\]\]?)?/gi
const BLOCK_OK = /^\[\[FIND\|([^|\]\n]*)\|([^|\]\n]*)\|([^|\]\n]*)\|([^|\]\n]*)\|([^|\]\n]*)\|([^|\]\n]*)\|([^|\]\n]*)\]\]$/

/** what a reply carries: { blocks: [{ok, text, find?}] } ; find = the parsed record fields of a well-formed block */
export function parseFinds(raw) {
    const t = typeof raw === 'string' ? raw : JSON.stringify(raw ?? '')
    const blocks = []
    for (const m of t.matchAll(BLOCK_ANY)) {
        const g = BLOCK_OK.exec(m[0])
        if (!g) { blocks.push({ ok: false, text: m[0].slice(0, 120) }); continue }
        const [kind, vi, en, effect, rarity, conditions, portable] = g.slice(1).map((s) => s.trim())
        const why = []
        if (!KINDS.includes(kind)) why.push(`kind "${kind}"`)
        if (!vi || vi.length > 60) why.push('name vi')
        if (!en || en.length > 60) why.push('name en')
        if (!effect || effect.length > 400) why.push('effect')
        if (!RARITIES.includes(rarity)) why.push(`rarity "${rarity}"`)
        if (!conditions) why.push('conditions')
        if (!/^(yes|no)$/i.test(portable)) why.push(`portable "${portable}"`)
        blocks.push(why.length ? { ok: false, text: m[0].slice(0, 120), why: why.join(', ') } : { ok: true, text: m[0], find: { kind, name: { vi, en }, effect, rarity, conditions, portable: /^yes$/i.test(portable) } })
    }
    return blocks
}

// ---- name normalisation (same rule as the store's fingerprint: lowercase, strip accents/punctuation/stopwords, sorted tokens) --------

export const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 's'])
const plain = (s) => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()
export function fingerprint(nameEn) {
    return plain(nameEn).replace(/'/g, '').replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOPWORDS.has(w)).sort().join(' ')
}
export const slug = (nameEn) => plain(nameEn).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

/** the finds a run carried: [{turn (1-based story turn), find}] */
export function findsOfRun(run) {
    const out = []
    ;(run?.turns ?? []).forEach((t, i) => { for (const b of parseFinds(t.raw ?? t.reply)) if (b.ok) out.push({ turn: i + 1, find: b.find }) })
    return out
}

// ---- finds.drop ---------------------------------------------------------------------------------------------------------------------

/** every run: >= MIN_TURNS story turns, at least one find, and never two finds within MIN_GAP turns of each other */
export function dropProblems(runs) {
    const out = []
    runs.forEach((run, r) => {
        const n = run.turns?.length ?? 0
        if (n < MIN_TURNS) out.push({ rule: 'too-few-turns', text: `run ${r + 1}: ${n} story turns, need ${MIN_TURNS}` })
        const fs_ = findsOfRun(run)
        if (!fs_.length) out.push({ rule: 'no-find', text: `run ${r + 1}: no find in ${n} turns` })
        for (let i = 1; i < fs_.length; i++) {
            if (fs_[i].turn - fs_[i - 1].turn < MIN_GAP) out.push({ rule: 'too-close', text: `run ${r + 1}: finds at turns ${fs_[i - 1].turn} and ${fs_[i].turn} (${fs_[i].turn - fs_[i - 1].turn} apart, need ${MIN_GAP})` })
        }
    })
    return out
}

/** REPORT-ONLY: a find inside the first 3 story turns (the spec's "never in the first 3 story turns after the character is locked") */
export const earlyFinds = (runs, first = 3) => runs.flatMap((run, r) => findsOfRun(run).filter((f) => f.turn <= first).map((f) => `run ${r + 1}: "${f.find.name.en}" at turn ${f.turn}`))

// ---- finds.noRepeat -----------------------------------------------------------------------------------------------------------------

/** no two finds (across all runs: they share one store) have the same fingerprint, no matter the Vietnamese name */
export function noRepeatProblems(runs) {
    const seen = new Map()
    const out = []
    runs.forEach((run, r) => {
        for (const { turn, find } of findsOfRun(run)) {
            const fp = fingerprint(find.name.en)
            const here = `run ${r + 1} turn ${turn}`
            if (seen.has(fp)) out.push({ rule: 'repeat', text: `${here}: "${find.name.en}" repeats ${seen.get(fp).at} ("${seen.get(fp).en}")` })
            else seen.set(fp, { at: here, en: find.name.en })
        }
    })
    return out
}

// ---- finds.natural ------------------------------------------------------------------------------------------------------------------

const POPUP = [/bạn nhận được/i, /\+\s*(skill|item)\b/i, /nhận được (kỹ năng|vật phẩm|skill|item)/i, /\[\s*hệ thống\s*:\s*nhận/i, /kỹ năng mới\s*:/i, /vật phẩm mới\s*:/i]

/**
 * The raw reply has exactly one well-formed [[FIND|…]] block or none; the displayed text has none of it and none of the popup phrasing;
 * narration.clean still passes on the displayed replies of the run.
 */
export function naturalProblems(runs) {
    const out = []
    runs.forEach((run, r) => {
        const turns = run.turns ?? []
        turns.forEach((t, i) => {
            const at = `run ${r + 1} turn ${i + 1}`
            const blocks = parseFinds(t.raw ?? t.reply)
            for (const b of blocks.filter((b) => !b.ok)) out.push({ rule: 'malformed', text: `${at}: ${b.text}${b.why ? ` (${b.why})` : ''}` })
            if (blocks.length > 1) out.push({ rule: 'many-blocks', text: `${at}: ${blocks.length} FIND blocks in one reply` })
            const shown = String(t.shown ?? '')
            const left = /\[\[\s*FIND\b|\bFIND\|/i.exec(shown)
            if (left) out.push({ rule: 'block-visible', text: `${at}: «${shown.slice(Math.max(0, left.index - 20), left.index + 60).replace(/\s+/g, ' ')}»` })
            for (const re of POPUP) { const m = re.exec(shown); if (m) { out.push({ rule: 'popup', text: `${at}: «${shown.slice(Math.max(0, m.index - 20), m.index + 60).replace(/\s+/g, ' ')}»` }); break } }
        })
        for (const p of narrationProblems(turns.map((t) => t.shown ?? ''))) out.push({ rule: `narration-${p.rule}`, text: `run ${r + 1} turn ${p.reply + 1}: ${p.text}` })
    })
    return out
}

// ---- finds.saved --------------------------------------------------------------------------------------------------------------------

const FIELDS = ['id', 'kind', 'name', 'source', 'effect', 'rarity', 'conditions', 'portable', 'found_at', 'fingerprint']
const RULE = /this world'?s own\s+mechanics/i

/** what shared_assets.for_card(cardId) returns for the store at storeDir: [{title, keys, body}] (python3, the asset manager's own code) */
export function forCard(cardId, storeDir, toolsDir = DEFAULT_TOOLS) {
    const code = 'import sys,json,os\nsys.path.insert(0,sys.argv[1])\nimport shared_assets\nprint(json.dumps([{"title":a["title"],"keys":a["keys"],"body":a["body"]} for a in shared_assets.for_card(sys.argv[2])]))'
    const out = execFileSync('python3', ['-c', code, toolsDir, cardId], { env: { ...process.env, RISU_SHARED_DIR: storeDir }, encoding: 'utf8', timeout: 60000 })
    return JSON.parse(out.trim().split('\n').at(-1))
}

/**
 * Every find a run carried is in <storeDir>/finds/<id>.json with all fields (and the block's values), and for_card(otherCard) returns a
 * portable one as "Thu được: <name vi>" with the translation rule, and never a non-portable one. `source.card` is the run's card.
 */
export function savedProblems(runs, { storeDir, toolsDir = DEFAULT_TOOLS, otherCard = 'fate', card = 'zombie' } = {}) {
    const out = []
    if (!storeDir) return [{ rule: 'no-store', text: 'RISU_SHARED_DIR is not set' }]
    const wanted = new Map()
    for (const run of runs) for (const { find } of findsOfRun(run)) if (!wanted.has(slug(find.name.en))) wanted.set(slug(find.name.en), find)
    if (!wanted.size) return [{ rule: 'no-find', text: 'no find in the runs, nothing to be saved' }]
    let other = null
    try { other = forCard(otherCard, storeDir, toolsDir) } catch (e) { out.push({ rule: 'for-card', text: `for_card('${otherCard}') failed: ${String(e.stderr || e.message).trim().split('\n').at(-1).slice(0, 160)}` }) }
    for (const [id, f] of wanted) {
        const file = path.join(storeDir, 'finds', `${id}.json`)
        let rec
        try { rec = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { out.push({ rule: 'not-saved', text: `${id}: no readable ${file}` }); continue }
        const missing = FIELDS.filter((k) => rec[k] === undefined || rec[k] === null || rec[k] === '')
        if (rec.name) for (const k of ['vi', 'en']) if (!rec.name?.[k]) missing.push(`name.${k}`)
        if (rec.source) for (const k of ['card', 'chapter']) if (!rec.source?.[k]) missing.push(`source.${k}`)
        if (missing.length) out.push({ rule: 'missing-field', text: `${id}: ${[...new Set(missing)].join(', ')}` })
        if (rec.id !== id) out.push({ rule: 'bad-id', text: `${id}: id is "${rec.id}"` })
        if (rec.fingerprint !== fingerprint(f.name.en)) out.push({ rule: 'bad-fingerprint', text: `${id}: "${rec.fingerprint}" != "${fingerprint(f.name.en)}"` })
        if (rec.kind !== f.kind || rec.rarity !== f.rarity || rec.portable !== f.portable || rec.name?.vi !== f.name.vi) out.push({ rule: 'differs-from-block', text: `${id}: stored kind/rarity/portable/name differ from the block` })
        if (rec.source?.card && rec.source.card !== card) out.push({ rule: 'bad-source', text: `${id}: source.card "${rec.source.card}", the run played "${card}"` })
        if (other) {
            const hit = other.find((a) => a.title === `Thu được: ${f.name.vi}` || (a.keys ?? []).includes(f.name.en))
            if (f.portable && !hit) out.push({ rule: 'not-loaded', text: `${id}: for_card('${otherCard}') does not return it` })
            else if (f.portable && !RULE.test(hit.body ?? '')) out.push({ rule: 'no-translation-rule', text: `${id}: its body in for_card('${otherCard}') has no translation rule` })
            else if (!f.portable && hit) out.push({ rule: 'leaked', text: `${id}: not portable, yet for_card('${otherCard}') returns it` })
        }
    }
    return out
}

// ---- checks for the gate/summary ----------------------------------------------------------------------------------------------------

/** the four check objects (score.mjs shape) over the story turns of the fresh runs */
export function findsChecks(runs, { storeDir = process.env.RISU_SHARED_DIR, toolsDir, otherCard, card } = {}) {
    const n = runs.length
    const total = runs.reduce((s, r) => s + (r.turns?.length ?? 0), 0)
    const found = runs.reduce((s, r) => s + findsOfRun(r).length, 0)
    const mk = (id, title, probs, ok) => ({ id, title, status: n && !probs.length && ok !== false ? 'PASS' : 'FAIL', summary: probs.length ? `${probs.length} problem(s) over ${n} runs / ${total} story turns` : `${n} runs, ${total} story turns, ${found} finds`, evidence: probs.map((p) => `${p.rule}: ${p.text}`) })
    const checks = [
        mk('finds.drop', `A find drops in each of ${n} fresh runs (>= ${MIN_TURNS} story turns), never two within ${MIN_GAP} turns`, dropProblems(runs)),
        mk('finds.noRepeat', 'No two finds share a fingerprint', noRepeatProblems(runs)),
        mk('finds.natural', 'One well-formed block or none, stripped from the prose, no popup phrasing, narration clean', naturalProblems(runs)),
        mk('finds.saved', 'Every find is in the store with all fields and another card loads it with the translation rule', savedProblems(runs, { storeDir, toolsDir, otherCard, card })),
    ]
    const early = earlyFinds(runs)
    checks.push({ id: 'finds.early', title: 'A find in the first 3 story turns (report only)', status: 'INFO', summary: `${early.length}`, evidence: early })
    return checks
}
