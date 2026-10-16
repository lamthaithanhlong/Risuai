// Three-way merge of two versions of database.bin (specs/mergesave: MergeSave.tla checked by TLC, Merge3.dfy proved in Dafny).
//
// Why: every page loads the whole save and writes the whole file back. A page that never touched the lorebook still wrote its old
// copy of it, so whichever page saved last erased the other's work (a phone tab overwrote a new lorebook, Max Response, a chat).
// Here the server knows what the writing page LOADED (the base, kept as a manifest of hashes), so it can tell what the page changed:
//   ours   = the file the page writes
//   base   = what the page loaded (manifest: hash of every block and of every top-level key)
//   theirs = the file the server has now
// A part the page did not change follows the server; a part it changed (or added) takes the page's value; a part deleted on one side
// stays deleted only if the other side did not change it. Parts are: blocks (root, one per character, presets, modules ...), the
// top-level keys of a block, and the elements of a list of objects with an id (a character's chats, the modules).
//
// The file is "RISUSAVE\0" then blocks of [type u8][compressed u8][name length u8][name][length u32 LE][data]; data is JSON, gzipped when
// the compressed byte is 1 (src/ts/storage/risuSave.ts). A block that needs no per-key merge is copied byte for byte.

const zlib = require('zlib')
const crypto = require('crypto')

const MAGIC = Buffer.from('RISUSAVE\0')
// CONFIG(0) and REMOTE(6) are kept as raw bytes; everything else is JSON
const RAW_TYPES = new Set([0, 6])

class SaveFormatError extends Error {}

// ---- reading and writing the container -----------------------------------------------------------------------------------------
function decodeSave(buf) {
    if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf)
    if (buf.length < MAGIC.length || buf.subarray(0, MAGIC.length).compare(MAGIC) !== 0) {
        throw new SaveFormatError('not a RISUSAVE file')
    }
    const blocks = []
    let o = MAGIC.length
    while (o < buf.length) {
        if (o + 3 > buf.length) throw new SaveFormatError('torn block header')
        const type = buf[o]
        const comp = buf[o + 1]
        const nameLen = buf[o + 2]
        o += 3
        if (o + nameLen + 4 > buf.length) throw new SaveFormatError('torn block name')
        const name = buf.subarray(o, o + nameLen).toString('utf8')
        o += nameLen
        const len = buf.readUInt32LE(o)
        o += 4
        if (o + len > buf.length) throw new SaveFormatError('torn block data')
        blocks.push({ type, comp, name, data: buf.subarray(o, o + len) })
        o += len
    }
    return blocks
}

function encodeSave(blocks) {
    const parts = [MAGIC]
    for (const b of blocks) {
        const name = Buffer.from(b.name, 'utf8')
        const head = Buffer.alloc(3)
        head[0] = b.type
        head[1] = b.comp
        head[2] = name.length
        const len = Buffer.alloc(4)
        len.writeUInt32LE(b.data.length)
        parts.push(head, name, len, b.data)
    }
    return Buffer.concat(parts)
}

/** the parsed JSON of a block, or undefined when it is raw, empty or not JSON */
function parseBlock(block) {
    if (RAW_TYPES.has(block.type) || block.data.length === 0) return undefined
    try {
        const text = (block.comp === 1 ? zlib.gunzipSync(block.data) : block.data).toString('utf8')
        return JSON.parse(text)
    } catch (e) {
        return undefined
    }
}

function serializeBlock(type, comp, name, value) {
    let data = Buffer.from(JSON.stringify(value), 'utf8')
    if (comp === 1) data = zlib.gzipSync(data)
    return { type, comp, name, data }
}

// ---- hashing ---------------------------------------------------------------------------------------------------------------------
function stable(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v)
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
}
const hashValue = (v) => crypto.createHash('sha1').update(stable(v)).digest('hex').slice(0, 16)
const hashBytes = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 16)

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
/** a list of objects that all have a unique string id: it can be merged element by element */
function idsOf(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return null
    const ids = new Map()
    for (const el of arr) {
        if (!isPlainObject(el) || typeof el.id !== 'string' || ids.has(el.id)) return null
        ids.set(el.id, el)
    }
    return ids
}
const isStringList = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')

