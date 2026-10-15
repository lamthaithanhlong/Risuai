import { describe, expect, it } from 'vitest'
import TABLE from './vietjiTable.json'
import { addReadings, collectVocab, fromVietji, hasKana, mergeVocab, parseReplies, renderReplies, stripReadings, toVietji } from './vietji'
import { hangulToVietji, pinyinToVietji, spanishToVietji, toneSyllable } from './vietjiLang'

const fold = (s: string) => s.toLowerCase().replace(/ê/g, 'e').replace(/ô/g, 'o').replace(/ư/g, 'u').replace(/ơ/g, 'o')

describe('Việt-ji table', () => {
    it('every kana reads one way and types back to itself', () => {
        for (const [kana, viet] of Object.entries(TABLE.table as Record<string, string>)) {
            expect(toVietji(kana), kana).toBe(viet)
            expect(fromVietji(viet), viet).toBe(kana)
        }
    })
    it('no two kana are typed the same once tone-less letters are folded', () => {
        const seen = new Map<string, string>()
        for (const [kana, viet] of Object.entries(TABLE.table as Record<string, string>)) {
            expect(seen.has(fold(viet)), `${kana} vs ${seen.get(fold(viet))}`).toBe(false)
            seen.set(fold(viet), kana)
        }
    })
})

describe('reading', () => {
    const samples: [string, string][] = [
        ['やめて', 'da-mê-tê'], ['ありがとう', 'a-ri-ga-tô-ư'], ['こんにちは', 'côn-ni-chi-ha'],
        ['わかりました', 'oa-ca-ri-ma-xi-ta'], ['きって', 'kit-tê'], ['とうきょう', 'tô-ư-kiô-ư'],
        ['すみません', 'sư-mi-ma-sên'], ['ちょっとまって', 'chôt-tô-mat-tê'], ['カタカナ', 'ca-ta-ca-na'],
        ['コーヒー', 'cô-ô-hi-i'], ['パン', 'pan'], ['おはようございます', 'ô-ha-dô-ư-gô-za-i-ma-sư'],
    ]
    it.each(samples)('%s reads %s', (kana, viet) => expect(toVietji(kana)).toBe(viet))
    it('kanji has no reading', () => expect(toVietji('日本')).toBe(null))
})

describe('typing', () => {
    it('without tone-less marks, spaces or hyphens', () => {
        expect(fromVietji('da me te')).toBe('やめて')
        expect(fromVietji('Da-Me-Te')).toBe('やめて')
        expect(fromVietji('oa ca ri ma xi ta')).toBe('わかりました')
        expect(fromVietji('kit te')).toBe('きって')
        expect(fromVietji('ddai giou bu')).toBe('だいじょうぶ')
    })
    it('da and dda stay apart', () => {
        expect(fromVietji('da')).toBe('や')
        expect(fromVietji('dda')).toBe('だ')
    })
    it.each(['tôi muốn mua bánh mì', 'đi đâu đó', 'chào bạn', 'bà đi', 'tôi đã mua', 'ok', 'v: tôi hiểu rồi', ''])(
        'Vietnamese "%s" is never converted', (s) => expect(fromVietji(s)).toBe(null))
})

describe('display', () => {
    it('kanji stays large with its kana small above, and the Việt-ji of the word underneath', () => {
        const r = addReadings('今日[きょう]は いい 天気[てんき] です。')
        expect(r).toContain('<ruby>今日<rt')
        expect(r).toContain('>きょう</rt></ruby>は')
        expect(r).toContain('>kiô-ư-ha</span>')          // 今日は read as きょうは
        expect(r).toContain('>tên-ki</span>')            // 天気
        expect(r).not.toContain('[きょう]')
    })
    it('kana words get their Việt-ji underneath', () => {
        expect(addReadings('「やめて」')).toContain('>da-mê-tê</span>')
    })
    it('a bare kanji run without a reading is dimmed and gets no reading', () => {
        const r = addReadings('彼は')
        expect(r).toContain('title="chưa có cách đọc">彼</span>')
    })
    it('Chinese: hanzi large, pinyin small above, Việt-ji underneath', () => {
        const r = addReadings('你好[nǐhǎo]，我[wǒ] 是[shì] 学生[xuéshēng]。')
        expect(r).toContain('<ruby>你好<rt')
        expect(r).toContain('>nǐhǎo</rt>')
        expect(r).toContain('>nỉ-hảo</span>')
        expect(r).toContain('>ủa</span>')
    })
    it('Korean: hangul with its Việt-ji underneath', () => {
        const r = addReadings('안녕하세요. 감사합니다.')
        expect(r).toContain('>an-niơng-ha-sê-dô</span>')
        expect(r).toContain('>cam-sa-ham-ni-đa</span>')
    })
    it('Spanish: only words inside «» get a reading', () => {
        const r = addReadings('Ông nói: «Hola, ¿cuánto cuesta?» rồi cười.')
        expect(r).toContain('>ô-la</span>')
        expect(r).toContain('>cuan-tô</span>')
        expect(r).toContain('rồi cười.')
        expect(r).not.toMatch(/>ông<\/span>/i)
    })
    it('leaves tags, styles and an existing ruby alone', () => {
        const html = '<style>.a{content:"やめて"}</style><span title="はい">x</span><ruby>はい<rt>ha-i</rt></ruby> はい'
        const r = addReadings(html)
        expect(r.startsWith('<style>.a{content:"やめて"}</style><span title="はい">x</span><ruby>はい<rt>ha-i</rt></ruby> ')).toBe(true)
        expect(r.endsWith('>ha-i</span></span>')).toBe(true)
    })
    it('plain Vietnamese is untouched', () => {
        expect(addReadings('Trời mưa, cô ấy đi về.')).toBe('Trời mưa, cô ấy đi về.')
        expect(hasKana('Trời mưa')).toBe(false)
    })
})

