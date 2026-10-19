// Remembers, per page, which version of database.bin it loaded, and merges its writes against that (dbMerge.cjs).
//
//   onRead(client, bytes)   a page read the database: that is now its base. A manifest of hashes is kept for the revision.
//   onLoaded(client, bytes) a page holds `bytes`, not the file it read (bootstrap.ts loads a dbbackup-*.bin when database.bin does not
//                           decode): that is its base from now on, and its writes are always merged against it (F7, see below).
//   onWrite(client, bytes, current) a page writes: returns the bytes to store (the page's own file when nobody else wrote since it
//                           loaded, else the merge of its file with what the server has) and the new revision.
//
// A page is a browser tab (the hash of its public key and the tab id, else the header x-risu-client, else address + user agent). Its
// base is what it last loaded or wrote: after a write its memory is the file it wrote, so what differs from that is exactly what it
// changed since. A write stored as it is makes that revision the base; a merged write keeps the page's own file as a manifest under a
// negative id, and the page's next write is merged against it (the server holds more than the page then). When the base is not
// known (a page that loaded before this started, a pruned manifest) the page's file is stored as it is, as before.
const { manifestOf, mergeSaves, validateSave } = require('./dbMerge.cjs')

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
    const db = new Database(opts.dbFile)
    db.pragma('journal_mode = WAL')
    db.exec(`
        CREATE TABLE IF NOT EXISTS sync_state (id INTEGER PRIMARY KEY CHECK (id = 1), rev INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_manifest (rev INTEGER PRIMARY KEY, created INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_write (rev INTEGER PRIMARY KEY, client TEXT NOT NULL, created INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sync_client (client TEXT PRIMARY KEY, base_rev INTEGER NOT NULL, updated INTEGER NOT NULL);
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
                try {
                    const r = mergeSaves(JSON.parse(mrow.data), bytes, current)
                    report = r.report
                    if (r.merged) {
                        validateSave(r.buf)            // never store a result that does not read back
                    }
                    out = r.buf
                    how = r.merged ? 'merged' : 'unmerged: ' + r.report.reason
                } catch (error) {
                    out = bytes
                    how = 'merge failed: ' + error.message
                }
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
        return { bytes: out, rev, merged: how === 'merged', how, report }
    }

    function close() {
        db.close()
    }

    return { onRead, onLoaded, onWrite, currentRev, close, db }
}

module.exports = { openDbSync }
