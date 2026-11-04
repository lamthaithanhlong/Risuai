#!/usr/bin/env node
// Patches the lorebook of a REMOTE card (enableRemoteSaving: the card and all its chats live in remotes/<chaId>.local.bin, written
// whole by each page) in one command: back up the file, replace the entries, read the result back, restart the server, and say that
// open pages must reload.
//
// Why (2026-11-03): patching the live Zombie card was launchctl bootout, a hand-written patch.cjs, a restart. Nothing checked that
// the chats survived, and a page that had been open since before the patch wrote its older copy of the card back over it.
//
//   node server/node/remoteCardPatch.cjs <save dir> <chaId prefix> --lore <risu_lorebook.json> [--entry "<comment>=<file.json>"]
//        [--restart] [--backup-dir DIR] [--dry-run]
//     --lore    replace the card's whole lorebook with the file's entries (a built risu_lorebook.json)
//     --entry   replace (or add) ONE entry, matched by its comment; the file holds one entry object
//     --desc    also replace the card's description (desc) with data.description of a built card json (main_description lives there, not in the lorebook)
//     --lua     replace the card's Lua trigger scripts (card.triggerscript, top level of the remote file) with the ones a built card json
//               ships (data.extensions.risuai.triggerscript), matched by script comment: same comment = replaced, new = added, any other
//               script already in the card is KEPT. Why: the Lua (stats.lua, loadout.lua, status.lua, imagegen.lua) rides in the card, not in
//               the lorebook, so a push without it left the old Lua running.
//     --lua-drop "<comment>"  with --lua: also remove the script with that comment (a script the build renamed or no longer ships; kept
//               scripts would otherwise run next to the new one). Repeat the flag for several.
//     --default-vars  with --lua: also set the card's defaultVariables (top level of the remote file) to the built card's
//               data.extensions.risuai.defaultVariables, so a variable the Lua reads (finds_by_lua=0) is explicit instead of absent. Opt-in.
//     --restart stop com.risu.server (launchd) first and start it after; without it the server must already be stopped
//     --dry-run do everything except the write and the restart
const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { toRisuLore, pendingQueueRows } = require('./loreImport.cjs')

const hexKey = (chaId) => Buffer.from(`remotes/${chaId}.local.bin`, 'utf-8').toString('hex')
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

/** The card's full chaId from a prefix: the names of database.bin's blocks. */
function resolveChaId(saveDir, prefix, store) {
    const { decodeSave } = require('./dbMerge.cjs')
    const DB_FILE = '64617461626173652f64617461626173652e62696e'
    const bytes = store.read(DB_FILE)
    if (!bytes) throw new Error(`no database/database.bin in ${saveDir}`)
    const names = decodeSave(bytes).map((b) => b.name).filter((n) => n.startsWith(prefix))
    if (names.length !== 1) throw new Error(`${names.length} cards start with "${prefix}"${names.length ? ': ' + names.join(', ') : ''}`)
    return names[0]
}

const short = (b) => sha(b).slice(0, 8)
const codeOf = (s) => (s.effect ?? []).filter((e) => e && typeof e.code === 'string').map((e) => e.code).join('\n')

/** The Lua trigger scripts a built card json (the character-card export) ships. Refuses a card with none (a typo'd file must not wipe Lua). */
function luaScriptsOf(card) {
    const list = card?.data?.extensions?.risuai?.triggerscript
    if (!Array.isArray(list) || !list.length) throw new Error('the built card ships no triggerscript (data.extensions.risuai.triggerscript)')
    for (const s of list) {
        if (!s || typeof s.comment !== 'string' || !s.comment) throw new Error('a shipped script has no comment to match on')
        if (!Array.isArray(s.effect)) throw new Error(`the shipped script "${s.comment}" has no effect list`)
    }
    if (new Set(list.map((s) => s.comment)).size !== list.length) throw new Error('two shipped scripts share a comment')
    return list
}

/** One hash of a set of scripts: order-free (sorted by comment), covers comment, type and every effect's code. */
function luaHash(scripts) {
    const h = crypto.createHash('sha256')
    for (const s of [...scripts].sort((a, b) => (a.comment < b.comment ? -1 : a.comment > b.comment ? 1 : 0))) {
        h.update(JSON.stringify([s.comment, s.type ?? '', s.conditions ?? [], (s.effect ?? []).map((e) => [e.type, e.code ?? '']), !!s.lowLevelAccess]))
        h.update('\n')
    }
    return h.digest('hex')
}

/** The scripts of this card's current Lua that a `lua` change ships (by comment): what luaHash compares between a copy and the candidate. */
function shippedPart(cardScripts, shipped) {
    const names = new Set(shipped.map((s) => s.comment))
    return (cardScripts ?? []).filter((s) => names.has(s.comment))
}

