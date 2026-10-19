'use strict'
// Copied from architecture-debug tools/lib/pddl/pddl.cjs (03aebda); Risu keeps its own copy and never reads that repo.
// A small typed-STRIPS PDDL planner: parser, grounder, breadth-first or greedy best-first search, plan validator.
//
// Supported: (:requirements :strips :typing :negative-preconditions :equality), (:types a b - c), (:constants), (:predicates),
// (:action :parameters :precondition :effect) where a precondition is a conjunction of literals (atom, (not atom), (= ?a ?b),
// (not (= ?a ?b))) and an effect is a conjunction of atoms and (not atom). A problem has (:objects), (:init) and (:goal) (a
// conjunction of literals). Anything else (or, forall, when, numeric fluents, durative actions) is refused with a parse error
// instead of being half-understood.
//
// Search: 'bfs' (shortest plan; default) or 'gbfs' (greedy best-first on the number of goal literals not yet true). A search that
// empties its frontier answers {ok:false, reason:'unsolvable'}: the goal is not reachable from the initial state. One that hits
// maxExpansions or timeoutMs answers reason 'limit' or 'timeout', which says nothing about reachability.
// Before searching, a delete-relaxed reachability pass (every add kept, every delete ignored; an action whose negative precondition
// names an atom true at the start and deleted by no action never applies) answers 'unsolvable' with relaxed:true when a positive
// goal atom cannot be reached even so. That is sound (the relaxation only over-approximates) and needs no search, so a world with
// a large state space still proves "impossible" quickly, e.g. joining an organization whose only leader is dead.

class PddlError extends Error {}

// ---- reading ---------------------------------------------------------------------------------------------------------------------
function tokenize(text) {
    const out = []
    const src = String(text).replace(/;[^\n]*/g, ' ')
    const re = /\(|\)|[^\s()]+/g
    let m
    while ((m = re.exec(src))) out.push(m[0].toLowerCase())
    return out
}

function parseSexp(text) {
    const toks = tokenize(text)
    let i = 0
    function read() {
        if (i >= toks.length) throw new PddlError('unexpected end of input')
        const t = toks[i++]
        if (t === '(') {
            const list = []
            while (true) {
                if (i >= toks.length) throw new PddlError('missing )')
                if (toks[i] === ')') { i++; return list }
                list.push(read())
            }
        }
        if (t === ')') throw new PddlError('unexpected )')
        return t
    }
    const v = read()
    if (i !== toks.length) throw new PddlError('text after the closing parenthesis')
    return v
}

/** `?a ?b - place ?c` → [{name:'?a',type:'place'},{name:'?b',type:'place'},{name:'?c',type:'object'}] */
function typedList(list) {
    if (!Array.isArray(list)) throw new PddlError('expected a list of names')
    const out = []
    let pending = []
    for (let i = 0; i < list.length; i++) {
        const t = list[i]
        if (Array.isArray(t)) throw new PddlError('unexpected list in a typed list (either types are not supported)')
        if (t === '-') {
            const type = list[++i]
            if (typeof type !== 'string') throw new PddlError('a type name must follow -')
            for (const n of pending) out.push({ name: n, type })
            pending = []
        } else pending.push(t)
    }
    for (const n of pending) out.push({ name: n, type: 'object' })
    return out
}

function sections(list, from) {
    const out = {}
    for (const s of list.slice(from)) {
        if (!Array.isArray(s) || typeof s[0] !== 'string' || !s[0].startsWith(':')) throw new PddlError('expected a (:section ...)')
        if (s[0] === ':action') (out[':action'] ??= []).push(s)
        else if (out[s[0]]) throw new PddlError(`${s[0]} appears twice`)
        else out[s[0]] = s
    }
    return out
}

function literals(f, where) {
    if (f === undefined || (Array.isArray(f) && f.length === 0)) return []
    if (!Array.isArray(f)) throw new PddlError(`${where}: expected a formula`)
    if (f[0] === 'and') return f.slice(1).flatMap((g) => literals(g, where))
    if (f[0] === 'not') {
        if (f.length !== 2 || !Array.isArray(f[1])) throw new PddlError(`${where}: (not ...) takes one atom`)
        const inner = literals(f[1], where)
        if (inner.length !== 1 || inner[0].neg) throw new PddlError(`${where}: (not ...) takes one atom`)
        return [{ neg: true, atom: inner[0].atom }]
    }
    if (['or', 'imply', 'forall', 'exists', 'when'].includes(f[0])) throw new PddlError(`${where}: ${f[0]} is not supported`)
    if (f.some(Array.isArray)) throw new PddlError(`${where}: nested term in an atom`)
    return [{ neg: false, atom: f }]
}

