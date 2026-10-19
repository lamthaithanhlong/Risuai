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