/**
 * The remote file's bytes with the lorebook changed. `change` is { lore: [entries] } (whole book) or { entry: {comment, ...} } (one).
 * Reads the result back and refuses when anything but the lorebook differs (the chats are the player's story) or the change did not
 * land. Returns { out, report }.
 */
function patchRemoteBytes(current, change) {
    if (!current || !current.length) throw new Error('the remote file is empty or missing (not a remote card?)')
    const before = JSON.parse(Buffer.from(current).toString('utf8'))
    if (!Array.isArray(before.globalLore)) throw new Error('the remote file has no globalLore')
    const next = structuredClone(before)
    const strip = (c) => { const { globalLore, desc, triggerscript, defaultVariables, ...rest } = c; return JSON.stringify(rest) }
    if (typeof change.defaultVars === 'string') next.defaultVariables = change.defaultVars
    if (typeof change.desc === 'string') {
        if (!change.desc.trim()) throw new Error('the new description is empty')
        next.desc = change.desc
    }
    if (change.lore) {
        next.globalLore = change.lore.map(toRisuLore)
    } else if (change.entry) {
        const e = toRisuLore(change.entry)
        if (!e.comment) throw new Error('the entry has no comment to match on')
        const i = next.globalLore.findIndex((x) => x.comment === e.comment)
        if (i >= 0) next.globalLore[i] = e
        else next.globalLore.push(e)
    } else if (typeof change.desc !== 'string' && !change.lua && typeof change.defaultVars !== 'string') {
        throw new Error('nothing to change')
    }
    let lua = null
    if (change.lua) {
        const shipped = change.lua.scripts
        const drop = change.lua.drop ?? []
        if (!Array.isArray(shipped) || !shipped.length) throw new Error('no Lua scripts to write')
        const cur = Array.isArray(before.triggerscript) ? before.triggerscript : []
        const names = new Set(shipped.map((s) => s.comment))
        for (const d of drop) if (names.has(d)) throw new Error(`"${d}" is both shipped and dropped`)
        const list = cur.filter((s) => !drop.includes(s.comment))
        lua = []
        for (const d of drop) {
            const old = cur.find((s) => s.comment === d)
            lua.push({ name: d, action: old ? 'drop' : 'drop (not in the card)', before: old ? { bytes: codeOf(old).length, sha: short(codeOf(old)) } : null, after: null })
        }
        for (const s of shipped) {
            const i = list.findIndex((x) => x.comment === s.comment)
            const old = i >= 0 ? list[i] : null
            const same = old && JSON.stringify(old) === JSON.stringify(s)
            lua.push({ name: s.comment, action: !old ? 'add' : same ? 'same' : 'replace', before: old ? { bytes: codeOf(old).length, sha: short(codeOf(old)) } : null, after: { bytes: codeOf(s).length, sha: short(codeOf(s)) } })
            if (old) list[i] = structuredClone(s)
            else list.push(structuredClone(s))
        }
        for (const s of list) if (!names.has(s.comment)) lua.push({ name: s.comment, action: 'keep', before: { bytes: codeOf(s).length, sha: short(codeOf(s)) }, after: null })
        next.triggerscript = list
    }
    const out = Buffer.from(JSON.stringify(next), 'utf8')
    // round trip: what a page will read
    const back = JSON.parse(out.toString('utf8'))
    if (strip(back) !== strip(before)) throw new Error('round trip: something besides the lorebook changed; nothing written')
    if (JSON.stringify(back.globalLore) !== JSON.stringify(next.globalLore)) throw new Error('round trip: the lorebook did not read back as written')
    if (typeof change.defaultVars === 'string' && back.defaultVariables !== change.defaultVars) throw new Error('round trip: the default variables did not read back as written')
    if (typeof change.defaultVars !== 'string' && back.defaultVariables !== before.defaultVariables) throw new Error('round trip: the default variables changed without --default-vars; nothing written')
    if (typeof change.desc === 'string' && back.desc !== change.desc) throw new Error('round trip: the description did not read back as written')
    if (change.entry && !back.globalLore.some((x) => x.comment === change.entry.comment && x.content === toRisuLore(change.entry).content)) {
        throw new Error('round trip: the entry is not in the result')
    }
    if (change.lua) {
        const have = back.triggerscript ?? []
        if (JSON.stringify(have) !== JSON.stringify(next.triggerscript)) throw new Error('round trip: the Lua did not read back as written')
        for (const s of change.lua.scripts) if (!have.some((x) => JSON.stringify(x) === JSON.stringify(s))) throw new Error(`round trip: the script "${s.comment}" is not in the result`)
        if (luaHash(shippedPart(have, change.lua.scripts)) !== luaHash(change.lua.scripts)) throw new Error('round trip: the Lua hash does not match the built card')
    } else if (JSON.stringify(back.triggerscript) !== JSON.stringify(before.triggerscript)) {
        throw new Error('round trip: the Lua changed without --lua; nothing written')
    }
    const chats = (c) => (c.chats ?? []).reduce((n, ch) => n + (ch.message ?? []).length, 0)
    return {
        out,
        report: { defaultVars: typeof change.defaultVars === 'string' ? [before.defaultVariables ?? null, back.defaultVariables] : null, lua, luaHash: change.lua ? luaHash(shippedPart(back.triggerscript, change.lua.scripts)) : null, lore: [before.globalLore.length, back.globalLore.length], messages: chats(before), bytes: [current.length, out.length] },
    }
}

