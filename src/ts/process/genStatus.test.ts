import { describe, expect, test } from 'vitest'
import { IDLE, nextStatus, phaseOfText, type GenEvent, type GenPhase, type GenStatusState } from './genStatus.svelte'

const T0 = 1_000_000
const run = (events: GenEvent[], from: GenStatusState = IDLE) => events.reduce((s, e) => nextStatus(s, e), from)

describe('phaseOfText', () => {
    test('what the streamed text says', () => {
        expect(phaseOfText('')).toBe('accepted')
        expect(phaseOfText('<Thoughts>\nđang nghĩ')).toBe('thinking')
        expect(phaseOfText('<Thoughts>\nnghĩ\n</Thoughts>\n')).toBe('thinking')
        expect(phaseOfText('<think>nghĩ</think>Chào em.')).toBe('writing')
        expect(phaseOfText('Chào em.')).toBe('writing')
    })
})

describe('nextStatus', () => {
    test('send, accept, thought, reply, end', () => {
        let s = run([{ type: 'send', now: T0 }])
        expect(s).toMatchObject({ phase: 'sent', startedAt: T0 })
        s = nextStatus(s, { type: 'accept', now: T0 + 10_000 })
        expect(s.phase).toBe('accepted')
        s = nextStatus(s, { type: 'text', now: T0 + 11_000, text: '<Thoughts>\nnghĩ' })
        expect(s.phase).toBe('thinking')
        s = nextStatus(s, { type: 'text', now: T0 + 12_000, text: '<Thoughts>\nnghĩ\n</Thoughts>\nBụi giấy' })
        expect(s).toMatchObject({ phase: 'writing', startedAt: T0 })
        expect(nextStatus(s, { type: 'end' })).toEqual(IDLE)
    })

    test('a failed attempt shows the reason and the next attempt number, and keeps the original start time', () => {
        let s = run([{ type: 'send', now: T0 }, { type: 'retry', now: T0 + 8000, attempt: 2, attempts: 3, reason: 'model_not_found' }])
        expect(s).toMatchObject({ phase: 'retrying', attempt: 2, attempts: 3, reason: 'model_not_found', startedAt: T0 })
        s = nextStatus(s, { type: 'accept', now: T0 + 20_000 })
        expect(s).toMatchObject({ phase: 'accepted', reason: '', startedAt: T0 })
    })

    test('phases never go back while a reply streams (a shorter text later does not undo "writing")', () => {
        let s = run([{ type: 'send', now: T0 }, { type: 'accept', now: T0 + 1 }, { type: 'text', now: T0 + 2, text: 'Chào em.' }])
        expect(s.phase).toBe('writing')
        s = nextStatus(s, { type: 'text', now: T0 + 3, text: '' })
        expect(s.phase).toBe('writing')
        s = nextStatus(s, { type: 'text', now: T0 + 4, text: '<Thoughts>\nlại nghĩ' })
        expect(s.phase).toBe('writing')
    })

    test('events when nothing is in flight change nothing', () => {
        expect(nextStatus(IDLE, { type: 'accept', now: T0 })).toEqual(IDLE)
        expect(nextStatus(IDLE, { type: 'retry', now: T0, attempt: 1, attempts: 2, reason: 'x' })).toEqual(IDLE)
        expect(nextStatus(IDLE, { type: 'end' })).toEqual(IDLE)
        expect(nextStatus(IDLE, { type: 'text', now: T0, text: 'Chào em.' })).toEqual(IDLE)
    })

    test('property: any event sequence, while a request is in flight the phase is never idle, and it only moves forward (except into retrying)', () => {
        const ORDER: Record<GenPhase, number> = { idle: 0, sent: 1, retrying: 1, accepted: 2, thinking: 3, writing: 4 }
        let seed = 7
        const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
        const texts = ['', '<Thoughts>\nnghĩ', '<Thoughts>\nnghĩ\n</Thoughts>\n', 'Chào em.', '<think>x</think>Chào']
        for (let run_ = 0; run_ < 3000; run_++) {
            let s: GenStatusState = IDLE
            let inFlight = false
            for (let i = 0; i < 20; i++) {
                const k = rnd()
                let e: GenEvent
                if (k < 0.15) e = { type: 'send', now: T0 + i }
                else if (k < 0.3) e = { type: 'retry', now: T0 + i, attempt: 1, attempts: 3, reason: 'x' }
                else if (k < 0.5) e = { type: 'accept', now: T0 + i }
                else if (k < 0.9) e = { type: 'text', now: T0 + i, text: texts[Math.floor(rnd() * texts.length)] }
                else e = { type: 'end' }
                const prev = s
                s = nextStatus(s, e)
                if (e.type === 'send') inFlight = true
                if (e.type === 'end') inFlight = false
                if (inFlight && e.type !== 'end') expect(s.phase).not.toBe('idle')
                if (e.type === 'end') expect(s.phase).toBe('idle')
                if (prev.phase !== 'idle' && e.type !== 'send' && e.type !== 'end' && s.phase !== 'retrying') {
                    expect(ORDER[s.phase]).toBeGreaterThanOrEqual(ORDER[prev.phase])
                }
            }
        }
    })
})
