import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { imperative, naiForm, prohibitive, teForm } from './vietjiImperative'
import { composeSuggestions, dictSuggestions } from './vietjiDict'

// asked 2026-10-15: "sửa luôn đuôi đi thành mệnh lệnh" — 침착하다 đi gave 침착하다 가다
describe('irregular verbs (asked: "làm bảng động từ bất quy tắc")', () => {
    it.each([
        // ㄷ → ㄹ; the same final in 받다, 닫다 is regular
        ['듣다', '들으세요', '들어'], ['걷다', '걸으세요', '걸어'], ['묻다', '물으세요', '물어'], ['받다', '받으세요', '받아'],
        // ㅂ → 우 (돕다 → 도와); 입다, 잡다 regular
        ['돕다', '도우세요', '도와'], ['눕다', '누우세요', '누워'], ['줍다', '주우세요', '주워'], ['입다', '입으세요', '입어'],
        // ㅅ drops; 씻다, 웃다 regular
        ['낫다', '나으세요', '나아'], ['짓다', '지으세요', '지어'], ['씻다', '씻으세요', '씻어'],
        // 르 → ㄹ라/ㄹ러; 따르다 is ㅡ only
        ['부르다', '부르세요', '불러'], ['모르다', '모르세요', '몰라'], ['고르다', '고르세요', '골라'], ['서두르다', '서두르세요', '서둘러'], ['따르다', '따르세요', '따라'],
        // ㅡ takes the vowel before it
        ['아프다', '아프세요', '아파'], ['바쁘다', '바쁘세요', '바빠'], ['쓰다', '쓰세요', '써'], ['기쁘다', '기쁘세요', '기뻐'],
        // 되다 → 돼; the polite verb said to someone
        ['되다', '되세요', '돼'], ['먹다', '드세요', '먹어'], ['마시다', '드세요', '마셔'], ['자다', '주무세요', '자'], ['있다', '계세요', '있어'], ['말하다', '말씀하세요', '말해'],
    ])('Korean %s → %s, %s', (w, polite, plain) => expect(imperative(w, 'ko')).toEqual([polite, plain]))
    it.each([
        ['帰る[かえる]', '帰って[かえって]'], ['切る[きる]', '切って[きって]'], ['着る[きる]', '着て[きて]'], ['走る[はしる]', '走って[はしって]'],
        ['入る[はいる]', '入って[はいって]'], ['知る[しる]', '知って[しって]'], ['見る[みる]', '見て[みて]'], ['寝る[ねる]', '寝て[ねて]'],
        ['出て行く[でていく]', '出て行って[でていって]'], ['持って来る[もってくる]', '持って来て[もってきて]'], ['問う[とう]', '問うて[とうて]'],
        ['勉強する[べんきょうする]', '勉強して[べんきょうして]'], ['締め切る[しめきる]', '締め切って[しめきって]'],
    ])('Japanese %s → %s', (w, te) => expect(imperative(w, 'ja')[1]).toBe(te))
    it('Japanese: ある and the copula are not orders', () => {
        for (const w of ['ある', 'です', 'でしょう']) expect(imperative(w, 'ja')).toEqual([])
    })
    it.each([
        ['冷静[lěngjìng]', '冷静[lěngjìng]点[diǎn]'], ['小心[xiǎoxīn]', '小心[xiǎoxīn]点[diǎn]'], ['等[děng]', '等[děng]一下[yíxià]'],
        ['休息[xiūxi]', '休息[xiūxi]一下[yíxià]'], ['走[zǒu]', '走[zǒu]吧[ba]'], ['吃[chī]', '吃[chī]吧[ba]'],
    ])('Chinese %s → %s', (w, first) => expect(imperative(w, 'zh')[0]).toBe(first))
    it.each([
        ['ver', 've', 'vea'], ['dar', 'da', 'dé'], ['estar', 'está', 'esté'], ['saber', 'sabe', 'sepa'], ['oír', 'oye', 'oiga'], ['traer', 'trae', 'traiga'],
        ['conocer', 'conoce', 'conozca'], ['ofrecer', 'ofrece', 'ofrezca'], ['conducir', 'conduce', 'conduzca'], ['vencer', 'vence', 'venza'],
        ['construir', 'construye', 'construya'], ['huir', 'huye', 'huya'], ['coger', 'coge', 'coja'], ['dirigir', 'dirige', 'dirija'],
        ['distinguir', 'distingue', 'distinga'], ['reír', 'ríe', 'ría'], ['enviar', 'envía', 'envíe'], ['continuar', 'continúa', 'continúe'],
        ['mantener', 'mantén', 'mantenga'], ['preferir', 'prefiere', 'prefiera'], ['almorzar', 'almuerza', 'almuerce'], ['colgar', 'cuelga', 'cuelgue'],
        ['oler', 'huele', 'huela'], ['divertirse', 'diviértete', 'diviértase'], ['despedirse', 'despídete', 'despídase'], ['ponerse', 'ponte', 'póngase'],
        ['dormirse', 'duérmete', 'duérmase'], ['callarse', 'cállate', 'cállese'], ['hacerse', 'hazte', 'hágase'],
    ])('Spanish %s → %s, %s', (w, tu, usted) => expect(imperative(w, 'es')).toEqual([tu, usted]))
    it('Spanish: poder, deber are not orders', () => {
        for (const w of ['poder', 'deber', 'gustar']) expect(imperative(w, 'es')).toEqual([])
    })
    it.each([
        ['craindre', 'crains', 'craignez'], ['peindre', 'peins', 'peignez'], ['éteindre', 'éteins', 'éteignez'], ['joindre', 'joins', 'joignez'],
        ['apprendre', 'apprends', 'apprenez'], ['comprendre', 'comprends', 'comprenez'], ['construire', 'construis', 'construisez'],
        ['traduire', 'traduis', 'traduisez'], ['permettre', 'permets', 'permettez'], ['décrire', 'décris', 'décrivez'], ['devenir', 'deviens', 'devenez'],
        ['obtenir', 'obtiens', 'obtenez'], ['recevoir', 'reçois', 'recevez'], ['couvrir', 'couvre', 'couvrez'], ['cueillir', 'cueille', 'cueillez'],
        ['sentir', 'sens', 'sentez'], ['servir', 'sers', 'servez'], ['mentir', 'mens', 'mentez'], ['payer', 'paie', 'payez'], ['envoyer', 'envoie', 'envoyez'],
        ['nettoyer', 'nettoie', 'nettoyez'], ['rappeler', 'rappelle', 'rappelez'], ['rire', 'ris', 'riez'], ['connaître', 'connais', 'connaissez'],
        ['mourir', 'meurs', 'mourez'], ['interdire', 'interdis', 'interdisez'], ['se souvenir', 'souviens-toi', 'souvenez-vous'],
        ["s'en aller", "va-t'en", 'allez-vous-en'], ['se taire', 'tais-toi', 'taisez-vous'], ['choisir', 'choisis', 'choisissez'], ['ralentir', 'ralentis', 'ralentissez'],
    ])('French %s → %s, %s', (w, tu, vous) => expect(imperative(w, 'fr')).toEqual([tu, vous]))
})

