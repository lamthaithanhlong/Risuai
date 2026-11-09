import { describe, expect, test } from 'vitest'
import { assetNamesFromCard, sanitizeAssetTags } from './assetTagGate'

const ALLOW = [
    'aki_schooluniform_confused',
    'aki_schooluniform_angry',
    'aki_schooluniform_curious',
    'naru_schooluniform_angry',
    'naru_schooluniform_confused',
    'rena_schooluniform_curious',
    'rena_schooluniform_seductive.smile',
]

describe('assetTagGate', () => {
    test('removes invented kenji_* tags; keeps real aki tag (live New Chat 2)', () => {
        const input =
            'X\n\n[🖼️|kenji_casual_nervous|👁️]\n\nAki looks.\n\n[🖼️|aki_schooluniform_confused|👁️]\n\n[🖼️|kenji_casual_thinking|👁️]\n'
        const { text, fixed } = sanitizeAssetTags(input, ALLOW)
        expect(text).toContain('[🖼️|aki_schooluniform_confused|👁️]')
        expect(text).not.toContain('kenji_casual')
        expect(fixed.filter((f) => f.from.startsWith('kenji_')).every((f) => f.to === null)).toBe(true)
    })

    test('remaps near-miss emotion within the same character prefix', () => {
        const { text, fixed } = sanitizeAssetTags('[🖼️|aki_schooluniform_confuzed|👁️]', ALLOW)
        expect(text).toBe('[🖼️|aki_schooluniform_confused|👁️]')
        expect(fixed).toEqual([{ from: 'aki_schooluniform_confuzed', to: 'aki_schooluniform_confused' }])
    })

    test('exact matches stay unchanged', () => {
        const raw = '[🖼️|rena_schooluniform_curious|👁️]'
        const { text, fixed } = sanitizeAssetTags(raw, ALLOW)
        expect(text).toBe(raw)
        expect(fixed).toEqual([])
    })

    test('assetNamesFromCard reads additionalAssets and emotionImages', () => {
        expect(
            assetNamesFromCard({
                additionalAssets: [['aki_schooluniform_confused', 'a', 'webp']],
                emotionImages: [['happy', 'b']],
            }),
        ).toEqual(['aki_schooluniform_confused', 'happy'])
    })
})

    test('strips invented yuuichi_schooluniform_* when only bare Yuuichi portrait exists', () => {
        const allow = [...ALLOW, 'Yuuichi']
        const { text, fixed } = sanitizeAssetTags('[🖼️|yuuichi_schooluniform_serious|👁️]', allow)
        expect(text).not.toContain('yuuichi_schooluniform_serious')
        expect(text).not.toContain('[🖼️|Yuuichi|👁️]')
        expect(fixed).toEqual([{ from: 'yuuichi_schooluniform_serious', to: null }])
    })