describe('readings by rule', () => {
    it.each([
        ['안녕하세요', 'an-niơng-ha-sê-dô'], ['감사합니다', 'cam-sa-ham-ni-đa'], ['사랑해', 'sa-rang-he'], ['주세요', 'chu-sê-dô'],
        // liaison: the final consonant moves onto a following silent ㅇ
        ['한국어', 'han-gu-gơ'], ['괜찮아요', 'coen-cha-na-dô'], ['서울에', 'sơ-u-rê'], ['읽어요', 'il-gơ-dô'], ['있어요', 'i-sơ-dô'],
        ['좋아요', 'chô-a-dô'], ['얼마예요', 'ơl-ma-dê-dô'],
    ])('Korean %s → %s', (w, v) => expect(hangulToVietji(w)).toBe(v))
    it.each([
        ['nǐhǎo', 'nỉ-hảo'], ['xièxie', 'xiề-xiê'], ['zhōngguó', 'trung-cúa'], ['wǒ', 'ủa'], ['shì', 'sừ'], ['yuè', 'duề'], ['èr', 'ờ'],
        ['ni3 hao3', 'nỉ-hảo'],
    ])('Chinese %s → %s', (w, v) => expect(pinyinToVietji(w)).toBe(v))
    it.each([
        ['hola', 'ô-la'], ['gracias', 'gra-xi-at'], ['días', 'đi-at'], ['cuánto', 'cuan-tô'], ['señor', 'xê-nhôr'],
        ['calle', 'ca-dê'], ['gente', 'khên-tê'], ['queso', 'kê-xô'], ['mañana', 'ma-nha-na'], ['adiós', 'a-đi-ôt'],
    ])('Spanish %s → %s', (w, v) => expect(spanishToVietji(w)).toBe(v))
    it('tone marks land on the main vowel', () => {
        expect(toneSyllable('hao', 'hoi')).toBe('hảo')
        expect(toneSyllable('trung', 'sac')).toBe('trúng')
        expect(toneSyllable('oan', 'huyen')).toBe('oàn')
        expect(toneSyllable('xiê', 'huyen')).toBe('xiề')
    })
})

describe('suggested replies and vocabulary', () => {
    const reply = 'Ông nói: “「しお です。」” (Đây là muối.)\n\n[[REPLIES\nはい | Vâng\nいくら ですか | Bao nhiêu tiền?\n]]'
    it('reads the replies block', () => {
        expect(parseReplies(reply)).toEqual([
            { text: 'はい', vietji: 'ha-i', meaning: 'Vâng' },
            { text: 'いくら ですか', vietji: 'i-cư-ra đê-sư-ca', meaning: 'Bao nhiêu tiền?' },
        ])
    })
    it('reads replies in kanji, hangul and Spanish', () => {
        const r = parseReplies('[[REPLIES\n大丈夫[だいじょうぶ] です | Không sao\n네 | Vâng\n«Sí, por favor» | Vâng, làm ơn\n]]')
        expect(r.map((x) => x.vietji)).toEqual(['đa-i-giô-ư-bư đê-sư', 'nê', 'xi pôr pha-bôr'])
    })
    it('shows the replies as a list and hides the raw block, also while it is still streaming', () => {
        const shown = renderReplies(reply)
        expect(shown).not.toContain('[[REPLIES')
        expect(shown).toContain('Bạn có thể đáp')
        expect(renderReplies('text [[REPLIES\nはい | Vâ')).toBe('text ')
    })
    it('collects what the speaker said with its meaning, and the replies', () => {
        const v = collectVocab(reply)
        expect(v.map((x) => x.text)).toEqual(['しお です。', 'はい', 'いくら ですか'])
        expect(v[0]).toMatchObject({ vietji: 'xi-ô đê-sư', meaning: 'Đây là muối.' })
        expect(collectVocab('Ông nói «Hola, amigo» (Chào bạn) rồi 안녕하세요 (Xin chào)').map((x) => x.vietji)).toEqual(['ô-la a-mi-gô', 'an-niơng-ha-sê-dô'])
    })
    it('keeps the newest first without repeats', () => {
        const a = mergeVocab(null, [{ text: 'はい', vietji: 'ha-i', meaning: 'Vâng' }])
        const b = JSON.parse(mergeVocab(a, [{ text: 'いいえ', vietji: 'i-i-ê', meaning: 'Không' }, { text: 'はい', vietji: 'ha-i', meaning: 'Vâng' }]))
        expect(b.map((x: any) => x.text)).toEqual(['はい', 'いいえ'])
        expect(JSON.parse(mergeVocab('not json', []))).toEqual([])
    })
    it('strips the readings from a phrase', () => {
        expect(stripReadings('今日[きょう]は «x»')).toBe('今日は x')
    })
})