describe('the order of a verb, regular forms', () => {
    it.each([
        ['침착하다', '침착하세요', '침착해'], ['가다', '가세요', '가'], ['앉다', '앉으세요', '앉아'], ['오다', '오세요', '와'], ['보다', '보세요', '봐'], ['주다', '주세요', '줘'], ['살다', '사세요', '살아'],
        ['쓰다', '쓰세요', '써'], ['서다', '서세요', '서'], ['기다리다', '기다리세요', '기다려'], ['진정하다', '진정하세요', '진정해'],
    ])('Korean %s → %s, %s', (w, polite, plain) => expect(imperative(w, 'ko')).toEqual([polite, plain]))
    it('Korean: not a verb, or the copula, gives nothing', () => {
        for (const w of ['나', '이다', '아니다', '없다', '집']) expect(imperative(w, 'ko')).toEqual([])
    })
    it.each([
        ['おちつく', 'おちついて'], ['すわる', 'すわって'], ['たべる', 'たべて'], ['かえる', 'かえって'], ['いく', 'いって'], ['はなす', 'はなして'],
        ['まつ', 'まって'], ['のむ', 'のんで'], ['およぐ', 'およいで'], ['べんきょうする', 'べんきょうして'], ['みる', 'みて'], ['だまる', 'だまって'],
        ['かう', 'かって'], ['しぬ', 'しんで'], ['あそぶ', 'あそんで'], ['はいる', 'はいって'], ['いる', 'いて'],
    ])('Japanese te-form %s → %s', (w, te) => expect(teForm(w)).toBe(te))
    it('Japanese keeps the kanji and the reading', () => {
        expect(imperative('落ち着く[おちつく]', 'ja')).toEqual(['落ち着いて[おちついて]ください', '落ち着いて[おちついて]'])
        expect(imperative('座る[すわる]', 'ja')[0]).toBe('座って[すわって]ください')
        expect(imperative('来る[くる]', 'ja')[1]).toBe('来て[きて]')
        expect(imperative('冷静[れいせい]', 'ja')).toEqual([])                     // a noun
    })
    it.each([
        ['correr', 'corre', 'corra'], ['hablar', 'habla', 'hable'], ['calmarse', 'cálmate', 'cálmese'], ['levantarse', 'levántate', 'levántese'],
        ['tener', 'ten', 'tenga'], ['ir', 've', 'vaya'], ['irse', 'vete', 'váyase'], ['comer', 'come', 'coma'],
        // the sweep found pensa for pensar: stem-changing verbs
        ['pensar', 'piensa', 'piense'], ['dormir', 'duerme', 'duerma'], ['volver', 'vuelve', 'vuelva'], ['pedir', 'pide', 'pida'],
        ['jugar', 'juega', 'juegue'], ['empezar', 'empieza', 'empiece'], ['buscar', 'busca', 'busque'], ['seguir', 'sigue', 'siga'],
        ['sentarse', 'siéntate', 'siéntese'], ['acostarse', 'acuéstate', 'acuéstese'],
    ])('Spanish %s → %s, %s', (w, tu, usted) => expect(imperative(w, 'es')).toEqual([tu, usted]))
    it.each([
        ['calmer', 'calme', 'calmez'], ['se calmer', 'calme-toi', 'calmez-vous'], ['s’asseoir', 'assieds-toi', 'asseyez-vous'],
        ['finir', 'finis', 'finissez'], ['attendre', 'attends', 'attendez'], ['aller', 'va', 'allez'], ['manger', 'mange', 'mangez'],
        // the sweep found achete for acheter and sincès for sincère
        ['acheter', 'achète', 'achetez'], ['se lever', 'lève-toi', 'levez-vous'], ['préférer', 'préfère', 'préférez'], ['entrer', 'entre', 'entrez'],
        ['appeler', 'appelle', 'appelez'], ['boire', 'bois', 'buvez'],
    ])('French %s → %s, %s', (w, tu, vous) => expect(imperative(w, 'fr')).toEqual([tu, vous]))
    it('French: an adjective in -re is not a verb', () => {
        for (const w of ['sincère', 'libre', 'pauvre']) expect(imperative(w, 'fr')).toEqual([])
    })
    it('Spanish: a verb said of the thing (me gusta) is not given as an order', () => {
        expect(imperative('gustar', 'es')).toEqual([])
    })
    it('Chinese urges with 吧, never after a person', () => {
        expect(imperative('坐[zuò]', 'zh')).toEqual(['坐[zuò]吧[ba]', '请[qǐng]坐[zuò]'])
        expect(imperative('我[wǒ]', 'zh')).toEqual([])
    })
})

