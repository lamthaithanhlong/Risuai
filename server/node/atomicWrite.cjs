// Writes a file so that a reader (or a crash) sees either the whole old content or the whole new content, never a half-written file.
//
// fs.writeFile(path, data) truncates the file first and then writes, so for as long as the write lasts /api/read (sendFile) can
// return a half file, and a process killed in that time leaves one behind (specs/core/SaveLoad.tla). Here the data goes to a
// temporary file in a sibling directory on the same filesystem and is moved over the real name with rename(), which replaces
// the file in one step. The temporary directory is outside the save directory so /api/list never shows a temporary file.

const fs = require('fs/promises')
const path = require('path')
const crypto = require('crypto')

async function atomicWriteFile(finalPath, content, opts = {}) {
    const tmpDir = opts.tmpDir ?? path.join(path.dirname(finalPath) + '.tmp')
    await fs.mkdir(tmpDir, { recursive: true })
    const tmp = path.join(tmpDir, `${path.basename(finalPath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}`)
    try {
        const handle = await fs.open(tmp, 'w')
        try {
            await handle.writeFile(content)
            if (opts.sync) {
                await handle.sync()          // the database is worth the extra milliseconds; assets are not
            }
        } finally {
            await handle.close()
        }
        if (opts.beforeRename) {
            await opts.beforeRename(tmp)     // test seam
        }
        await fs.rename(tmp, finalPath)
        if (opts.syncDir) {
            // the rename itself is only durable once the directory is flushed; the queue deletes its row right after this returns
            const dir = await fs.open(path.dirname(finalPath), 'r')
            try { await dir.sync() } finally { await dir.close() }
        }
    } catch (error) {
        await fs.rm(tmp, { force: true }).catch(() => {})
        throw error
    }
}

// A process killed between creating the temporary file and the rename leaves it behind; nothing else ever reads that directory.
async function cleanStaleTemp(tmpDir, maxAgeMs, now = Date.now()) {
    let names = []
    try {
        names = await fs.readdir(tmpDir)
    } catch (error) {
        return 0
    }
    let removed = 0
    for (const name of names) {
        const file = path.join(tmpDir, name)
        try {
            const st = await fs.stat(file)
            if (now - st.mtimeMs > maxAgeMs) {
                await fs.rm(file, { force: true })
                removed++
            }
        } catch (error) {
            /* gone already */
        }
    }
    return removed
}

module.exports = { atomicWriteFile, cleanStaleTemp }
