// @vitest-environment node
// The four one-line hooks that connect the growth pieces to the app; each is a call a refactor could drop without any other test noticing.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (p: string) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8')

describe('growth wiring', () => {
    it('the display chain strips the growth tags (parser.svelte.ts)', () => {
        const s = read('src/ts/parser/parser.svelte.ts')
        expect(s).toMatch(/import \{ stripStatTags \} from '..\/process\/statsTags'/)
        expect(s).toMatch(/stripStatTags\(stripFind\(/)
    })
    it('a request loads the persona\'s stats and a reply sends this turn\'s gains, in both reply paths (index.svelte.ts)', () => {
        const s = read('src/ts/process/index.svelte.ts')
        expect(s).toMatch(/await statsBeforeRequestPage\(currentChar, currentChat\)/)
        expect(s.match(/void statsAfterReplyPage\(currentChar, currentChat\)/g)?.length).toBe(2)
    })
    it('the server mounts POST /api/stats (server.cjs)', () => {
        expect(read('server/node/server.cjs')).toMatch(/require\('\.\/statsBridge\.cjs'\)\.mountStats\(app, \{ auth: /)
    })
})
