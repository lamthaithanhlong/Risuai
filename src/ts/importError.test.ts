import { describe, expect, test } from 'vitest'
import { describeImportError } from './importError'

describe('describeImportError', () => {
    test('an Error keeps its message and stack', () => {
        const cause = new TypeError('Load failed')
        const e = describeImportError(cause)
        expect(e.message).toBe('Error while importing: Load failed')
        expect(e.stack).toContain('--- cause ---')
        expect(e.stack).toContain('TypeError')
        expect((e as any).cause).toBe(cause)
    })

    test('a thrown string (getHubResources throws response text) is shown as is', () => {
        expect(describeImportError('{"error":"not found"}').message).toBe('Error while importing: {"error":"not found"}')
    })

    test('an object is turned into text instead of "[object Object]"', () => {
        expect(describeImportError({ status: 502 }).message).toBe('Error while importing: {"status":502}')
    })

    test('an error with an empty message still says something', () => {
        expect(describeImportError(new Error('')).message).toBe('Error while importing: Error')
    })

    test('an AggregateError lists its distinct reasons with counts instead of hiding them', () => {
        const errors = [...Array(500).fill('setItem Error'), ...Array(60).fill('Failed to fetch'), ...Array(5).fill(new TypeError('Load failed'))].map((e) => typeof e === 'string' ? new Error(e) : e)
        const e = describeImportError(new AggregateError(errors, 'Failed to save 565 assets'))
        expect(e.message).toBe('Error while importing: Failed to save 565 assets [setItem Error x500; Failed to fetch x60; Load failed x5]')
    })

    test('more than three distinct reasons say how many were left out', () => {
        const errors = ['a', 'b', 'c', 'd', 'e'].map((m) => new Error(m))
        expect(describeImportError(new AggregateError(errors, 'Failed to save 5 assets')).message).toContain('+2 other reasons')
    })
})
