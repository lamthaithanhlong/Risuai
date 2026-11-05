// The Lua of the candidate card in a gate's copy of the save. The copy is a snapshot of the live save, so its card carries whatever
// Lua the card had then; a gate that patches only the lore and the description (the first version) ran the card with the OLD Lua,
// the growth system was never exercised, and --stats could never pass. Now the copy gets the candidate's built Lua through the same
// function a live push uses (remoteCardPatch --lua), and the gate refuses to play unless the copy's Lua hash equals the candidate's.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const rcp = () => createRequire(import.meta.url)('../../../server/node/remoteCardPatch.cjs')

/** The built card json of a candidate dir: the named file (--candidate-json, e.g. the illustrated build) or the first *_fate.json. */
export function candidateFile(candidateDir, name = null) {
    if (name) {
        if (path.basename(name) !== name) throw new Error(`--candidate-json is a file name inside the candidate dir, not a path: ${name}`)
        if (!fs.existsSync(path.join(candidateDir, name))) throw new Error(`${name} is not in ${candidateDir}`)
        return name
    }
    const file = fs.readdirSync(candidateDir).filter((f) => /_fate\.json$/.test(f)).sort()[0]
    if (!file) throw new Error(`no *_fate.json (built card) in ${candidateDir}`)
    return file
}

/** The files a gate record's `hash` covers: the lorebook, every *_fate.json, and the named built card (assetlib.push_gate does the same). */
export function gateHashFiles(candidateDir, name = null) {
    const all = fs.readdirSync(candidateDir).filter((f) => f === 'risu_lorebook.json' || /_fate\.json$/.test(f))
    if (name && !all.includes(name)) all.push(name)
    return all.sort()
}

/** The scripts the candidate's built card json ships: { file, scripts, hash, defaultVars, description }. */
export function candidateLua(candidateDir, name = null) {
    const { luaScriptsOf, luaHash } = rcp()
    const file = candidateFile(candidateDir, name)
    const card = JSON.parse(fs.readFileSync(path.join(candidateDir, file), 'utf8'))
    const scripts = luaScriptsOf(card)
    return { file, scripts, hash: luaHash(scripts), defaultVars: card.data.extensions.risuai.defaultVariables ?? '', description: card.data.description }
}

/** The gate.lua check: the copy's hash of the shipped scripts must equal the candidate's. */
export function luaHashCheck({ candidate, copy, found, of, drop = [] }) {
    const problems = []
    if (!candidate) problems.push('no candidate Lua hash recorded')
    else if (!copy) problems.push('no hash of the copy\'s Lua recorded')
    else if (found !== of) problems.push(`only ${found} of the ${of} shipped scripts are in the copy`)
    else if (copy !== candidate) problems.push(`the copy's Lua (${copy.slice(0, 12)}) is not the candidate's (${candidate.slice(0, 12)}): the card would run old Lua`)
    return {
        id: 'gate.lua', title: 'The copy runs the candidate\'s Lua (hash equal)',
        status: problems.length ? 'FAIL' : 'PASS',
        summary: problems.length ? problems[0] : `${of} script(s), hash ${candidate.slice(0, 12)}${drop.length ? `, dropped ${drop.length}` : ''}`,
        evidence: problems,
    }
}

/**
 * Patch lore + desc + the candidate's Lua into the copy at saveDir (one patchRemoteCard call), read the Lua hash back from the copy and
 * throw if it is not the candidate's. Returns { report, luaHash: {candidate, copy, found, of, drop}, scripts: [{name, action, before, after}] }.
 * `ctx` = { patchRemoteCard?, readCardLuaHash? } for tests; default the real ones.
 */
export function patchGateCopy({ saveDir, prefix, candidateDir, candidateJson = null, defaultVars = false, lore, desc = undefined, drop = [], backupDir, store = null, id = null, log = () => {} }) {
    const real = rcp()
    const cand = candidateLua(candidateDir, candidateJson)
    const opts = { backupDir, ...(store ? { store } : {}), ...(id ? { id } : {}) }
    const r = real.patchRemoteCard(saveDir, prefix, { lore, desc: desc ?? cand.description, lua: { scripts: cand.scripts, drop }, ...(defaultVars ? { defaultVars: cand.defaultVars } : {}) }, opts)
    const back = real.readCardLuaHash(saveDir, prefix, cand.scripts, { ...(store ? { store } : {}), ...(id ? { id } : {}) })
    for (const x of r.report.lua ?? []) log(`lua ${x.action}: ${x.name} (${x.before ? `${x.before.bytes} B ${x.before.sha}` : '-'} -> ${x.after ? `${x.after.bytes} B ${x.after.sha}` : '-'})`)
    const check = luaHashCheck({ candidate: cand.hash, copy: back.hash, found: back.found, of: back.of, drop })
    if (check.status !== 'PASS') throw new Error(`gate copy: ${check.summary}`)
    return { report: r.report, luaHash: { candidate: cand.hash, copy: back.hash, found: back.found, of: back.of, drop }, scripts: r.report.lua ?? [], file: cand.file }
}

