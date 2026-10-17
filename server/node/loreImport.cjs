#!/usr/bin/env node
// Writes lorebooks into story cards of the save while the server is stopped, the way a page's write is recorded.
//
// Why (2026-10-16): the lore of a story was written straight into database.bin; the next chat message from a page that was
// open put the old lore back. dbSync stores a page's write as it is ("fast" path) when no OTHER client wrote since that page
// loaded, and a write behind its back is not a write it knows about. Here the import is recorded as a write of its own client,
// so a page that loaded before it takes the merge path, and the merge keeps the new lore (the page did not change it).
//
//   node server/node/loreImport.cjs <save dir> <chaId prefix>=<risu_lorebook.json> [...]
const fs = require('fs')
const path = require('path')
const net = require('net')
const { decodeSave, encodeSave, parseBlock, serializeBlock, validateSave } = require('./dbMerge.cjs')
const { openDbSync } = require('./dbSync.cjs')

const DB_FILE = '64617461626173652f64617461626173652e62696e'        // hex of database/database.bin

function toRisuLore(e) {
    return {
        key: e.key ?? '', secondkey: e.secondkey ?? '', insertorder: e.insertorder ?? 100, comment: e.comment ?? '', content: e.content ?? '',
        mode: e.mode ?? 'normal', alwaysActive: !!e.alwaysActive, selective: !!e.selective, useRegex: !!e.useRegex,
    }
}

/** The save with the given cards' lorebooks replaced. Throws when a card is missing or the result does not read back. */
function withLore(bytes, plan) {
    const blocks = decodeSave(bytes)
    const report = []
    for (const { prefix, entries } of plan) {
        const i = blocks.findIndex((b) => b.name.startsWith(prefix))
        if (i < 0) throw new Error(`no card ${prefix} in the save`)
        const v = parseBlock(blocks[i])
        const before = (v.globalLore ?? []).length
        v.globalLore = entries.map(toRisuLore)
        blocks[i] = serializeBlock(blocks[i].type, blocks[i].comp, blocks[i].name, v)
        report.push({ prefix, name: v.name, before, after: v.globalLore.length })
    }
    const out = encodeSave(blocks)
    validateSave(out)
    return { out, report }
}

/** Replaces the lorebooks and records the write in dbSync as its own client; returns what was written. */
function importLore(saveDir, plan, syncFile = saveDir + '.sync.sqlite') {
    const file = path.join(saveDir, DB_FILE)
    const current = fs.readFileSync(file)
    const { out, report } = withLore(current, plan)
    let stored = out
    if (fs.existsSync(syncFile)) {
        const sync = openDbSync({ dbFile: syncFile, log: () => {} })
        try { stored = sync.onWrite('lore-import', out, current).bytes } finally { sync.close() }
    }
    fs.writeFileSync(file + '.lore-tmp', stored)
    fs.renameSync(file + '.lore-tmp', file)
    return report
}

function serverRunning(port = 6001) {
    return new Promise((resolve) => {
        const s = net.connect(port, '127.0.0.1')
        s.once('connect', () => { s.destroy(); resolve(true) })
        s.once('error', () => resolve(false))
    })
}

if (require.main === module) {
    (async () => {
        const [saveDir, ...pairs] = process.argv.slice(2)
        if (!saveDir || !pairs.length) { console.error('usage: loreImport.cjs <save dir> <chaId prefix>=<risu_lorebook.json> ...'); process.exit(2) }
        if (await serverRunning()) { console.error('the Risu server is running on :6001; stop it first (its queue flushes on SIGTERM)'); process.exit(1) }
        const plan = pairs.map((p) => { const [prefix, f] = p.split('='); return { prefix, entries: JSON.parse(fs.readFileSync(f, 'utf8')).data } })
        for (const r of importLore(saveDir, plan)) console.log(`${r.prefix} ${r.name}: lore ${r.before} -> ${r.after}`)
    })().catch((e) => { console.error(e.message); process.exit(1) })
}

module.exports = { importLore, withLore }
