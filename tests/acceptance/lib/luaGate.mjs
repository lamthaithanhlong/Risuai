// The Lua of the candidate card in a gate's copy of the save. The copy is a snapshot of the live save, so its card carries whatever
// Lua the card had then; a gate that patches only the lore and the description (the first version) ran the card with the OLD Lua,
// the growth system was never exercised, and --stats could never pass. Now the copy gets the candidate's built Lua through the same
// function a live push uses (remoteCardPatch --lua), and the gate refuses to play unless the copy's Lua hash equals the candidate's.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const rcp = () => createRequire(import.meta.url)('../../../server/node/remoteCardPatch.cjs')

/** The scripts the candidate's built card json (first *_fate.json in the dir) ships: { file, scripts, hash }. */
export function candidateLua(candidateDir) {
    const { luaScriptsOf, luaHash } = rcp()
    const file = fs.readdirSync(candidateDir).filter((f) => /_fate\.json$/.test(f)).sort()[0]
    if (!file) throw new Error(`no *_fate.json (built card) in ${candidateDir}`)
    const scripts = luaScriptsOf(JSON.parse(fs.readFileSync(path.join(candidateDir, file), 'utf8')))
    return { file, scripts, hash: luaHash(scripts) }
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
export function patchGateCopy({ saveDir, prefix, candidateDir, lore, desc, drop = [], backupDir, store = null, id = null, log = () => {} }) {
    const real = rcp()
    const cand = candidateLua(candidateDir)
    const opts = { backupDir, ...(store ? { store } : {}), ...(id ? { id } : {}) }
    const r = real.patchRemoteCard(saveDir, prefix, { lore, desc, lua: { scripts: cand.scripts, drop } }, opts)
    const back = real.readCardLuaHash(saveDir, prefix, cand.scripts, { ...(store ? { store } : {}), ...(id ? { id } : {}) })
    for (const x of r.report.lua ?? []) log(`lua ${x.action}: ${x.name} (${x.before ? `${x.before.bytes} B ${x.before.sha}` : '-'} -> ${x.after ? `${x.after.bytes} B ${x.after.sha}` : '-'})`)
    const check = luaHashCheck({ candidate: cand.hash, copy: back.hash, found: back.found, of: back.of, drop })
    if (check.status !== 'PASS') throw new Error(`gate copy: ${check.summary}`)
    return { report: r.report, luaHash: { candidate: cand.hash, copy: back.hash, found: back.found, of: back.of, drop }, scripts: r.report.lua ?? [], file: cand.file }
}