// ---- manifest: what a page loaded, as hashes -------------------------------------------------------------------------------------
function manifestOfBlock(block) {
    const value = parseBlock(block)
    if (value === undefined) return { type: block.type, kind: 'raw', h: hashBytes(block.data) }
    if (isPlainObject(value)) {
        const keys = {}
        const lists = {}
        const elems = {}
        for (const k of Object.keys(value)) {
            keys[k] = hashValue(value[k])
            if (k === '__directory' && isStringList(value[k])) lists[k] = value[k]
            const ids = idsOf(value[k])
            if (ids) {
                elems[k] = {}
                for (const [id, el] of ids) elems[k][id] = hashValue(el)
            }
        }
        return { type: block.type, kind: 'obj', keys, lists, elems }
    }
    const ids = idsOf(value)
    const m = { type: block.type, kind: 'arr', h: hashValue(value) }
    if (ids) {
        m.elems = {}
        for (const [id, el] of ids) m.elems[id] = hashValue(el)
    }
    return m
}

function manifestOf(buf) {
    const blocks = decodeSave(buf)
    const out = { blocks: {} }
    for (const b of blocks) out.blocks[b.name] = manifestOfBlock(b)
    return out
}

// ---- merging one list of objects with ids ---------------------------------------------------------------------------------------
// bElems: {id: hash} of the base, or undefined when the base did not have the list.
function mergeById(bElems, oursArr, theirsArr, report) {
    const oIds = idsOf(oursArr)
    const tIds = idsOf(theirsArr)
    if (!oIds || !tIds || !bElems) return null
    const out = []
    for (const [id, o] of oIds) {
        const t = tIds.get(id)
        const untouched = bElems[id] !== undefined && hashValue(o) === bElems[id]
        if (t && untouched) {
            if (hashValue(t) !== bElems[id]) report.fromServer++
            out.push(t)                    // the page did not touch it: follow the server
        } else if (!t && untouched) {
            report.fromServer++            // deleted by the server, untouched by the page: gone (a deleted chat used to come back here)
        } else {
            out.push(o)                    // changed or added by the page
        }
    }
    for (const [id, t] of tIds) {
        if (oIds.has(id)) continue
        if (bElems[id] === undefined || hashValue(t) !== bElems[id]) {
            out.push(t)                    // added by the server, or changed by it after the page deleted it
            report.fromServer++
        }                                  // else deleted by the page and untouched by the server: gone
    }
    return out
}

/** __directory and other lists of names: the page's order, plus what the server added, minus what the page removed */
function mergeStringList(baseList, oursList, theirsList) {
    if (!baseList) return oursList
    const baseSet = new Set(baseList)
    const oursSet = new Set(oursList)
    const out = oursList.slice()
    for (const x of theirsList) {
        if (!oursSet.has(x) && !baseSet.has(x)) out.push(x)
    }
    return out
}

// ---- merging one JSON object block by top-level key ----------------------------------------------------------------------------
function mergeObjects(bm, ours, theirs, report) {
    const out = {}
    const keys = new Set([...Object.keys(theirs), ...Object.keys(ours)])
    const bKeys = bm && bm.kind === 'obj' ? bm.keys : {}
    for (const k of keys) {
        const inO = Object.prototype.hasOwnProperty.call(ours, k)
        const inT = Object.prototype.hasOwnProperty.call(theirs, k)
        const hB = bKeys[k]
        if (inO && inT) {
            const hO = hashValue(ours[k])
            const hT = hashValue(theirs[k])
            if (hO === hT) { out[k] = theirs[k]; continue }
            if (hB !== undefined && hO === hB) { out[k] = theirs[k]; report.fromServer++; continue }   // the page did not change it
            if (hB !== undefined && hT !== hB) {
                // both changed it: merge a list of names or of objects with ids, otherwise the page wins
                report.conflicts++
                if (k === '__directory' && isStringList(ours[k]) && isStringList(theirs[k])) {
                    out[k] = mergeStringList(bm.lists && bm.lists[k], ours[k], theirs[k])
                    continue
                }
                const merged = bm && bm.elems ? mergeById(bm.elems[k], ours[k], theirs[k], report) : null
                if (merged) { out[k] = merged; continue }
            }
            out[k] = ours[k]
        } else if (inO) {
            // only the page has it: the server deleted it (gone unless the page changed it) or the page added it
            if (hB !== undefined && hashValue(ours[k]) === hB) { report.fromServer++; continue }
            out[k] = ours[k]
        } else {
            // only the server has it: the page deleted it (gone unless the server changed it) or the server added it
            if (hB !== undefined && hashValue(theirs[k]) === hB) continue
            out[k] = theirs[k]
            report.fromServer++
        }
    }
    return out
}

// ---- merging whole saves -------------------------------------------------------------------------------------------------------
/**
 * @param base    the manifest of what the page loaded (manifestOf), or null when unknown
 * @param oursBuf the file the page writes
 * @param theirsBuf the file the server has
 * @returns {buf, merged, report} merged is false when ours was used as it is (no base, or a file that could not be read)
 */
