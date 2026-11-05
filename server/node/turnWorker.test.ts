import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
const { appPageProblem, explainError } = createRequire(import.meta.url)('./turnWorker.cjs')

const pageWith = (text: string) => ({ evaluate: async (fn: () => string) => { (globalThis as any).document = { body: { innerText: text } }; return fn() } })

describe('turnWorker failure messages', () => {
    it('names the legal screen when the app page shows it', async () => {
        const msg = await appPageProblem(pageWith('Legal documents not configured\nsomething'))
        expect(msg).toMatch(/legal screen/)
    })
    it('says nothing about a normal app page or a closed page', async () => {
        expect(await appPageProblem(pageWith('Input your password'))).toBeNull()
        expect(await appPageProblem({ evaluate: async () => { throw new Error('Target page, context or browser has been closed') } })).toBeNull()
    })
    it('explains the opaque "closed" error', () => {
        const m = explainError('page.evaluate: Target page, context or browser has been closed')
        expect(m).toMatch(/server restarted or stopped/)
        expect(m).toMatch(/has been closed/)
        expect(explainError('the chat is not in the save')).toBe('the chat is not in the save')
    })
})
