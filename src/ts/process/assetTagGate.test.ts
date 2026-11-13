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


import { countImageTags, imageReminder, imageRequest, imageSystemOf, keepAssetTags } from './assetTagGate'

const EMO = ['acting.coy', 'angry', 'bored', 'curious', 'happy', 'sad', 'shy', ...Array.from({ length: 14 }, (_, i) => `mood${i}`)]
const emojiCard = {
    additionalAssets: [...['naru', 'aki'].flatMap((c) => EMO.map((e) => [`${c}_schooluniform_${e}`, 'p', 'webp'])), ['id_photo', 'p', 'webp'], ...[1, 2, 3, 4, 5, 6].map((i) => [`status_photo_${i}`, 'p', 'webp'])],
    customscript: [{ in: '\\[(?:🖼️|🔞)\\|(.*?)\\|👁️\\]', type: 'editdisplay' }],
}
const imgCard = {
    additionalAssets: [['Female', 'p', 'webp'], ['Lyra Astraeus', 'p', 'webp'], ...EMO.map((e) => [`Lyra Astraeus ${e}`, 'p', 'webp'])],
    customscript: [{ in: '<img="(?!(?:Male|Female)">)([^"<>\\r\\n]+)">', type: 'editdisplay' }],
}

describe('the card pictures are asked for on every story turn', () => {
    test('a card with emoji image tags: its characters and one real tag as the example', () => {
        expect(imageSystemOf(emojiCard)).toEqual({ kind: 'emoji', who: ['Naru', 'Aki'], example: '[🖼️|naru_schooluniform_angry|👁️]' })
    })
    test('a card with <img="Name emotion"> tags', () => {
        expect(imageSystemOf(imgCard)).toEqual({ kind: 'img', who: ['Lyra Astraeus'], example: '<img="Lyra Astraeus acting.coy">' })
    })
    test('no picture system: no pictures, or pictures the card never draws from a tag', () => {
        expect(imageSystemOf({ additionalAssets: emojiCard.additionalAssets, customscript: [] })).toBeNull()
        expect(imageSystemOf({ additionalAssets: [['a_b_c', 'p', 'webp']], customscript: emojiCard.customscript })).toBeNull()
        expect(imageSystemOf(null)).toBeNull()
        expect(imageReminder(null)).toBe('')
    })
    test('the reminder goes at the end of the last player message, only for such a card', () => {
        const msgs = [{ role: 'system', content: 's' }, { role: 'user', content: 'Tui ngồi dậy' }]
        const out = imageRequest(msgs, emojiCard)
        expect(out[1].content).toMatch(/^Tui ngồi dậy\n\n\[Pictures \(hidden, never named\): .*Naru, Aki.*\[🖼️\|naru_schooluniform_angry\|👁️\]/s)
        expect(out[0]).toBe(msgs[0])
        expect(imageRequest(msgs, { additionalAssets: [], customscript: [] })).toBe(msgs)
    })
    test('a long cast is listed up to 12 names', () => {
        const who = Array.from({ length: 30 }, (_, i) => `N${i}`)
        expect(imageReminder({ kind: 'img', who, example: 'x' })).toContain('N11 and 18 more')
    })
})

describe('a rewrite keeps the pictures of the first draft', () => {
    const first = 'Nắng.\n\n[🖼️|naru_schooluniform_curious|👁️]\n\nNaru chớp mắt. “Ơ?”\n\n[🖼️|aki_schooluniform_bored|👁️]\n\nAki ngáp.'
    test('a lost tag goes back before the paragraph that names the character', () => {
        const final = 'Nắng chiều.\n\nNaru nghiêng đầu. “Chắc ngủ thật rồi.”\n\nAki quay lưng. “Ừ. Đi.”\n\n[📊|0|0]'
        const { text, kept } = keepAssetTags(first, final)
        expect(kept).toEqual(['naru_schooluniform_curious', 'aki_schooluniform_bored'])
        expect(text).toBe('Nắng chiều.\n\n[🖼️|naru_schooluniform_curious|👁️]\n\nNaru nghiêng đầu. “Chắc ngủ thật rồi.”\n\n[🖼️|aki_schooluniform_bored|👁️]\n\nAki quay lưng. “Ừ. Đi.”\n\n[📊|0|0]')
        expect(countImageTags(text)).toBe(2)
    })
    test('a character the final text already tags, or no longer names, is left alone', () => {
        const final = '[🖼️|naru_schooluniform_happy|👁️]\n\nNaru cười.'
        expect(keepAssetTags(first, final)).toEqual({ text: final, kept: [] })
        expect(keepAssetTags(first, 'Hành lang vắng.').kept).toEqual([])
    })
    test('"Naruto" is not Naru', () => {
        expect(keepAssetTags(first, 'Narutomaki nguội trên bàn.').kept).toEqual([])
    })
})
