import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The model is slower than every helper timeout (the ChatGPT web case): each request answers MODEL_MS after it is sent,
// unless it is aborted first. specs/core/HelperCache.tla is the model of this; these tests tie it to the code.
const MODEL_MS = 5 * 60_000
const db: { storyTerms?: boolean; storyVoice?: boolean } = {}
vi.mock('../storage/database.svelte', () => ({ getDatabase: () => db }))
const asks: string[] = []
const aborted: string[] = []
const reply = { text: '[{"vi": "Tiếng Vọng", "lore": "Echo", "means": "a servant"}]' }
vi.mock('./request/request', () => ({
    requestChatData: (arg: { formated: { content: string }[] }, _model: string, signal?: AbortSignal) => {
        const ask = arg.formated[0].content
        asks.push(ask)
        return new Promise((resolve) => {
            const t = setTimeout(() => resolve({ type: 'success', result: reply.text }), MODEL_MS)
            signal?.addEventListener('abort', () => { clearTimeout(t); aborted.push(ask); resolve({ type: 'fail', result: 'aborted' }) })
        })
    },
}))

const { glossaryOf } = await import('./storyTermsPage')
const { sharedJob, waitAtMost, jobsInFlight, HELPER_HARD_MS } = await import('./helperJob')

const newCard = () => ({ type: 'character', name: 'Shadow Slave', desc: 'rules of the story', globalLore: [], extentions: {} as Record<string, unknown> })

describe('story helpers keep a late answer (ChatGPT web: slower than every helper timeout)', () => {
    beforeEach(() => { vi.useFakeTimers(); asks.length = 0; aborted.length = 0 })
    afterEach(() => { vi.useRealTimers() })

    it('the turn stops waiting at its timeout, the answer is still kept, and the next turn sends nothing', async () => {
        const card = newCard()
        const first = glossaryOf(card as never)
        await vi.advanceTimersByTimeAsync(40_000)
        expect(await first).toBe(null)                      // the turn went on without the glossary
        await vi.advanceTimersByTimeAsync(MODEL_MS)
        expect(card.extentions.vjTerms).toBeTruthy()        // ...but the late answer is kept with the card
        const second = await glossaryOf(card as never)
        expect(second?.map((t) => t.lore)).toEqual(['Echo'])
        expect(asks.length).toBe(1)                         // one ChatGPT web turn in all
    })

    it('a turn that comes while the request is in flight joins it instead of asking again (OneAsk)', async () => {
        const card = newCard()
        const turns = [glossaryOf(card as never)]
        await vi.advanceTimersByTimeAsync(40_000)
        turns.push(glossaryOf(card as never))
        await vi.advanceTimersByTimeAsync(40_000)
        turns.push(glossaryOf(card as never))
        expect(asks.length).toBe(1)
        expect(jobsInFlight()).toBe(1)
        await vi.advanceTimersByTimeAsync(MODEL_MS)
        await Promise.all(turns)
        expect(jobsInFlight()).toBe(0)
    })

    it('a request that never answers is aborted at the hard limit and frees its key', async () => {
        const job = sharedJob('hung', (signal) => new Promise<string>((resolve) => signal.addEventListener('abort', () => resolve('gave up'))))
        const wait = waitAtMost(job, 1000)
        await vi.advanceTimersByTimeAsync(1000)
        expect(await wait).toBe(null)
        expect(jobsInFlight()).toBe(1)
        await vi.advanceTimersByTimeAsync(HELPER_HARD_MS)
        expect(await job).toBe('gave up')
        expect(jobsInFlight()).toBe(0)
    })

    it('a failed job gives null to the waiting turn and is not kept', async () => {
        const job = sharedJob('boom', async () => { throw new Error('502') })
        expect(await waitAtMost(job, 1000)).toBe(null)
        expect(jobsInFlight()).toBe(0)
    })
})
