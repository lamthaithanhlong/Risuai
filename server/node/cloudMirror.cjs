#!/usr/bin/env node
// Background mirror of this server's save files to the owner's Risu account.
//
// Why it exists: with "Save data in account" a fresh browser uploaded every file itself, one request at a time, before the app
// opened (2485 files, about 1 s each). The save already lives on this machine, so this process does the upload instead and the
// phone keeps opening from the server. It only ever reads the save directory and writes to the cloud account.
//
//   node server/node/cloudMirror.cjs            upload what is missing, then check again every 10 minutes
//   node server/node/cloudMirror.cjs --once     one pass, then exit
//   node server/node/cloudMirror.cjs --limit 3  stop after 3 uploads (for trying it out)
//
// State: ~/.risu-lan/cloud-mirror.json (what was sent, resumable). The account token is read from the saved database and is
// never logged.

const fs = require('fs')
const os = require('os')
const path = require('path')
const zlib = require('zlib')

const SAVE = path.join(process.env.RISU_SAVE_DIR || path.join(process.cwd(), 'save'))
const HUB = process.env.RISU_HUB_URL || 'https://sv.risuai.xyz'
const STATE_PATH = process.env.RISU_MIRROR_STATE || path.join(os.homedir(), '.risu-lan', 'cloud-mirror.json')
const WORKERS = Math.max(1, Number(process.env.RISU_MIRROR_WORKERS) || 2)
const RESCAN_MS = 10 * 60 * 1000
const DB_KEY = 'database/database.bin'
const args = process.argv.slice(2)
const once = args.includes('--once')
const limit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity

const log = (...a) => console.log(`[cloud-mirror] ${new Date().toISOString()}`, ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- reading the account token out of the saved database -------------------------------------------------------------
const SAVE_MAGIC = Buffer.from('RISUSAVE\0')

function readRootBlock(buf) {
    if (buf.subarray(0, SAVE_MAGIC.length).compare(SAVE_MAGIC) !== 0) {
        throw new Error('database.bin is not in the block format this script knows')
    }
    let o = SAVE_MAGIC.length
    while (o < buf.length) {
        const compressed = buf[o + 1] === 1
        o += 2
        const nameLen = buf[o]
        o += 1
        const name = buf.subarray(o, o + nameLen).toString('utf8')
        o += nameLen
        const len = buf.readUInt32LE(o)
        o += 4
        let data = buf.subarray(o, o + len)
        o += len
        if (name === 'root') {
            if (compressed) data = zlib.gunzipSync(data)
            return JSON.parse(data.toString('utf8'))
        }
    }
    throw new Error('no root block in database.bin')
}

function readToken() {
    if (process.env.RISU_ACCOUNT_TOKEN) return process.env.RISU_ACCOUNT_TOKEN
    const root = readRootBlock(fs.readFileSync(path.join(SAVE, Buffer.from(DB_KEY).toString('hex'))))
    const token = root.account && root.account.token
    if (!token) throw new Error('no Risu account is logged in on this server (db.account.token is empty)')
    return token
}

// ---- state -----------------------------------------------------------------------------------------------------------
function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
    } catch (e) {
        return { done: {}, startedAt: new Date().toISOString() }
    }
}

function saveState(state) {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true })
    const tmp = STATE_PATH + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state))
    fs.renameSync(tmp, STATE_PATH)
}

// ---- save directory --------------------------------------------------------------------------------------------------
function listKeys() {
    const out = []
    for (const f of fs.readdirSync(SAVE)) {
        if (!/^[0-9a-f]+$/.test(f) || f.length % 2) continue
        const key = Buffer.from(f, 'hex').toString('utf8')
        // dbbackup-* are local safety copies and remotes/* are pointers into this machine, neither belongs in the account
        if (!key.startsWith('assets/') && key !== DB_KEY) continue
        const st = fs.statSync(path.join(SAVE, f))
        out.push({ key, file: path.join(SAVE, f), size: st.size, mtimeMs: Math.floor(st.mtimeMs) })
    }
    // the database goes last, once every asset it points at is already in the account
    out.sort((a, b) => (a.key === DB_KEY) - (b.key === DB_KEY))
    return out
}

// ---- cloud -----------------------------------------------------------------------------------------------------------
class Cloud {
    constructor(token) {
        this.token = token
        this.session = ''
    }

    async getSession() {
        const res = await fetch(`${HUB}/api/account/getsessionnumber`, { headers: { 'x-risu-auth': this.token } })
        if (res.status === 403) throw new AuthError('the Risu account token was refused (403): log in again in Risu settings')
        const json = await res.json()
        this.session = `${json.sessionNumber}`
    }

