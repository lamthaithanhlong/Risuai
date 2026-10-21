'use strict'
// Steps 3 and 4 of the seed pipeline: the drafting model's files (prompt.md: one JSON a batch of targets) are CHECKED, then merged
// into story/npcs/<world>.json.
//   --check <draftDir>: every draft file, every error printed as "<file>: <where>: <what>", exit 1 on any. Checks, per file:
//     - each npc against story/schema/npc-profile.schema.json (traits 0..100, speech and tags from the lists, text caps);
//     - its id is a PERSON of the world's lore graph (story/graphs/<world>.json), not the player, not listed twice;
//     - a secret rests on the graph: wants_to_hide and hide_fid come together, and hide_fid is the index in the graph's `facts` of a
//       fact ABOUT this npc (subject or object) whose status is fact or unknown (a rumor or an outdated fact is no secret);
//     - each relation against the schema, p an npc of THIS file, q an npc of any draft file or "player", p != q, (p, q) once;
//     - skip entries ({id, why}: what the drafter judged no individual) name nobody that is also an npc;
//     - across the directory: at most 30 distinct npcs.
//   <draftDir> <out>: merges. One npc per id (the higher importance wins, the earlier file on a tie), the top 30 by importance;
//     relations of the same (p, q) become the mean of their four numbers; a relation to somebody who did not make the cut is dropped.
//     The whole file is checked again (schema + seedErrors) before it is written. --drop-bad merges around the files' errors
//     (the failing npcs and relations are left out) instead of refusing.
// node merge.cjs <world> --check <draftDir>
// node merge.cjs <world> <draftDir> [out.json] [--drop-bad]      (out defaults to story/npcs/<world>.json)
const fs = require('fs')
const path = require('path')
const { validate, sub } = require('../../../jsonSchemaLite.cjs')
const { SCHEMA, seedErrors, PLAYER } = require('../../../npcPsych.cjs')

const GRAPH_DIR = path.join(__dirname, '..', '..', 'graphs')
const MAX_NPCS = 30
const DIMS = ['trust', 'affection', 'debt', 'grudge']

function loadGraph(world) {
    const g = JSON.parse(fs.readFileSync(path.join(GRAPH_DIR, `${world}.json`), 'utf8'))
    return { persons: new Set(g.entities.filter((e) => e.kind === 'person').map((e) => e.id)), facts: g.facts }
}

/** the errors of one draft ({npcs, relations, skip}) against the graph; allIds = the npc ids of every draft file; [] = fine */
function checkDraft(draft, graph, allIds) {
    const out = []
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return ['the file is not a JSON object']
    const npcs = Array.isArray(draft.npcs) ? draft.npcs : (out.push('npcs: missing or not a list'), [])
    const relations = draft.relations === undefined ? [] : Array.isArray(draft.relations) ? draft.relations : (out.push('relations: not a list'), [])
    const mine = new Set()
    npcs.forEach((n, i) => {
        const at = `npcs[${i}] ${n?.id ?? '?'}`
        for (const e of validate(sub(SCHEMA, 'npc'), n)) out.push(`${at}: ${e.replace(/^\$/, '')}`)
        if (typeof n?.id !== 'string') return
        if (n.id === PLAYER) out.push(`${at}: the player's persona is never an npc`)
        else if (!graph.persons.has(n.id)) out.push(`${at}: id is no person of this world's graph`)
        if (mine.has(n.id)) out.push(`${at}: listed twice in this file`)
        mine.add(n.id)
        const hide = typeof n.wants_to_hide === 'string' && n.wants_to_hide.trim() !== ''
        const fid = n.hide_fid
        if (hide && (fid === null || fid === undefined)) out.push(`${at}: wants_to_hide without hide_fid`)
        if (!hide && fid !== null && fid !== undefined) out.push(`${at}: hide_fid without wants_to_hide`)
        if (hide && Number.isInteger(fid)) {
            const f = graph.facts[fid]
            if (!f) out.push(`${at}: hide_fid ${fid} is no fact of the graph`)
            else if (f.s !== n.id && f.o !== n.id) out.push(`${at}: hide_fid ${fid} is a fact about ${f.s}${graph.persons.has(f.o) ? ' / ' + f.o : ''}, not about this npc`)
            else if (f.status !== 'fact' && f.status !== 'unknown') out.push(`${at}: hide_fid ${fid} is a ${f.status}, a secret rests on a fact or an unknown`)
        }
    })
    const pairs = new Set()
    relations.forEach((r, i) => {
        const at = `relations[${i}] ${r?.p ?? '?'} -> ${r?.q ?? '?'}`
        for (const e of validate(sub(SCHEMA, 'relation'), r)) out.push(`${at}: ${e.replace(/^\$/, '')}`)
        if (typeof r?.p !== 'string' || typeof r?.q !== 'string') return
        if (r.p === r.q) out.push(`${at}: p and q are the same`)
        if (!mine.has(r.p)) out.push(`${at}: p is no npc of this file`)
        if (r.q !== PLAYER && !allIds.has(r.q)) out.push(`${at}: q is no npc of any draft and not "${PLAYER}"`)
        if (pairs.has(`${r.p}\u0000${r.q}`)) out.push(`${at}: listed twice`)
        pairs.add(`${r.p}\u0000${r.q}`)
    })
    for (const [i, s] of (Array.isArray(draft.skip) ? draft.skip : []).entries()) {
        if (typeof s?.id !== 'string' || typeof s?.why !== 'string') out.push(`skip[${i}]: wants {id, why}`)
        else if (mine.has(s.id)) out.push(`skip[${i}] ${s.id}: also listed as an npc`)
    }
    return out
}

