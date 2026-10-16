// Vietnamese "đi" at the end of a sentence, after a verb, is the imperative ("bình tĩnh đi" = calm down!, "ngồi đi" = sit),
// not the verb "go" (asked 2026-10-15: "sửa luôn đuôi đi thành mệnh lệnh"). Word by word it gave 침착하다 가다. This turns the
// verb before it into the language's own imperative. Irregular verbs (asked the same day: "làm bảng động từ bất quy tắc"):
// by class where the language has classes (Korean ㄷ/ㅂ/ㅅ/르, Japanese godan る, Spanish -zca/-uir/-ger, French -indre/-uire…),
// a table for the ones that are their own (먹다 → 드세요, 来る, ir → ve, être → sois). A verb in neither may still come out
// wrong; the check after sending corrects it.
//
// Words come in the list's own form: Chinese and Japanese carry their reading in brackets (冷静[lěngjìng], 落ち着く[おちつく]).

import type { LearningLang } from './vietji'

/** Vietnamese words that, after a verb at the end of a sentence, make it an order or an urging. */
export const IMPERATIVE_VI = new Set(['đi', 'đi nào', 'đi mà'])
/** After a person, đi is the verb: "tôi đi" is I go, not an order. */
export const PERSON_VI = new Set(['tôi', 'tui', 'tao', 'mình', 'ta', 'bạn', 'cậu', 'mày', 'anh', 'chị', 'em', 'cô', 'chú', 'bác', 'ông', 'bà',
    'nó', 'họ', 'hắn', 'chúng tôi', 'chúng ta', 'chúng mình', 'tụi mình', 'cô ấy', 'anh ấy', 'ai'])
// ---- Korean -------------------------------------------------------------------------------------------------------------------
const H0 = 0xac00
const syl = (c: string) => { const n = c.charCodeAt(0) - H0; return n >= 0 && n < 11172 ? { l: Math.floor(n / 588), v: Math.floor((n % 588) / 28), t: n % 28 } : null }
const make = (l: number, v: number, t: number) => String.fromCharCode(H0 + l * 588 + v * 28 + t)
const V = { a: 0, ae: 1, ya: 2, eo: 4, e: 5, yeo: 6, o: 8, wa: 9, wae: 10, oe: 11, u: 13, wo: 14, eu: 18, i: 20 }
const T = { d: 7, l: 8, b: 17, s: 19 }
const NOT_ORDERS = new Set(['이다', '아니다', '없다'])
// what is said to someone politely is another verb: 먹다 → 드세요, 자다 → 주무세요
const KO_HONOR: Record<string, string> = { 먹다: '드세요', 마시다: '드세요', 자다: '주무세요', 있다: '계세요', 말하다: '말씀하세요' }
// the classes: the same final consonant is regular in other verbs (받다 받아, 입다 입어, 웃다 웃어), so they are listed
const KO_D = new Set(['듣다', '걷다', '묻다', '싣다', '깨닫다', '붇다', '긷다', '알아듣다'])                         // ㄷ → ㄹ: 들어
const KO_B = new Set(['돕다', '눕다', '굽다', '줍다', '춥다', '덥다', '쉽다', '어렵다', '가깝다', '무섭다', '귀엽다', '아름답다',
    '즐겁다', '반갑다', '고맙다', '부럽다', '더럽다', '가볍다', '무겁다', '두렵다', '괴롭다', '외롭다', '곱다', '밉다', '맵다', '시끄럽다', '부끄럽다'])  // ㅂ → 우: 누워
const KO_S = new Set(['낫다', '짓다', '붓다', '잇다', '젓다', '긋다'])                                               // ㅅ drops: 나아
const KO_REU = new Set(['부르다', '모르다', '고르다', '자르다', '오르다', '서두르다', '누르다', '흐르다', '기르다', '마르다', '다르다',
    '빠르다', '구르다', '가르다', '바르다', '지르다', '찌르다', '머무르다', '두르다', '게으르다'])          // 르 → ㄹ라/ㄹ러: 불러
const bright = (v: number) => v === V.a || v === V.o || v === V.ya