    // returns {status, remoteKey}
    async write(key, body) {
        for (let attempt = 0; attempt < 6; attempt++) {
            if (!this.session) await this.getSession()
            const res = await fetch(`${HUB}/api/account/write`, {
                method: 'POST',
                body,
                headers: {
                    'x-risu-auth': this.token,
                    'content-type': 'application/octet-stream',
                    'x-risu-key': key,
                    'X-Format': 'nocheck',
                    'x-risu-session': this.session,
                    'x-risu-save-date': Date.now().toFixed(0),
                },
            })
            const text = await res.text()
            if (res.status === 304) return { status: 304, remoteKey: key }
            if (res.status === 403) {
                if (res.headers.get('x-risu-status') === 'warn') return { status: 403, remoteKey: null, warn: true }
                throw new AuthError('the Risu account token was refused (403): log in again in Risu settings')
            }
            if (res.headers.get('content-type') === 'application/json') {
                let json = null
                try {
                    json = JSON.parse(text)
                } catch (e) {}
                if (json && json.reloadSession) {
                    // another client became the writer; take the session back and retry
                    log('session taken by another client, re-acquiring')
                    this.session = ''
                    await sleep(2000)
                    continue
                }
            }
            if (res.status === 429 || res.status >= 500) {
                const wait = Math.min(60000, 2000 * 2 ** attempt)
                log(`${res.status} from the hub for ${key}, retrying in ${wait / 1000}s`)
                await sleep(wait)
                continue
            }
            if (res.status < 200 || res.status >= 300) throw new Error(`write ${key}: HTTP ${res.status} ${text.slice(0, 120)}`)
            return { status: res.status, remoteKey: text }
        }
        throw new Error(`write ${key}: gave up after retries`)
    }
}

class AuthError extends Error {}

// ---- one pass --------------------------------------------------------------------------------------------------------
async function pass(cloud, state) {
    const keys = listKeys()
    const todo = keys.filter((k) => {
        const d = state.done[k.key]
        return !d || d.size !== k.size || d.mtimeMs !== k.mtimeMs
    })
    const total = keys.length
    log(`${total - todo.length}/${total} already in the account, ${todo.length} to send`)
    if (!todo.length) return { sent: 0, renamed: 0 }

    let sent = 0
    let renamed = 0
    let next = 0
    const startedAt = Date.now()

    // assets in parallel, the database strictly after them
    const assets = todo.filter((k) => k.key !== DB_KEY)
    const dbItem = todo.find((k) => k.key === DB_KEY)

    const one = async (item) => {
        const body = fs.readFileSync(item.file)
        const r = await cloud.write(item.key, body)
        if (r.warn) {
            log(`warning response for ${item.key}, will retry on the next pass`)
            return
        }
        if (r.remoteKey && r.remoteKey !== item.key) {
            renamed += 1
            state.done[item.key] = { size: item.size, mtimeMs: item.mtimeMs, remote: r.remoteKey }
        } else {
            state.done[item.key] = { size: item.size, mtimeMs: item.mtimeMs }
        }
        sent += 1
        if (sent % 25 === 0) {
            saveState(state)
            const rate = sent / ((Date.now() - startedAt) / 1000)
            log(`sent ${sent}/${todo.length} (${rate.toFixed(1)} files/s), renamed by the hub: ${renamed}`)
        }
    }

    const worker = async () => {
        while (sent < limit) {
            const i = next++
            if (i >= assets.length) return
            await one(assets[i])
        }
    }
    await Promise.all(Array.from({ length: WORKERS }, worker))
    saveState(state)

    if (dbItem && sent < limit) {
        if (renamed > 0) {
            // the account database must point at the names the hub gave, which this script does not rewrite
            log(`not sending ${DB_KEY}: the hub renamed ${renamed} asset(s), the database would point at missing names`)
        } else if (assets.some((a) => !state.done[a.key])) {
            log(`not sending ${DB_KEY} yet: some assets did not go through`)
        } else {
            await one(dbItem)
            saveState(state)
        }
    }
    log(`pass done: sent ${sent}, renamed ${renamed}`)
    return { sent, renamed }
}

async function main() {
    const cloud = new Cloud(readToken())
    const state = loadState()
    for (;;) {
        try {
            const r = await pass(cloud, state)
            if (once || r.sent >= limit) return
        } catch (e) {
            if (e instanceof AuthError) {
                log(`STOPPED: ${e.message}`)
                process.exit(2)
            }
            log(`pass failed: ${e.message}`)
            if (once) process.exit(1)
        }
        await sleep(RESCAN_MS)
    }
}

if (require.main === module) {
    main().catch((e) => {
        log(`fatal: ${e.message}`)
        process.exit(1)
    })
}

module.exports = { readRootBlock, listKeys }