const SUPPORTED = new Set([':strips', ':typing', ':negative-preconditions', ':equality'])

function parseDomain(text) {
    const d = parseSexp(text)
    if (!Array.isArray(d) || d[0] !== 'define' || !Array.isArray(d[1]) || d[1][0] !== 'domain') throw new PddlError('not a (define (domain ...))')
    const s = sections(d, 2)
    const requirements = (s[':requirements'] ?? [':requirements', ':strips']).slice(1)
    for (const r of requirements) if (!SUPPORTED.has(r)) throw new PddlError(`requirement ${r} is not supported`)
    const parent = new Map([['object', null]])
    for (const t of typedList((s[':types'] ?? [':types']).slice(1))) parent.set(t.name, t.type)
    for (const p of [...parent.values()]) if (p && !parent.has(p)) parent.set(p, 'object')
    const constants = typedList((s[':constants'] ?? [':constants']).slice(1))
    const predicates = new Map()
    for (const p of (s[':predicates'] ?? [':predicates']).slice(1)) {
        if (!Array.isArray(p) || typeof p[0] !== 'string') throw new PddlError('bad predicate declaration')
        predicates.set(p[0], typedList(p.slice(1)))
    }
    const actions = []
    for (const a of s[':action'] ?? []) {
        const name = a[1]
        const kv = {}
        for (let i = 2; i < a.length; i += 2) kv[a[i]] = a[i + 1]
        const params = typedList(kv[':parameters'] ?? [])
        const pre = literals(kv[':precondition'], `action ${name} precondition`)
        const effLits = literals(kv[':effect'], `action ${name} effect`)
        const vars = new Set(params.map((p) => p.name))
        for (const l of [...pre, ...effLits]) {
            const [pred, ...args] = l.atom
            if (pred !== '=' && !predicates.has(pred)) throw new PddlError(`action ${name}: unknown predicate ${pred}`)
            if (pred !== '=' && predicates.get(pred).length !== args.length) throw new PddlError(`action ${name}: ${pred} takes ${predicates.get(pred).length} arguments`)
            for (const x of args) if (x.startsWith('?') && !vars.has(x)) throw new PddlError(`action ${name}: ${x} is not a parameter`)
        }
        for (const l of effLits) if (l.atom[0] === '=') throw new PddlError(`action ${name}: = in an effect`)
        actions.push({ name, params, pre, add: effLits.filter((l) => !l.neg).map((l) => l.atom), del: effLits.filter((l) => l.neg).map((l) => l.atom) })
    }
    return { name: d[1][1], requirements, parent, constants, predicates, actions }
}

function parseProblem(text, domain) {
    const p = parseSexp(text)
    if (!Array.isArray(p) || p[0] !== 'define' || !Array.isArray(p[1]) || p[1][0] !== 'problem') throw new PddlError('not a (define (problem ...))')
    const s = sections(p, 2)
    const objects = typedList((s[':objects'] ?? [':objects']).slice(1))
    const init = (s[':init'] ?? [':init']).slice(1)
    for (const a of init) if (!Array.isArray(a) || a.some(Array.isArray)) throw new PddlError(':init holds atoms only')
    const goal = literals(s[':goal']?.[1], 'goal')
    const prob = { name: p[1][1], domainName: s[':domain']?.[1], objects, init, goal }
    if (domain) checkProblem(domain, prob)
    return prob
}

/** a goal on its own, e.g. "(and (at dark-city) (not (exhausted)))" */
function parseGoal(text, domain, problem) {
    const g = literals(parseSexp(text), 'goal')
    if (domain && problem) checkAtoms(domain, objectTypes(domain, problem), g.map((l) => l.atom), 'goal')
    return g
}

function objectTypes(domain, problem) {
    const types = new Map()
    for (const o of [...domain.constants, ...problem.objects]) {
        if (!domain.parent.has(o.type)) throw new PddlError(`object ${o.name}: unknown type ${o.type}`)
        types.set(o.name, o.type)
    }
    return types
}

function isA(domain, type, want) {
    for (let t = type; t; t = domain.parent.get(t)) if (t === want) return true
    return want === 'object'
}

