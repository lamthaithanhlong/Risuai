// A small copy of the live save for the repro scripts. tests/acceptance/lib/env.mjs snapshotLive copies the whole store (~1 GB of
// inlays, assets and old backups) and the disk runs near full; a turn needs only database.bin and the character files
// (remotes/<chaId>.local.bin), about 7 MB. Also the root-settings patch and readers of the copy's store that repro.mjs has inline.
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { createRequire } from 'module'
import { REPO } from '../../acceptance/lib/env.mjs'

const require = createRequire(import.meta.url)
const { decodeSave, parseBlock, encodeSave, serializeBlock } = require(path.join(REPO, 'server/node/dbMerge.cjs'))
const Database = require(path.join(REPO, 'node_modules/better-sqlite3'))
export const hexName = (name) => Buffer.from(name, 'utf-8').toString('hex').toLowerCase()
const DB_KEY = hexName('database/database.bin')

/** RUN/_base with an empty save/ and a store holding only database.bin and remotes/*; the write queue and meta come as they are. */
export function leanSnapshot(runDir, { liveCwd = REPO } = {}) {
    const base = path.join(runDir, '_base')
    fs.mkdirSync(path.join(base, 'save'), { recursive: true })
    const src = new Database(path.join(liveCwd, 'save.store.sqlite'), { readonly: true, fileMustExist: true })
    const dst = new Database(path.join(base, 'save.store.sqlite'))
    try {
        for (const r of src.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all()) dst.exec(r.sql)
        const put = dst.prepare('INSERT INTO files (key, path, data, size, mtime, sha256) VALUES (?, ?, ?, ?, ?, ?)')
        dst.transaction(() => {
            for (const r of src.prepare("SELECT key, path, data, size, mtime, sha256 FROM files WHERE path = 'database/database.bin' OR path LIKE 'remotes/%'").all()) put.run(r.key, r.path, r.data, r.size, r.mtime, r.sha256)
            for (const r of src.prepare('SELECT k, v FROM meta').all()) dst.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run(r.k, r.v)
        })()
    } finally { src.close(); dst.close() }
    // what is still waiting in the live write queue is newer than the store (saveQueue.cjs): carry it over through the online backup
    const q = path.join(liveCwd, 'save.queue.sqlite')
    if (fs.existsSync(q)) {
        const d = new Database(q, { readonly: true, fileMustExist: true })
        return d.backup(path.join(base, 'save.queue.sqlite')).then(() => { d.close(); return base })
    }
    return Promise.resolve(base)
}

/**
 * Patches the copy's root settings where a reader finds them: a database.bin still waiting in the copied write queue is what the page
 * loads, so both the queue and the store are patched. Only ever on an acceptance copy.
 */
export function patchRoot(dir, patch, log = console.log) {
    if (!/\.risu-story-work\/acceptance\//.test(dir)) throw new Error('not an acceptance copy: ' + dir)
    const fix = (bytes) => {
        const blocks = decodeSave(bytes)
        const i = blocks.findIndex((b) => b.name === 'root')
        const root = Object.assign(parseBlock(blocks[i]), patch)
        // a bot preset carries its own URL and the page applies it (database.svelte.ts setPreset): patch every one
        for (const pr of root.botPresets ?? []) if (patch.forceReplaceUrl && pr && 'forceReplaceUrl' in pr) pr.forceReplaceUrl = patch.forceReplaceUrl
        blocks[i] = serializeBlock(blocks[i].type, blocks[i].comp, 'root', root)
        return encodeSave(blocks)
    }
    const store = new Database(path.join(dir, 'save.store.sqlite'))
    const queue = new Database(path.join(dir, 'save.queue.sqlite'))
    try {
        const queued = queue.prepare("SELECT data FROM pending WHERE key = ? AND op = 'write'").get(DB_KEY)?.data
        const stored = store.prepare('SELECT data FROM files WHERE key = ?').get(DB_KEY)?.data
        if (queued) queue.prepare('UPDATE pending SET data = ? WHERE key = ?').run(fix(queued), DB_KEY)
        const b = fix(stored)
        // the store checks each file against its sha256: a row patched without it reads as corrupt and the page falls back to a backup
        const sha = crypto.createHash('sha256').update(b).digest('hex')
        const r = store.prepare('UPDATE files SET data = ?, size = ?, sha256 = ?, mtime = ? WHERE key = ?').run(b, b.length, sha, Date.now(), DB_KEY)
        if (r.changes !== 1) throw new Error('database.bin not found in the copy store')
        log('patched root', queued ? '(queue + store)' : '(store)')
    } finally { store.close(); queue.close() }
}

/** A file as the SERVER has it (the copy's queue first: a write still in it is what a reader gets), or null. */
export function serverFile(dir, name) {
    const key = hexName(name)
    let bytes
    const q = path.join(dir, 'save.queue.sqlite')
    if (fs.existsSync(q)) {
        const d = new Database(q, { readonly: true })
        try { bytes = d.prepare("SELECT data FROM pending WHERE key = ? AND op = 'write'").get(key)?.data } catch { /* other schema */ } finally { d.close() }
    }
    if (!bytes) { const d = new Database(path.join(dir, 'save.store.sqlite'), { readonly: true }); try { bytes = d.prepare('SELECT data FROM files WHERE key = ?').get(key)?.data } finally { d.close() } }
    return bytes ?? null
}

/** The chat as the SERVER has it: messages {role, data, id}. With enableRemoteSaving the card is a REMOTE block (type 6). */
export function serverChat(dir, cardId, chatId) {
    const block = decodeSave(serverFile(dir, 'database/database.bin')).find((b) => b.name === cardId)
    const remote = block.type === 6 ? serverFile(dir, `remotes/${cardId}.local.bin`) : null
    const card = remote ? JSON.parse(Buffer.from(remote).toString('utf8')) : parseBlock(block)
    const chat = card.chats.find((c) => c.id === chatId)
    return chat ? chat.message.map((m) => ({ role: m.role, data: String(m.data), id: m.chatId })) : null
}

/** Rows of a table of one of the copy's SQLite files (read only), or []. */
export function rows(file, sql, ...args) {
    if (!fs.existsSync(file)) return []
    const d = new Database(file, { readonly: true })
    try { return d.prepare(sql).all(...args) } catch { return [] } finally { d.close() }
}