/**
 * Backup, patch and record the write in dbSync as its own client (so a page that read the old file merges at its next write
 * instead of replacing it). The server must be stopped. Returns { chaId, backup, report }.
 */
function patchRemoteCard(saveDir, prefix, change, { backupDir = path.join(os.homedir(), '.risu-story-work', 'remote-backups'), dryRun = false, id = null, store = null } = {}) {
    const { openSaveStore, resolveBackend } = require('./saveStore.cjs')
    const own = store ? null : openSaveStore({ saveDir, backend: resolveBackend() })
    const st = store ?? own
    try {
        const chaId = id ?? resolveChaId(saveDir, prefix, st)
        const key = hexKey(chaId)
        const current = st.read(key)
        const { out, report } = patchRemoteBytes(current, change)
        fs.mkdirSync(backupDir, { recursive: true })
        const backup = path.join(backupDir, `${chaId}-${new Date().toISOString().replace(/[:.]/g, '-')}.bin`)
        fs.writeFileSync(backup, current)
        if (sha(fs.readFileSync(backup)) !== sha(current)) throw new Error('the backup does not match the file; nothing written')
        if (dryRun) return { chaId, backup, report, written: false }
        const syncFile = path.resolve(saveDir) + '.sync.sqlite'
        st.update(key, (cur) => {
            if (!cur || sha(cur) !== sha(current)) throw new Error('the remote file changed while patching; run again')
            let stored = out
            if (fs.existsSync(syncFile)) {
                const { openDbSync } = require('./dbSync.cjs')
                const sync = openDbSync({ dbFile: syncFile, log: () => {} })
                try { stored = sync.onRemoteWrite('remote-patch', chaId, out, cur).bytes } finally { sync.close() }
            }
            return stored
        })
        const read = st.read(key)
        if (!read || !read.length) throw new Error('read back after the write: the file is empty')
        JSON.parse(Buffer.from(read).toString('utf8'))
        return { chaId, backup, report, written: true }
    } finally {
        own?.close()
    }
}

/** Read-only: the luaHash of the card's scripts that `shipped` covers, as the save holds them now (what a gate checks after patching its copy). */
function readCardLuaHash(saveDir, prefix, shipped, { id = null, store = null } = {}) {
    const { openSaveStore, resolveBackend } = require('./saveStore.cjs')
    const own = store ? null : openSaveStore({ saveDir, backend: resolveBackend() })
    const st = store ?? own
    try {
        const bytes = st.read(hexKey(id ?? resolveChaId(saveDir, prefix, st)))
        if (!bytes || !bytes.length) throw new Error('the remote file is empty or missing (not a remote card?)')
        const card = JSON.parse(Buffer.from(bytes).toString('utf8'))
        const part = shippedPart(card.triggerscript, shipped)
        return { hash: luaHash(part), found: part.length, of: shipped.length }
    } finally { own?.close() }
}

const LABEL = 'com.risu.server'
const uid = () => process.getuid()
function launchd(args) { return execFileSync('launchctl', args, { encoding: 'utf8' }) }
function serverUp(port = 6001) {
    return new Promise((resolve) => {
        const s = require('net').connect(port, '127.0.0.1')
        s.once('connect', () => { s.destroy(); resolve(true) })
        s.once('error', () => resolve(false))
    })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(pred, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await pred()) return true; await sleep(300) } return false }

