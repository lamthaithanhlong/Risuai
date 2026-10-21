// Remembers, per page, which version of database.bin it loaded, and merges its writes against that (dbMerge.cjs).
//
//   onRead(client, bytes)   a page read the database: that is now its base. A manifest of hashes is kept for the revision.
//   onLoaded(client, bytes) a page holds `bytes`, not the file it read (bootstrap.ts loads a dbbackup-*.bin when database.bin does not
//                           decode): that is its base from now on, and its writes are always merged against it (F7, see below).
//   onRemoteRead(client, name, bytes) / onRemoteWrite(client, name, bytes, current)  the same for a remote character file
//                           (remotes/<chaId>.local.bin, below).
//   onWrite(client, bytes, current) a page writes: returns the bytes to store (the page's own file when nobody else wrote since it
//                           loaded, else the merge of its file with what the server has) and the new revision.
//
// A page is a browser tab (the hash of its public key and the tab id, else the header x-risu-client, else address + user agent). Its
// base is what it last loaded or wrote: after a write its memory is the file it wrote, so what differs from that is exactly what it
// changed since. A write stored as it is makes that revision the base; a merged write keeps the page's own file as a manifest under a
// negative id, and the page's next write is merged against it (the server holds more than the page then) -- unless the merge took
// nothing from the server: then the page's own file is stored and becomes the base, as a plain write would. When the base is not
// known (a page that loaded before this started, a pruned manifest) the page's file is stored as it is, as before.
//
// Remote character files (enableRemoteSaving: a character and ALL its chats live in remotes/<chaId>.local.bin, database.bin only
// points at it). Per page and per file the server keeps the version the page last read or wrote -- by hash, with the bytes once per
// version -- and merges the page's write against it (dbMerge.cjs mergeRemote). After a write the base is the page's own file, merged or
// not: the page holds what it wrote, and what the server holds beyond that is exactly what the next write must take from it
// (specs/chat/RemoteSync.tla, Advance). The server's file still being the base's means nobody wrote since: the page's file as it is.
const crypto = require('crypto')
const { manifestOf, mergeSaves, validateSave, manifestOfRemote, mergeRemote, validateRemote } = require('./dbMerge.cjs')

function loadDriver() {
    try {
        return require('better-sqlite3')
    } catch (error) {
        throw new Error(`better-sqlite3 is not available (${error.message})`)
    }
}

