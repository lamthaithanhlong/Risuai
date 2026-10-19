// The playground: a copy of the owner's save and a second Risu server on another port pointed at it. The live server (:6001) and
// the real save are only ever READ (APFS clone of save/, SQLite online backup of the bookkeeping files); nothing here writes there.
//
// Layout of one run (RUN = ~/.risu-story-work/acceptance/<stamp>):
//   RUN/dist                    the client, built from the working tree (or a symlink to the repo's dist with --no-build)
//   RUN/_base                   one snapshot of the live save: save/ (APFS clone) + save.*.sqlite (online backups: store, queue, ...)
//   RUN/<story>/save*           clone of _base; save/__password replaced by a generated test password, known keys cleared
//   RUN/<story>/dist            symlink to RUN/dist; the server serves cwd/dist and reads cwd/save
//   RUN/<story>/jobs.sqlite     the copy's job store (the live one is ~/.risu-lan/jobs.sqlite: never shared)

import { execFileSync, spawn } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
export const WORK_ROOT = path.join(os.homedir(), '.risu-story-work', 'acceptance')
const LIVE_PORT = 6001
const KEEP_RUNS = 3

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })

/** The live server's pid, cwd and RISU_* environment (read with lsof/ps; nothing is sent to it). */
export function liveServer(port = LIVE_PORT) {
    try {
        const pid = sh('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN']).trim().split('\n')[0]
        if (!pid) return null
        const cmd = sh('ps', ['-Eww', '-o', 'command=', '-p', pid])
        const env = {}
        for (const m of cmd.matchAll(/(?:^|\s)(RISU_[A-Z_]+|PORT)=(\S*)/g)) env[m[1]] = m[2]
        let cwd = ''
        try { cwd = (sh('lsof', ['-a', '-p', pid, '-d', 'cwd', '-Fn']).split('\n').find((l) => l.startsWith('n')) || '').slice(1) } catch { /* unknown */ }
        return { pid: Number(pid), env, cwd }
    } catch {
        return null
    }
}

/** files | sqlite: what the live server uses (its RISU_STORE, else the default of the store module it runs, saveStore.cjs). */
export function storeBackend(live, override) {
    if (override) return override
    const { resolveBackend } = require(path.join(REPO, 'server/node/saveStore.cjs'))
    return resolveBackend(live?.env ?? {})
}

/** Old run directories beyond the newest KEEP_RUNS are removed (they are clones of the save; only this harness writes them). */
export function pruneRuns() {
    if (!fs.existsSync(WORK_ROOT)) return
    const runs = fs.readdirSync(WORK_ROOT).filter((d) => /^\d{8}-\d{6}$/.test(d)).sort()
    for (const d of runs.slice(0, Math.max(0, runs.length - KEEP_RUNS))) fs.rmSync(path.join(WORK_ROOT, d), { recursive: true, force: true })
}

export function newRunDir() {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    const dir = path.join(WORK_ROOT, stamp)
    fs.mkdirSync(dir, { recursive: true })
    return dir
}

/** Build the client from the working tree into RUN/dist (VITE_RISU_LEGAL_CONFIGURED=TRUE: a private self-hosted instance). */
export function buildClient(runDir, { noBuild = false, log = console.log } = {}) {
    const out = path.join(runDir, 'dist')
    if (noBuild) {
        fs.symlinkSync(path.join(REPO, 'dist'), out)
        log(`[env] using the repo's dist (built ${fs.statSync(path.join(REPO, 'dist', 'index.html')).mtime.toISOString()})`)
        return out
    }
    log('[env] building the client from the working tree ...')
    const t0 = Date.now()
    const res = sh(path.join(REPO, 'node_modules/.bin/vite'), ['build', '--outDir', out, '--emptyOutDir'], {
        cwd: REPO, env: { ...process.env, VITE_RISU_LEGAL_CONFIGURED: 'TRUE' }, maxBuffer: 64 * 1024 * 1024,
    })
    fs.writeFileSync(path.join(runDir, 'build.log'), res)
    if (!fs.existsSync(path.join(out, 'index.html'))) throw new Error('client build produced no index.html (see build.log)')
    log(`[env] client built in ${Math.round((Date.now() - t0) / 1000)} s`)
    return out
}

async function backupSqlite(src, dst) {
    const Database = require(path.join(REPO, 'node_modules/better-sqlite3'))
    const db = new Database(src, { readonly: true, fileMustExist: true })
    try { await db.backup(dst) } finally { db.close() }
}