function mergeSaves(base, oursBuf, theirsBuf) {
    const report = { blocksFromServer: 0, keysFromServer: 0, fromServer: 0, conflicts: 0, reason: '' }
    if (!base) { report.reason = 'no base'; return { buf: oursBuf, merged: false, report } }
    let ours, theirs
    try {
        ours = decodeSave(oursBuf)
        theirs = decodeSave(theirsBuf)
    } catch (e) {
        report.reason = 'unreadable: ' + e.message
        return { buf: oursBuf, merged: false, report }
    }
    const oMap = new Map(ours.map((b) => [b.name, b]))
    const tMap = new Map(theirs.map((b) => [b.name, b]))
    const order = [...theirs.map((b) => b.name), ...ours.map((b) => b.name).filter((n) => !tMap.has(n))]
    const blocks = []
    for (const name of order) {
        const o = oMap.get(name)
        const t = tMap.get(name)
        const bm = base.blocks[name]
        if (o && t) {
            if (o.type === t.type && o.data.equals(t.data)) { blocks.push(t); continue }
            const hO = manifestOfBlock(o)
            // the page did not change this block at all: follow the server
            if (bm && sameManifest(bm, hO)) { blocks.push(t); report.blocksFromServer++; continue }
            const ov = parseBlock(o)
            const tv = parseBlock(t)
            if (ov !== undefined && tv !== undefined && isPlainObject(ov) && isPlainObject(tv) && o.type === t.type) {
                const merged = mergeObjects(bm, ov, tv, report)
                blocks.push(serializeBlock(o.type, o.comp, name, merged))
            } else if (ov !== undefined && tv !== undefined && Array.isArray(ov) && Array.isArray(tv) && bm && bm.kind === 'arr') {
                // a block that is a list (presets, modules): by element when they have ids, else the page's list if it changed it
                const merged = mergeById(bm.elems, ov, tv, report)
                const tm = manifestOfBlock(t)
                if (merged) blocks.push(serializeBlock(o.type, o.comp, name, merged))
                else if (tm.h === bm.h) blocks.push(o)           // the server did not change it: the page's list
                else { blocks.push(o); report.conflicts++ }       // both changed an atomic list: the page wins
            } else {
                // raw block or a shape this does not know: the page's if it changed it
                blocks.push(o)
            }
        } else if (o) {
            // only the page has it: new there, or deleted by the server
            const hO = manifestOfBlock(o)
            if (bm && sameManifest(bm, hO)) { report.blocksFromServer++; continue }   // deleted by the server, untouched by the page
            blocks.push(o)
        } else {
            // only the server has it: new there, or deleted by the page
            const hT = manifestOfBlock(t)
            if (bm && sameManifest(bm, hT)) continue                                    // deleted by the page, untouched by the server
            blocks.push(t)
            report.blocksFromServer++
        }
    }
    repairDirectory(blocks)
    report.keysFromServer = report.fromServer
    return { buf: encodeSave(blocks), merged: true, report }
}

function sameManifest(a, b) {
    if (a.kind !== b.kind) return false
    if (a.kind === 'raw' || a.kind === 'arr') return a.h === b.h
    const ka = Object.keys(a.keys)
    const kb = Object.keys(b.keys)
    if (ka.length !== kb.length) return false
    for (const k of ka) if (a.keys[k] !== b.keys[k]) return false
    return true
}

/** the root's __directory lists the blocks; after a merge it must list exactly the blocks that exist */
function repairDirectory(blocks) {
    const root = blocks.find((b) => b.name === 'root')
    if (!root) return
    const value = parseBlock(root)
    if (!isPlainObject(value) || !isStringList(value.__directory)) return
    const names = new Set(blocks.map((b) => b.name))
    const dir = value.__directory.filter((n) => names.has(n))
    const listed = new Set(dir)
    let changed = dir.length !== value.__directory.length
    for (const b of blocks) {
        if (b.name === 'root' || b.name === 'config' || listed.has(b.name)) continue
        dir.push(b.name)
        listed.add(b.name)
        changed = true
    }
    if (changed) {
        value.__directory = dir
        const i = blocks.indexOf(root)
        blocks[i] = serializeBlock(root.type, root.comp, root.name, value)
    }
}

/** the file reads back: the container is whole and every JSON block parses. A merge result must pass this before it is stored. */
function validateSave(buf) {
    const blocks = decodeSave(buf)
    for (const b of blocks) {
        if (RAW_TYPES.has(b.type) || b.data.length === 0) continue
        const text = (b.comp === 1 ? zlib.gunzipSync(b.data) : b.data).toString('utf8')
        JSON.parse(text)
    }
    return blocks.length
}

module.exports = { decodeSave, encodeSave, parseBlock, serializeBlock, manifestOf, mergeSaves, validateSave, hashValue, SaveFormatError }
