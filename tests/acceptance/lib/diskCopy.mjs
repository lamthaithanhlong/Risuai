// Copies of the live save and of earlier runs must cost no disk: APFS clone (cp -c) is copy-on-write. When clone is refused (another volume,
// not APFS) the copy is a normal one, and says so, because that is what fills the disk (2026-11-04: gates stopped at 3 GB free).
import { execFileSync } from 'child_process'
import fs from 'fs'

/** bytes free for an unprivileged writer on the volume holding `p` */
export function freeBytes(p, statfs = fs.statfsSync) {
    const s = statfs(p)
    return Number(s.bavail) * Number(s.bsize)
}

/** 'clone' when cp -c worked, 'copy' after a logged fallback to a plain cp -R. `run` is injectable for tests. */
export function cloneCopy(src, dst, { log = console.log, run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' }) } = {}) {
    try {
        run('cp', ['-cR', src, dst])
        return 'clone'
    } catch (e) {
        log(`[env] clone refused for ${src} (${String(e.message).split('\n')[0].slice(0, 120)}): plain copy, this one costs real disk`)
        fs.rmSync(dst, { recursive: true, force: true })
        run('cp', ['-R', src, dst])
        return 'copy'
    }
}

export const MIN_FREE_AFTER_COPY = 2 * 1024 ** 3

/** the message to stop on, or '' when the run may go on; `free` in bytes measured after the copies */
export function diskProblem({ free, min = MIN_FREE_AFTER_COPY }) {
    if (free < min) {
        return `run.mjs: only ${(free / 1024 ** 3).toFixed(2)} GB free after copying the save (needs ${(min / 1024 ** 3).toFixed(1)} GB): stopping before the server starts. Free disk (finished runs under ~/.risu-story-work/acceptance) or reuse a base with --base-from.`
    }
    return ''
}

export const gb = (b) => (b / 1024 ** 3).toFixed(2)
