// Read-only views of a COPIED save: the model the owner's settings use (for the report and the judge), and a card's chats.
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { REPO } from './env.mjs'

const require = createRequire(import.meta.url)
const { decodeSave, encodeSave, parseBlock, serializeBlock } = require(path.join(REPO, 'server/node/dbMerge.cjs'))
const DB_KEY = Buffer.from('database/database.bin', 'utf-8').toString('hex')

function readDb(saveDir, backend = 'files') {
    if (backend === 'sqlite') {
        const Database = require(path.join(REPO, 'node_modules/better-sqlite3'))
        const db = new Database(saveDir + '.store.sqlite', { readonly: true })
        try { return db.prepare('SELECT data FROM files WHERE key = ?').get(DB_KEY.toLowerCase())?.data } finally { db.close() }
    }
    return fs.readFileSync(path.join(saveDir, DB_KEY))
}

/** The owner's model settings (keys never leave this object except to the local 9router the settings already point at). */
export function modelSettings(saveDir, backend) {
    const blocks = decodeSave(readDb(saveDir, backend))
    const root = parseBlock(blocks.find((b) => b.name === 'root'))
    const slots = Array.isArray(root.modelSlots) ? root.modelSlots : []
    const active = slots.find((s) => s.id === root.activeModelSlot)
    const url = root.forceReplaceUrl || 'http://localhost:20128/v1/chat/completions'
    return {
        aiModel: root.aiModel,
        slot: active ? active.name : null,
        slots: slots.map((x) => ({ id: x.id, name: x.name, model: x.model, req: x.req })),
        requestModel: active?.req || root.customProxyRequestModel || root.proxyRequestModel,
        url,
        key: root.proxyKey || '',
        jevGuard: (() => { try { const j = typeof root.jevGuard === 'string' ? JSON.parse(root.jevGuard) : root.jevGuard; return { enabled: !!j?.enabled, model: j?.model } } catch { return null } })(),
        gameMaster: root.gameMaster !== false,
        jevReferee: root.jevReferee !== false,
        autoTranslate: !!root.autoTranslate,
        language: root.language,
        cards: blocks.filter((b) => b.type === 2).map((b) => b.name),
        persona: String(root.personaPrompt ?? ''),
    }
}

export const redact = (s) => String(s ?? '').replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***').replace(/Bearer\s+\S+/g, 'Bearer ***')

/**
 * DIAGNOSTIC, on a COPY only: change root settings of the copied save (e.g. maxContext), so checks behind a blocker can still be
 * measured. run.mjs labels such a run as diagnostic; the real save is never opened for writing.
 */
export function patchCopyRoot(saveDir, backend, patch) {
    if (!/\.risu-story-work\/acceptance\//.test(saveDir)) throw new Error(`refusing to patch ${saveDir}: not an acceptance copy`)
    const blocks = decodeSave(readDb(saveDir, backend))
    const i = blocks.findIndex((b) => b.name === 'root')
    const root = parseBlock(blocks[i])
    const before = Object.fromEntries(Object.keys(patch).map((k) => [k, root[k]]))
    Object.assign(root, patch)
    blocks[i] = serializeBlock(blocks[i].type, blocks[i].comp, 'root', root)
    const bytes = encodeSave(blocks)
    if (backend === 'sqlite') {
        const Database = require(path.join(REPO, 'node_modules/better-sqlite3'))
        const db = new Database(saveDir + '.store.sqlite')
        try {
            const r = db.prepare('UPDATE files SET data = ?, size = ? WHERE key = ?').run(bytes, bytes.length, DB_KEY.toLowerCase())
            if (r.changes !== 1) throw new Error('database.bin row not found in the copy store')
        } finally { db.close() }
    } else fs.writeFileSync(path.join(saveDir, DB_KEY), bytes)
    return before
}

/**
 * DIAGNOSTIC, on a COPY only: scale a card's loreSettings.tokenBudget (the lore books' token budget). With enableRemoteSaving the card
 * is the file remotes/<chaId>.local.bin (JSON text) in the copy's store, not a block of database.bin. Returns {before, after}.
 */
export function patchCopyCardBudget(saveDir, backend, chaId, percent) {
    if (!/\.risu-story-work\/acceptance\//.test(saveDir)) throw new Error(`refusing to patch ${saveDir}: not an acceptance copy`)
    const key = Buffer.from(`remotes/${chaId}.local.bin`, 'utf-8').toString('hex')
    const edit = (bytes) => {
        const card = JSON.parse(Buffer.from(bytes).toString('utf8'))
        const before = card.loreSettings?.tokenBudget
        if (!(before > 0)) throw new Error(`card ${chaId} has no loreSettings.tokenBudget to scale`)
        const after = Math.round((before * percent) / 100)
        card.loreSettings.tokenBudget = after
        return { out: Buffer.from(JSON.stringify(card), 'utf8'), before, after }
    }
    if (backend === 'sqlite') {
        const Database = require(path.join(REPO, 'node_modules/better-sqlite3'))
        const db = new Database(saveDir + '.store.sqlite')
        try {
            const row = db.prepare('SELECT data FROM files WHERE key = ?').get(key)
            if (!row) throw new Error(`remotes/${chaId}.local.bin not found in the copy store`)
            const { out, before, after } = edit(row.data)
            db.prepare('UPDATE files SET data = ?, size = ? WHERE key = ?').run(out, out.length, key)
            return { before, after }
        } finally { db.close() }
    }
    const f = path.join(saveDir, key)
    const { out, before, after } = edit(fs.readFileSync(f))
    fs.writeFileSync(f, out)
    return { before, after }
}
