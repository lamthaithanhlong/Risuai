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
    } else if (typeof change.desc !== 'string') {
        throw new Error('nothing to change')
    }
    const out = Buffer.from(JSON.stringify(next), 'utf8')
    // round trip: what a page will read
    const back = JSON.parse(out.toString('utf8'))
    const strip = (c) => { const { globalLore, desc, ...rest } = c; return JSON.stringify(rest) }
    if (strip(back) !== strip(before)) throw new Error('round trip: something besides the lorebook changed; nothing written')
    if (JSON.stringify(back.globalLore) !== JSON.stringify(next.globalLore)) throw new Error('round trip: the lorebook did not read back as written')
    if (typeof change.desc === 'string' && back.desc !== change.desc) throw new Error('round trip: the description did not read back as written')
    if (change.entry && !back.globalLore.some((x) => x.comment === change.entry.comment && x.content === toRisuLore(change.entry).content)) {
        throw new Error('round trip: the entry is not in the result')
    }
    const chats = (c) => (c.chats ?? []).reduce((n, ch) => n + (ch.message ?? []).length, 0)
    return {
        out,
        report: { lore: [before.globalLore.length, back.globalLore.length], messages: chats(before), bytes: [current.length, out.length] },
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
    if (!saveDir || !prefix || (!opt('--lore') && !opt('--entry') && !opt('--desc'))) {
        console.error('usage: remoteCardPatch.cjs <save dir> <chaId prefix> --lore <risu_lorebook.json> | --entry "<comment>=<file.json>" [--desc <card.json>] [--restart] [--backup-dir DIR] [--dry-run]')
        process.exit(2)
    }
    const change = opt('--lore')
        ? { lore: JSON.parse(fs.readFileSync(opt('--lore'), 'utf8')).data }
        : opt('--entry')
            ? { entry: (() => { const [c, f] = opt('--entry').split('='); return { ...JSON.parse(fs.readFileSync(f, 'utf8')), comment: c } })() }
            : {}
    if (opt('--desc')) change.desc = JSON.parse(fs.readFileSync(opt('--desc'), 'utf8')).data.description
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

module.exports = { patchRemoteBytes, patchRemoteCard, resolveChaId, hexKey }
