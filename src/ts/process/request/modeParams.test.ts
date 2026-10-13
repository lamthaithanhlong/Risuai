import { describe, expect, test } from 'vitest'
import { TOKEN_SAVER_OFF, migrateTokenSaverOff, modeAdditionalParameters } from './modeParams'

describe('modeAdditionalParameters', () => {
    test('a translation request gets the translate-only parameters', () => {
        expect(modeAdditionalParameters('translate', [TOKEN_SAVER_OFF])).toEqual([TOKEN_SAVER_OFF])
    })

    test('chat and every other kind of request are left alone', () => {
        expect(modeAdditionalParameters('model', [TOKEN_SAVER_OFF])).toEqual([])
        expect(modeAdditionalParameters('submodel', [TOKEN_SAVER_OFF])).toEqual([])
        expect(modeAdditionalParameters(undefined, [TOKEN_SAVER_OFF])).toEqual([])
    })

    test('nothing configured means nothing added, and the setting is never mutated', () => {
        expect(modeAdditionalParameters('translate', undefined)).toEqual([])
        const configured: [string, string][] = [TOKEN_SAVER_OFF]
        modeAdditionalParameters('translate', configured).push(['x', 'y'])
        expect(configured).toEqual([TOKEN_SAVER_OFF])
    })

    test('a translation model of its own is added as the request model', () => {
        expect(modeAdditionalParameters('translate', [TOKEN_SAVER_OFF], 'story')).toEqual([TOKEN_SAVER_OFF, ['model', 'story']])
        expect(modeAdditionalParameters('translate', undefined, '  story ')).toEqual([['model', 'story']])
    })

    test('an empty translation model keeps the chat model, and chat never gets it', () => {
        expect(modeAdditionalParameters('translate', [TOKEN_SAVER_OFF], '')).toEqual([TOKEN_SAVER_OFF])
        expect(modeAdditionalParameters('model', [TOKEN_SAVER_OFF], 'story')).toEqual([])
    })
})

describe('migrateTokenSaverOff', () => {
    test('adds the header once, keeping the other rows', () => {
        const out = migrateTokenSaverOff([['top_k', '{{none}}']], false)
        expect(out.params).toEqual([['top_k', '{{none}}'], TOKEN_SAVER_OFF])
        expect(out.migrated).toBe(true)
    })

    test('after migrating, a row the owner deleted is not added back', () => {
        expect(migrateTokenSaverOff([], true).params).toEqual([])
    })

    test('a row for that header already there is the owner\'s choice, even set to something else', () => {
        const rows: [string, string][] = [['Header::X-9Router-Token-Saver', 'on']]
        expect(migrateTokenSaverOff(rows, false).params).toEqual(rows)
    })

    test('running it twice never duplicates the row', () => {
        const first = migrateTokenSaverOff([], false)
        expect(migrateTokenSaverOff(first.params, false).params).toEqual([TOKEN_SAVER_OFF])
    })

    test('the input list is not changed', () => {
        const rows: [string, string][] = []
        migrateTokenSaverOff(rows, false)
        expect(rows).toEqual([])
    })
})

describe('migrateStreamingDisplay', () => {
    test('off (or unset) becomes balanced once', async () => {
        const { migrateStreamingDisplay } = await import('./modeParams')
        expect(migrateStreamingDisplay('off', false)).toEqual({ mode: 'balanced', migrated: true })
        expect(migrateStreamingDisplay(undefined, false)).toEqual({ mode: 'balanced', migrated: true })
    })
    test("the owner's own choice is kept", async () => {
        const { migrateStreamingDisplay } = await import('./modeParams')
        expect(migrateStreamingDisplay('strong', false).mode).toBe('strong')
        expect(migrateStreamingDisplay('balanced', false).mode).toBe('balanced')
    })
    test('once migrated, switching back to off sticks', async () => {
        const { migrateStreamingDisplay } = await import('./modeParams')
        expect(migrateStreamingDisplay('off', true)).toEqual({ mode: 'off', migrated: true })
    })
})