function koImperative(word: string): string[] {
    if (KO_HONOR[word]) return [KO_HONOR[word], koPlain(word)]
    if (!/^[\uAC00-\uD7A3]+다$/.test(word) || word.length < 2 || NOT_ORDERS.has(word)) return []
    return [koPolite(word), koPlain(word)]
}
// a feeling is not forbidden as itself: 무섭다 → 무서워하지 마세요 (do not be afraid), 슬프다 → 슬퍼하지 마세요
const KO_FEEL = new Set(['무섭다', '슬프다', '두렵다', '부끄럽다', '아프다', '외롭다', '괴롭다', '서운하다', '섭섭하다', '아쉽다', '귀찮다'])
/** Do not: stem + 지 마세요 / 지 마 (가지 마세요); a feeling takes 아/어하다 first. */
function koProhibitive(word: string): string[] {
    if (!/^[\uAC00-\uD7A3]+다$/.test(word) || word.length < 2 || NOT_ORDERS.has(word)) return []
    if (KO_FEEL.has(word) && !word.endsWith('하다')) { const p = koPlain(word); return [p + '하지 마세요', p + '하지 마'] }
    const stem = word.slice(0, -1)
    return [stem + '지 마세요', stem + '지 마']
}

/** stem + (으)세요; ㄹ drops (살다 → 사세요), ㄷ → ㄹ (들으세요), ㅂ → 우 (도우세요), ㅅ drops (나으세요). */
function koPolite(word: string): string {
    const stem = word.slice(0, -1), last = syl(stem.at(-1)!)!, before = stem.slice(0, -1)
    if (KO_D.has(word)) return before + make(last.l, last.v, T.l) + '으세요'
    if (KO_B.has(word)) return before + make(last.l, last.v, 0) + '우세요'
    if (KO_S.has(word)) return before + make(last.l, last.v, 0) + '으세요'
    return last.t === 0 ? stem + '세요' : last.t === T.l ? before + make(last.l, last.v, 0) + '세요' : stem + '으세요'
}
/** stem + 아/어, the vowels joined when there is no final consonant. */
function koPlain(word: string): string {
    const stem = word.slice(0, -1), last = syl(stem.at(-1)!)!, before = stem.slice(0, -1)
    const prev = before ? syl(before.at(-1)!) : null
    if (stem.endsWith('하')) return before + '해'
    if (KO_D.has(word)) return before + make(last.l, last.v, T.l) + (bright(last.v) ? '아' : '어')
    if (KO_B.has(word)) return before + (word === '돕다' || word === '곱다' ? make(last.l, last.v, 0) + '와' : make(last.l, last.v, 0) + '워')
    if (KO_S.has(word)) return before + make(last.l, last.v, 0) + (bright(last.v) ? '아' : '어')
    if (KO_REU.has(word) && prev) return before.slice(0, -1) + make(prev.l, prev.v, T.l) + (bright(prev.v) ? '라' : '러')
    if (last.t !== 0) return stem + (bright(last.v) ? '아' : '어')
    // ㅡ goes, taking the vowel before it: 아프다 → 아파, 바쁘다 → 바빠, 쓰다 → 써
    if (last.v === V.eu) return before + make(last.l, prev && bright(prev.v) ? V.a : V.eo, 0)
    const join: Record<number, number> = { [V.a]: V.a, [V.o]: V.wa, [V.u]: V.wo, [V.i]: V.yeo, [V.eo]: V.eo, [V.e]: V.e, [V.ae]: V.ae, [V.yeo]: V.yeo, [V.oe]: V.wae }
    const v = join[last.v]
    return v === undefined ? stem + '어' : before + make(last.l, v, 0)
}

// ---- Japanese: the te-form, then ください -----------------------------------------------------------------------------------------
// る after an i/e sound is usually ichidan (食べる → 食べて); these godan ones look the same (帰る → 帰って). By the kanji where
// the reading is shared (切る 切って, 着る 着て; 要る 要って, 居る 居て), by the reading for a word in kana.
const GODAN_RU_KANJI = ['帰る', '入る', '走る', '知る', '切る', '要る', '減る', '滑る', '喋る', '限る', '蹴る', '焦る', '参る', '握る', '散る',
    '弄る', '照る', '練る', '遮る', '茂る', '湿る', '陥る', '翻る', '罵る', '蘇る', '甦る', '捻る', '混じる', '交じる', '覆る', '嘲る']