const list = (l: string) => { const d = JSON.parse(readFileSync(`public/dict/vi-${l}.json`, 'utf8')); return { words: d.words, unsure: new Set<string>(d.unsure ?? []), order: d.order ?? [] } as any }

describe('in the bar', () => {
    it('reported: "… 침착하다 đi" offers 침착하세요 first, keeping what is before it', () => {
        const chips = composeSuggestions('나 와 고 일다 당안전하다, 침착하다 đi', list('ko'), 'ko')
        expect(chips[0].text).toBe('침착하세요')
        expect(chips[0].replace).toBe('나 와 고 일다 당안전하다, 침착하세요')
        expect(chips[0].meaning).toContain('mệnh lệnh')
    })
    it('"bình tĩnh đi" typed in Vietnamese gives the order first, in every language', () => {
        expect(dictSuggestions('bình tĩnh đi', list('ko').words, 'ko')[0].text).toBe('침착하세요')
        expect(dictSuggestions('bình tĩnh đi', list('ja').words, 'ja')[0].text).toBe('落ち着いて[おちついて]ください')
        expect(dictSuggestions('ngồi đi', list('zh').words, 'zh')[0].text).toBe('坐[zuò]吧[ba]')
        expect(dictSuggestions('chạy đi', list('es').words, 'es')[0].text).toBe('corre')
        expect(dictSuggestions('ăn đi', list('fr').words, 'fr')[0].text).toBe('mange')
        // irregular and honorific in the bar (2026-10-15): nghe đi → 들으세요 (ㄷ), ăn đi → 드세요, giúp đi → 도와주세요 (was 지원하세요)
        expect(dictSuggestions('nghe đi', list('ko').words, 'ko')[0].text).toBe('들으세요')
        expect(dictSuggestions('ăn đi', list('ko').words, 'ko')[0].text).toBe('드세요')
        expect(dictSuggestions('giúp đi', list('ko').words, 'ko')[0].text).toBe('도와주세요')
    })
    it('"tôi đi" is I go: no order', () => {
        for (const l of ['ko', 'zh', 'ja', 'es', 'fr']) {
            expect(dictSuggestions('tôi đi', list(l).words, l as any).every((c) => !c.meaning.includes('mệnh lệnh'))).toBe(true)
        }
        expect(composeSuggestions('我 đi', list('zh'), 'zh').every((c) => !c.meaning.includes('mệnh lệnh'))).toBe(true)
    })
})

