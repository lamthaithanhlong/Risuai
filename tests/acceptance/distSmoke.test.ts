// Proves scripts/distSmoke.mjs: RED on a client built without the legal flag, GREEN on the live-good client.
// Needs the dists the PM keeps next to the repo (~/Downloads/Risuai); skipped when they are absent. Takes ~20 s each.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const root = process.env.RISU_DIST_ROOT || path.join(os.homedir(), 'Downloads/Risuai')
const bad = path.join(root, 'dist.nolegal-1105-1246')
const good = path.join(root, 'dist')
const script = path.resolve(__dirname, '../../scripts/distSmoke.mjs')
const run = (d: string, port: string) => spawnSync(process.execPath, [script, d, '--port', port], { encoding: 'utf8', timeout: 120000 })

describe('distSmoke', () => {
    it.skipIf(!fs.existsSync(bad))('fails the dist without the legal flag, naming the legal screen', () => {
        const r = run(bad, '6262')
        expect(r.status).toBe(1)
        expect(r.stdout).toMatch(/^FAIL: .*legal screen/)
    }, 130000)
    it.skipIf(!fs.existsSync(good))('passes the good dist', () => {
        const r = run(good, '6263')
        expect(r.status).toBe(0)
        expect(r.stdout).toMatch(/^PASS: /)
    }, 130000)
    it('fails a directory that is not a dist', () => {
        const r = run(os.tmpdir(), '6264')
        expect(r.status).toBe(1)
        expect(r.stdout).toMatch(/^FAIL: .*no index.html/)
    })
})