const GODAN_RU = ['かえる', 'はいる', 'はしる', 'しる', 'へる', 'すべる', 'しゃべる', 'かぎる', 'ける', 'あせる', 'まいる', 'にぎる', 'ちる', 'いじる']
const I_E_ROW = /[いきぎしじちぢにひびぴみりえけげせぜてでねへべぺめれ]$/
const TE: Record<string, string> = { う: 'って', つ: 'って', る: 'って', む: 'んで', ぶ: 'んで', ぬ: 'んで', く: 'いて', ぐ: 'いで', す: 'して' }
/** Not given as orders: ある (there is), the copula and the polite endings. */
const JA_NOT = /(?:^ある|です|ます|だろう|でしょう)$/

function ichidan(kana: string, surface: string): boolean {
    if (!kana.endsWith('る')) return false
    const godanRu = surface !== kana ? GODAN_RU_KANJI.some((g) => surface.endsWith(g)) : GODAN_RU.some((g) => kana === g || (kana.endsWith(g) && g.length >= 3))
    return !godanRu && I_E_ROW.test(kana.slice(0, -1))
}
const NAI: Record<string, string> = { う: 'わ', く: 'か', ぐ: 'が', す: 'さ', つ: 'た', ぬ: 'な', ぶ: 'ば', む: 'ま', る: 'ら' }
/** The ない form: 行く → 行かない, 食べる → 食べない, する → しない, 来る → こない. */
export function naiForm(kana: string, surface = kana): string | null {
    if (kana.endsWith('する')) return kana.slice(0, -2) + 'しない'
    if (surface.endsWith('来る') || kana === 'くる') return kana.slice(0, -2) + 'こない'
    if (kana === 'ある') return null
    if (ichidan(kana, surface)) return kana.slice(0, -1) + 'ない'
    const end = kana.at(-1)!
    return NAI[end] ? kana.slice(0, -1) + NAI[end] + 'ない' : null
}

export function teForm(kana: string, surface = kana): string | null {
    if (kana.endsWith('する')) return kana.slice(0, -2) + 'して'
    if (surface.endsWith('来る') || kana === 'くる') return kana.slice(0, -2) + 'きて'
    if (surface.endsWith('行く') || kana === 'いく' || kana === 'ゆく') return kana.slice(0, -1) + 'って'
    if (surface.endsWith('問う') || surface.endsWith('請う') || kana === 'とう' || kana === 'こう') return kana + 'て'   // 問うて, not 問って
    const stem = kana.slice(0, -1), end = kana.at(-1)!
    if (ichidan(kana, surface)) return stem + 'て'
    return TE[end] ? stem + TE[end] : null
}

/** The verb with its ending changed by `change` (te or nai), the kanji kept and the reading in brackets. */
function jaInflect(word: string, change: (kana: string, surface: string) => string | null, kuruAs: string): string | null {
    const m = /^([^[\]]+)(?:\[([^\]]+)\])?$/.exec(word)
    if (!m) return null
    const surface = m[1], reading = m[2] ?? surface
    if (!/[うくぐすつぬぶむる]$/.test(surface) || JA_NOT.test(reading)) return null
    const te = change(reading, surface)
    if (!te) return null
    let s: string
    if (surface.endsWith('来る')) s = surface.slice(0, -2) + kuruAs          // 持って来る → 持って来て: the kanji stays, the reading changes
    else {
        let p = 0
        while (p < reading.length && reading[p] === te[p]) p++
        const changed = reading.slice(p)                    // the kana at the end that change (る, く, する…); none for 問う → 問うて
        if (changed && !surface.endsWith(changed)) return null
        s = surface.slice(0, surface.length - changed.length) + te.slice(p)
    }
    return s === te ? s : `${s}[${te}]`
}
function jaImperative(word: string): string[] {
    const form = jaInflect(word, teForm, '来て')
    return form ? [form + 'ください', form] : []
}
/** Do not: the ない form + で(ください): 行かないでください, 食べないで. */
function jaProhibitive(word: string): string[] {
    const form = jaInflect(word, naiForm, '来ない')
    return form ? [form + 'でください', form + 'で'] : []
}