/** the draft files of a directory, parsed: [{file, draft, error}] */
function readDrafts(dir) {
    return fs.readdirSync(dir).filter((f) => /^[^.].*\.json$/.test(f) && !/\.targets\.json$/.test(f)).sort().map((file) => {
        try { return { file, draft: JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) } } catch (e) { return { file, draft: null, error: e.message } }
    })
}

/** every error of a directory of drafts: {errors: [{file, message}], npcs, skipped} */
function check(world, dir, graph = loadGraph(world)) {
    const files = readDrafts(dir)
    const allIds = new Set(files.flatMap((f) => (Array.isArray(f.draft?.npcs) ? f.draft.npcs.map((n) => n?.id).filter((x) => typeof x === 'string') : [])))
    const errors = []
    for (const f of files) {
        if (f.error) { errors.push({ file: f.file, message: `not JSON: ${f.error}` }); continue }
        for (const m of checkDraft(f.draft, graph, allIds)) errors.push({ file: f.file, message: m })
    }
    if (allIds.size > MAX_NPCS) errors.push({ file: '(all)', message: `${allIds.size} distinct npcs, at most ${MAX_NPCS}` })
    const skipped = files.flatMap((f) => (Array.isArray(f.draft?.skip) ? f.draft.skip : []))
    return { errors, npcs: allIds.size, skipped }
}

/**
 * Drafts -> the seed file of the world; pure. {file, drop, errors}: `drop` counts what was left out, by reason; `errors` are the final
 * schema and pair-rule errors (empty = writable).
 */
