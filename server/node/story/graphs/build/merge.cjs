'use strict'
// Turns the model's drafts (extract.py: one JSON a batch of books) into story/graphs/<world>.json, checked:
//   - one entity per thing: drafts that share an id or an alias are merged (union-find); the id is the most used one, the kind the
//     most voted, every alias kept (Vietnamese names from the cards' KEYS lines included);
//   - a relation between two things (member_of, enemy_of, located_at, ...) must name a known entity on both sides, else the fact is
//     dropped; a literal relation (status, rank, identity, ...) needs a value, except unknown (the value is what nobody knows);
//   - the source must be a book of this card's lorebook (an exact title, or the one title it is a case-insensitive prefix of);
//   - outdated needs `until`; the same (s, r, o, status) twice is kept once;
//   - the whole graph is checked against story/schema/lore-graph.schema.json before it is written.
// node merge.cjs <world> <risu_lorebook.json> [draftDir] [outFile]   -> prints what was kept and dropped, by reason
const fs = require('fs')
const path = require('path')
const { validate } = require('../../../jsonSchemaLite.cjs')

const SCHEMA = JSON.parse(fs.readFileSync(path.join(__dirname, '../../schema/lore-graph.schema.json'), 'utf8'))
const RELS = new Set(SCHEMA.$defs.rel.enum)
/** relations whose object is another entity */
const ENTITY_REL = new Set(['knows', 'member_of', 'leads', 'located_at', 'part_of', 'enemy_of', 'ally_of', 'controls', 'kin_of', 'serves', 'mentor_of', 'loves', 'killed', 'happened_at'])
const KINDS = new Set(SCHEMA.$defs.kind.enum)