function checkAtoms(domain, types, atoms, where) {
    for (const [pred, ...args] of atoms) {
        if (pred === '=') { for (const x of args) if (!types.has(x)) throw new PddlError(`${where}: unknown object ${x}`); continue }
        const decl = domain.predicates.get(pred)
        if (!decl) throw new PddlError(`${where}: unknown predicate ${pred}`)
        if (decl.length !== args.length) throw new PddlError(`${where}: ${pred} takes ${decl.length} arguments`)
        args.forEach((x, i) => {
            if (!types.has(x)) throw new PddlError(`${where}: unknown object ${x}`)
            if (!isA(domain, types.get(x), decl[i].type)) throw new PddlError(`${where}: ${x} is not a ${decl[i].type}`)
        })
    }
}

function checkProblem(domain, prob) {
    if (prob.domainName && prob.domainName !== domain.name) throw new PddlError(`problem is for domain ${prob.domainName}, not ${domain.name}`)
    const types = objectTypes(domain, prob)
    checkAtoms(domain, types, prob.init, ':init')
    checkAtoms(domain, types, prob.goal.map((l) => l.atom), 'goal')
}

// ---- grounding -------------------------------------------------------------------------------------------------------------------
const key = (atom) => atom.join(' ')

function ground(domain, problem) {
    const types = objectTypes(domain, problem)
    const objs = [...types.keys()]
    const fluent = new Set()
    for (const a of domain.actions) for (const at of [...a.add, ...a.del]) fluent.add(at[0])
    const init = new Set(problem.init.map(key))
    const ops = []
    for (const a of domain.actions) {
        const domainOf = a.params.map((p) => objs.filter((o) => isA(domain, types.get(o), p.type)))
        const order = a.params.map((p) => p.name)
        // a static literal (its predicate never changes) is checked as soon as its variables are bound: prunes the product early
        const staticAt = a.pre.map((l) => ({ l, last: Math.max(-1, ...l.atom.slice(1).map((x) => order.indexOf(x))), isStatic: l.atom[0] === '=' || !fluent.has(l.atom[0]) }))
        const binding = {}
        const sub = (atom) => atom.map((x, i) => (i > 0 && x.startsWith('?') ? binding[x] : x))
        const holdsStatic = (l) => {
            const at = sub(l.atom)
            const v = at[0] === '=' ? at[1] === at[2] : init.has(key(at))
            return l.neg ? !v : v
        }
        const rec = (i) => {
            for (const s of staticAt) if (s.isStatic && s.last === i - 1 && !holdsStatic(s.l)) return
            if (i === order.length) {
                const pre = a.pre.filter((l) => l.atom[0] !== '=' && fluent.has(l.atom[0])).map((l) => ({ neg: l.neg, k: key(sub(l.atom)) }))
                ops.push({ name: `(${[a.name, ...order.map((v) => binding[v])].join(' ')})`, pre, add: a.add.map((x) => key(sub(x))), del: a.del.map((x) => key(sub(x))) })
                return
            }
            for (const o of domainOf[i]) { binding[order[i]] = o; rec(i + 1) }
        }
        rec(0)
    }
    return { ops, init }
}

// ---- search ----------------------------------------------------------------------------------------------------------------------
/** the ops that can ever apply under the delete relaxation, and (as .reached) every atom they can make true */
function relaxedReachable(ops, init) {
    const deleted = new Set(ops.flatMap((o) => o.del))
    const usable = ops.filter((o) => o.pre.every((l) => !l.neg || !init.has(l.k) || deleted.has(l.k)))
    const reached = new Set(init)
    const fired = new Set()
    for (let changed = true; changed;) {
        changed = false
        for (const o of usable) {
            if (fired.has(o) || !o.pre.every((l) => l.neg || reached.has(l.k))) continue
            fired.add(o)
            for (const a of o.add) if (!reached.has(a)) { reached.add(a); changed = true }
            changed = true
        }
    }
    const live = usable.filter((o) => fired.has(o))
    live.reached = reached
    return live
}

