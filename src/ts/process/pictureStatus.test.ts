import { describe, expect, it } from 'vitest'
import { notYetApplied, openJobs, pictureStates, pollDelayMs } from './pictureStatus'
import type { ImageJob } from './imageJobClient'

const job = (over: Partial<ImageJob> & { id: string }): ImageJob => ({ status: 'queued', target: { charId: 'c', chatId: 'k', chatIndex: 0, messageId: 'm1', messageIndex: 1 }, created: 1000, ...over })

describe('what the page shows under a message', () => {
    it('shows drawing, retrying and failed pictures by message id, and nothing for a picture that arrived', () => {
        const s = pictureStates([
            job({ id: 'a', status: 'running', created: 1, target: { charId: 'c', chatIndex: 0, messageIndex: 0, messageId: 'm1' } }),
            job({ id: 'b', status: 'retrying', attempt: 1, nextAt: 9000, created: 2, target: { charId: 'c', chatIndex: 0, messageIndex: 0, messageId: 'm2' } }),
            job({ id: 'c', status: 'error', error: 'every model failed', created: 3, target: { charId: 'c', chatIndex: 0, messageIndex: 0, messageId: 'm3' } }),
            job({ id: 'd', status: 'placed', inlayId: 'p', created: 4, target: { charId: 'c', chatIndex: 0, messageIndex: 0, messageId: 'm4' } }),
        ])
        expect(Object.keys(s).sort()).toEqual(['m1', 'm2', 'm3'])
        expect(s.m1).toMatchObject({ state: 'drawing', jobId: 'a' })
        expect(s.m2).toMatchObject({ state: 'retrying', attempt: 1, nextAt: 9000 })
        expect(s.m3).toMatchObject({ state: 'failed', error: 'every model failed' })
    })
    it('the newest job of a message wins: a redraw hides the failure of the first picture, and a finished redraw clears the line', () => {
        const failed = job({ id: 'old', status: 'error', created: 1 })
        expect(pictureStates([failed, job({ id: 'new', status: 'queued', created: 2 })]).m1.jobId).toBe('new')
        expect(pictureStates([failed, job({ id: 'new', status: 'placed', inlayId: 'p', created: 2 })])).toEqual({})
    })
    it('counts the jobs that still have work to do', () => {
        expect(openJobs([job({ id: 'a' }), job({ id: 'b', status: 'running' }), job({ id: 'c', status: 'retrying' }), job({ id: 'd', status: 'error' }), job({ id: 'e', status: 'placed' })]).map((j) => j.id)).toEqual(['a', 'b', 'c'])
    })
    it('looks often while a picture is open, rarely otherwise, never while the page is hidden', () => {
        expect(pollDelayMs(1, false)).toBeLessThan(pollDelayMs(0, false)!)
        expect(pollDelayMs(2, true)).toBeNull()
    })
    it('puts a picture into this copy of the chat once per page: a picture deleted by hand does not come back at the next look', () => {
        const done = job({ id: 'p', status: 'placed', inlayId: 'x' })
        const applied = new Set<string>()
        expect(notYetApplied([done, job({ id: 'q' })], applied).map((j) => j.id)).toEqual(['p'])
        applied.add('p')
        expect(notYetApplied([done], applied)).toEqual([])
    })
})
