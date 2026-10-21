'use strict'
// Step 1 of the seed pipeline (see merge.cjs for the rest): the candidates a cheap model ranked (<world>.candidates.json:
// {world, npcs: [{id, name, aliases, score, fact_count, lore_count, facts: [texts], lore_snippets: [...], pairs: [{id, r}]}]}) become
// <world>.targets.json: the people to profile, each with what the drafting model may read about them.
//   - a candidate is resolved to a PERSON of the world's graph (story/graphs/<world>.json): its id when that is a person id, else its
//     name or an alias folded (accents and case) when exactly one person goes by it; the rest are printed and dropped;
//   - the player's own names are dropped (the persona is never an NPC; the acceptance copies play as "Kenji Park");
//   - score -> importance by RANK among the kept (1st = 100, last = 1), the top 30 are kept;
//   - per target: the graph facts about it (as subject or as object of a relation with another entity), at most 12, each with its
//     `fid` = its index in the graph's `facts` array (stable: the graph file is hash-gated; hide_fid in the profile means the same),
//     the ones the candidate's own facts quote first, then fact > unknown > rumor > outdated; at most 4 lore snippets.
// Many candidates are titles and groups, not people ("Saint", "Void", "His Majesty"): they resolve to graph "persons" all the same, so
// the drafting prompt lets the drafter answer {"skip": [...]} and merge.cjs drops them.
// node normalize.cjs <world> [candidates.json] [out.json]
const fs = require('fs')
const path = require('path')

const GRAPH_DIR = path.join(__dirname, '..', '..', 'graphs')
const WORK = path.join(process.env.HOME ?? '', '.backend-review/work/risu-npc-psych/npcs')
const KEEP = 30, MAX_FACTS = 12, MAX_LORE = 4
const PLAYER_NAMES = new Set(['player', 'the player', 'người chơi', 'the character', 'kenji', 'kenji park'])
const STATUS_RANK = { fact: 0, unknown: 1, rumor: 2, outdated: 3 }

const fold = (s) => String(s ?? '').normalize('NFC').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/\s+/g, ' ').trim()

/** {persons: Map id -> entity, byName: Map folded name -> Set ids, about: Map id -> [{fid, fact}]} of a lore graph */
function indexGraph(graph) {
    const persons = new Map()
    const byName = new Map()
    for (const e of graph.entities ?? []) {
        if (e.kind !== 'person') continue
        persons.set(e.id, e)
        for (const n of new Set([e.id, e.name, ...(e.aliases ?? [])])) {
            const k = fold(n)
            if (!byName.has(k)) byName.set(k, new Set())
            byName.get(k).add(e.id)
        }
    }
    const about = new Map()
    ;(graph.facts ?? []).forEach((f, fid) => {
        for (const id of new Set([f.s, f.o])) if (id && persons.has(id)) { if (!about.has(id)) about.set(id, []); about.get(id).push({ fid, fact: f }) }
    })
    return { persons, byName, about }
}

/** a candidate -> a person id of the graph, or null */
function resolve(c, g) {
    if (c?.id && g.persons.has(String(c.id))) return String(c.id)
    for (const n of [c?.name, c?.id, ...(c?.aliases ?? [])]) {
        const ids = g.byName.get(fold(n))
        if (ids?.size === 1) return [...ids][0]
    }
    return null
}

/**
 * candidates ({npcs: [...]} or a bare list) + the graph -> {targets, unresolved, dropped}; pure.
 */
function normalize(world, candidates, graph) {
    const list = Array.isArray(candidates) ? candidates : candidates?.npcs ?? []
    const g = indexGraph(graph)
    const unresolved = []
    const dropped = []
    const best = new Map()                 // id -> candidate (the higher score when two candidates are one person)
    for (const c of list) {
        const names = [c?.name, c?.id, ...(c?.aliases ?? [])].map(fold)
        const id = resolve(c, g)
        if (!id) { unresolved.push(String(c?.name ?? c?.id ?? '?')); continue }
        if (names.some((n) => PLAYER_NAMES.has(n)) || PLAYER_NAMES.has(fold(id))) { dropped.push(`${id} (the player's own name)`); continue }
        const score = Number(c.score) || 0
        if (!best.has(id) || score > (Number(best.get(id).score) || 0)) best.set(id, c)
    }
    const ranked = [...best.entries()].sort((a, b) => (Number(b[1].score) || 0) - (Number(a[1].score) || 0) || a[0].localeCompare(b[0])).slice(0, KEEP)
    const ids = new Set(ranked.map(([id]) => id))
    const targets = ranked.map(([id, c], i) => {
        const e = g.persons.get(id)
        const quoted = new Set((c.facts ?? []).map((t) => fold(t)))
        const facts = (g.about.get(id) ?? [])
            .map((x) => ({ ...x, q: quoted.has(fold(x.fact.text)) ? 0 : 1 }))
            .sort((a, b) => a.q - b.q || STATUS_RANK[a.fact.status] - STATUS_RANK[b.fact.status] || a.fid - b.fid)
            .slice(0, MAX_FACTS)
            .map(({ fid, fact }) => ({ fid, s: fact.s, r: fact.r, o: fact.o ?? null, status: fact.status, text: fact.text, ...(fact.known_by?.length ? { known_by: fact.known_by.map((k) => k.who) } : {}) }))
        const aliases = [...new Set([...(c.aliases ?? []), ...(e.aliases ?? [])])].filter((a) => a !== (c.name ?? e.name)).slice(0, 8)
        return {
            id, name: c.name ?? e.name, aliases,
            importance: ranked.length > 1 ? Math.round(100 - (i * 99) / (ranked.length - 1)) : 100,
            score: Number(c.score) || 0,
            facts,
            lore: (c.lore_snippets ?? []).slice(0, MAX_LORE).map((t) => String(t).replace(/\s+/g, ' ').slice(0, 300)),
            pairs: (c.pairs ?? []).map((p) => ({ id: resolve({ id: p.id }, g), r: p.r })).filter((p) => p.id && ids.has(p.id) && p.id !== id),
        }
    })
    return { world, targets, unresolved, dropped }
}

function main() {
    const [world, cand0, out0] = process.argv.slice(2)
    if (!world) { console.error('usage: node normalize.cjs <world> [candidates.json] [out.json]'); process.exit(2) }
    const candFile = cand0 || path.join(WORK, `${world}.candidates.json`)
    const out = out0 || candFile.replace(/\.candidates\.json$/, '') + '.targets.json'
    const graph = JSON.parse(fs.readFileSync(path.join(GRAPH_DIR, `${world}.json`), 'utf8'))
    const r = normalize(world, JSON.parse(fs.readFileSync(candFile, 'utf8')), graph)
    fs.writeFileSync(out, JSON.stringify({ world, built: new Date().toISOString().slice(0, 10), targets: r.targets }, null, 1) + '\n')
    console.log(JSON.stringify({ world, candidates: (JSON.parse(fs.readFileSync(candFile, 'utf8')).npcs ?? []).length, resolved: r.targets.length, unresolved: r.unresolved, dropped: r.dropped, withFacts: r.targets.filter((t) => t.facts.length).length, out }))
}

if (require.main === module) main()
module.exports = { normalize, indexGraph, resolve, fold, PLAYER_NAMES }
