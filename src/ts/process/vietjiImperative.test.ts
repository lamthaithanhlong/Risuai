import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { imperative, teForm } from './vietjiImperative'
import { composeSuggestions, dictSuggestions } from './vietjiDict'

// asked 2026-10-15: "sửa luôn đuôi đi thành mệnh lệnh" — 침착하다 đi gave 침착하다 가다
describe('the order of a verb, regular forms', () => {
    it.each([
        ['침착하다', '침착하세요', '침착해'], ['가다', '가세요', '가'], ['앉다', '앉으세요', '앉아'], ['먹다', '먹으세요', '먹어'],
        ['마시다', '마시세요', '마셔'], ['오다', '오세요', '와'], ['보다', '보세요', '봐'], ['주다', '주세요', '줘'], ['살다', '사세요', '살아'],
        ['쓰다', '쓰세요', '써'], ['서다', '서세요', '서'], ['기다리다', '기다리세요', '기다려'], ['진정하다', '진정하세요', '진정해'],
    ])('Korean %s → %s, %s', (w, polite, plain) => expect(imperative(w, 'ko')).toEqual([polite, plain]))
    it('Korean: not a verb, or the copula, gives nothing', () => {
        for (const w of ['나', '이다', '아니다', '있다', '집']) expect(imperative(w, 'ko')).toEqual([])
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
        expect(imperative('冷静[lěngjìng]', 'zh')).toEqual(['冷静[lěngjìng]吧[ba]'])
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
    })
    it('"tôi đi" is I go: no order', () => {
        for (const l of ['ko', 'zh', 'ja', 'es', 'fr']) {
            expect(dictSuggestions('tôi đi', list(l).words, l as any).every((c) => !c.meaning.includes('mệnh lệnh'))).toBe(true)
        }
        expect(composeSuggestions('我 đi', list('zh'), 'zh').every((c) => !c.meaning.includes('mệnh lệnh'))).toBe(true)
    })
})
