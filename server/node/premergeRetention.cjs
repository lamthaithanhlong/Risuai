// The safety copies a merged write leaves (database/premerge-<time>-server.bin and -page.bin, at most one pair per ten minutes) were
// never deleted: 68 files, 273 MB in four days on a disk that runs near full. Keep the newest `keepPairs` pairs.
const PREFIX = 'database/premerge-'
const PAIR = /^database\/premerge-(.+)-(server|page)\.bin$/

/** names (utf-8 keys) of premerge files to delete so that only the newest keepPairs tags remain; tags are ISO times, so they sort */
function premergeToDelete(names, keepPairs) {
    const byTag = new Map()
    for (const n of names) {
        const m = PAIR.exec(n)
        if (!m) continue
        if (!byTag.has(m[1])) byTag.set(m[1], [])
        byTag.get(m[1]).push(n)
    }
    const tags = [...byTag.keys()].sort()
    const drop = tags.slice(0, Math.max(0, tags.length - Math.max(0, keepPairs)))
    return drop.flatMap((t) => byTag.get(t))
}

function keepPairsFromEnv(env = process.env) {
    const n = Number.parseInt(env.RISU_PREMERGE_KEEP || '', 10)
    return Number.isFinite(n) && n >= 0 ? n : 20
}

module.exports = { premergeToDelete, keepPairsFromEnv, PREFIX }