/**
 * Snapshot the live save once per run into RUN/_base: save/ as an APFS clone (copy-on-write, instant), the SQLite files (the store
 * with every stored file as a BLOB, the queue, sync and story bookkeeping) through the online backup API, which is consistent while
 * the live server writes and folds its WAL in. The live files are only opened read-only.
 */
export async function snapshotLive(runDir, { liveCwd = REPO, backend = 'sqlite', log = console.log } = {}) {
    const base = path.join(runDir, '_base')
    fs.mkdirSync(base, { recursive: true })
    try { sh('cp', ['-cR', path.join(liveCwd, 'save'), path.join(base, 'save')]) } catch { sh('cp', ['-R', path.join(liveCwd, 'save'), path.join(base, 'save')]) }
    const t0 = Date.now()
    for (const name of ['save.store.sqlite', 'save.queue.sqlite', 'save.sync.sqlite', 'save.story.sqlite']) {
        const f = path.join(liveCwd, name)
        if (fs.existsSync(f)) await backupSqlite(f, path.join(base, name))
    }
    if (backend === 'sqlite' && !fs.existsSync(path.join(base, 'save.store.sqlite'))) throw new Error('the live server uses the sqlite store but there is no save.store.sqlite to copy')
    log(`[env] live save snapshot in ${Math.round((Date.now() - t0) / 1000)} s (${backend} store) -> ${base}`)
    return base
}

/** RUN/<story>: a clone of the snapshot, with a generated test password (never the owner's). */
export function copySave(runDir, base, story, { log = console.log } = {}) {
    const dir = path.join(runDir, story)
    fs.mkdirSync(dir, { recursive: true })
    for (const name of fs.readdirSync(base)) {
        try { sh('cp', ['-cR', path.join(base, name), path.join(dir, name)]) } catch { sh('cp', ['-R', path.join(base, name), path.join(dir, name)]) }
    }
    fs.rmSync(path.join(dir, 'save.server.pid'), { force: true })
    fs.symlinkSync(path.join(runDir, 'dist'), path.join(dir, 'dist'))
    // the server compares the sha256 hex of the typed password (nodeStorage.ts digestPassword)
    const pw = crypto.randomBytes(16).toString('hex')
    fs.writeFileSync(path.join(dir, 'save', '__password'), crypto.createHash('sha256').update(pw).digest('hex'))
    fs.writeFileSync(path.join(dir, 'save', '__known_public_key_hashes.json'), '[]')
    log(`[env] ${story}: copy at ${dir}`)
    return { dir, password: pw }
}

/** Start server.cjs with cwd = the copy. Resolves once it listens; the handle stops it. */
export async function startServer(dir, port, { backend = 'files', log = console.log } = {}) {
    const out = fs.openSync(path.join(dir, 'server.log'), 'a')
    const env = { ...process.env, PORT: String(port), RISU_JOBS_DB: path.join(dir, 'jobs.sqlite') }
    env.RISU_STORE = backend
    delete env.RISU_SYNC_DB; delete env.RISU_STORY_DB; delete env.LAN_TLS_PORT
    const child = spawn(process.execPath, [path.join(REPO, 'server/node/server.cjs')], { cwd: dir, env, stdio: ['ignore', out, out] })
    const t0 = Date.now()
    while (Date.now() - t0 < 60000) {
        if (child.exitCode !== null) throw new Error(`server exited (${child.exitCode}); see ${path.join(dir, 'server.log')}`)
        try { const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) }); if (r.status < 500) break } catch { /* not yet */ }
        await new Promise((r) => setTimeout(r, 500))
    }
    log(`[env] server for ${path.basename(dir)} on :${port} (pid ${child.pid})`)
    return {
        port, pid: child.pid,
        stop: () => new Promise((resolve) => {
            if (child.exitCode !== null) return resolve()
            child.once('exit', () => resolve())
            child.kill('SIGTERM')
            setTimeout(() => { try { child.kill('SIGKILL') } catch { /* gone */ } resolve() }, 12000).unref()
        }),
    }
}

/** A port nobody listens on, from `start` up. */
export async function freePort(start) {
    const net = await import('net')
    for (let p = start; p < start + 200; p++) {
        const ok = await new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(p, '0.0.0.0', () => s.close(() => resolve(true))) })
        if (ok && p !== LIVE_PORT) return p
    }
    throw new Error('no free port')
}