// ---- gate.lua_locals: the shipped Lua must COMPILE inside the client's wrapper, with room to spare --------------------------------------
// Why: Lua allows 200 locals per function. The client (src/ts/process/scriptings.ts luaCodeWrapper) puts its own prelude (4 main-level locals)
// in front of the card's code and runs both as ONE chunk; a card at 199 locals died live with "too many local variables (limit is 200)" while
// every other check was green (the hash check above only hashes; the client swallows load errors). This check really compiles.
// Measure: K pad locals go at the very top of the wrapped chunk; the largest K that still compiles gives peak = 200 - K.
const MAXVARS = 200
const CLIENT_SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../src/ts/process/scriptings.ts')

/** The client's wrapper, read from the client source: { pre, post } = the text before and after ${code} in luaCodeWrapper's template. */
export function clientLuaWrapper(file = CLIENT_SRC) {
    const m = fs.readFileSync(file, 'utf8').match(/function luaCodeWrapper\(code:\s*string\)\s*\{\s*return `([\s\S]*?)\$\{code\}([\s\S]*?)`/)
    if (!m) throw new Error(`luaCodeWrapper not found in ${file}`)
    return { pre: m[1], post: m[2] }
}

async function compiler() {
    const { LuaFactory } = createRequire(import.meta.url)('wasmoon')
    const L = await new LuaFactory().createEngine()
    await L.doString(`function COMPILES(src) local f, e = load(src, "=card") f = nil collectgarbage() if e == nil then return "ok" end return e end`)
    return { compile: async (src) => { L.global.set('SRC', src); return String(await L.doString('local r = COMPILES(SRC) SRC = nil return r')) }, close: () => L.global.close() }
}
const pad = (k) => (k ? 'local ' + Array.from({ length: k }, (_, i) => '__pad' + i).join(', ') + '\n' : '')

/** { ok, peak, error } for one script's code as the client runs it. Fresh wasm engine per call (a shared one ran out of memory). */
export async function measureLocals(code, wrapper = clientLuaWrapper()) {
    const c = await compiler()
    try {
        const full = wrapper.pre + code + wrapper.post
        const bare = await c.compile(full)
        if (bare !== 'ok') return { ok: false, peak: null, error: bare }
        let lo = 0, hi = MAXVARS
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2)
            if ((await c.compile(pad(mid) + full)) === 'ok') lo = mid
            else hi = mid - 1
        }
        return { ok: true, peak: MAXVARS - lo, error: null }
    } finally { c.close() }
}

/** The gate.lua_locals check over the candidate's scripts (candidateLua(...).scripts): every triggerlua effect, wrapped as the client does. */
export async function luaLocalsCheck(scripts, { limit = 180 } = {}) {
    const wrapper = clientLuaWrapper()
    const problems = []
    const seen = []
    let n = 0
    for (const s of scripts ?? []) {
        for (const e of s.effect ?? []) {
            if (e.type !== 'triggerlua') continue
            n++
            const r = await measureLocals(e.code ?? '', wrapper)
            if (!r.ok) problems.push(`"${s.comment}" does not compile in the client wrapper: ${r.error}`)
            else if (r.peak >= limit) problems.push(`"${s.comment}" has ${r.peak} main-level locals at peak (client prelude included); limit ${limit} (Lua's is ${MAXVARS})`)
            else seen.push(`${s.comment}: ${r.peak}`)
        }
    }
    if (!n) problems.push('no triggerlua code to compile')
    return {
        id: 'gate.lua_locals', title: 'The shipped Lua compiles in the client wrapper with room to spare',
        status: problems.length ? 'FAIL' : 'PASS',
        summary: problems.length ? problems[0] : `${n} chunk(s) compile; peak main-level locals ${seen.map((x) => x.split(': ').pop()).join(', ')} (limit ${limit})`,
        evidence: problems.length ? problems : seen,
    }
}