// ---- Chinese: no ending; the word that fits after it -------------------------------------------------------------------------
// 吧 urges (坐吧, 走吧); 请 asks politely (请坐); a state is told with 点 (冷静点, 小心点); a short action with 一下 (等一下).
const ZH_DIAN = new Set(['冷静', '安静', '小心', '快', '慢', '认真', '耐心', '大声', '小声', '勇敢', '坚强', '乖', '专心', '轻', '仔细', '清醒', '镇定', '放松', '高兴', '开心'])
const ZH_YIXIA = new Set(['等', '看', '听', '试', '休息', '想', '帮', '问', '介绍', '说明', '检查', '准备', '解释', '尝', '停'])
/** The person spoken to ("cô đừng khóc"): Korean and Japanese leave them out (당신, あなた sound cold or rude), and an order
 *  never names them in Spanish or French either. The polite ones ask for usted/vous, the familiar ones for tú/tu. */
export const ADDRESSEE_POLITE = new Set(['cô', 'chú', 'bác', 'ông', 'bà', 'anh', 'chị'])
export const ADDRESSEE_FAMILIAR = new Set(['bạn', 'cậu', 'mày', 'em'])
export const isAddressee = (vi: string) => ADDRESSEE_POLITE.has(vi) || ADDRESSEE_FAMILIAR.has(vi)
/** Languages that do not say the person spoken to: in an order (all but Chinese), in any sentence (Korean, Japanese). */
export const DROPS_ADDRESSEE_IN_ORDER = new Set(['ko', 'ja', 'es', 'fr'])
export const DROPS_ADDRESSEE = new Set(['ko', 'ja'])
const PERSON_ZH = /^(?:我|你|您|他|她|它|我们|你们|他们|她们|咱们|大家)$/

function zhImperative(word: string): string[] {
    const plain = word.replace(/\[[^\]]*\]/g, '')
    if (!/[\u3400-\u9fff]/.test(plain) || plain.includes('吧') || PERSON_ZH.test(plain)) return []
    if (ZH_DIAN.has(plain)) return [word + '点[diǎn]', word + '一点[yìdiǎn]']
    if (ZH_YIXIA.has(plain)) return [word + '一下[yíxià]', word + '吧[ba]']
    return [word + '吧[ba]', '请[qǐng]' + word]
}