function openDbSync(opts) {
    const Database = loadDriver()
    const now = opts.now ?? Date.now
    const log = opts.log ?? (() => {})
    const keep = opts.keep ?? 3000
    const remoteKeepMs = opts.remoteKeepMs ?? 60 * 24 * 3600 * 1000
    const db = new Database(opts.dbFile)
    db.pragma('journal_mode = WAL')
    db.exec(`
        CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), rev INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_manifest (rev INTEGER PRIMARY KEY, created INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_write (rev INTEGER PRIMARY KEY, client TEXT NOT NULL, created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_client (client TEXT PRIMARY KEY, base_rev INTEGER NOT NULL, updated INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_remote (client TEXT NOT NULL, name TEXT NOT NULL, h TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (client, name));
        CREATE TABLE IF NOT EXISTS sync_remote_blob (name TEXT NOT NULL, h TEXT NOT NULL, data BLOB NOT NULL, PRIMARY KEY (name, h));
        INSERT OR IGNORE INTO sync_state (id, rev) VALUES (1, 0);
    `)
    const getRev = db.prepare('SELECT rev FROM sync_state WHERE id = 1')
    const setRev = db.prepare('UPDATE sync_state SET rev = ? WHERE id = 1')
    const putManifest = db.prepare('INSERT OR REPLACE INTO sync_manifest (rev, created, data) VALUES (?, ?, ?)')
    const getManifest = db.prepare('SELECT data FROM sync_manifest WHERE rev = ?')
    const putWrite = db.prepare('INSERT OR REPLACE INTO sync_write (rev, client, created) VALUES (?, ?, ?)')
    const foreignWrites = db.prepare('SELECT COUNT(*) AS n FROM sync_write WHERE rev > ? AND client <> ?')
    const getClient = db.prepare('SELECT base_rev FROM sync_client WHERE client = ?')
    const putClient = db.prepare('INSERT OR REPLACE INTO sync_client (client, base_rev, updated) VALUES (?, ?, ?)')
    // A revision some page still has as its base is never pruned, nor the write rows after it: a page left open for days (650 saves
    // a day were measured, so 3000 revisions last ~4.6 days) used to lose its base and have its stale file stored whole
    // ('base pruned'), erasing everything written since (specs/chat/DbSync.tla, PinBases).
    const prune = db.prepare('DELETE FROM sync_manifest WHERE rev < ? AND rev NOT IN (SELECT base_rev FROM sync_client)')
    // a loaded base (negative id, below) is not a revision: it must not hold back the pruning of write rows
    const pruneWrites = db.prepare('DELETE FROM sync_write WHERE rev < MIN(?, COALESCE((SELECT MIN(base_rev) FROM sync_client WHERE base_rev > 0), ?))')
    // F7. The base is recorded when a page GETs database.bin, but the page may then hold something else: bootstrap.ts falls back to
    // the newest dbbackup-*.bin when the file does not decode. Its memory is then that backup, and every chat (lore, setting) newer
    // than the backup is "missing from the page", which the merge reads as "deleted by the page" -- or, with no foreign write since
    // the read, the fast path stores the backup whole. A page can only delete what it has loaded, so such a page tells the server
    // what it loaded; that manifest is kept under a negative id (it is no revision of the file) and the page's writes are always
    // merged against it (specs/chat/DbSync.tla, LoadedBase). Unreferenced loaded manifests are dropped.
    const minLoaded = db.prepare('SELECT MIN(rev) AS m FROM sync_manifest WHERE rev < 0')
    const pruneLoaded = db.prepare('DELETE FROM sync_manifest WHERE rev < 0 AND rev NOT IN (SELECT base_rev FROM sync_client)')
    // the base a page leaves behind when its write moves it (~29 KB a manifest on a 6 MB save, one per write): dropped unless another
    // page still has it as its base. A later read of that revision would build it again from the bytes.
    const dropBase = db.prepare('DELETE FROM sync_manifest WHERE rev = ? AND rev NOT IN (SELECT base_rev FROM sync_client)')

    const getRemote = db.prepare('SELECT h FROM sync_remote WHERE client = ? AND name = ?')
    const putRemote = db.prepare('INSERT OR REPLACE INTO sync_remote (client, name, h, updated) VALUES (?, ?, ?, ?)')
    const hasBlob = db.prepare('SELECT 1 FROM sync_remote_blob WHERE name = ? AND h = ?')
    const getBlob = db.prepare('SELECT data FROM sync_remote_blob WHERE name = ? AND h = ?')
    const putBlob = db.prepare('INSERT OR IGNORE INTO sync_remote_blob (name, h, data) VALUES (?, ?, ?)')
    // a version no page has as its base any more is dropped
    const dropBlob = db.prepare('DELETE FROM sync_remote_blob WHERE name = ? AND h = ? AND NOT EXISTS (SELECT 1 FROM sync_remote WHERE name = ? AND h = ?)')
    const pruneRemote = db.prepare('DELETE FROM sync_remote WHERE updated < ?')
    const pruneBlobs = db.prepare('DELETE FROM sync_remote_blob WHERE NOT EXISTS (SELECT 1 FROM sync_remote r WHERE r.name = sync_remote_blob.name AND r.h = sync_remote_blob.h)')
    const sha = (b) => crypto.createHash('sha1').update(b).digest('hex')

    /** `client` now has `bytes` of the remote file `name` (read or written): that is its base from now on */
    function setRemoteBase(client, name, bytes) {
        const h = sha(bytes)
        const old = getRemote.get(client, name)
        if (!hasBlob.get(name, h)) putBlob.run(name, h, bytes)
        putRemote.run(client, name, h, now())
        if (old && old.h !== h) dropBlob.run(name, old.h, name, old.h)
        return h
    }

    const currentRev = () => getRev.get().rev

    /** a page loaded `bytes` (the current database): remember what it has */
    function onRead(client, bytes) {
        let rev = currentRev()
        if (rev === 0) {
            rev = 1
            setRev.run(rev)
        }
        try {
            if (!getManifest.get(rev)) putManifest.run(rev, now(), JSON.stringify(manifestOf(bytes)))
            putClient.run(client, rev, now())
            if (rev > keep) {
                prune.run(rev - keep)
                pruneWrites.run(rev - keep, rev - keep)
            }
        } catch (error) {
            log(`sync: could not record the read of ${client.slice(0, 8)}: ${error.message}`)
        }
        return rev
    }

    /** a page holds `bytes` (not the file it last read): that is its base; its writes are merged against it until it reads again */
    function onLoaded(client, bytes) {
        const id = Math.min(0, minLoaded.get().m ?? 0) - 1
        putManifest.run(id, now(), JSON.stringify(manifestOf(bytes)))
        putClient.run(client, id, now())
        pruneLoaded.run()
        return id
    }

    /** a page writes `bytes`; `current` is what the server has (Buffer or null) */
    function onWrite(client, bytes, current) {
        const t0 = performance.now()
        let tMerge = 0
        const cur = currentRev()
        const rev = cur + 1
        let out = bytes
        let how = 'plain'
        let report = null
        const row = getClient.get(client)
        if (!current || cur === 0) {
            how = 'first'
        } else if (!row) {
            how = 'unknown page'
        } else if (row.base_rev > 0 && foreignWrites.get(row.base_rev, client).n === 0) {
            how = 'fast'
        } else {
            const mrow = getManifest.get(row.base_rev)
            if (!mrow) {
                how = 'base pruned'
            } else {
                const tm = performance.now()
                try {
                    const r = mergeSaves(JSON.parse(mrow.data), bytes, current)
                    report = r.report
                    out = r.buf
                    how = r.merged ? 'merged' : 'unmerged: ' + r.report.reason
                    if (r.merged && r.report.fromServer === 0 && r.report.blocksFromServer === 0 && r.report.conflicts === 0) {
                        // the merge took nothing from the server: its result is the page's own file, so store that and make it the
                        // base, as a fast write would. Kept as 'merged', the page's base stayed a negative manifest and every later
                        // save of it was merged again, forever (onWrite 62-70 ms instead of 35, measured with tests/acceptance/jank.mjs
                        // --other-page on 2026-10-20; specs/chat/DbSync.tla AfterMerge)
                        out = bytes
                        how = 'merged, nothing from the server'
                    }
                    if (how === 'merged') validateSave(out)   // never store a result that does not read back
                } catch (error) {
                    out = bytes
                    how = 'merge failed: ' + error.message
                }
                tMerge = performance.now() - tm
            }
        }
        setRev.run(rev)
        putWrite.run(rev, client, now())
        // After this write the page holds what it wrote, so that is its base for the next one. The base used to stay the revision the
        // page LOADED: every later write of the page counted its earlier writes as its edits again, and another page's edit or delete
        // of a message this page had written (or the retry of a write whose answer was lost, arriving after such an edit) was undone
        // (measured with Toxiproxy on a copy of the save, 2026-10-19; specs/chat/DbSync.tla AdvanceBase, NoLostUpdateSinceSync).
        try {
            if (how === 'merged') {
                // the server now holds more than the page (what the other pages wrote): its next write must merge, against what it wrote
                const id = Math.min(0, minLoaded.get().m ?? 0) - 1
                putManifest.run(id, now(), JSON.stringify(manifestOf(bytes)))
                putClient.run(client, id, now())
                pruneLoaded.run()
            } else {
                // the server now holds exactly what the page wrote: that is the base from now on
                putManifest.run(rev, now(), JSON.stringify(manifestOf(out)))
                putClient.run(client, rev, now())
            }
            if (row && row.base_rev > 0) dropBase.run(row.base_rev)
        } catch (error) {
            log(`sync: could not record the write of ${client.slice(0, 8)}: ${error.message}`)
        }
        if (how === 'merged') {
            log(`sync: merged a write of ${client.slice(0, 8)} (base ${row.base_rev}, now ${cur}): ${report.fromServer} parts from the server, ${report.conflicts} both-changed`)
        } else if (how !== 'fast') {
            log(`sync: write of ${client.slice(0, 8)} stored as ${how}`)
        }
        // ms: event-loop time of this write (merge: reading the base, mergeSaves and validateSave; the rest is manifestOf and SQLite)
        const ms = { total: performance.now() - t0, merge: tMerge }
        return { bytes: out, rev, merged: how === 'merged', how, report, ms }
    }

    /** a page loaded the remote file `name`: that is what its later writes of it are compared with */
    function onRemoteRead(client, name, bytes) {
        try {
            setRemoteBase(client, name, bytes)
            if (pruneRemote.run(now() - remoteKeepMs).changes > 0) pruneBlobs.run()
        } catch (error) {
            log(`sync: could not record the read of remote ${name} by ${client.slice(0, 8)}: ${error.message}`)
        }
    }

    /** a page writes `bytes` as the remote file `name`; `current` is what the server has (Buffer or null) */
    function onRemoteWrite(client, name, bytes, current) {
        const t0 = performance.now()
        let out = bytes
        let how = 'plain'
        let report = null
        const row = getRemote.get(client, name)
        if (!current || current.length === 0) {
            how = 'first'
        } else if (!row) {
            how = 'unknown page'
        } else if (row.h === sha(current)) {
            how = 'fast'    // nobody wrote since this page read or wrote: its file is the newest
        } else {
            const blob = getBlob.get(name, row.h)
            if (!blob) {
                how = 'base pruned'
            } else {
                try {
                    const r = mergeRemote(manifestOfRemote(blob.data), bytes, current)
                    report = r.report
                    out = r.buf
                    how = r.merged ? 'merged' : 'unmerged: ' + r.report.reason
                    if (r.merged && r.report.fromServer === 0 && r.report.blocksFromServer === 0 && r.report.conflicts === 0) {
                        out = bytes    // took nothing from the server: the page's own file
                        how = 'merged, nothing from the server'
                    }
                    if (how === 'merged') validateRemote(out)
                } catch (error) {
                    out = bytes
                    how = 'merge failed: ' + error.message
                }
            }
        }
        // the page holds what it wrote: that is its base, whatever the server stored
        try {
            setRemoteBase(client, name, bytes)
        } catch (error) {
            log(`sync: could not record the write of remote ${name} by ${client.slice(0, 8)}: ${error.message}`)
        }
        if (how === 'merged') {
            log(`sync: merged a write of remote ${name.slice(0, 8)} by ${client.slice(0, 8)}: ${report.fromServer} parts from the server, ${report.conflicts} both-changed, ${report.chatsMerged} chats merged`)
        } else if (how !== 'fast') {
            log(`sync: write of remote ${name.slice(0, 8)} by ${client.slice(0, 8)} stored as ${how}`)
        }
        return { bytes: out, merged: how === 'merged', how, report, ms: performance.now() - t0 }
    }

    function close() {
        db.close()
    }

    return { onRead, onLoaded, onWrite, onRemoteRead, onRemoteWrite, currentRev, close, db }
}

module.exports = { openDbSync }