// asked 2026-10-15: "làm luôn đuôi đừng thành mệnh lệnh phủ định"
describe('do not (đừng + verb)', () => {
    it.each([
        ['가다', '가지 마세요', '가지 마'], ['먹다', '먹지 마세요', '먹지 마'], ['듣다', '듣지 마세요', '듣지 마'], ['걱정하다', '걱정하지 마세요', '걱정하지 마'],
        ['울다', '울지 마세요', '울지 마'], ['무섭다', '무서워하지 마세요', '무서워하지 마'], ['슬프다', '슬퍼하지 마세요', '슬퍼하지 마'],
    ])('Korean %s → %s, %s', (w, a, b) => expect(prohibitive(w, 'ko')).toEqual([a, b]))
    it.each([
        ['行く[いく]', '行かない[いかない]でください'], ['食べる[たべる]', '食べない[たべない]でください'], ['泣く[なく]', '泣かない[なかない]でください'],
        ['帰る[かえる]', '帰らない[かえらない]でください'], ['心配する[しんぱいする]', '心配しない[しんぱいしない]でください'], ['来る[くる]', '来ない[こない]でください'],
        ['見る[みる]', '見ない[みない]でください'], ['買う[かう]', '買わない[かわない]でください'], ['待つ[まつ]', '待たない[またない]でください'],
    ])('Japanese %s → %s', (w, a) => expect(prohibitive(w, 'ja')[0]).toBe(a))
    it('Japanese ない forms', () => {
        expect(['いく', 'たべる', 'する', 'くる', 'およぐ', 'はなす', 'しぬ', 'あそぶ', 'のむ', 'きる'].map((k) => naiForm(k)))
            .toEqual(['いかない', 'たべない', 'しない', 'こない', 'およがない', 'はなさない', 'しなない', 'あそばない', 'のまない', 'きない'])
        expect(naiForm('きる', '切る')).toBe('きらない')
        expect(naiForm('ある')).toBe(null)
    })
    it('Chinese 别 / 不要, never before a person', () => {
        expect(prohibitive('哭[kū]', 'zh')).toEqual(['别[bié]哭[kū]', '不要[búyào]哭[kū]'])
        expect(prohibitive('我[wǒ]', 'zh')).toEqual([])
    })
    it.each([
        ['correr', 'no corras', 'no corra'], ['hablar', 'no hables', 'no hable'], ['ir', 'no vayas', 'no vaya'], ['irse', 'no te vayas', 'no se vaya'],
        ['preocuparse', 'no te preocupes', 'no se preocupe'], ['llorar', 'no llores', 'no llore'], ['dar', 'no des', 'no dé'], ['tener', 'no tengas', 'no tenga'],
        ['decir', 'no digas', 'no diga'], ['hacer', 'no hagas', 'no haga'], ['dormir', 'no duermas', 'no duerma'], ['jugar', 'no juegues', 'no juegue'],
    ])('Spanish %s → %s, %s', (w, a, b) => expect(prohibitive(w, 'es')).toEqual([a, b]))
    it.each([
        ['partir', 'ne pars pas', 'ne partez pas'], ['pleurer', 'ne pleure pas', 'ne pleurez pas'], ['avoir', "n'aie pas", "n'ayez pas"],
        ['oublier', "n'oublie pas", "n'oubliez pas"], ['s’inquiéter', "ne t'inquiète pas", 'ne vous inquiétez pas'], ['se lever', 'ne te lève pas', 'ne vous levez pas'],
        ['aller', 'ne va pas', "n'allez pas"], ["s'en aller", "ne t'en va pas", 'ne vous en allez pas'], ['être', 'ne sois pas', 'ne soyez pas'],
    ])('French %s → %s, %s', (w, a, b) => expect(prohibitive(w, 'fr')).toEqual([a, b]))

    it('in the bar: "đừng đi" is do not go, in every language (not the order ending)', () => {
        const first = (t: string, l: string) => dictSuggestions(t, list(l).words, l as any, 6, new Set(list(l).verbs ?? JSON.parse(readFileSync(`public/dict/vi-${l}.json`, 'utf8')).verbs))[0]?.text
        expect(first('đừng đi', 'ko')).toBe('가지 마세요')
        expect(first('đừng đi', 'ja')).toBe('行かない[いかない]でください')
        expect(first('đừng đi', 'zh')).toBe('别[bié]去[qù]')
        expect(first('đừng đi', 'es')).toBe('no vayas')
        expect(first('đừng đi', 'fr')).toBe('ne va pas')
        expect(first('đừng khóc', 'ko')).toBe('울지 마세요')
        expect(first('đừng lo', 'es')).toBe('no te preocupes')
        expect(first('đừng sợ', 'fr')).toBe("n'aie pas peur")
        expect(first('cô đừng đi', 'ko')).toMatch(/가지 마세요$/)
    })
    it('in the bar: đừng before a person or a non-verb gives no "do not"', () => {
        const v = new Set<string>(JSON.parse(readFileSync('public/dict/vi-ko.json', 'utf8')).verbs)
        for (const t of ['đừng tôi', 'đừng nhà']) expect(dictSuggestions(t, list('ko').words, 'ko', 6, v).every((c) => !c.meaning.includes('cấm'))).toBe(true)
    })
})

