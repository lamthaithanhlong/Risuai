// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const gm = createRequire(import.meta.url)('../../../server/node/gmSolver.cjs')

describe('companionLimits on the decide route', () => {
    it('keeps a plain object, 6 entries, 40-char names, 300-char texts', () => {
        const big: Record<string, unknown> = {}
        for (let i = 0; i < 9; i++) big['n' + i] = 'x'.repeat(500)
        big['k'.repeat(60)] = 'late'
        const out = gm.sanitizeCompanionLimits(big)
        expect(Object.keys(out)).toHaveLength(6)
        expect(Object.values(out).every((v) => (v as string).length === 300)).toBe(true)
        expect(Object.keys(gm.sanitizeCompanionLimits({ ['k'.repeat(60)]: 'a' }))[0]).toHaveLength(40)
    })
    it('drops non-strings, arrays and non-objects', () => {
        expect(gm.sanitizeCompanionLimits({ a: 1, b: { c: 1 }, d: 'ok' })).toEqual({ d: 'ok' })
        for (const v of [undefined, null, 'x', 5, ['a']]) expect(gm.sanitizeCompanionLimits(v)).toEqual({})
    })
    it('the route forwards it to the solver input', () => {
        const src = require('node:fs').readFileSync(new URL('../../../server/node/server.cjs', import.meta.url), 'utf8')
        expect(src).toMatch(/companionLimits:\s*gmSolver\.sanitizeCompanionLimits\(b\.companionLimits\)/)
    })
})