// ---- Spanish: tú, then usted --------------------------------------------------------------------------------------------------
// verbs that are their own (tú, usted); the -se forms are built from them (ponte, póngase; vete, váyase)
const ES_OWN: Record<string, [string, string]> = {
    tener: ['ten', 'tenga'], venir: ['ven', 'venga'], poner: ['pon', 'ponga'], salir: ['sal', 'salga'], hacer: ['haz', 'haga'],
    decir: ['di', 'diga'], ir: ['ve', 'vaya'], ser: ['sé', 'sea'], ver: ['ve', 'vea'], dar: ['da', 'dé'], estar: ['está', 'esté'],
    saber: ['sabe', 'sepa'], oír: ['oye', 'oiga'], traer: ['trae', 'traiga'], caer: ['cae', 'caiga'], reír: ['ríe', 'ría'],
    sonreír: ['sonríe', 'sonría'], freír: ['fríe', 'fría'], seguir: ['sigue', 'siga'], conseguir: ['consigue', 'consiga'],
    elegir: ['elige', 'elija'], corregir: ['corrige', 'corrija'], enviar: ['envía', 'envíe'], confiar: ['confía', 'confíe'],
    guiar: ['guía', 'guíe'], esquiar: ['esquía', 'esquíe'], continuar: ['continúa', 'continúe'], actuar: ['actúa', 'actúe'],
    mantener: ['mantén', 'mantenga'], obtener: ['obtén', 'obtenga'], detener: ['detén', 'detenga'], contener: ['contén', 'contenga'],
    suponer: ['supón', 'suponga'], componer: ['compón', 'componga'], deshacer: ['deshaz', 'deshaga'], satisfacer: ['satisface', 'satisfaga'],
    prevenir: ['prevén', 'prevenga'], oler: ['huele', 'huela'], jugar: ['juega', 'juegue'],
}
// stem-changing verbs: the stressed stem vowel changes (pensar → piensa, dormir → duerme, pedir → pide)
const ES_STEM: Record<string, string> = {
    pensar: 'piens', cerrar: 'cierr', empezar: 'empiez', comenzar: 'comienz', sentar: 'sient', despertar: 'despiert', calentar: 'calient',
    confesar: 'confies', negar: 'nieg', regar: 'rieg', entender: 'entiend', perder: 'pierd', encender: 'enciend', defender: 'defiend',
    querer: 'quier', sentir: 'sient', mentir: 'mient', preferir: 'prefier', divertir: 'diviert', convertir: 'conviert',
    dormir: 'duerm', morir: 'muer', volver: 'vuelv', devolver: 'devuelv', resolver: 'resuelv', mover: 'muev', contar: 'cuent',
    mostrar: 'muestr', acostar: 'acuest', encontrar: 'encuentr', recordar: 'recuerd', acordar: 'acuerd', probar: 'prueb', soñar: 'sueñ',
    volar: 'vuel', sonar: 'suen', colgar: 'cuelg', soltar: 'suelt', almorzar: 'almuerz', costar: 'cuest',
    pedir: 'pid', repetir: 'repit', servir: 'sirv', vestir: 'vist', despedir: 'despid', medir: 'mid', impedir: 'impid',
}
/** Verbs that are not given as orders: gustar is said of the thing liked (me gusta), not told to someone. */
const ES_NO_ORDER = new Set(['gustar', 'parecer', 'doler', 'importar', 'faltar', 'haber', 'poder', 'deber', 'soler', 'encantar', 'llover', 'nevar'])
const STRONG: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' }

/** A pronoun put on the end moves the stress back: calma + te → cálmate (the vowel of the stressed syllable gets its mark). */
function accentForClitic(form: string): string {
    const groups = [...form.matchAll(/[aeiouáéíóú]+/g)]
    if (groups.length < 2 || /[áéíóú]/.test(form)) return form
    const g = groups[groups.length - 2]
    const k = g[0].search(/[aeo]/) >= 0 ? g[0].search(/[aeo]/) : g[0].length - 1
    const at = g.index! + k
    return form.slice(0, at) + STRONG[form[at]] + form.slice(at + 1)
}

/** [tú order, usted order (the subjunctive)] and whether it is a -se verb; null when not an infinitive. */
function esForms(word: string): { pair: [string, string]; se: boolean } | null {
    const m = /^([a-zñáéíóú]*?)(ar|er|ir|ír)(se)?$/.exec(word.toLowerCase())
    if (!m) return null
    const [, plainStem, end, se] = m
    const inf = plainStem + end
    if (ES_NO_ORDER.has(inf)) return null
    let pair = ES_OWN[inf]
    if (!pair) {
        const stem = ES_STEM[inf] ?? plainStem
        const ar = end === 'ar'
        let usted: string
        if (ar) usted = (stem.endsWith('c') ? stem.slice(0, -1) + 'qu' : stem.endsWith('g') ? stem + 'u' : stem.endsWith('z') ? stem.slice(0, -1) + 'c' : stem) + 'e'
        else if (/[aeiou]c$/.test(stem)) usted = stem.slice(0, -1) + 'zca'               // conocer → conozca, conducir → conduzca
        else if (stem.endsWith('c')) usted = stem.slice(0, -1) + 'za'                    // vencer → venza
        else if (stem.endsWith('gu')) usted = stem.slice(0, -1) + 'a'                    // distinguir → distinga
        else if (stem.endsWith('g')) usted = stem.slice(0, -1) + 'ja'                    // coger → coja, dirigir → dirija
        else if (/[^gq]u$/.test(stem)) usted = stem + 'ya'                               // construir → construya
        else usted = stem + 'a'
        const tu = ar ? stem + 'a' : /[^gq]u$/.test(stem) && end === 'ir' ? stem + 'ye' : stem + 'e'
        pair = [tu, usted]
    }
    return { pair, se: !!se }
}
function esImperative(word: string): string[] {
    const f = esForms(word)
    if (!f) return []
    return f.se ? [accentForClitic(f.pair[0]) + 'te', accentForClitic(f.pair[1]) + 'se'] : [...f.pair]
}
/** Do not: no + the subjunctive, the tú one is usted's + s (no corras, no se preocupe; no te vayas). */
function esProhibitive(word: string): string[] {
    const f = esForms(word)
    if (!f) return []
    const usted = f.pair[1], tu = usted === 'dé' ? 'des' : usted + 's'
    return f.se ? [`no te ${tu}`, `no se ${usted}`] : [`no ${tu}`, `no ${usted}`]
}