function merge(world, drafts) {
    const drop = {}
    const dropped = (why) => { drop[why] = (drop[why] ?? 0) + 1 }
    const best = new Map()
    for (const d of drafts) for (const n of d?.npcs ?? []) {
        if (!n || typeof n.id !== 'string') { dropped('npc: no id'); continue }
        const had = best.get(n.id)
        if (!had) best.set(n.id, n)
        else { dropped('npc: duplicate id'); if ((n.importance ?? 0) > (had.importance ?? 0)) best.set(n.id, n) }
    }
    const npcs = [...best.values()].sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0) || a.id.localeCompare(b.id))
    for (const n of npcs.slice(MAX_NPCS)) dropped(`npc: below the top ${MAX_NPCS}`)
    const kept = npcs.slice(0, MAX_NPCS)
    const ids = new Set(kept.map((n) => n.id))
    const acc = new Map()
    for (const d of drafts) for (const r of d?.relations ?? []) {
        if (!r || r.p === r.q) { dropped('relation: p == q'); continue }
        if (!ids.has(r.p) || (r.q !== PLAYER && !ids.has(r.q))) { dropped('relation: an end is not in the file'); continue }
        const k = `${r.p}\u0000${r.q}`
        if (!acc.has(k)) acc.set(k, [])
        acc.get(k).push(r)
    }
    const order = new Map(kept.map((n, i) => [n.id, i]))
    const relations = [...acc.values()].map((rs) => {
        if (rs.length > 1) dropped('relation: same pair twice, averaged')
        const r = { p: rs[0].p, q: rs[0].q }
        for (const d of DIMS) r[d] = Math.round(rs.reduce((s, x) => s + Number(x[d]), 0) / rs.length)
        const why = rs.map((x) => String(x.why ?? '').trim()).find(Boolean)
        if (why) r.why = [...why].slice(0, 160).join('')
        return r
    }).sort((a, b) => order.get(a.p) - order.get(b.p) || (a.q === PLAYER ? -1 : b.q === PLAYER ? 1 : (order.get(a.q) ?? 0) - (order.get(b.q) ?? 0)))
    const file = { world, version: 1, built: new Date().toISOString().slice(0, 10), npcs: kept, relations }
    return { file, drop, errors: [...validate(SCHEMA, file), ...seedErrors(file)] }
}

/** the drafts of a directory without the npcs and relations the check flagged (--drop-bad) */
function withoutBad(world, dir) {
    const graph = loadGraph(world)
    const files = readDrafts(dir).filter((f) => f.draft && !f.error)
    const allIds = new Set(files.flatMap((f) => (f.draft.npcs ?? []).map((n) => n?.id).filter((x) => typeof x === 'string')))
    return files.map(({ draft }) => {
        const npcs = (draft.npcs ?? []).filter((n) => checkDraft({ npcs: [n] }, graph, allIds).length === 0)
        const ok = new Set(npcs.map((n) => n.id))
        const relations = (draft.relations ?? []).filter((r) => ok.has(r?.p) && (r.q === PLAYER || allIds.has(r.q)) && validate(sub(SCHEMA, 'relation'), r).length === 0)
        return { npcs, relations }
    })
}

function main() {
    const args = process.argv.slice(2)
    const flags = args.filter((a) => a.startsWith('--'))
    const pos = args.filter((a) => !a.startsWith('--'))
    const world = pos[0]
    if (!world) { console.error('usage: node merge.cjs <world> --check <draftDir> | <world> <draftDir> [out.json] [--drop-bad]'); process.exit(2) }
    if (flags.includes('--check')) {
        const dir = pos[1]
        const r = check(world, dir)
        for (const e of r.errors) console.error(`${e.file}: ${e.message}`)
        console.log(JSON.stringify({ world, npcs: r.npcs, skipped: r.skipped.length, errors: r.errors.length, filesWithErrors: [...new Set(r.errors.map((e) => e.file))] }))
        process.exit(r.errors.length ? 1 : 0)
    }
    const dir = pos[1]
    const out = pos[2] || path.join(__dirname, '..', `${world}.json`)
    let drafts
    if (flags.includes('--drop-bad')) drafts = withoutBad(world, dir)
    else {
        const c = check(world, dir)
        if (c.errors.length) { for (const e of c.errors) console.error(`${e.file}: ${e.message}`); console.error(`${c.errors.length} errors: nothing written (--drop-bad merges around them)`); process.exit(1) }
        drafts = readDrafts(dir).map((f) => f.draft)
    }
    const { file, drop, errors } = merge(world, drafts)
    // every hide_fid must still be a fact about its npc (--drop-bad took the failing ones out; this is the last line)
    const graph = loadGraph(world)
    for (const n of file.npcs) if (!graph.persons.has(n.id)) errors.push(`npc ${n.id}: no person of the graph`)
    if (errors.length) { console.error(errors.slice(0, 20).join('\n')); process.exit(1) }
    fs.writeFileSync(out, JSON.stringify(file, null, 1) + '\n')
    console.log(JSON.stringify({ world, npcs: file.npcs.length, relations: file.relations.length, withSecret: file.npcs.filter((n) => n.wants_to_hide).length, dropped: drop, out }))
}

if (require.main === module) main()
module.exports = { check, checkDraft, merge, loadGraph, MAX_NPCS }
