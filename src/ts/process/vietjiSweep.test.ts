// A sweep of the learning bar over the most used Vietnamese words in all five languages (asked 2026-10-15: "dùng tool đo xem
// tính năng này còn bug không"): each invariant is counted over every word, so a regression shows as a number, not a hunch.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { composeSuggestions, dictSuggestions, needsModel } from './vietjiDict'
import { buildKoreanIndex, buildSoundIndex, commitOnSpace, imeSuggestions, isSoundTyping } from './vietjiIme'
import { mixChips } from './vietjiSuggest'
import { filledHtml, parseDetail, readInline, parseLesson, lessonHtml } from './grammarCoach'
import { setEnglishReadings, setHanReadings } from './vietji'
import { imperative, prohibitive } from './vietjiImperative'
import { phraseVietji } from './vietji'

const json = (f: string) => JSON.parse(readFileSync(f, 'utf8'))
const LANGS = ['ko', 'zh', 'ja', 'es', 'fr', 'en'] as const
const lists = Object.fromEntries(LANGS.map((l) => { const d = json(`public/dict/vi-${l}.json`); return [l, { words: d.words, unsure: new Set<string>(d.unsure ?? []), order: d.order ?? [], verbs: new Set<string>(d.verbs ?? []) }] })) as any
const top = (json('public/dict/vi-zh.json').order as string[]).slice(0, 300)
setHanReadings(json('public/dict/zh-pinyin.json').words)
setEnglishReadings(json('public/dict/en-vietji.json').words)
const zhIdx = buildSoundIndex(json('public/dict/zh-pinyin.json').words)
const koIdx = buildKoreanIndex(json('public/dict/ko-words.json').words, Object.values(lists.ko.words as Record<string, string[]>).flat())
const HEAD: Record<string, string> = { ko: '나 ', zh: '我 ', ja: '私 ', es: 'yo ', fr: 'je ', en: 'I ' }
const report: Record<string, unknown> = {}

