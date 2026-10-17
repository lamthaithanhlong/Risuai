#!/usr/bin/env node
// Writes lorebooks into story cards of the save while the server is stopped, the way a page's write is recorded.
//
// Why (2026-10-16): the lore of a story was written straight into database.bin; the next chat message from a page that was
// open put the old lore back. dbSync stores a page's write as it is ("fast" path) when no OTHER client wrote since that page
// loaded, and a write behind its back is not a write it knows about. Here the import is recorded as a write of its own client,
// so a page that loaded before it takes the merge path, and the merge keeps the new lore (the page did not change it).
//
//   node server/node/loreImport.cjs <save dir> <chaId prefix>=<risu_lorebook.json> [...]
//   node server/node/loreImport.cjs <save dir> --image <picture.png> <chaId prefix> [...]   (the card's icon)
//   node server/node/loreImport.cjs <save dir> --script <card.json> <chaId prefix> [...]     (the card's trigger scripts, e.g. a new status.lua)
const fs = require('fs')
const path = require('path')
const net = require('net')
const { decodeSave, encodeSave, parseBlock, serializeBlock, validateSave } = require('./dbMerge.cjs')
const { openDbSync } = require('./dbSync.cjs')

const DB_FILE = '64617461626173652f64617461626173652e62696e'        // hex of database/database.bin

/**
 * An entry in the shape Risu itself holds it in. A page normalizes every entry that is not bookVersion 2 when it loads (characters.ts
 * updateLorebooks: @@end -> @@depth 0, <char>/<bot> -> {{char}}, <user> -> {{user}}, then bookVersion = 2). An entry written without
 * that makes the page's copy differ from the file the page loaded, and the merge then reads it as "the page changed the lore": an open
 * page that loaded older lore put it back (found 2026-10-17: the Memories and Echoes text imported at 00:03 was gone at 00:45, all 822
 * other entries "differing" only by bookVersion). Writing the normalized shape makes an unchanged page lore equal to its base.
 */
function toRisuLore(e) {
    const content = String(e.content ?? '').replace(/@@@?end/g, '@@depth 0').replace(/<(char|bot)>/g, '{{char}}').replace(/<(user)>/g, '{{user}}')
    return {
        key: e.key ?? '', secondkey: e.secondkey ?? '', insertorder: e.insertorder ?? 100, comment: e.comment ?? '', content,
        mode: e.mode ?? 'normal', alwaysActive: !!e.alwaysActive, selective: !!e.selective, useRegex: !!e.useRegex, bookVersion: 2,
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

/** Writes the save changed by `change(current) -> { out, report }`, recorded in dbSync as its own client, so an open page merges. */
function recordedWrite(saveDir, change, syncFile = saveDir + '.sync.sqlite', client = 'lore-import') {
    const file = path.join(saveDir, DB_FILE)
    const current = fs.readFileSync(file)
    const { out, report } = change(current)
    let stored = out
    if (fs.existsSync(syncFile)) {
        const sync = openDbSync({ dbFile: syncFile, log: () => {} })
        try { stored = sync.onWrite(client, out, current).bytes } finally { sync.close() }
    }
    fs.writeFileSync(file + '.lore-tmp', stored)
    fs.renameSync(file + '.lore-tmp', file)
    return report
}

/** Replaces the lorebooks and records the write in dbSync as its own client; returns what was written. */
function importLore(saveDir, plan, syncFile = saveDir + '.sync.sqlite') {
    return recordedWrite(saveDir, (current) => withLore(current, plan), syncFile)
}

/** Sets the cards' image: the picture is stored as Risu stores an asset (assets/<sha256>.<ext>), then each card points at it. */
function setCardImage(saveDir, prefixes, imageBytes, ext = 'png', syncFile = saveDir + '.sync.sqlite') {
    const name = `assets/${require('crypto').createHash('sha256').update(imageBytes).digest('hex')}.${ext}`
    const assetFile = path.join(saveDir, Buffer.from(name, 'utf-8').toString('hex'))
    if (!fs.existsSync(assetFile)) fs.writeFileSync(assetFile, imageBytes)
    return recordedWrite(saveDir, (current) => {
        const blocks = decodeSave(current)
        const report = []
        for (const prefix of prefixes) {
            const i = blocks.findIndex((b) => b.name.startsWith(prefix))
            if (i < 0) throw new Error(`no card ${prefix} in the save`)
            const v = parseBlock(blocks[i])
            report.push({ prefix, name: v.name, before: v.image || '(none)', after: name })
            v.image = name
            blocks[i] = serializeBlock(blocks[i].type, blocks[i].comp, blocks[i].name, v)
        }
        const out = encodeSave(blocks)
        validateSave(out)
        return { out, report }
    }, syncFile, 'card-image')
}

/** Replaces the cards' trigger scripts (and their low-level access flag) with those of a built card, recorded like a lore import. */
function setCardScript(saveDir, prefixes, triggerscript, lowLevelAccess, syncFile = saveDir + '.sync.sqlite') {
    if (!Array.isArray(triggerscript) || !triggerscript.length) throw new Error('the card has no trigger script')
    return recordedWrite(saveDir, (current) => {
        const blocks = decodeSave(current)
        const report = []
        for (const prefix of prefixes) {
            const i = blocks.findIndex((b) => b.name.startsWith(prefix))
            if (i < 0) throw new Error(`no card ${prefix} in the save`)
            const v = parseBlock(blocks[i])
            const size = (t) => JSON.stringify(t ?? []).length
            report.push({ prefix, name: v.name, before: size(v.triggerscript), after: size(triggerscript) })
            v.triggerscript = structuredClone(triggerscript)
            if (lowLevelAccess !== undefined) v.lowLevelAccess = !!lowLevelAccess
            blocks[i] = serializeBlock(blocks[i].type, blocks[i].comp, blocks[i].name, v)
        }
        const out = encodeSave(blocks)
        validateSave(out)
        return { out, report }
    }, syncFile, 'card-script')
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
        if (pairs[0] === '--script') {
            // loreImport.cjs <save dir> --script <card.json> <chaId prefix> ...
            const [, cardFile, ...prefixes] = pairs
            const c = JSON.parse(fs.readFileSync(cardFile, 'utf8'))
            const risu = (c.data ?? c).extensions?.risuai ?? {}
            for (const r of setCardScript(saveDir, prefixes, risu.triggerscript, risu.lowLevelAccess)) console.log(`${r.prefix} ${r.name}: trigger script ${r.before} -> ${r.after} chars`)
            return
        }
        if (pairs[0] === '--image') {
            // loreImport.cjs <save dir> --image <picture> <chaId prefix> ...
            const [, pic, ...prefixes] = pairs
            for (const r of setCardImage(saveDir, prefixes, fs.readFileSync(pic), path.extname(pic).slice(1).toLowerCase() || 'png')) console.log(`${r.prefix} ${r.name}: image ${r.before} -> ${r.after}`)
            return
        }
        const plan = pairs.map((p) => { const [prefix, f] = p.split('='); return { prefix, entries: JSON.parse(fs.readFileSync(f, 'utf8')).data } })
        for (const r of importLore(saveDir, plan)) console.log(`${r.prefix} ${r.name}: lore ${r.before} -> ${r.after}`)
    })().catch((e) => { console.error(e.message); process.exit(1) })
}

module.exports = { importLore, withLore, setCardImage, setCardScript, recordedWrite, toRisuLore }
