import { describe, expect, test } from 'vitest'
import { fitInlaySize, GENERATED_INLAY_MAX_SIDE } from './inlaySize'

describe('fitInlaySize', () => {
    test('a generated landscape picture is cut to 360 on the long side and keeps its proportions', () => {
        expect(fitInlaySize(1536, 1024, { maxSide: GENERATED_INLAY_MAX_SIDE })).toEqual({ width: 360, height: 240 })
    })

    test('a square and a portrait picture', () => {
        expect(fitInlaySize(1024, 1024, { maxSide: 360 })).toEqual({ width: 360, height: 360 })
        expect(fitInlaySize(1000, 1500, { maxSide: 360 })).toEqual({ width: 240, height: 360 })
    })

    test('a picture that is already small is not enlarged', () => {
        expect(fitInlaySize(200, 100, { maxSide: 360 })).toEqual({ width: 200, height: 100 })
        expect(fitInlaySize(360, 360, { maxSide: 360 })).toEqual({ width: 360, height: 360 })
    })

    test('without maxSide the old rule holds: only the total pixels are limited to 1024 x 1024', () => {
        expect(fitInlaySize(2000, 2000)).toEqual({ width: 1024, height: 1024 })
        expect(fitInlaySize(1536, 1024)).toEqual({ width: 1254, height: 836 })
        expect(fitInlaySize(800, 600)).toEqual({ width: 800, height: 600 })
    })

    test('the stricter of the two limits wins', () => {
        expect(fitInlaySize(4000, 3000, { maxSide: 5000 })).toEqual({ width: 1182, height: 886 })
        expect(fitInlaySize(4000, 3000, { maxSide: 3500 })).toEqual({ width: 1182, height: 886 })   // the pixel limit is stricter than 3500
        expect(fitInlaySize(4000, 3000, { maxSide: 360 })).toEqual({ width: 360, height: 270 })
    })

    test('a very thin picture never collapses to zero', () => {
        const r = fitInlaySize(10000, 3, { maxSide: 360 })
        expect(r.width).toBe(360)
        expect(r.height).toBeGreaterThanOrEqual(1)
    })
})
