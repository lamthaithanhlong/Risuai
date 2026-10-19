// @vitest-environment node
// F6: only the newest RISU_PREMERGE_KEEP premerge pairs are kept (68 files, 273 MB in four days before).
import { describe, expect, test } from 'vitest'
import { createRequire } from 'node:module'

const req = createRequire(import.meta.url)
const retention = () => req('../../../server/node/premergeRetention.cjs')

describe('F6: only the newest premerge pairs are kept', () => {
    test('25 pairs and N = 20: the 5 oldest pairs go, other database files are never touched', () => {
        const names = ['database/database.bin', 'database/dbbackup-1.bin']
        for (let i = 0; i < 25; i++) {
            const tag = `2026-10-${String(10 + i).padStart(2, '0')}T00-00-00-000Z`
            names.push(`database/premerge-${tag}-server.bin`, `database/premerge-${tag}-page.bin`)
        }
        const { premergeToDelete } = retention()
        const drop = premergeToDelete(names, 20)
        expect(drop).toHaveLength(10)
        expect(drop.every((n: string) => n.startsWith('database/premerge-2026-10-1'))).toBe(true)
        expect(drop).not.toContain('database/database.bin')
        expect(premergeToDelete(names, 30)).toEqual([])
    })
    test('N comes from RISU_PREMERGE_KEEP, 20 when unset or invalid', () => {
        const { keepPairsFromEnv } = retention()
        expect(keepPairsFromEnv({})).toBe(20)
        expect(keepPairsFromEnv({ RISU_PREMERGE_KEEP: '3' })).toBe(3)
        expect(keepPairsFromEnv({ RISU_PREMERGE_KEEP: 'x' })).toBe(20)
    })
})
