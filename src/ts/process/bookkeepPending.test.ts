// The server's turn worker saves a turn only after the reply's bookkeeper (bookkeepPending.ts), and a trigger hands back only the
// variables it set (triggerVars.ts): measured 2026-10-21, both used to drop the bookkeeper's $led_soc lines.
import { describe, expect, it } from 'vitest'
import { bookkeepSettled, pendingFor, trackForward } from './bookkeepPending'
import { writeTriggerVars } from './triggerVars'

describe('bookkeepSettled: the turn waits for the reply\'s bookkeeper, never forever', () => {
    it('waits for the chat\'s chain; none is no wait; a slow one gives up after ms', async () => {
        expect(await bookkeepSettled('none', 10)).toBe(true)
        let done = false
        trackForward({ id: 'c1' }, new Promise((r) => setTimeout(() => { done = true; r(null) }, 30)))
        expect(await bookkeepSettled('c1', 1000)).toBe(true)
        expect(done).toBe(true)                       // the notes are written before the save the worker takes
        expect(pendingFor('c1')).toBeUndefined()
        trackForward({ id: 'c2' }, new Promise(() => {}))
        const t0 = Date.now()
        expect(await bookkeepSettled('c2', 40)).toBe(false)
        expect(Date.now() - t0).toBeLessThan(500)
        trackForward({ id: 'c3' }, Promise.reject(new Error('helper down')))
        expect(await bookkeepSettled('c3', 100)).toBe(true)   // a failed helper does not hold the turn
    })
})

describe('writeTriggerVars: a trigger gives back what it set, not its whole copy', () => {
    it('a write that landed in the live chat while the trigger ran survives', () => {
        const live = { scriptstate: { $st_hp: '10', $gm_beat: '1' } as Record<string, string> }
        const copy = structuredClone(live.scriptstate)       // runTrigger's clone, taken at its start
        live.scriptstate.$led_soc = '3 | Harlan | help | player'   // the bookkeeper meanwhile
        copy.$st_hp = '8'                                     // the trigger's own write
        writeTriggerVars([live, live, null], copy, ['$st_hp'])
        expect(live.scriptstate).toEqual({ $st_hp: '8', $gm_beat: '1', $led_soc: '3 | Harlan | help | player' })
        const fresh: { scriptstate?: Record<string, string> } = {}
        writeTriggerVars([fresh], copy, new Set(['$st_hp', '$nope']))
        expect(fresh.scriptstate).toEqual({ $st_hp: '8' })
        writeTriggerVars([live], copy, [])                   // nothing set: nothing written
        expect(live.scriptstate.$st_hp).toBe('8')
    })
})