// ---- French: tu, then vous ----------------------------------------------------------------------------------------------------
// verbs that are their own; the families below are built by rule (-indre, -uire, -ttre, -prendre, -venir/-tenir, -crire, -cevoir,
// -vrir/-frir/-llir, partir/dormir…, -yer, -eler/-eter)
const FR: Record<string, [string, string]> = {
    aller: ['va', 'allez'], être: ['sois', 'soyez'], avoir: ['aie', 'ayez'], faire: ['fais', 'faites'], dire: ['dis', 'dites'],
    courir: ['cours', 'courez'], mourir: ['meurs', 'mourez'], voir: ['vois', 'voyez'], lire: ['lis', 'lisez'], asseoir: ['assieds', 'asseyez'],
    taire: ['tais', 'taisez'], plaire: ['plais', 'plaisez'], boire: ['bois', 'buvez'], croire: ['crois', 'croyez'], suivre: ['suis', 'suivez'],
    vivre: ['vis', 'vivez'], rire: ['ris', 'riez'], sourire: ['souris', 'souriez'], savoir: ['sache', 'sachez'], vouloir: ['veuille', 'veuillez'],
    connaître: ['connais', 'connaissez'], reconnaître: ['reconnais', 'reconnaissez'], paraître: ['parais', 'paraissez'],
    interdire: ['interdis', 'interdisez'], prédire: ['prédis', 'prédisez'], vaincre: ['vaincs', 'vainquez'], convaincre: ['convaincs', 'convainquez'],
    rompre: ['romps', 'rompez'], interrompre: ['interromps', 'interrompez'],
}
const FR_DOUBLE = new Set(['appeler', 'rappeler', 'épeler', 'renouveler', 'jeter', 'rejeter', 'projeter', 'feuilleter'])
const FR_TIR = /(?:partir|sortir|sentir|mentir|dormir|servir)$/                // 3rd group: pars, dors, sers (not finir's -is)
/** e or é before the last consonant opens to è in the tu form: acheter → achète, lever → lève, préférer → préfère. */
const openE = (stem: string) => stem.replace(/[eé]([bcdfghjklmnpqrstvz])$/, 'è$1')