function plan(domain, problem, opts = {}) {
    const search = opts.search ?? 'bfs'
    const maxExpansions = opts.maxExpansions ?? 200000
    const deadline = Date.now() + (opts.timeoutMs ?? 10000)
    const goal = (opts.goal ?? problem.goal).map((l) => ({ neg: l.neg, k: key(l.atom), eq: l.atom[0] === '=' ? l.atom : null }))
    const grounded = ground(domain, problem)
    const init = grounded.init
    const ops = relaxedReachable(grounded.ops, init)
    if (goal.some((l) => !l.neg && !l.eq && !ops.reached.has(l.k))) return { ok: false, reason: 'unsolvable', relaxed: true, expanded: 0, grounded: grounded.ops.length }
    const sat = (st, lits) => lits.every((l) => (l.eq ? (l.eq[1] === l.eq[2]) !== l.neg : st.has(l.k) !== l.neg))
    const h = (st) => goal.reduce((n, l) => n + (sat(st, [l]) ? 0 : 1), 0)
    const id = (st) => [...st].sort().join('|')
    const start = { st: init, parent: null, op: null, g: 0 }
    if (sat(init, goal)) return { ok: true, plan: [], expanded: 0, grounded: grounded.ops.length }
    const seen = new Set([id(init)])
    // bfs: a FIFO; gbfs: a binary heap on (h, insertion order) so ties keep breadth-first order
    let frontier = [start]
    let head = 0
    const heap = []
    let seq = 0
    const push = (n) => {
        if (search === 'bfs') { frontier.push(n); return }
        n.h = h(n.st); n.seq = seq++
        heap.push(n)
        let i = heap.length - 1
        while (i > 0) { const p = (i - 1) >> 1; if (less(heap[i], heap[p])) { [heap[i], heap[p]] = [heap[p], heap[i]]; i = p } else break }
    }
    const less = (a, b) => a.h < b.h || (a.h === b.h && a.seq < b.seq)
    const pop = () => {
        if (search === 'bfs') return head < frontier.length ? frontier[head++] : null
        if (!heap.length) return null
        const top = heap[0]
        const last = heap.pop()
        if (heap.length) {
            heap[0] = last
            let i = 0
            while (true) {
                const l = 2 * i + 1, r = l + 1
                let m = i
                if (l < heap.length && less(heap[l], heap[m])) m = l
                if (r < heap.length && less(heap[r], heap[m])) m = r
                if (m === i) break;
                [heap[i], heap[m]] = [heap[m], heap[i]]; i = m
            }
        }
        return top
    }
    if (search !== 'bfs') { frontier = null; push(start) }
    else frontier = [start]
    let expanded = 0
    for (let n = pop(); n; n = pop()) {
        if (++expanded > maxExpansions) return { ok: false, reason: 'limit', expanded: expanded - 1, grounded: grounded.ops.length }
        if ((expanded & 255) === 0 && Date.now() > deadline) return { ok: false, reason: 'timeout', expanded, grounded: grounded.ops.length }
        for (const op of ops) {
            if (!op.pre.every((l) => n.st.has(l.k) !== l.neg)) continue
            const next = new Set(n.st)
            for (const d of op.del) next.delete(d)
            for (const a of op.add) next.add(a)
            const k = id(next)
            if (seen.has(k)) continue
            seen.add(k)
            const child = { st: next, parent: n, op: op.name, g: n.g + 1 }
            if (sat(next, goal)) {
                const steps = []
                for (let c = child; c.parent; c = c.parent) steps.push(c.op)
                return { ok: true, plan: steps.reverse(), expanded, grounded: grounded.ops.length }
            }
            push(child)
        }
    }
    return { ok: false, reason: 'unsolvable', expanded, grounded: grounded.ops.length }
}

/** replays a plan from the initial state: every step's precondition must hold and the goal must hold at the end */
function validate(domain, problem, steps, goal) {
    const { ops, init } = ground(domain, problem)
    const byName = new Map(ops.map((o) => [o.name, o]))
    const st = new Set(init)
    for (const [i, s] of steps.entries()) {
        const op = byName.get(s)
        if (!op) return { ok: false, step: i, reason: `not an applicable ground action: ${s}` }
        const bad = op.pre.find((l) => st.has(l.k) === l.neg)
        if (bad) return { ok: false, step: i, reason: `precondition ${bad.neg ? 'not ' : ''}(${bad.k}) does not hold` }
        for (const d of op.del) st.delete(d)
        for (const a of op.add) st.add(a)
    }
    const g = (goal ?? problem.goal).find((l) => (l.atom[0] === '=' ? (l.atom[1] === l.atom[2]) === l.neg : st.has(key(l.atom)) === l.neg))
    return g ? { ok: false, step: steps.length, reason: `goal literal ${g.neg ? 'not ' : ''}(${key(g.atom)}) does not hold` } : { ok: true }
}

/** one call for the CLI and for callers: texts in, JSON-able answer out, never throws */
function solve({ domain, problem, goal, search, maxExpansions, timeoutMs }) {
    try {
        const d = parseDomain(domain)
        const p = parseProblem(problem, d)
        const g = goal ? parseGoal(goal, d, p) : undefined
        return plan(d, p, { goal: g, search, maxExpansions, timeoutMs })
    } catch (e) {
        if (e instanceof PddlError) return { ok: false, reason: 'parse', error: e.message }
        throw e
    }
}

module.exports = { parseSexp, parseDomain, parseProblem, parseGoal, ground, plan, validate, solve, PddlError }