const fold = (s) => String(s ?? '').normalize('NFC').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd')
const norm = (s) => String(s ?? '').normalize('NFC').toLowerCase().replace(/[\s ]+/g, ' ').replace(/^["'“”‘’]+|["'“”‘’.,;:]+$/g, '').trim()

function booksOf(lorebookFile) {
    const raw = JSON.parse(fs.readFileSync(lorebookFile, 'utf8'))
    const titles = new Set()
    for (const e of raw.data ?? raw) if (e.mode !== 'folder' && (e.comment ?? '').trim()) titles.add(e.comment.trim())
    return titles
}

function merge(world, drafts, titles) {
    const drop = {}
    const dropped = (why) => { drop[why] = (drop[why] ?? 0) + 1 }
    // ---- entities: union-find over ids and aliases ---------------------------------------------------------------------------
    const parent = new Map()
    const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x) } return x }
    const add = (x) => { if (!parent.has(x)) parent.set(x, x) }
    const union = (a, b) => { add(a); add(b); const ra = find(a), rb = find(b); if (ra !== rb) parent.set(rb, ra) }
    const seen = []
    for (const d of drafts) for (const e of d.entities ?? []) {
        const id = norm(e?.id ?? e?.name)
        if (id.length < 2 || !KINDS.has(e?.kind)) { dropped('entity: no id or bad kind'); continue }
        const names = [e.name, ...(Array.isArray(e.aliases) ? e.aliases : [])].map((a) => String(a ?? '').normalize('NFC').trim()).filter((a) => [...a].length >= 2 && a.length <= 120)
        add(id)
        // an alias joins two drafts only when it is a real name (3+ characters), so "Li" does not glue two people together
        for (const n of names) if ([...norm(n)].length >= 3) union(id, 'alias:' + norm(n))
        seen.push({ id, kind: e.kind, names })
    }
    const groups = new Map()
    for (const s of seen) {
        const r = find(s.id)
        if (!groups.has(r)) groups.set(r, { ids: new Map(), kinds: new Map(), names: new Map() })
        const g = groups.get(r)
        g.ids.set(s.id, (g.ids.get(s.id) ?? 0) + 1)
        g.kinds.set(s.kind, (g.kinds.get(s.kind) ?? 0) + 1)
        for (const n of s.names) g.names.set(n, (g.names.get(n) ?? 0) + 1)
    }
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0][0]
    const idOf = new Map()                  // any id or alias (normalised) -> canonical id
    const entities = []
    for (const g of groups.values()) {
        const id = top(g.ids)
        const name = top(g.names)
        const aliases = [...g.names.keys()].filter((n) => n !== name).slice(0, 30)
        entities.push({ id, kind: top(g.kinds), name, ...(aliases.length ? { aliases } : {}) })
        for (const k of g.ids.keys()) idOf.set(k, id)
        for (const n of g.names.keys()) if (!idOf.has(norm(n))) idOf.set(norm(n), id)
    }
    const namesOf = new Map()             // canonical id -> every name, folded
    for (const e of entities) namesOf.set(e.id, [...new Set([e.id, e.name, ...(e.aliases ?? [])].map(fold))])
    const resolve = (x) => (x === null || x === undefined ? null : idOf.get(norm(x)) ?? null)
    // ---- facts -------------------------------------------------------------------------------------------------------------------
    const lowerTitles = [...titles].map((t) => [t.toLowerCase(), t])
    const bookOf = (src) => {
        const t = String(src ?? '').replace(/^book:\s*/i, '').trim()
        if (titles.has(t)) return t
        const hits = lowerTitles.filter(([l]) => l.startsWith(t.toLowerCase()) && t.length >= 6)
        return hits.length === 1 ? hits[0][1] : null
    }
    const facts = []
    const key = new Set()
    for (const d of drafts) for (const f of d.facts ?? []) {
        const s = resolve(f?.s)
        if (!s) { dropped('fact: subject is no entity'); continue }
        if (!RELS.has(f.r)) { dropped('fact: relation not in the list'); continue }
        let status = ['fact', 'rumor', 'unknown', 'outdated'].includes(f.status) ? f.status : null
        if (!status) { dropped('fact: bad status'); continue }
        let o = f.o === undefined || f.o === null || String(f.o).trim() === '' ? null : String(f.o).normalize('NFC').trim()
        if (ENTITY_REL.has(f.r)) {
            o = resolve(o)
            if (!o) { dropped(`fact: ${f.r} object is no entity`); continue }
            if (o === s) { dropped('fact: relation to itself'); continue }
        } else if (o === null && status !== 'unknown') { dropped(`fact: ${f.r} without a value`); continue }
        else if (o !== null) o = f.r === 'status' ? norm(o) : o.slice(0, 120)
        const book = bookOf(f.source)
        if (!book) { dropped('fact: source is no book of this card'); continue }
        const text = String(f.text ?? '').replace(/\s+/g, ' ').trim()
        if ([...text].length < 8) { dropped('fact: no text'); continue }
        // the sentence must name the subject or the other side (any of their names, accents folded): a fact whose words are about
        // someone else was misfiled by the draft (seen 2026-10-21: "kisaragi ally_of kurogane-kai" over a sentence about the Sharks)
        const said = fold(text)
        const mentions = (id) => id && (namesOf.get(id) ?? [id]).some((n) => n.length >= 3 && said.includes(n))
        if (!mentions(s) && !(ENTITY_REL.has(f.r) && mentions(o))) { dropped('fact: sentence names neither side'); continue }
        const k = `${s}|${f.r}|${o}|${status}`
        if (key.has(k)) { dropped('fact: duplicate'); continue }
        key.add(k)
        // status and knowers agree (specs/story/graph/GraphStatus.als: the schema alone allows both contradictions, and the drafts had
        // 30 of them): a rumor is known as a rumor; an "unknown" that somebody knows is a secret, i.e. a fact with its knowers
        let kb = (Array.isArray(f.known_by) ? f.known_by : []).map((k) => ({ who: resolve(k?.who), as: k?.as === 'rumor' ? 'rumor' : 'fact' })).filter((k) => k.who)
        if (status === 'rumor') kb = kb.map((k) => ({ ...k, as: 'rumor' }))
        if (status === 'unknown' && kb.length) { status = 'fact'; dropped('fact: unknown known to someone -> a secret (fact)') }
        const fact = { s, r: f.r, o, status, text: [...text].slice(0, 400).join(''), source: `book:${book}`.slice(0, 200) }
        if (status === 'outdated') fact.until = String(f.until ?? '').trim().slice(0, 160) || 'the books say it ended'
        if (kb.length) fact.known_by = kb.slice(0, 20)
        facts.push(fact)
    }
    const graph = { world, version: 1, built: new Date().toISOString().slice(0, 10), entities, facts }
    return { graph, drop, errors: validate(SCHEMA, graph) }
}

function main() {
    const [world, lorebook, dir0, out0] = process.argv.slice(2)
    const dir = dir0 || path.join(process.env.HOME, '.backend-review/work/risu-librarian-kg/extract', world)
    const out = out0 || path.join(__dirname, '..', `${world}.json`)
    const drafts = fs.readdirSync(dir).filter((f) => /^batch-\d+\.json$/.test(f)).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')))
    const { graph, drop, errors } = merge(world, drafts, booksOf(lorebook))
    if (errors.length) { console.error(errors.slice(0, 20).join('\n')); process.exit(1) }
    fs.writeFileSync(out, JSON.stringify(graph) + '\n')
    const by = (k) => graph.facts.reduce((m, f) => ((m[f[k]] = (m[f[k]] ?? 0) + 1), m), {})
    console.log(JSON.stringify({ world, drafts: drafts.length, entities: graph.entities.length, facts: graph.facts.length, status: by('status'), dropped: drop, bytes: fs.statSync(out).size }))
}

if (require.main === module) main()
module.exports = { merge, norm, ENTITY_REL }