// asked 2026-10-15: "sửa luôn 당신 cho tự nhiên" — cô đừng khóc gave 당신 울지 마세요
describe('the person spoken to', () => {
    const v = (l: string) => new Set<string>(JSON.parse(readFileSync(`public/dict/vi-${l}.json`, 'utf8')).verbs)
    const first = (t: string, l: string) => dictSuggestions(t, list(l).words, l as any, 6, v(l))[0]?.text
    it('is left out of an order, and picks the polite or familiar form', () => {
        expect(first('cô đừng khóc', 'ko')).toBe('울지 마세요')
        expect(first('cô đừng khóc', 'ja')).toBe('泣かない[なかない]でください')
        expect(first('cô đừng khóc', 'zh')).toBe('你[nǐ] 别[bié]哭[kū]')            // Chinese keeps 你: 你别哭 is natural
        expect(first('cô đừng khóc', 'es')).toBe('no llore')                       // cô → usted
        expect(first('em đừng khóc', 'es')).toBe('no llores')                      // em → tú
        expect(first('cô đừng khóc', 'fr')).toBe('ne pleurez pas')                 // cô → vous
        expect(first('bạn đừng khóc', 'fr')).toBe('ne pleure pas')
        expect(first('cô ngồi đi', 'ko')).toBe('앉으세요')
        expect(first('anh ngồi đi', 'es')).toBe('siéntese')
    })
    it('Korean and Japanese word by word leave it out at the start; alone it is still offered', () => {
        const chips = dictSuggestions('cô có sao không', list('ko').words, 'ko', 6, v('ko'))
        expect(chips[0].text.startsWith('당신')).toBe(false)
        expect(chips[0].text.startsWith('그쪽')).toBe(false)
        expect(chips[0].text).toBe('괜찮아요?')                                      // có sao không is one phrase (it gave 있다 왜 아니요)
        expect(dictSuggestions('cô', list('ko').words, 'ko').map((c) => c.text)).not.toContain('나')
        expect(dictSuggestions('cô', list('ko').words, 'ko')[0].text).toBe('그쪽')
        expect(composeSuggestions('제발 cô đừng đi', list('ko'), 'ko')[0].replace).toBe('제발 가지 마세요')
    })
    it('a person who is not spoken to stays (cô ấy = she)', () => {
        expect(dictSuggestions('cô ấy đẹp', list('ko').words, 'ko', 6, v('ko'))[0].meaning).toContain('cô ấy')
        expect(dictSuggestions('tôi đi', list('ko').words, 'ko', 6, v('ko'))[0].text.startsWith('저')).toBe(true)
    })
})