function frForms(inf: string): [string, string] | null {
    if (FR[inf]) return FR[inf]
    const cut = (n: number) => inf.slice(0, -n)
    if (/(?:ai|ei|oi)ndre$/.test(inf)) return [cut(3) + 's', cut(4) + 'gnez']              // crains, craignez
    if (inf.endsWith('prendre')) return [cut(2) + 's', cut(3) + 'ez']                       // apprends, apprenez
    if (inf.endsWith('uire')) return [cut(2) + 's', cut(2) + 'sez']                         // construis, construisez
    if (inf.endsWith('ttre')) return [cut(3) + 's', cut(2) + 'ez']                          // bats, battez; mets, mettez
    if (inf.endsWith('crire')) return [cut(2) + 's', cut(2) + 'vez']                        // écris, écrivez
    if (/[vt]enir$/.test(inf)) return [cut(4) + 'iens', cut(4) + 'enez']                    // viens, venez; tiens, tenez
    if (inf.endsWith('cevoir')) return [cut(6) + 'çois', cut(6) + 'cevez']                  // reçois, recevez
    if (/(?:vrir|frir|llir)$/.test(inf)) return [cut(2) + 'e', cut(2) + 'ez']               // ouvre, cueille
    if (FR_TIR.test(inf)) return [cut(3) + 's', cut(2) + 'ez']                             // pars, partez
    if (inf.endsWith('yer')) return [cut(3) + 'ie', cut(2) + 'ez']                          // paie, payez; envoie, envoyez
    if (FR_DOUBLE.has(inf)) return [cut(2) + inf.at(-3) + 'e', cut(2) + 'ez']              // appelle, jette
    if (inf.endsWith('er')) return [openE(cut(2)) + 'e', cut(2) + 'ez']
    if (inf.endsWith('ir')) return [cut(2) + 'is', cut(2) + 'issez']                       // finis, finissez
    if (inf.endsWith('dre')) return [cut(2) + 's', cut(2) + 'ez']                          // attends; only -dre: sincère, libre are not verbs
    return null
}

const VOWEL_START = /^[aeiouyhâàéèêîïôûœ]/
/** Do not: ne … pas around the order (n' and t' before a vowel): ne pars pas, n'aie pas, ne t'inquiète pas. */
function frProhibitive(word: string): string[] {
    const w = word.toLowerCase().replace(/’/g, "'")
    if (w === "s'en aller") return ["ne t'en va pas", 'ne vous en allez pas']
    const m = /^(?:se |s')?([a-zàâçéèêëîïôûùüÿœ]+)$/.exec(w)
    if (!m) return []
    const forms = frForms(m[1])
    if (!forms) return []
    const ne = (v: string) => (VOWEL_START.test(v) ? `n'${v}` : `ne ${v}`)
    if (/^(?:se |s')/.test(w)) {
        const te = VOWEL_START.test(forms[0]) ? `t'${forms[0]}` : `te ${forms[0]}`
        return [`ne ${te} pas`, `ne vous ${forms[1]} pas`]
    }
    return [`${ne(forms[0])} pas`, `${ne(forms[1])} pas`]
}

function frImperative(word: string): string[] {
    const w = word.toLowerCase().replace(/’/g, "'")
    if (w === "s'en aller") return ["va-t'en", 'allez-vous-en']
    const m = /^(?:se |s')?([a-zàâçéèêëîïôûùüÿœ]+)$/.exec(w)
    if (!m) return []
    const forms = frForms(m[1])
    if (!forms) return []
    return /^(?:se |s')/.test(w) ? [`${forms[0]}-toi`, `${forms[1]}-vous`] : [...forms]
}

/** Vietnamese words that, before a verb, forbid it ("đừng đi" = do not go). */
export const PROHIBIT_VI = new Set(['đừng', 'chớ', 'đừng có', 'không được'])

/** The verb in the list's own form made a "do not": the polite or usual one first. Not a verb: []. */
export function prohibitive(word: string, lang: LearningLang): string[] {
    const w = (word ?? '').trim()
    if (!w) return []
    if (lang === 'ko') return koProhibitive(w)
    if (lang === 'ja') return jaProhibitive(w)
    if (lang === 'es') return esProhibitive(w)
    if (lang === 'fr') return frProhibitive(w)
    if (lang === 'zh') {
        const plain = w.replace(/\[[^\]]*\]/g, '')
        return /[\u3400-\u9fff]/.test(plain) && !PERSON_ZH.test(plain) && !/^(?:别|不要)/.test(plain) ? ['别[bié]' + w, '不要[búyào]' + w] : []
    }
    return []
}

/** The verb in the list's own form made an order: the polite or usual one first. Not a verb (or unsure): []. */
export function imperative(word: string, lang: LearningLang): string[] {
    const w = (word ?? '').trim()
    if (!w) return []
    if (lang === 'ko') return koImperative(w)
    if (lang === 'ja') return jaImperative(w)
    if (lang === 'es') return esImperative(w)
    if (lang === 'fr') return frImperative(w)
    if (lang === 'zh') return zhImperative(w)
    return []
}
