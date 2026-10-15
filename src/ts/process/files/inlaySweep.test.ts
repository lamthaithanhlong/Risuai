import { describe, expect, it } from 'vitest'
import { orphans, referencedIds, sweepInlays, type SweepDeps } from './inlaySweep'

const A = '054135db-d057-462f-b990-fc4bacf352da'
const B = 'd1f2ff63-a6f6-4582-8f2f-4d4fa37f4658'
const C = 'eebb5960-6dfa-4234-a3f0-deedb65bff66'
const MIN = 60_000

function world(opts: { texts: string[]; server: string[]; local: string[] }) {
    const removed = { server: [] as string[], local: [] as string[] }
    let seen = {}
    let clock = 1_800_000_000_000
    const deps: SweepDeps = {
        referenceTexts: async () => opts.texts,
        serverIds: async () => opts.server.filter((x) => !removed.server.includes(x)),
        localIds: async () => opts.local.filter((x) => !removed.local.includes(x)),
        removeServer: async (id) => { removed.server.push(id) },
        removeLocal: async (id) => { removed.local.push(id) },
        seen: { load: () => seen, save: (s) => { seen = s } },
        now: () => clock,
    }
    return { deps, removed, advance: (ms: number) => { clock += ms } }
}

describe('what counts as used', () => {
    it('any uuid in the database text, in any case', () => {
        const used = referencedIds([`{{inlay::${A}}} text`, JSON.stringify({ x: B.toUpperCase() })])
        expect(used.has(A) && used.has(B)).toBe(true)
    })
    it('only uuid-shaped ids can be orphans: a character image stored under its own name is kept', () => {
        expect(orphans([A, 'assets/abc.png', 'my-icon', C], new Set([A]))).toEqual([C])
    })
})

describe('the sweep', () => {
    it('a picture still used is never removed, however often the sweep runs', async () => {
        const w = world({ texts: [`{{inlay::${A}}}`], server: [A], local: [A] })
        for (let i = 0; i < 3; i++) { await sweepInlays(w.deps); w.advance(60 * MIN) }
        expect(w.removed).toEqual({ server: [], local: [] })
    })
    it('two strikes: the first start only remembers an orphan, a start after the grace time removes it from server and browser', async () => {
        const w = world({ texts: [`{{inlay::${A}}}`], server: [A, C], local: [A, C] })
        expect((await sweepInlays(w.deps)).removed).toEqual([])
        w.advance(5 * MIN)
        expect((await sweepInlays(w.deps)).removed).toEqual([])          // not long enough yet
        w.advance(6 * MIN)
        expect((await sweepInlays(w.deps)).removed).toEqual([C])
        expect(w.removed).toEqual({ server: [C], local: [C] })
    })
    it('a picture that becomes used again between the strikes is kept (the page saved the message meanwhile)', async () => {
        const texts: string[] = ['nothing yet']
        const w = world({ texts, server: [B], local: [] })
        await sweepInlays(w.deps)
        texts.push(`{{inlay::${B}}}`)
        w.advance(30 * MIN)
        expect((await sweepInlays(w.deps)).removed).toEqual([])
        texts.pop()
        w.advance(5 * MIN)
        expect((await sweepInlays(w.deps)).removed).toEqual([])           // the wait starts again from this start
    })
})
