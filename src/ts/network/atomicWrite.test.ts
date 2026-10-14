// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const { atomicWriteFile } = createRequire(import.meta.url)('../../../server/node/atomicWrite.cjs')

let dir: string
let save: string
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'atomic-'))
    save = join(dir, 'save')
    mkdirSync(save)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('atomicWriteFile (specs/core/SaveLoad.tla)', () => {
    it('leaves the old file whole until the new one is complete, then replaces it in one step', async () => {
        const f = join(save, 'aa')
        writeFileSync(f, 'OLD-CONTENT')
        let seenDuring = ''
        await atomicWriteFile(f, Buffer.from('NEW-CONTENT'), {
            beforeRename: () => {
                seenDuring = readFileSync(f, 'utf8')   // what a reader sees while the new file is already fully written
            },
        })
        expect(seenDuring).toBe('OLD-CONTENT')
        expect(readFileSync(f, 'utf8')).toBe('NEW-CONTENT')
    })

    it('a failure before the rename keeps the old file and leaves no temporary file behind', async () => {
        const f = join(save, 'bb')
        writeFileSync(f, 'OLD')
        await expect(atomicWriteFile(f, Buffer.from('NEW'), { beforeRename: () => { throw new Error('disk full') } })).rejects.toThrow('disk full')
        expect(readFileSync(f, 'utf8')).toBe('OLD')
        expect(readdirSync(join(dir, 'save.tmp'))).toEqual([])
    })

    it('keeps temporary files out of the save directory, so /api/list never shows one', async () => {
        await atomicWriteFile(join(save, 'cc'), Buffer.from('x'))
        expect(readdirSync(save)).toEqual(['cc'])
    })

    it('creates the file when there is none', async () => {
        const f = join(save, 'dd')
        await atomicWriteFile(f, Buffer.from('FIRST'), { sync: true })
        expect(existsSync(f) && readFileSync(f, 'utf8')).toBe('FIRST')
    })

    it('stress: readers during many overlapping writes only ever see one whole version', async () => {
        const f = join(save, 'ee')
        const A = Buffer.alloc(300_000, 'a')
        const B = Buffer.alloc(300_000, 'b')
        writeFileSync(f, A)
        let stop = false
        const bad: string[] = []
        const reader = (async () => {
            while (!stop) {
                const got = await readFile(f)
                if (!(got.equals(A) || got.equals(B))) {
                    bad.push(`length ${got.length}`)
                }
            }
        })()
        for (let i = 0; i < 60; i++) {
            await atomicWriteFile(f, i % 2 ? A : B)
        }
        stop = true
        await reader
        expect(bad).toEqual([])
    })
})