async function main(argv) {
    const [saveDir, prefix, ...rest] = argv
    const opt = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined }
    const has = (n) => rest.includes(n)
    if (!saveDir || !prefix || (!opt('--lore') && !opt('--entry') && !opt('--desc') && !opt('--lua'))) {
        console.error('usage: remoteCardPatch.cjs <save dir> <chaId prefix> --lore <risu_lorebook.json> | --entry "<comment>=<file.json>" [--desc <card.json>] [--lua <built card.json> [--default-vars] [--lua-drop "<comment>"]...] [--restart] [--backup-dir DIR] [--dry-run]')
        process.exit(2)
    }
    const change = opt('--lore')
        ? { lore: JSON.parse(fs.readFileSync(opt('--lore'), 'utf8')).data }
        : opt('--entry')
            ? { entry: (() => { const [c, f] = opt('--entry').split('='); return { ...JSON.parse(fs.readFileSync(f, 'utf8')), comment: c } })() }
            : {}
    if (opt('--desc')) change.desc = JSON.parse(fs.readFileSync(opt('--desc'), 'utf8')).data.description
    if (has('--default-vars')) {
        if (!opt('--lua')) throw new Error('--default-vars reads the built card of --lua')
        const dv = JSON.parse(fs.readFileSync(opt('--lua'), 'utf8')).data?.extensions?.risuai?.defaultVariables
        if (typeof dv !== 'string') throw new Error('the built card has no defaultVariables')
        change.defaultVars = dv
    }
    if (opt('--lua')) {
        const drop = rest.flatMap((a, i) => (a === '--lua-drop' && rest[i + 1] ? [rest[i + 1]] : []))
        change.lua = { scripts: luaScriptsOf(JSON.parse(fs.readFileSync(opt('--lua'), 'utf8'))), drop }
    }
    const port = Number(process.env.PORT) || 6001
    const restart = has('--restart')
    const dryRun = has('--dry-run')
    if (restart && !dryRun) {
        console.log(`stopping ${LABEL} (its save queue flushes on SIGTERM) ...`)
        launchd(['bootout', `gui/${uid()}/${LABEL}`])
        if (!await waitFor(async () => !(await serverUp(port)), 30000)) throw new Error(`the server still answers on :${port}`)
    } else if (await serverUp(port) && !dryRun) {
        throw new Error(`the Risu server is running on :${port}; stop it first, or pass --restart`)
    }
    const queued = pendingQueueRows(saveDir)
    if (queued && !dryRun) throw new Error(`the save queue still holds ${queued} write(s) not applied; start the server and stop it with SIGTERM first`)
    let failure = null
    try {
        const r = patchRemoteCard(saveDir, prefix, change, { backupDir: opt('--backup-dir') ?? undefined, dryRun })
        console.log(`${r.written ? 'patched' : 'dry run, nothing written'}: card ${r.chaId}`)
        console.log(`  backup:   ${r.backup}`)
        console.log(`  lore:     ${r.report.lore[0]} -> ${r.report.lore[1]} entries; chats untouched (${r.report.messages} messages)`)
        if (r.report.defaultVars) console.log(`  defaultVariables: ${JSON.stringify(r.report.defaultVars[0])} -> ${JSON.stringify(r.report.defaultVars[1])}`)
        if (r.report.lua) {
            console.log(`  lua:      ${r.report.lua.filter((x) => x.action !== 'keep' && x.action !== 'same').length} script(s) change, hash ${r.report.luaHash.slice(0, 12)}`)
            for (const x of r.report.lua) console.log(`    ${x.action.padEnd(8)} ${x.name}: ${x.before ? `${x.before.bytes} B ${x.before.sha}` : '-'} -> ${x.after ? `${x.after.bytes} B ${x.after.sha}` : '-'}`)
            const kept = r.report.lua.filter((x) => x.action === 'keep')
            if (kept.length) console.log(`    WARNING: ${kept.length} script(s) the built card does not ship stay in the card (a Lua script among them runs next to the new one; --lua-drop "<comment>" removes it)`)
        }
        console.log(`  size:     ${r.report.bytes[0]} -> ${r.report.bytes[1]} bytes`)
    } catch (e) {
        failure = e
    }
    if (restart && !dryRun) {
        console.log(`starting ${LABEL} ...`)
        launchd(['bootstrap', `gui/${uid()}`, path.join(os.homedir(), 'Library/LaunchAgents', `${LABEL}.plist`)])
        console.log(await waitFor(() => serverUp(port), 60000) ? `server is back on :${port}` : `WARNING: the server did not answer on :${port} within 60 s`)
    }
    if (failure) throw failure
    if (!dryRun) console.log('RELOAD EVERY OPEN PAGE of this card (Mac tab, phone) before playing: a page that was open before the patch holds the old card and writes it back at its next save.')
}

if (require.main === module) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exit(1) })

module.exports = { readCardLuaHash, luaScriptsOf, luaHash, shippedPart, patchRemoteBytes, patchRemoteCard, resolveChaId, hexKey }