describe('sweep: the 300 most used Vietnamese words', () => {
    it('measures', () => {
        for (const l of LANGS) {
            const words = lists[l].words
            const vi = new Set(Object.keys(words))
            const known = top.filter((w) => words[w])
            const noChip = known.filter((w) => dictSuggestions(w, words, l).length === 0)
            const headEaten = known.filter((w) => composeSuggestions(HEAD[l] + w, lists[l], l).some((c) => !(c.replace ?? '').startsWith(HEAD[l].trim())))
            const soundFirst = l === 'ko' || l === 'zh' ? known.filter((w) => !w.includes(' ') && isSoundTyping(w, l === 'ko' ? koIdx : zhIdx, vi)) : []
            const soundShown = l === 'ko' || l === 'zh' ? known.filter((w) => {
                const rest = dictSuggestions(w, words, l)
                const st = isSoundTyping(w, l === 'ko' ? koIdx : zhIdx, vi)
                return mixChips(rest, imeSuggestions(w, l === 'ko' ? koIdx : zhIdx), [], { soundTyping: st, listSure: rest.length > 0 && !needsModel(w, lists[l]) }).some((c) => c.source === 'ime')
                    && rest.length > 0 && !needsModel(w, lists[l])
            }) : []
            const eaten = (['zh', 'ko'] as const).includes(l as any) ? top.filter((w) => !w.includes(' ') && commitOnSpace(w + ' ', l, { zh: zhIdx, ko: koIdx, vietnamese: vi }) !== null) : []
            report[l] = { known: known.length, noChip: noChip.slice(0, 12), noChipN: noChip.length, headEatenN: headEaten.length, headEaten: headEaten.slice(0, 8),
                soundFirstN: soundFirst.length, soundFirst: soundFirst.slice(0, 8), soundShownN: soundShown.length, eatenN: eaten.length }
        }
        // the orders: every verb among the top words, + đi, gives an order chip first
        const orders: Record<string, unknown> = {}
        for (const l of LANGS) {
            const words = lists[l].words
            const isOrder = (w: string) => (dictSuggestions(`${w} đi`, words, l, 6, lists[l].verbs)[0]?.meaning ?? '').includes('mệnh lệnh')
            const single = top.filter((w) => words[w] && !w.includes(' ') && w !== 'đi')
            const ordered = single.filter(isOrder)
            const notVerb = single.filter((w) => !lists[l].verbs.has(w))
            const wrongOrder = notVerb.filter(isOrder)                         // an order made of a word that is not a verb
            orders[l] = { ordered: ordered.length, wrongOrderN: wrongOrder.length, wrongOrder: wrongOrder.slice(0, 8),
                sample: ordered.slice(0, 12).map((w) => `${w}→${dictSuggestions(`${w} đi`, words, l, 6, lists[l].verbs)[0].text}`) }
        }
        report.orders = orders
        // đừng + verb: a "do not" first for the verbs, never for the rest; and no form is silently dropped for want of a reading
        const nots: Record<string, unknown> = {}
        for (const l of LANGS) {
            const words = lists[l].words, verbs = lists[l].verbs
            const sug = (t: string) => dictSuggestions(t, words, l, 6, verbs)
            const single = top.filter((w) => words[w] && !w.includes(' ') && w !== 'đừng')
            const isNot = (w: string) => (sug(`đừng ${w}`)[0]?.meaning ?? '').includes('cấm')
            const verbsTop = single.filter((w) => verbs.has(w))
            const withForm = verbsTop.filter((w) => words[w].some((x: string) => prohibitive(x, l).length))
            const missing = withForm.filter((w) => !isNot(w))
            const wrongNot = single.filter((w) => !verbs.has(w)).filter(isNot)
            // a form the chip builder drops: dictSuggestions keeps a chip only when the text has a reading
            const noReading = withForm.flatMap((w) => words[w].map((x: string) => prohibitive(x, l)).find((f: string[]) => f.length) ?? [])
                .concat(verbsTop.flatMap((w) => words[w].map((x: string) => imperative(x, l)).find((f: string[]) => f.length) ?? []))
                .filter((f: string) => !phraseVietji(`«${f}»`))
            nots[l] = { verbs: verbsTop.length, withForm: withForm.length, missingN: missing.length, missing: missing.slice(0, 8), wrongNotN: wrongNot.length,
                wrongNot: wrongNot.slice(0, 8), noReadingN: noReading.length, noReading: noReading.slice(0, 8),
                sample: withForm.slice(0, 10).map((w) => `đừng ${w}→${sug(`đừng ${w}`)[0]?.text}`) }
        }
        report.nots = nots
        if (process.env.VJ_SWEEP_OUT) require('fs').writeFileSync(process.env.VJ_SWEEP_OUT, JSON.stringify(report, null, 1))
        // every invariant holds over every word: what the learner typed is offered, never eaten, never taken for sound, and
        // only a verb before đi is turned into an order (measured 2026-10-15: all 0 after the fixes of that day)
        for (const l of LANGS) {
            const r = report[l] as any, o = orders[l] as any
            expect({ l, noChip: r.noChipN, headEaten: r.headEatenN, soundFirst: r.soundFirstN, soundShown: r.soundShownN, eaten: r.eatenN, wrongOrder: o.wrongOrderN })
                .toEqual({ l, noChip: 0, headEaten: 0, soundFirst: 0, soundShown: 0, eaten: 0, wrongOrder: 0 })
            expect(o.ordered).toBeGreaterThan(40)                           // and the orders are there for the verbs
            const n = nots[l] as any                                        // đừng: every verb, nothing else, nothing dropped
            expect({ l, missing: n.missingN, wrongNot: n.wrongNotN, noReading: n.noReadingN }).toEqual({ l, missing: 0, wrongNot: 0, noReading: 0 })
        }
    }, 60_000)                                                          // ~2 s alone, over 5 s inside the full suite
    it('fuzz: model text never reaches the page as markup', () => {
        const nasty = ['<img src=x onerror=alert(1)>', '"><script>x</script>', '___<b>__', '나는 <i>그</i>', '&lt;', '</span><span style="x">', '[[CHECK x]]']
        let leaks = 0
        for (let k = 0; k < 2000; k++) {
            const s = Array.from({ length: 1 + (k % 5) }, (_, j) => nasty[(k * 7 + j * 3) % nasty.length] + (j % 2 ? ' 침착 ' : ' 冷静 ')).join('')
            for (const html of [readInline(s), filledHtml(s, [s.slice(0, 3)], [s.slice(3, 6)]), lessonHtml(parseLesson(`${s} → ${s} | ${s} → ${s}: ${s} | ${s}`) ?? { wrote: s, fix: s, parts: [], point: s })]) {
                const rest = html.replace(/<(?:span|div|b|s)(?: (?:style|title)="[^"]*")*>|<\/(?:span|div|b|s)>/g, '')
                // escaped text may still read "onerror"; a leak is a real '<' left after our own tags are taken out
                const m = /</.exec(rest)
                if (m) { if (!leaks) console.log('LEAK', JSON.stringify(s), JSON.stringify(rest.slice(Math.max(0, m.index - 30), m.index + 30))); leaks++ }
            }
            const d = parseDetail(`{"pieces":[{"piece":${JSON.stringify(s)},"ok":${k % 2 === 0}}],"final":${JSON.stringify(s)},"adds":${k % 3 ? '[1,null,{"add":2}]' : 'null'}}`)
            if (d && typeof d.final !== 'string') leaks++
        }
        expect(leaks).toBe(0)
    })
})
