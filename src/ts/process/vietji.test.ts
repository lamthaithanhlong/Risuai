import { describe, expect, it } from 'vitest'
import TABLE from './vietjiTable.json'
import { addReadings, collectVocab, fromVietji, hasKana, mergeVocab, parseReplies, phraseVietji, setHanReadings, setKanjiReadings, renderReplies, setLatinLanguage, stripReadings, toVietji } from './vietji'
import { frenchToVietji, hangulToVietji, pinyinToVietji, spanishToVietji, toneSyllable } from './vietjiLang'

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
        expect(fromVietji('i i ê, i ri ma sên')).toBe('いいえ、いりません')
        expect(fromVietji('i cu ra đê sư ca?')).toBe('いくらですか？')
        expect(fromVietji('ha i.')).toBe('はい。')
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
    it('French lines in « » get the French reader, Spanish lines the Spanish one', () => {
        setLatinLanguage('fr')
        expect(addReadings('« Bonjour, merci. »')).toContain('>bông-giu</span>')
        setLatinLanguage('es')
        expect(addReadings('«Hola»')).toContain('>ô-la</span>')
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
    it.each([
        ['bonjour', 'bông-giu'], ['merci', 'mec-xi'], ['café', 'ca-phê'], ['croissant', 'croa-xăng'], ['oui', 'uy'], ['bonsoir', 'bông-xoa'],
        ['garçon', 'gac-xông'], ['beaucoup', 'bô-cu'], ['madame', 'ma-đam'], ['soupe', 'xup'], ['chocolat', 'sô-cô-la'],
        ['gâteau', 'ga-tô'], ['fromage', 'phrô-ma-giơ'], ['bien', 'biêng'], ['plaît', 'plê'], ['appelle', 'a-pel'],
    ])('French %s → %s', (w, v) => expect(frenchToVietji(w)).toBe(v))
    it('French elisions keep their consonant: c\'est ça is not "e xa"', () => {
        for (const w of ["C'est", "c’est", "J'ai", "L'eau", "qu'il", "d'accord", "n'est"]) {
            expect(frenchToVietji(w), w).toMatch(/^(x|gi|l|k|đ|n)/i)
        }
        expect(frenchToVietji("C'est")).toBe('xe')
        setLatinLanguage('fr')
        const cest = phraseVietji("«C'est ça.»"), jai = phraseVietji("«J'ai faim»")
        setLatinLanguage('es')                                     // the other tests read Spanish
        expect(cest).toBe('xe xa')
        expect(jai).toMatch(/^gi\S* /)
    })
    it('tone marks land on the main vowel', () => {
        expect(toneSyllable('hao', 'hoi')).toBe('hảo')
        expect(toneSyllable('trung', 'sac')).toBe('trúng')
        expect(toneSyllable('oan', 'huyen')).toBe('oàn')
        expect(toneSyllable('xiê', 'huyen')).toBe('xiề')
        expect(toneSyllable('ngươi', 'huyen')).toBe('người')          // ươ: on ơ, not ư
        expect(toneSyllable('mương', 'hoi')).toBe('mưởng')
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
    it('reads up to six replies with their kind, and shows the kind in the box', () => {
        const six = '[[REPLIES\nはい | Vâng | easy\nいいえ | Không | dễ\nいくら ですか | Bao nhiêu? | stretch\nもう いちど | Lần nữa | nói vòng\nください | Cho tôi\nさようなら | Tạm biệt | vong\nありがとう | Cảm ơn | easy\n]]'
        const r = parseReplies(six)
        expect(r).toHaveLength(6)
        expect(r.map((x) => x.kind)).toEqual(['easy', 'easy', 'stretch', undefined, undefined, 'workaround'])
        expect('kind' in r[4]).toBe(false)                         // no tag: no kind key, old replies read as before
        expect(renderReplies(six)).toContain('nói vòng')
        expect(renderReplies(six)).toContain('>nâng<')
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

describe('Chinese written without [pinyin] (reported: 快开门！ showed no reading)', () => {
    const words = { '快': 'kuài', '开门': 'kāimén', '开': 'kāi', '门': 'mén' }
    it('is read from the word list, longest word first, with the Việt-ji line', () => {
        setHanReadings(words)
        try {
            const html = addReadings('“快开门！” (Mở cửa mau!)')
            expect(html).toContain('<ruby>快<rt')
            expect(html).toContain('<ruby>开门<rt')                       // the word, not 开 + 门
            expect(html).not.toContain('chưa có cách đọc')
            expect(html).toContain(pinyinToVietji('kuài kāimén')!)
        } finally { setHanReadings(null) }
    })
    it('a character not in the list stays marked unread, the rest is read', () => {
        setHanReadings(words)
        try {
            const html = addReadings('快鬼')
            expect(html).toContain('<ruby>快<rt')
            expect(html).toContain('chưa có cách đọc')
        } finally { setHanReadings(null) }
    })
    it('without the list (Japanese, or not loaded yet) nothing is guessed', () => {
        expect(addReadings('快开门')).toContain('chưa có cách đọc')
    })
})

describe('Korean as it is said, not as it is spelled (표준 발음법)', () => {
    it.each([
        ['국물', 'cung-mul'], ['감사합니다', 'cam-sa-ham-ni-đa'],                          // a stop before ㄴ ㅁ turns nasal
        ['같이', 'ca-chi'], ['굳이', 'cu-chi'],                                              // palatalization
        ['좋다', 'chô-tha'], ['많다', 'man-tha'], ['축하', 'chu-kha'], ['입학', 'i-pac'], ['못해요', 'mô-the-dô'],   // aspiration
        ['신라', 'sil-la'], ['설날', 'sơl-lal'],                                              // ㄹ next to ㄴ
        ['심리', 'sim-ni'], ['종로', 'chông-nô'], ['국립', 'cung-nip'],                      // ㄹ said ㄴ
        ['먹다', 'mơc-ta'], ['학교', 'hac-kiô'],                                             // tense after a stop
        ['맛있어요', 'ma-si-sơ-dô'], ['좋아요', 'chô-a-dô'], ['안녕하세요', 'an-niơng-ha-sê-dô'], ['한국어', 'han-gu-gơ'],
    ])('%s → %s', (w, v) => expect(hangulToVietji(w)).toBe(v))
})

describe('Japanese kanji written without [reading]', () => {
    const words = { '開け': 'あけ', '開': 'ひら', '今日': 'きょう', '今': 'いま', '早く': 'はやく' }
    it('the kanji gets its reading, the okurigana stays as written, and the Việt-ji reads the whole word', () => {
        setKanjiReadings(words)
        try {
            const html = addReadings('「早く開けて！」')
            expect(html).toContain('<ruby>開<rt')
            expect(html).toMatch(/<ruby>開<rt[^>]*>あ<\/rt><\/ruby>けて/)          // 開け → あけ: only あ goes on 開
            expect(html).toContain('<ruby>早<rt')
            expect(html).not.toContain('chưa có cách đọc')
            expect(html).toContain(toVietji('あけて'))
        } finally { setKanjiReadings(null) }
    })
    it('the longest word wins (今日, not 今 + 日), and an unknown kanji stays marked unread', () => {
        setKanjiReadings(words)
        try {
            expect(addReadings('今日')).toMatch(/<ruby>今日<rt[^>]*>きょう</)
            expect(addReadings('鬼')).toContain('chưa có cách đọc')
        } finally { setKanjiReadings(null) }
    })
    it('the Chinese list never reads Japanese kanji, nor the other way round', () => {
        setHanReadings({ '开门': 'kāimén', '今日': 'jīnrì' })
        try { expect(addReadings('今日')).toContain('jīnrì') } finally { setHanReadings(null) }
        setKanjiReadings({ '开门': 'あ' })
        try { expect(addReadings('今日')).toContain('chưa có cách đọc') } finally { setKanjiReadings(null) }
    })
})

describe('English readings (public/dict/en-vietji.json, espeak-ng IPA respelled by pdf2mp3)', () => {
    it('reads English inside «» word by word, contractions as one word', async () => {
        const { setEnglishReadings, setLatinLanguage, phraseVietji, isLatinLang } = await import('./vietji')
        setEnglishReadings(JSON.parse(require('fs').readFileSync('public/dict/en-vietji.json', 'utf8')).words)
        setLatinLanguage('en')
        expect(phraseVietji('«Hello, okay»')).toBe('hơ-lô ô-cây')
        expect(phraseVietji("«don't worry»")).toBe('đôn uơ-ri')
        expect(isLatinLang('en') && isLatinLang('es') && !isLatinLang('ko')).toBe(true)
        setEnglishReadings(null)
        setLatinLanguage('es')
    })
})