// asked 2026-10-15: "làm luôn cho tiếng Nhật あなた trong câu thường"
describe('Japanese (and Korean) ordinary sentences: no あなた / 당신', () => {
    const v = (l: string) => new Set<string>(JSON.parse(readFileSync(`public/dict/vi-${l}.json`, 'utf8')).verbs)
    const whole = (t: string, l: string) => dictSuggestions(t, list(l).words, l as any, 6, v(l)).find((c) => c.meaning.includes('từng chữ'))?.text ?? ''
    it('the person spoken to is left out anywhere in the sentence', () => {
        for (const t of ['tôi thích cô', 'cô ăn chưa', 'tôi muốn giúp bạn', 'anh đi đâu']) {
            expect(whole(t, 'ja'), t).not.toMatch(/あなた|そちら|君/)
            expect(whole(t, 'ko'), t).not.toMatch(/당신|그쪽/)
        }
        expect(dictSuggestions('cô có sao không', list('ja').words, 'ja', 6, v('ja'))[0].text).toBe('大丈夫[だいじょうぶ]ですか')
    })
    it('alone, cô is not あなた first; cô ấy stays 彼女; tôi stays', () => {
        expect(dictSuggestions('cô', list('ja').words, 'ja')[0].text).toBe('そちら')
        expect(dictSuggestions('bạn', list('ja').words, 'ja')[0].text).toBe('君[きみ]')
        expect(whole('cô ấy thích tôi', 'ja')).toMatch(/^彼女/)
        expect(whole('tôi thích cô', 'ja')).toMatch(/^私/)
    })
})

// asked 2026-10-15: "你 trong câu thường … tBn, pháp" — only Spanish drops the subject; Chinese, French, English need it
describe('the person spoken to, ordinary sentences in Chinese, Spanish, French', () => {
    const v = (l: string) => new Set<string>(JSON.parse(readFileSync(`public/dict/vi-${l}.json`, 'utf8')).verbs)
    const whole = (t: string, l: string) => dictSuggestions(t, list(l).words, l as any, 6, v(l)).find((c) => c.meaning.includes('từng chữ'))?.text ?? ''
    it('Spanish leaves out tú/usted as the subject, keeps it as the object', () => {
        expect(whole('cô ăn chưa', 'es')).not.toMatch(/^usted|^tú/)
        expect(whole('tôi thích cô', 'es')).toMatch(/usted|tú/)
    })
    it('Chinese and French keep it: 你/您, vous/tu', () => {
        expect(whole('tôi thích cô', 'zh')).toContain('你')
        expect(whole('ông ăn chưa', 'zh')).toMatch(/^您/)
        expect(whole('cô ăn chưa', 'fr')).toMatch(/^vous/)
    })
})

// asked 2026-10-15: "learning thêm 1 bảng tiếng anh làm tương tự mấy tiếng kia"
describe('English', () => {
    const v = new Set<string>(JSON.parse(readFileSync('public/dict/vi-en.json', 'utf8')).verbs)
    const first = (t: string) => dictSuggestions(t, list('en').words, 'en', 6, v)[0]?.text
    it('the word list reads Vietnamese the spoken way', () => {
        const w = list('en').words
        expect(w['tôi'][0]).toBe('I')
        expect(w['cô'][0]).toBe('you')
        expect(w['là'][0]).toBe('is')
        expect(w['ăn'][0]).toBe('eat')
        expect(w['cô ấy'][0]).toBe('she')
    })
    it('orders and do-nots: please first, no "you"', () => {
        expect(first('bình tĩnh đi')).toBe('please calm down')
        expect(first('cô đừng khóc')).toBe("please don't cry")
        expect(first('đừng lo')).toBe("don't worry")
        expect(first('tôi đi')?.startsWith('please')).toBe(false)
    })
    it('ordinary sentences keep "you"', () => {
        expect(dictSuggestions('tôi thích cô', list('en').words, 'en', 6, v)[0].text).toBe('I like you')
    })
    it('the chips are there before the readings list loads, and read once it has', async () => {
        const { setEnglishReadings } = await import('./vietji')
        expect(dictSuggestions('ăn', list('en').words, 'en')[0]).toMatchObject({ text: 'eat', vietji: '' })
        setEnglishReadings(JSON.parse(readFileSync('public/dict/en-vietji.json', 'utf8')).words)
        expect(dictSuggestions('ăn', list('en').words, 'en')[0].vietji).toBe('ít')
        setEnglishReadings(null)
    })
})
